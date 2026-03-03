
-- Create collection_jobs table for queue-based architecture
CREATE TABLE public.collection_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.collection_runs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  dupe_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz
);

-- Enable RLS
ALTER TABLE public.collection_jobs ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view jobs for their companies
CREATE POLICY "Users can view own collection jobs"
ON public.collection_jobs FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM companies c WHERE c.id = collection_jobs.company_id AND c.user_id = auth.uid()
));

-- RLS: Service role inserts/updates via edge functions, but allow authenticated users to view
CREATE POLICY "Users can insert own collection jobs"
ON public.collection_jobs FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM companies c WHERE c.id = collection_jobs.company_id AND c.user_id = auth.uid()
));

CREATE POLICY "Users can update own collection jobs"
ON public.collection_jobs FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM companies c WHERE c.id = collection_jobs.company_id AND c.user_id = auth.uid()
));

CREATE POLICY "Users can delete own collection jobs"
ON public.collection_jobs FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM companies c WHERE c.id = collection_jobs.company_id AND c.user_id = auth.uid()
));

-- Index for efficient lookups
CREATE INDEX idx_collection_jobs_run_id ON public.collection_jobs(run_id);
CREATE INDEX idx_collection_jobs_status ON public.collection_jobs(status) WHERE status IN ('pending', 'running');
