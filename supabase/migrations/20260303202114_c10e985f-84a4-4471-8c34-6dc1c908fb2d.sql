
-- Phase 1A: Persisted Review Site URLs
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS g2_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS capterra_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS trustradius_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS getapp_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS review_urls_verified_at timestamptz;

-- Phase 1B: Reddit JSON API config
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS reddit_min_score integer DEFAULT 5;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS reddit_max_age_days integer DEFAULT 90;
