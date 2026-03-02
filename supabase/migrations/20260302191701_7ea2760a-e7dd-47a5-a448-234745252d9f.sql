-- Allow deleting actions (needed for company cascade delete)
CREATE POLICY "Authenticated users can delete actions"
ON public.actions
FOR DELETE
USING (true);

-- Allow deleting roadmap items (needed for company cascade delete)
CREATE POLICY "Authenticated users can delete roadmap"
ON public.roadmap
FOR DELETE
USING (true);

-- Allow deleting collection runs (needed for company cascade delete)
CREATE POLICY "Authenticated users can delete collection runs"
ON public.collection_runs
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM companies c
  WHERE c.id = collection_runs.company_id AND c.user_id = auth.uid()
));