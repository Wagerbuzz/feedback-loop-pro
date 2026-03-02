

# Improve Web Search Source Discovery

## Problem

The web search phase is bad at finding new, unexpected sources (blogs, Substacks, newsletters, community forums, YouTube comments, podcasts) because:

1. **~75% of queries are locked to known sites** via `site:reddit.com`, `site:g2.com`, `site:trustradius.com` constraints in brand-profile query generation. Only open-web queries can discover new sources.
2. **Hard brand-mention pre-filter** on line 533 of collect-feedback discards pages before AI extraction if the scraped text doesn't literally contain the brand name. Many blog posts, newsletters, and forum threads reference the product in titles/headers but not body text.
3. **No discovery-oriented query templates** - queries like "{brand} blog review", "{brand} newsletter", "{brand} podcast mention" don't exist.
4. **Sequential requests with 1s delay** between each query (line 667) wastes time budget.

## Solution

### 1. Restructure query generation for discovery (brand-profile)

Split queries into two categories:
- **Targeted queries** (~40%): Use specific `site:` constraints for known high-value platforms (Capterra, ProductHunt, HackerNews) that aren't already covered by direct phases
- **Discovery queries** (~60%): Open web with no `site:` constraint, using diverse templates designed to surface blogs, newsletters, community posts

Add new discovery-oriented intent buckets:

```text
Existing (keep):
  pain: "{brand} frustrating", "{brand} issues"
  churn: "{brand} switching from", "left {brand} for"
  comparison: "{brand} vs", "{brand} compared to"
  pricing: "{brand} pricing", "{brand} expensive"
  feature_experience: "{brand} {feature} experience"
  praise: "{brand} love", "{brand} recommend"

New discovery buckets:
  blog_review: "{brand} review blog", "{brand} honest review", "{brand} deep dive"
  newsletter: "{brand} newsletter review", "{brand} substack", "{brand} analysis"
  community: "{brand} forum discussion", "{brand} community feedback", "{brand} user experience"
  video: "{brand} review youtube", "{brand} walkthrough"
  case_study: "{brand} case study", "using {brand} for", "{brand} workflow"
```

Change domain constraints from random to deterministic:
- Remove `site:reddit.com` (has dedicated phase)
- Remove `site:g2.com` and `site:trustradius.com` (will be handled by direct scraping)
- New constraints cycle: `["site:capterra.com", "site:producthunt.com", "site:news.ycombinator.com", ""]`
- Ensure at least 60% of queries have no site constraint (open discovery)

Increase query cap from 20 to 25.

### 2. Replace hard brand filter with soft scoring (collect-feedback)

Currently line 533 does:
```typescript
if (!hasBrandMention) continue; // Hard skip - kills discovery
```

Replace with a soft relevance check that allows pages through if they have contextual signals of relevance:

```typescript
const hasBrandMention = brandTerms.some(t => lowerContent.includes(t.toLowerCase()));
const hasProductMention = (company.product_terms || []).some(t => lowerContent.includes(t.toLowerCase()));
const hasDomainMention = company.domain && lowerContent.includes(company.domain.toLowerCase());
const urlMentionsBrand = brandTerms.some(t => urlLower.includes(t.toLowerCase()));

// Allow page if ANY relevance signal is present
const isRelevant = hasBrandMention || hasProductMention || hasDomainMention || urlMentionsBrand;
if (!isRelevant) continue;
```

This means a blog post at `myblog.com/airops-review` passes even if the body text uses "the platform" instead of repeating "AirOps". Product term mentions (e.g., "workflow builder") and domain mentions also qualify.

### 3. Parallelize web search requests

Replace the sequential loop with batched parallel processing:

```text
Before:
  Query 1 -> 1s wait -> Query 2 -> 1s wait -> Query 3 -> ...
  ~3s per query = ~13 queries in 40s

After:
  [Query 1, Query 2, Query 3] -> [Query 4, Query 5, Query 6] -> ...
  ~3s per batch of 3 = ~39 queries worth in 40s (capped at 25)
```

- Process 3 queries concurrently using `Promise.allSettled`
- Remove the 1s inter-query delay (line 667)
- Check time budget after each batch, not each query

### 4. Add URL deduplication within a run

Track all scraped URLs in a `Set<string>` across all phases (direct scraping, web search, Reddit) to avoid processing the same page twice when it appears in multiple query results.

## Technical Details

### File: `supabase/functions/brand-profile/index.ts`

**Query generation overhaul** (lines 116-145):

- Add new intent buckets for blog/newsletter/community/video/case_study discovery
- Replace `domainConstraints` with deterministic cycling that prioritizes open web
- Use index-based cycling (`index % constraints.length`) instead of `Math.random()`
- Increase cap from 20 to 25 queries
- Ensure discovery buckets always use open web (no `site:` constraint)

### File: `supabase/functions/collect-feedback/index.ts`

**Soft relevance filter** (replace line 530-533):
- Check brand terms, product terms, domain, and URL for relevance signals
- Only skip if none of these signals are present
- Pass a `pageRelevanceContext` string to the AI prompt so it knows what signal matched

**Parallel batching** (replace lines 487-671):
- Wrap query processing in a `processQuery` helper function
- Batch queries in groups of 3 using `Promise.allSettled`
- Remove `await new Promise(r => setTimeout(r, 1000))` delay
- Add `scrapedUrls: Set<string>` tracking, skip URLs already seen

**Enhanced AI prompt** (line 549):
- Add instruction: "This page was found via a web search for feedback about {company}. Even if it's a blog post or newsletter that discusses the product indirectly, extract any user opinions or experiences mentioned."

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/brand-profile/index.ts` | Add discovery query templates, fix domain constraints, deterministic cycling, increase cap to 25 |
| `supabase/functions/collect-feedback/index.ts` | Replace hard brand filter with soft relevance scoring, parallelize web search in batches of 3, add URL deduplication, enhance AI extraction prompt for indirect mentions |

## Expected Outcome

- 60% of queries now search the open web (up from ~25%), dramatically increasing chances of finding blogs, Substacks, newsletters, and forums
- Pages that mention the product by URL, domain, or product feature name no longer get discarded
- 2-3x more queries processed per run via parallelization
- New query templates specifically target blog reviews, newsletters, community discussions, and case studies
- No duplicate processing of the same URL across phases

