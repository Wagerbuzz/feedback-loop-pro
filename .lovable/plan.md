

# Spec Gap Analysis: Feedback Collection Engine

## Current State vs. Specification

| # | Improvement | Spec Status | Current State |
|---|---|---|---|
| 1 | Queue-Based Architecture | Critical | **Not implemented.** Still a monolithic single function. No `collection_jobs` table. No orchestrator. No per-source retry. |
| 2 | Persisted Review URLs | High | **Not implemented.** Phase 0 still constructs URLs via slug (lines 35-41). No `g2_url`, `capterra_url`, `trustradius_url`, `getapp_url` columns on `companies`. No `lookup-review-urls` function. No UI fields. |
| 3 | Native Reddit JSON API | High | **Not implemented.** Reddit still uses Firecrawl search (lines 290-298). No upvote/score filtering. No `reddit_min_score` or `reddit_max_age_days` columns on `companies`. |
| 4 | Semantic Deduplication | High | **Not implemented.** Still SHA-256 exact-match only (line 10-15). No `pgvector` extension. No `embedding` column on `feedback`. |
| 5 | Two-Pass AI (Extract then Classify) | Medium | **Not implemented.** Still single-pass extraction+classification in one prompt (all phases). |
| 6 | Incremental Clustering | Medium | **Not implemented.** Clustering rebuilds from scratch every run (lines 1009-1066). No "assign or create" logic. No weekly re-cluster. |
| 7 | API Rate Limit & Cost Tracking | Low | **Not implemented.** Still just a 5s sleep on 429. No `api_rate_limits` table. No cost tracking columns on `collection_runs`. |

### Minor Code Fixes Status

| Fix | Status |
|---|---|
| Replace `Date.now() + random` feedback_id with `crypto.randomUUID()` | **Not done.** Still uses `DIR-${Date.now()}-...` pattern (line 198), `RED-...` (line 397), `TW-...` (line 609), `WEB-...` (line 921). |
| Save `company_id` to local variable in try block | **Partially done.** `company_id` is destructured from `req.json()` at line 658, but the catch block (line 1124) still calls `req.clone().json()` which is fragile. |
| Document HARD_WALL_MS consistently | **Partially done.** Comment says "70s hard wall (leave 50s for Reddit/Twitter/clustering/save)" but the actual Deno timeout and spec says 120s. |
| Add type annotations to company object | **Not done.** Company is typed as `any` (line 19 of `collectDirectReviews`). |

### What IS Already Implemented (from prior work)

- Batched AI extraction (combining multiple results into one prompt)
- Phase 0 timeout cap (15s)
- Independent web phase timer (`webPhaseStart`)
- Query disambiguation from `industry_type`
- Domain-based query bucket
- Reduced search limit (5 results)
- Model optimization (Flash Lite for extraction, Flash for clustering)
- Increased batch concurrency (5)
- Stuck run cleanup (3-minute timeout)
- Error recovery in catch block

## Implementation Plan

Given the scope, I recommend implementing in the spec's suggested order. Here's the concrete plan:

### Phase 1: Quick Wins (Persisted Review URLs + Native Reddit JSON API)

**1A. Persisted Review URLs**

DB migration:
- Add 5 columns to `companies`: `g2_url text`, `capterra_url text`, `trustradius_url text`, `getapp_url text`, `review_urls_verified_at timestamptz`

New edge function `supabase/functions/lookup-review-urls/index.ts`:
- Takes `company_id`, loads company
- For each platform, Firecrawl search: `"{company_name}" site:g2.com/products`, etc.
- Extracts first matching URL from results
- Updates `companies` row with canonical URLs
- ~80 LOC

Update `collect-feedback/index.ts` Phase 0 (lines 34-41):
- Use `company.g2_url`, `company.capterra_url`, etc. when available
- Fall back to slug construction only if stored URL is null

Update `brand-profile/index.ts`:
- After profiling, invoke `lookup-review-urls` if URLs not yet set

UI: Add 4 optional URL fields to `CompanySetup.tsx`

**1B. Native Reddit JSON API**

DB migration:
- Add `reddit_min_score integer default 5`, `reddit_max_age_days integer default 90` to `companies`

Rewrite `collectRedditFeedback` (lines 232-434):
- Replace Firecrawl calls with `fetch("https://www.reddit.com/search.json?q=...")`
- For configured subreddits: `https://www.reddit.com/r/{sub}/search.json?q={brand}&restrict_sr=1&sort=top&limit=25`
- Filter by `score >= reddit_min_score` and `created_utc` within `reddit_max_age_days`
- Batch filtered posts into AI extraction (same batched pattern)
- Eliminates Firecrawl usage for Reddit

### Phase 2: Two-Pass AI + Queue Architecture

**2A. Two-Pass AI**

Refactor all extraction prompts in `collect-feedback/index.ts`:
- Pass 1 (Flash Lite): extract `{ author, text, source_url }` only, strict "find verbatim review text" prompt
- Post-filter: drop < 30 chars, drop items with no brand/product term match
- Pass 2 (Flash): classify batch of up to 25 items with `{ sentiment, pain_point_category, intent_type, confidence, context_excerpt }`, include company context

**2B. Queue Architecture**

DB migration: Create `collection_jobs` table per spec schema

New edge functions:
- `collect-orchestrator/index.ts` — receives `company_id`, creates run, enqueues jobs, invokes source functions
- `collect-reviews/index.ts` — Phase 0 logic standalone
- `collect-web/index.ts` — Phase 1 logic standalone
- `collect-reddit/index.ts` — Phase 2 standalone
- `collect-twitter/index.ts` — Phase 3 standalone
- `collect-cluster/index.ts` — clustering standalone

Keep `collect-feedback` as backward-compatible wrapper calling orchestrator.

Update `src/lib/api/collection.ts` to call orchestrator. Update UI to show per-job status.

### Phase 3: Semantic Dedup + Incremental Clustering

**3A. Semantic Dedup**
- Enable pgvector: `CREATE EXTENSION IF NOT EXISTS vector;`
- Add `embedding vector(1536)` column + IVFFlat index to `feedback`
- Compute embeddings via Lovable AI gateway before insert
- Check cosine similarity > 0.92 within same `company_id`

**3B. Incremental Clustering**
- Refactor `collect-cluster` to fetch existing clusters, assign new items to existing or create new
- Weekly full re-cluster via `pg_cron`

### Phase 4: Rate Limit & Cost Tracking

- Create `api_rate_limits` table per spec
- Add cost tracking columns to `collection_runs`
- Token bucket helper in each source function

### Minor Fixes (apply during Phase 1)

- Replace all `feedback_id` generation with `crypto.randomUUID()`
- Save `company_id` to local var before any async work
- Add type annotations to company objects
- Fix `req.clone().json()` in catch block

## Recommended Next Step

Start with **Phase 1** (Persisted Review URLs + Native Reddit JSON API + minor fixes) as these are quick wins with the highest immediate data quality impact.

