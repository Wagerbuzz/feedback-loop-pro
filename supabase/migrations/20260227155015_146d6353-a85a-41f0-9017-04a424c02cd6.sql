
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS reddit_subreddits jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS collection_sources jsonb DEFAULT '["web", "reddit"]'::jsonb;
