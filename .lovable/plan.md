

# Fix Reddit and Twitter Collection

## Problems Found

1. **Edge function timeout**: The web collection phase (17 queries x 10 results) takes so long that the function times out (~60s limit) before Reddit and Twitter phases ever execute.

2. **Empty subreddits**: All companies have `reddit_subreddits: []` because they were profiled before the subreddit discovery feature was added. This limits Reddit to only a generic global search.

3. **Reddit blocking**: Reddit's public JSON API often rejects requests with generic User-Agent strings (403/429 errors), and the function has no logging for these failures that would surface clearly.

4. **No timeout awareness**: The function doesn't track elapsed time, so it blindly runs all web queries even when there's no time left for Reddit/Twitter.

## Solution

### 1. Add time-budget management
Track elapsed time in the main handler. Allocate roughly 30s to web, 15s to Reddit, 15s to Twitter. When the web phase exceeds its budget, stop early and move on to Reddit/Twitter.

### 2. Reduce web query count for multi-source runs
When Reddit and Twitter are also enabled, limit web queries to 15 (instead of 25) to leave time for the other sources.

### 3. Fix Reddit User-Agent
Change the User-Agent to a more realistic browser-like string to avoid Reddit's automated request blocking. Also add better error logging.

### 4. Backfill subreddits for existing companies
Add a step that auto-generates subreddit suggestions based on the company's industry_type if `reddit_subreddits` is empty, so existing companies benefit from targeted subreddit searches.

### 5. Add diagnostic logging
Add clear log lines at the start of each phase ("Starting Reddit phase...", "Starting Twitter phase...") and log any HTTP errors with status codes so failures are visible in logs.

## Technical Details

### File: `supabase/functions/collect-feedback/index.ts`

**Time budget logic** (add to main handler before Phase 1):
```typescript
const startTime = Date.now();
const TIME_BUDGET_MS = 55000; // 55s total (leave 5s margin)
const hasMultipleSources = collectionSources.length > 1;
const webQueryLimit = hasMultipleSources ? 15 : 25;
const webBudgetMs = hasMultipleSources ? 30000 : 45000;
```

**Web phase**: Check elapsed time each iteration, break early if over budget. Use `webQueryLimit` instead of hardcoded 25.

**Reddit phase**: 
- Change User-Agent to `Mozilla/5.0 (compatible; FeedbackBot/1.0)`
- Add fallback subreddits based on industry_type when `reddit_subreddits` is empty (e.g., for SEO tools: `["SEO", "bigseo", "digital_marketing"]`)
- Add `console.log("Starting Reddit collection phase...")` before the call

**Twitter phase**:
- Add `console.log("Starting Twitter collection phase...")` before the call
- Log bearer token availability check result

**Subreddit fallback map** (inside `collectRedditFeedback`):
```typescript
const INDUSTRY_SUBREDDITS: Record<string, string[]> = {
  "SEO": ["SEO", "bigseo", "digital_marketing"],
  "SaaS": ["SaaS", "startups", "software"],
  "Database": ["databases", "dataengineering", "devops"],
  "Analytics": ["analytics", "datascience", "BusinessIntelligence"],
  // ... more mappings
};
```

If `subreddits` is empty and company has an `industry_type`, use the fallback map.

## Expected Outcome

- Reddit and Twitter phases will actually execute (not get starved by web phase timeout)
- Reddit requests will succeed more reliably with a proper User-Agent
- Existing companies will get subreddit coverage via industry-based fallbacks
- Clear logging will make it easy to diagnose any remaining issues
