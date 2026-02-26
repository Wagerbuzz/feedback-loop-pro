

# Feedback Intelligence Engine -- MVP Implementation Plan

## Overview

Transform FeedbackFlow from a manual feedback tool into an automated feedback intelligence engine. Given a brand name and domain, the system will crawl the web, extract real customer feedback, classify it with AI, deduplicate, cluster, and surface prioritized insights.

## Architecture

```text
User adds company (name + domain)
        |
        v
Edge Function: brand-profile  (crawl homepage, extract product/feature terms via AI)
        |
        v
Edge Function: collect-feedback  (orchestrates full pipeline)
        |
        +---> Generate search queries (brand terms x intent buckets)
        +---> Firecrawl Search API (find real reviews, forum posts)
        +---> AI Extraction (parse raw pages into structured feedback items)
        +---> AI Enrichment (classify pain_point, intent, persona, competitor)
        +---> Deduplicate (content_hash)
        +---> AI Clustering (group into themes, generate cluster titles)
        +---> Trend & Severity scoring
        +---> Insert to database
        |
        v
UI: Dashboard shows key signals, Inbox shows real feedback, Clusters show themes
```

## Phase 1: Database Schema Changes

### New table: `companies`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | owner |
| name | text | e.g. "MongoDB" |
| domain | text | e.g. "mongodb.com" |
| brand_terms | jsonb | AI-extracted brand vocabulary |
| product_terms | jsonb | AI-extracted product names |
| feature_terms | jsonb | AI-extracted feature keywords |
| industry_type | text | AI-inferred |
| persona_type | text | AI-inferred |
| search_queries | jsonb | generated query list |
| last_collected_at | timestamptz | |
| auto_collect_enabled | boolean | default false |
| collection_frequency | text | 'daily' or 'weekly' |
| created_at | timestamptz | |

RLS: users CRUD own companies.

### Alter `feedback` table
Add columns:
- `source_url` (text, nullable) -- link back to source page
- `content_hash` (text, nullable, unique) -- SHA-256 for dedup
- `company_id` (uuid, nullable) -- link to company
- `pain_point_category` (text, nullable) -- UX, Pricing, Reliability, etc.
- `intent_type` (text, nullable) -- praise, bug, feature_request, churn_risk
- `confidence_score` (numeric, nullable) -- AI confidence 0-1
- `original_context_excerpt` (text, nullable) -- surrounding context

### Alter `clusters` table
Add columns:
- `company_id` (uuid, nullable)
- `description` (text, nullable) -- AI-generated summary
- `primary_pain_point` (text, nullable)
- `trend_velocity` (numeric, default 0) -- % change
- `severity_score` (numeric, default 0) -- 0-1 composite
- `first_seen_at` (timestamptz, nullable)
- `last_seen_at` (timestamptz, nullable)
- `sentiment_mix` (jsonb, default '{}')

### New table: `collection_runs`
Track each collection execution:
| Column | Type |
|---|---|
| id | uuid |
| company_id | uuid |
| status | text (running/completed/failed) |
| new_feedback_count | integer |
| duplicates_skipped | integer |
| clusters_updated | integer |
| started_at | timestamptz |
| completed_at | timestamptz |
| error_message | text nullable |

RLS: users can view runs for their companies.

## Phase 2: Connectors

Link the existing **Firecrawl** connection to the project so edge functions can use `FIRECRAWL_API_KEY`. The **Lovable AI** key is already available.

## Phase 3: Edge Functions

### `brand-profile` (new)
- Input: `{ company_name, domain }`
- Crawls homepage via Firecrawl scrape
- Sends markdown to Lovable AI (Gemini Flash) with tool calling to extract structured brand profile: product names, feature terms, industry, persona type
- Generates 15-20 search queries by combining brand terms with intent buckets (pain, churn, comparison, pricing, feature experience, praise) and domain constraints (reddit, g2, trustradius, etc.)
- Returns the profile + queries

### `collect-feedback` (new)
- Input: `{ company_id, user_id }`
- Loads company profile from DB
- Creates a `collection_runs` entry (status: running)
- For each search query (max 20):
  - Calls Firecrawl Search API with `scrapeOptions: { formats: ['markdown'] }`
  - Filters results: skip pages < 300 words, no brand mention, affiliate content
  - For each valid result, calls Lovable AI to extract atomic feedback items using tool calling (structured output: author, text, sentiment, confidence, approximate_date)
  - Second AI pass for enrichment: pain_point_category, intent_type, persona_type, competitor_mentioned
  - Computes content_hash (SHA-256 of normalized text)
  - Inserts into `feedback` table (skips duplicates via ON CONFLICT)
- After all feedback is collected:
  - Calls Lovable AI to cluster feedback by similarity (groups texts, generates cluster title + description + primary_pain_point)
  - Upserts clusters with trend_velocity and severity_score
  - Updates `collection_runs` with final counts
- Returns summary stats

## Phase 4: UI Changes

### Company Setup (Settings > Integrations)
Add a "Tracked Companies" section above the existing provider grid:
- "Add Company" form: name + domain fields
- Company card showing: name, domain, last collected time, feedback count
- "Collect Now" button that triggers the pipeline
- Progress indicator during collection
- Collection history (last 5 runs with counts)

### Inbox Updates
- Show `source_url` as clickable link in the detail panel
- Show `pain_point_category` and `intent_type` as badges
- Add source filter options for web sources (G2, Reddit, etc.)
- Show `confidence_score` as a subtle indicator

### Clusters Updates
- Show `description`, `trend_velocity` (arrow + %), `severity_score` (bar)
- Sort by severity by default
- Show `sentiment_mix` as mini bar chart
- Show `first_seen_at` / `last_seen_at` for temporal context

### Dashboard Updates
- "Key Signals" section at top:
  - Top 3 emerging pain clusters (highest trend_velocity)
  - Top churn-risk cluster (highest severity with churn intent)
  - Net sentiment trend
- Replace static stat cards with company-aware data

## Phase 5: Files Summary

### New files:
- `supabase/functions/brand-profile/index.ts` -- brand profiling edge function
- `supabase/functions/collect-feedback/index.ts` -- main collection pipeline
- `src/components/settings/CompanySetup.tsx` -- company management UI in settings
- `src/lib/api/collection.ts` -- frontend API helpers for triggering collection

### Modified files:
- `src/components/settings/IntegrationsSettings.tsx` -- add CompanySetup section
- `src/pages/InboxView.tsx` -- show source_url, pain_point_category, intent_type
- `src/pages/ClustersView.tsx` -- show description, trend_velocity, severity_score
- `src/pages/DashboardView.tsx` -- add Key Signals section
- `supabase/config.toml` -- register new edge functions

### Database migration:
- Create `companies` table
- Create `collection_runs` table
- Alter `feedback` table (add 6 columns)
- Alter `clusters` table (add 7 columns)
- RLS policies for new tables

## Implementation Order

1. Connect Firecrawl to project
2. Run database migration (new tables + altered columns)
3. Build `brand-profile` edge function
4. Build `collect-feedback` edge function
5. Build CompanySetup UI component
6. Update IntegrationsSettings to include CompanySetup
7. Update InboxView, ClustersView, DashboardView
8. Test end-to-end with MongoDB

## Seed Data

After the pipeline is built, we'll add MongoDB as the first company and run "Collect Now" to populate the system with real feedback from G2, Reddit, and other sources.

