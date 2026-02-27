

# Comprehensive Feedback Collection Expansion

## Current Limitations

The collection pipeline currently relies solely on Firecrawl web search, which is a general-purpose scraper. This creates several gaps:

- **Shallow search depth**: Only 5 results per query, 15 queries max = 75 pages ceiling
- **Reddit**: `site:reddit.com` queries exist but Firecrawl often gets blocked or returns few results from Reddit
- **Twitter/X**: Zero coverage -- no integration exists
- **Review sites**: Only scrapes the first page of results; G2 and TrustRadius have paginated reviews that are missed

## Plan

### 1. Increase Firecrawl Search Depth

Simple but effective -- increase `limit` from 5 to 10 per query and raise the query cap from 15 to 25. This alone could roughly double the feedback collected from web sources.

**File**: `supabase/functions/collect-feedback/index.ts`
- Change `limit: 5` to `limit: 10`
- Change `queries.slice(0, 15)` to `queries.slice(0, 25)`

### 2. Add Dedicated Reddit Collection

Use Reddit's public JSON API (no API key required) to search subreddits for brand mentions and extract comments. This is far more reliable than scraping Reddit through Firecrawl.

**Approach**:
- For each brand, search Reddit via `https://www.reddit.com/search.json?q={brand}&sort=relevance&limit=25`
- Also target specific subreddits (e.g., `/r/mongodb/search.json`, `/r/database/search.json`)
- For each relevant post, fetch comments via `https://www.reddit.com/comments/{post_id}.json`
- Extract individual comments as feedback items using the same AI extraction pipeline
- Reddit's JSON API is public and rate-limited to ~60 requests/minute (no key needed)

**File**: `supabase/functions/collect-feedback/index.ts`
- Add a new `collectRedditFeedback()` function that runs after the Firecrawl phase
- Generates subreddit targets from the company's industry type
- Source labeled as "Reddit" with direct permalink URLs

### 3. Add Twitter/X Collection

Twitter requires API credentials but provides access to real-time customer sentiment. The X API v2 search endpoint can find recent tweets mentioning the brand.

**Approach**:
- Use the X API v2 Recent Search endpoint: `GET https://api.x.com/2/tweets/search/recent`
- Search for brand mentions (e.g., `"MongoDB" -is:retweet lang:en`)
- Extract tweet text, author, and engagement metrics
- Requires 4 secrets: `TWITTER_CONSUMER_KEY`, `TWITTER_CONSUMER_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`

**File**: `supabase/functions/collect-feedback/index.ts`
- Add a `collectTwitterFeedback()` function
- Source labeled as "Twitter" with tweet permalink URLs
- Only runs if Twitter secrets are configured (gracefully skipped otherwise)

### 4. Add Source-Specific Search Queries During Brand Profiling

Update the brand-profile function to generate Reddit and Twitter-specific search queries alongside the existing web queries.

**File**: `supabase/functions/brand-profile/index.ts`
- Add `reddit_subreddits` field to the AI extraction (e.g., ["mongodb", "database", "devops"])
- Store these on the company record for targeted Reddit collection

### 5. UI: Show Collection Sources and Enable/Disable Per Source

Update CompanySetup to show which sources are active and let users toggle them.

**File**: `src/components/settings/CompanySetup.tsx`
- Add checkboxes for collection sources: Web, Reddit, Twitter
- Show Twitter as "requires API keys" with a setup link if secrets aren't configured
- Display source breakdown in collection run results

### 6. Database Changes

Add columns to track source-specific configuration:

```sql
ALTER TABLE public.companies
  ADD COLUMN reddit_subreddits jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN collection_sources jsonb DEFAULT '["web", "reddit"]'::jsonb;
```

## Impact Estimate

| Source | Current | After Changes |
|--------|---------|---------------|
| Web (Firecrawl) | ~75 pages/run | ~250 pages/run |
| Reddit | ~0 (unreliable via Firecrawl) | ~50-100 posts + comments/run |
| Twitter/X | 0 | ~100 tweets/run (if configured) |
| Review sites | First page only | Same (future: pagination) |

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/collect-feedback/index.ts` | Increase limits, add Reddit JSON API collection, add Twitter API collection |
| `supabase/functions/brand-profile/index.ts` | Generate reddit_subreddits during profiling |
| `src/components/settings/CompanySetup.tsx` | Source toggles, Twitter setup prompt |
| Database migration | Add `reddit_subreddits` and `collection_sources` columns to companies |

## Secrets Required

- **Reddit**: None (public JSON API)
- **Twitter/X**: 4 secrets needed -- user will be prompted to provide them. Twitter collection is optional and gracefully skipped if not configured.

