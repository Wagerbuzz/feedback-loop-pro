
-- Drop all existing restrictive policies and recreate them as permissive (default)

-- FEEDBACK table
DROP POLICY IF EXISTS "Authenticated users can view feedback" ON public.feedback;
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.feedback;
DROP POLICY IF EXISTS "Authenticated users can update feedback" ON public.feedback;

CREATE POLICY "Authenticated users can view feedback"
  ON public.feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert feedback"
  ON public.feedback FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update feedback"
  ON public.feedback FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- CLUSTERS table
DROP POLICY IF EXISTS "Authenticated users can view clusters" ON public.clusters;
DROP POLICY IF EXISTS "Authenticated users can insert clusters" ON public.clusters;
DROP POLICY IF EXISTS "Authenticated users can update clusters" ON public.clusters;

CREATE POLICY "Authenticated users can view clusters"
  ON public.clusters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert clusters"
  ON public.clusters FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update clusters"
  ON public.clusters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ACTIONS table
DROP POLICY IF EXISTS "Authenticated users can view actions" ON public.actions;
DROP POLICY IF EXISTS "Authenticated users can insert actions" ON public.actions;
DROP POLICY IF EXISTS "Authenticated users can update actions" ON public.actions;

CREATE POLICY "Authenticated users can view actions"
  ON public.actions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert actions"
  ON public.actions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update actions"
  ON public.actions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ROADMAP table
DROP POLICY IF EXISTS "Authenticated users can view roadmap" ON public.roadmap;
DROP POLICY IF EXISTS "Authenticated users can insert roadmap" ON public.roadmap;
DROP POLICY IF EXISTS "Authenticated users can update roadmap" ON public.roadmap;

CREATE POLICY "Authenticated users can view roadmap"
  ON public.roadmap FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert roadmap"
  ON public.roadmap FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update roadmap"
  ON public.roadmap FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- CUSTOMER_PORTAL table
DROP POLICY IF EXISTS "Anyone can view customer portal" ON public.customer_portal;
DROP POLICY IF EXISTS "Authenticated users can insert portal" ON public.customer_portal;

CREATE POLICY "Anyone can view customer portal"
  ON public.customer_portal FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert portal"
  ON public.customer_portal FOR INSERT TO authenticated WITH CHECK (true);

-- PROFILES table
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- USER_ROLES table
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert own role" ON public.user_roles;

CREATE POLICY "Users can view own role"
  ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own role"
  ON public.user_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
