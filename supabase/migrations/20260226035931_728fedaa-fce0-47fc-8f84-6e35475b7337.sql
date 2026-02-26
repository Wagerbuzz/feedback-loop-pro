
ALTER TABLE public.actions ADD COLUMN company_id uuid REFERENCES public.companies(id);
ALTER TABLE public.roadmap ADD COLUMN company_id uuid REFERENCES public.companies(id);
