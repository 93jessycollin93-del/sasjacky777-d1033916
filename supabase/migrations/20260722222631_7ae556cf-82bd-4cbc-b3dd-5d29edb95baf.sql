
CREATE TABLE public.mesh_routers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesh_routers TO authenticated;
GRANT ALL ON public.mesh_routers TO service_role;
ALTER TABLE public.mesh_routers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own routers select" ON public.mesh_routers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own routers insert" ON public.mesh_routers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own routers update" ON public.mesh_routers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own routers delete" ON public.mesh_routers FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.mesh_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  router_id UUID REFERENCES public.mesh_routers(id) ON DELETE SET NULL,
  capability_required TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX mesh_jobs_queue_idx ON public.mesh_jobs (user_id, status, capability_required, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesh_jobs TO authenticated;
GRANT ALL ON public.mesh_jobs TO service_role;
ALTER TABLE public.mesh_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs select" ON public.mesh_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own jobs insert" ON public.mesh_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own jobs update" ON public.mesh_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own jobs delete" ON public.mesh_jobs FOR DELETE USING (auth.uid() = user_id);
