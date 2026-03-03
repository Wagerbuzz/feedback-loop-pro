
# Fix Feedback Discovery Throughput

## Root Cause

The logs show that for Apollo, only **1 batch of 3 queries** ran before hitting the 40s web phase budget. Reddit and Twitter were completely skipped (76s total elapsed). The result: only 20 feedback items from 30 total (Capterra + TrustRadius + 1 web batch).

The bottleneck is **per-result AI extraction**. Each of the 5 search results per query triggers a separate AI call (2-4s each). So 3 queries x 5 results = 15 sequential-ish AI calls = ~40s consumed by a single batch.

## Changes

### 1. Batch AI extraction: combine multiple search results into one AI call

Instead of calling AI separately for each search result, combine all results from a single query (up to 5) into one AI prompt. This turns 5 AI calls into 1 per query, cutting AI time by ~80%.

**File: `supabase/functions/collect-feedback/index.ts`**

In `processQuery`, after fetching search results and filtering for relevance, concatenate the relevant pages into a single AI prompt:

```text
Before (per result):
  Result 1 -> AI call -> feedback items
  Result 2 -> AI call -> feedback items  
  Result 3 -> AI call -> feedback items
  (3 AI calls x 3s = 9s per query)

After (batched):
  [Result 1 + Result 2 + Result 3] -> single AI call -> all feedback items
  (1 AI call x 4s = 4s per query)
```

- Collect all relevant results (after URL dedup + relevance filter), truncate each to ~2000 chars
- Send them as a single prompt with clear `--- SOURCE N: {url} ---` delimiters
- AI extracts from all sources at once, with a `source_url` field per item
- Cap combined content at 12,000 chars to stay within model limits

### 2. Batch AI extraction for Phase 0 (direct reviews) too

Same problem exists in `collectDirectReviews` -- each of the 5 review URLs gets a separate AI call. Batch them the same way.

### 3. Increase batch concurrency from 3 to 5

With batched AI extraction, each query now takes ~4s instead of ~15s. We can safely increase from 3 concurrent queries to 5, processing all 25 queries in 5 batches.

### 4. Ensure Reddit/Twitter phases always run

Currently the overall `TIME_BUDGET_MS` (55s) check on line 926 uses `startTime` which includes Phase 0 + Phase 1. With the speed improvements above, phases should complete in time, but as a safety net, give Reddit and Twitter their own minimum time allocation rather than skipping them entirely when the web phase runs long.

Change the Reddit/Twitter phase guards from:
```text
if (Date.now() - startTime < TIME_BUDGET_MS)  // Skips if web ran long
```
To a softer approach: always attempt Reddit/Twitter unless we're past a hard 90s wall clock (the Deno function timeout is ~120s).

### 5. Use gemini-2.5-flash-lite for web extraction

The web extraction AI calls use `gemini-2.5-flash` which is overkill for structured extraction from pre-filtered content. Switch to `gemini-2.5-flash-lite` which is faster and cheaper, reserving `gemini-2.5-flash` only for the clustering phase where reasoning quality matters more.

## Technical Details

### File: `supabase/functions/collect-feedback/index.ts`

**Phase 0 batched extraction** (lines 78-180):
- After all 5 review URLs are scraped in parallel, combine their content into one AI prompt instead of looping through each separately
- Format: `--- REVIEW PAGE: {source} ({url}) ---\n{content}\n` for each page
- Single AI call extracts all items with an added `source_url` field in the schema
- Truncate each page to 3000 chars, total cap 15000 chars

**Phase 1 `processQuery` batched extraction** (lines 691-898):
- After the search results loop that filters for relevance/dedup, collect all passing results into an array
- Combine into a single AI prompt with delimiters
- Single AI call with `source_url` field per extracted item
- Truncate each result to 2000 chars, total cap 12000 chars

**Increase batch size** (line 902):
- Change `const batchSize = 3` to `const batchSize = 5`

**Model change** (lines 89, 770):
- Change `google/gemini-2.5-flash` to `google/gemini-2.5-flash-lite` for both Phase 0 and Phase 1 extraction

**Phase 2/3 guards** (lines 926, 940):
- Change from `Date.now() - startTime < TIME_BUDGET_MS` to `Date.now() - startTime < 90000` (90s hard wall, leaving 30s margin before Deno timeout)

## Expected Outcome

- **5x fewer AI calls** per run (batched extraction): 25 queries = 25 AI calls instead of ~125
- **3x more queries processed**: all 25 queries complete in ~20s instead of only 3
- **Reddit and Twitter always run**: softer time guard ensures later phases execute
- **For Apollo specifically**: should go from 20 items to 80-150+ items across G2, Capterra, TrustRadius, blogs, Reddit, and Twitter
