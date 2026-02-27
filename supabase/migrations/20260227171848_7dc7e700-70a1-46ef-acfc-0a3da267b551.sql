CREATE POLICY "Authenticated users can delete clusters"
ON public.clusters
FOR DELETE
USING (true);