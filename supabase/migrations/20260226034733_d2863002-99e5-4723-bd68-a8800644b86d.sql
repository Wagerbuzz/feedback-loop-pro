
-- Create companies table
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  domain text NOT NULL,
  brand_terms jsonb DEFAULT '[]',
  product_terms jsonb DEFAULT '[]',
  feature_terms jsonb DEFAULT '[]',
  industry_type text,
  persona_type text,
  search_queries jsonb DEFAULT '[]',
  last_collected_at timestamptz,
  auto_collect_enabled boolean NOT NULL DEFAULT false,
  collection_frequency text NOT NULL DEFAULT 'weekly',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own companies" ON public.companies FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own companies" ON public.companies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own companies" ON public.companies FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own companies" ON public.companies FOR DELETE USING (auth.uid() = user_id);

-- Create collection_runs table
CREATE TABLE public.collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  new_feedback_count integer NOT NULL DEFAULT 0,
  duplicates_skipped integer NOT NULL DEFAULT 0,
  clusters_updated integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

ALTER TABLE public.collection_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own collection runs" ON public.collection_runs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = collection_runs.company_id AND c.user_id = auth.uid()));
CREATE POLICY "Users can insert own collection runs" ON public.collection_runs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = collection_runs.company_id AND c.user_id = auth.uid()));
CREATE POLICY "Users can update own collection runs" ON public.collection_runs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.companies c WHERE c.id = collection_runs.company_id AND c.user_id = auth.uid()));

-- Alter feedback table
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pain_point_category text,
  ADD COLUMN IF NOT EXISTS intent_type text,
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS original_context_excerpt text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_content_hash ON public.feedback(content_hash) WHERE content_hash IS NOT NULL;

-- Alter clusters table
ALTER TABLE public.clusters
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS primary_pain_point text,
  ADD COLUMN IF NOT EXISTS trend_velocity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS severity_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS sentiment_mix jsonb NOT NULL DEFAULT '{}';
