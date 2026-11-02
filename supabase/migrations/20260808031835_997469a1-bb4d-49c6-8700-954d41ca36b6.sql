-- 1. Remove client-side insert on api_usage_logs (server/service role writes them)
DROP POLICY IF EXISTS "Users can insert own logs" ON public.api_usage_logs;
REVOKE INSERT ON public.api_usage_logs FROM authenticated, anon;
GRANT ALL ON public.api_usage_logs TO service_role;

-- 2. Scope ownership policies to the authenticated role
DROP POLICY IF EXISTS "own pods select" ON public.eye_pod_registry;
DROP POLICY IF EXISTS "own pods insert" ON public.eye_pod_registry;
DROP POLICY IF EXISTS "own pods update" ON public.eye_pod_registry;
DROP POLICY IF EXISTS "own pods delete" ON public.eye_pod_registry;
CREATE POLICY "own pods select" ON public.eye_pod_registry FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own pods insert" ON public.eye_pod_registry FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pods update" ON public.eye_pod_registry FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pods delete" ON public.eye_pod_registry FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own jobs select" ON public.mesh_jobs;
DROP POLICY IF EXISTS "own jobs insert" ON public.mesh_jobs;
DROP POLICY IF EXISTS "own jobs update" ON public.mesh_jobs;
DROP POLICY IF EXISTS "own jobs delete" ON public.mesh_jobs;
CREATE POLICY "own jobs select" ON public.mesh_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own jobs insert" ON public.mesh_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own jobs update" ON public.mesh_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own jobs delete" ON public.mesh_jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own routers select" ON public.mesh_routers;
DROP POLICY IF EXISTS "own routers insert" ON public.mesh_routers;
DROP POLICY IF EXISTS "own routers update" ON public.mesh_routers;
DROP POLICY IF EXISTS "own routers delete" ON public.mesh_routers;
CREATE POLICY "own routers select" ON public.mesh_routers FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own routers insert" ON public.mesh_routers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own routers update" ON public.mesh_routers FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own routers delete" ON public.mesh_routers FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own folds select" ON public.pod_folds;
DROP POLICY IF EXISTS "own folds insert" ON public.pod_folds;
DROP POLICY IF EXISTS "own folds delete" ON public.pod_folds;
CREATE POLICY "own folds select" ON public.pod_folds FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own folds insert" ON public.pod_folds FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own folds delete" ON public.pod_folds FOR DELETE TO authenticated USING (auth.uid() = user_id);