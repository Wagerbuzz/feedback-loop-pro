
-- ============================================================
-- FeedbackFlow: Full Schema Migration
-- ============================================================

-- Roles enum
CREATE TYPE public.app_role AS ENUM ('pm', 'cs', 'exec');

-- User roles table (secure, separate from profiles)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Helper to get current user's role
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1
$$;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  avatar_initials TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Feedback table
CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id TEXT NOT NULL UNIQUE, -- e.g. FB-001
  source TEXT NOT NULL, -- Intercom, Slack, Email, Zendesk, In-App, Social
  text TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  sentiment TEXT NOT NULL DEFAULT 'Neutral', -- Positive, Negative, Neutral
  status TEXT NOT NULL DEFAULT 'New', -- New, Clustered, Under Review
  cluster_id TEXT,
  channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Clusters table
CREATE TABLE public.clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id TEXT NOT NULL UNIQUE, -- e.g. CL-001
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- Feature Request, Bug, UX Improvement
  feedback_count INTEGER NOT NULL DEFAULT 0,
  sentiment TEXT NOT NULL DEFAULT 'Neutral',
  priority TEXT NOT NULL DEFAULT 'Medium', -- High, Medium, Low
  tags TEXT[] NOT NULL DEFAULT '{}',
  linked_actions_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;

-- Actions table
CREATE TABLE public.actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id TEXT NOT NULL UNIQUE, -- e.g. ACT-001
  cluster_id TEXT NOT NULL,
  cluster_name TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_initials TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending', -- Pending, In Progress, Done
  deadline TIMESTAMPTZ,
  ai_suggested BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;

-- Roadmap table
CREATE TABLE public.roadmap (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id TEXT NOT NULL UNIQUE, -- e.g. RI-001
  title TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  cluster_name TEXT NOT NULL,
  predicted_impact TEXT NOT NULL,
  impact_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Proposal', -- Proposal, In Progress, Shipped
  owner_name TEXT NOT NULL,
  owner_initials TEXT NOT NULL,
  impact_rationale TEXT,
  raw_feedback_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.roadmap ENABLE ROW LEVEL SECURITY;

-- Customer portal table
CREATE TABLE public.customer_portal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Received', -- Received, Clustered, Under Review, In Progress, Shipped
  action_taken TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_portal ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- user_roles: users can read own role, only service role can write
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own role" ON public.user_roles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- profiles: users can read all, update own
CREATE POLICY "Profiles are viewable by authenticated users" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- feedback: authenticated users can read/write
CREATE POLICY "Authenticated users can view feedback" ON public.feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert feedback" ON public.feedback FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update feedback" ON public.feedback FOR UPDATE TO authenticated USING (true);

-- clusters: authenticated users can read/write
CREATE POLICY "Authenticated users can view clusters" ON public.clusters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert clusters" ON public.clusters FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update clusters" ON public.clusters FOR UPDATE TO authenticated USING (true);

-- actions: authenticated users can read/write
CREATE POLICY "Authenticated users can view actions" ON public.actions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert actions" ON public.actions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update actions" ON public.actions FOR UPDATE TO authenticated USING (true);

-- roadmap: authenticated users can read/write
CREATE POLICY "Authenticated users can view roadmap" ON public.roadmap FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert roadmap" ON public.roadmap FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update roadmap" ON public.roadmap FOR UPDATE TO authenticated USING (true);

-- customer_portal: public read
CREATE POLICY "Anyone can view customer portal" ON public.customer_portal FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert portal" ON public.customer_portal FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_initials)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    UPPER(LEFT(COALESCE(NEW.raw_user_meta_data->>'full_name', 'U'), 1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
