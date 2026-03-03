

# Make Discovery Engine Comprehensive for Any Brand

## Problems Found

1. **Phase 0 has no time cap** -- direct review scraping runs uncapped and can consume the entire 55s budget, causing web search (Phase 1) to get zero time. The budget check at line 894 uses `startTime` which includes Phase 0 duration.

2. **No query disambiguation** -- queries like "Clay review blog" return pottery results. The brand name is used raw without any industry/product context to help search engines understand which "Clay" we mean.

3. **Too many results per query** -- `limit: 15` on line 692 means each Firecrawl search returns 15 results, but most are irrelevant tail results. This wastes time on AI extraction for low-quality pages when we could process more distinct queries instead.

4. **Weak product_terms extraction** -- the brand-profile prompt says "Specific product names" but doesn't guide the AI to extract sub-features, modules, or named capabilities (e.g., "Claygent", "Waterfall Enrichment"). Empty product_terms means fewer relevance signals.

5. **No domain-based queries** -- the domain (e.g., `clay.com`) is unambiguous but never used in search queries. A query like `"clay.com review"` would bypass common-name problems entirely.

## Changes

### 1. Cap Phase 0 at 15 seconds (`collect-feedback/index.ts`)

Wrap `collectDirectReviews` in a `Promise.race` with a 15s timeout so it can never starve later phases. Reset the web phase timer after Phase 0 completes so Phase 1 always gets its full budget.

```text
Phase 0: max 15s (timeout race)
Phase 1: fresh timer, full 40s budget starting AFTER Phase 0
```

### 2. Add disambiguation to queries (`brand-profile/index.ts`)

Build a `disambiguator` from `industry_type` (e.g., "CRM", "GTM", "SEO tool") and append it to all discovery query templates:

```text
Before: "{brand} review blog"
After:  "{brand} CRM review blog"
```

For targeted queries with `site:` constraints, disambiguation is optional since the site already narrows results.

### 3. Add domain-based query bucket (`brand-profile/index.ts`)

New discovery bucket that uses the domain instead of the brand name:

```text
domain_search: ["{domain} review", "{domain} feedback", "{domain} alternative"]
```

These queries are completely unambiguous regardless of brand name commonality.

### 4. Reduce search limit from 15 to 5 (`collect-feedback/index.ts`)

Change `limit: 15` to `limit: 5` on the Firecrawl search call. This processes more distinct queries within the time budget since fewer results per query means faster AI extraction cycles.

### 5. Improve product_terms extraction (`brand-profile/index.ts`)

Update the `product_terms` schema description to explicitly ask for sub-products, modules, and named features:

```text
Before: "Specific product names (e.g. 'Atlas', 'Compass', 'Realm')"
After:  "Specific product names, sub-products, modules, and named features 
         (e.g. 'Atlas', 'Compass', 'Claygent', 'Waterfall Enrichment', 'Chrome Extension')"
```

Also add a line to the user prompt: "Look for named features, modules, and sub-products even if they aren't separate products."

## Technical Details

### File: `supabase/functions/collect-feedback/index.ts`

**Phase 0 timeout** (lines 666-674):
- Wrap `collectDirectReviews(...)` in `Promise.race` with a 15s timeout
- After Phase 0, create a new `webPhaseStart = Date.now()` and use it for Phase 1 budget checks instead of `startTime`

**Search limit** (line 692):
- Change `limit: 15` to `limit: 5`

**Web phase budget** (line 894):
- Replace `Date.now() - startTime` with `Date.now() - webPhaseStart` so Phase 1 gets its own independent budget window

### File: `supabase/functions/brand-profile/index.ts`

**Product terms schema** (line 73):
- Update description to include sub-products, modules, named features with examples

**Query disambiguation** (lines 140-174):
- After extracting profile, build `disambiguator` from `industry_type` (take first 2 words)
- Append disambiguator to discovery bucket templates
- Add new `domain_search` bucket with domain-based templates
- Keep targeted bucket templates unchanged (site constraints handle disambiguation)

**AI prompt** (line 53):
- Add instruction: "Look for named features, modules, and sub-products even if they aren't standalone products."

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/collect-feedback/index.ts` | 15s Phase 0 timeout, independent web phase timer, reduce search limit to 5 |
| `supabase/functions/brand-profile/index.ts` | Add disambiguation to discovery queries, add domain-based query bucket, improve product_terms extraction prompt |

## Expected Outcome

- Phase 1 (web search) always gets its full 40s budget regardless of Phase 0 duration
- Queries like "Clay CRM review blog" and "clay.com feedback" return relevant results instead of pottery
- 3x more distinct queries processed per run (5 results each vs 15)
- Richer product_terms give the soft relevance filter more signals to match
- Works equally well for unique names (AirOps) and common names (Clay, Notion, Linear)

