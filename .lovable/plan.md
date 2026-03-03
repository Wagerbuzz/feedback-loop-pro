

# Spec Gap Analysis: Feedback Collection Engine

## Current State vs. Specification

| # | Improvement | Spec Status | Current State |
|---|---|---|---|
| 1 | Queue-Based Architecture | Critical | **Not implemented.** Still a monolithic single function. No `collection_jobs` table. No orchestrator. No per-source retry. |
| 2 | Persisted Review URLs | High | **✅ Implemented.** `g2_url`, `capterra_url`, `trustradius_url`, `getapp_url`, `review_urls_verified_at` columns on `companies`. `lookup-review-urls` edge function created. Phase 0 uses stored URLs with slug fallback. UI fields in CompanySetup. Auto-detection on company creation. |
| 3 | Native Reddit JSON API | High | **✅ Implemented.** Replaced Firecrawl Reddit scraping with native `reddit.com/search.json` and `/r/{sub}/search.json` calls. Score filtering (`reddit_min_score` default 5), age filtering (`reddit_max_age_days` default 90). Batched AI extraction. Eliminates Firecrawl usage for Reddit. |
| 4 | Semantic Deduplication | High | **Not implemented.** Still SHA-256 exact-match only. No `pgvector` extension. No `embedding` column on `feedback`. |
| 5 | Two-Pass AI (Extract then Classify) | Medium | **Not implemented.** Still single-pass extraction+classification in one prompt (all phases). |
| 6 | Incremental Clustering | Medium | **Not implemented.** Clustering rebuilds from scratch every run. No "assign or create" logic. No weekly re-cluster. |
| 7 | API Rate Limit & Cost Tracking | Low | **Not implemented.** Still just a 5s sleep on 429. No `api_rate_limits` table. No cost tracking columns on `collection_runs`. |

### Minor Code Fixes Status

| Fix | Status |
|---|---|
| Replace `Date.now() + random` feedback_id with `crypto.randomUUID()` | **✅ Done.** All phases now use `crypto.randomUUID()`. |
| Save `company_id` to local variable in try block | **✅ Done.** `savedCompanyId` saved before async work; catch block uses it directly (no `req.clone()`). |
| Document HARD_WALL_MS consistently | **✅ Done.** Comment now says "70s hard wall leaves ~50s margin before Deno 120s timeout". |
| Add type annotations to company object | **✅ Done.** `CompanyRow` interface defined and used across all phase functions. |

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
- **Persisted review site URLs** (Phase 1A complete)
- **Native Reddit JSON API** (Phase 1B complete)
- **Minor code fixes** (all applied)

## Next Steps

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
