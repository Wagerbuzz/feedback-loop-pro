

# Improve Feedback Collection Volume

## Root Causes

1. **Reddit is completely blocked**: All Reddit JSON API calls return 403. Reddit now blocks server-side requests without proper OAuth. Every collection run wastes time trying Reddit and gets nothing.
2. **Web time budget too restrictive**: When multiple sources are enabled, web search only gets 30 seconds. Most runs hit this limit after processing 6-8 of 17 queries, leaving half the queries unprocessed.
3. **Over-aggressive brand filtering**: Extracted feedback items that don't literally contain the brand name in the text are discarded unless confidence >= 0.9. Many legitimate reviews (e.g., "The keyword tracking is terrible") get filtered out because they don't repeat the product name.
4. **Low Firecrawl result count**: Only 10 results per search query, meaning even successful queries yield limited pages.

## Solution

### 1. Fix Reddit collection using Firecrawl instead of direct API

Replace the direct Reddit JSON API calls (which are blocked) with Firecrawl search queries targeting Reddit. This uses Firecrawl's scraping infrastructure which can access Reddit content.

**File**: `supabase/functions/collect-feedback/index.ts`

In `collectRedditFeedback`, instead of fetching `reddit.com/search.json`, use Firecrawl search with `site:reddit.com` queries:

```typescript
// Instead of direct Reddit API:
const searchRes = await fetch(`https://api.firecrawl.dev/v1/search`, {
  method: "POST",
  headers: { Authorization: `Bearer ${firecrawlApiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `${brandName} site:reddit.com/r/${subreddit}`,
    limit: 5,
    scrapeOptions: { formats: ["markdown"] },
  }),
});
```

This means:
- Pass `firecrawlApiKey` into the Reddit collection function
- Replace the direct Reddit fetch calls with Firecrawl search calls
- Remove the 1.2s rate-limit delays (not needed for Firecrawl)
- Keep the same AI extraction logic for processing scraped content

### 2. Increase web search budget and results

- Raise `webBudgetMs` from 30000 to 40000ms (still leaves 15s for other phases)
- Increase Firecrawl `limit` from 10 to 15 results per query
- Raise `webQueryLimit` from 15 to 20 when multiple sources are active

**File**: `supabase/functions/collect-feedback/index.ts` (lines 509-510)

```typescript
const webQueryLimit = hasMultipleSources ? 20 : 25;
const webBudgetMs = hasMultipleSources ? 40000 : 50000;
```

And in the Firecrawl search call (line 532):

```typescript
limit: 15,  // was 10
```

### 3. Relax brand-mention filtering for high-confidence items

Currently items without a literal brand mention need confidence >= 0.9 to pass. Lower this threshold to 0.8, matching the AI's natural confidence range for legitimate feedback.

**File**: `supabase/functions/collect-feedback/index.ts`

For web extraction (line 656):
```typescript
if (!mentionsBrand && (item.confidence || 0) < 0.8) {  // was 0.9
```

For Reddit extraction (line 205):
```typescript
if (!mentionsBrand && (item.confidence || 0) < 0.8) {  // was 0.9
```

### 4. Add page-level context to AI extraction prompt

Tell the AI that feedback from a page dedicated to the brand doesn't need to repeat the brand name. This produces more items with higher confidence.

Update the system prompt for web extraction to include:
```
"If the page URL or title clearly indicates this is a review page for ${company.name}, you can extract feedback even if the text doesn't explicitly mention the brand name."
```

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/collect-feedback/index.ts` | Replace Reddit direct API with Firecrawl search; increase time budgets, query limits, and Firecrawl result count; relax brand-mention confidence threshold; improve AI extraction prompt |

## Expected Outcome

- Reddit feedback collection restored (via Firecrawl proxy instead of blocked direct API)
- ~60-70% more web queries processed per run (20 vs 15, with more time)
- ~50% more results per query (15 vs 10)
- Fewer legitimate feedback items filtered out by brand-mention check
- Overall: significantly more comprehensive collection per run

