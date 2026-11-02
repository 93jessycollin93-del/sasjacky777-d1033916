
create extension if not exists vector;

CREATE TABLE public.eye_pod_registry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pod_key TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  glyph TEXT NOT NULL DEFAULT '◈',
  capability TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  content_hash TEXT,
  bytes_raw BIGINT NOT NULL DEFAULT 0,
  bytes_compressed BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pod_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eye_pod_registry TO authenticated;
GRANT ALL ON public.eye_pod_registry TO service_role;
ALTER TABLE public.eye_pod_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pods select" ON public.eye_pod_registry FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pods insert" ON public.eye_pod_registry FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pods update" ON public.eye_pod_registry FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own pods delete" ON public.eye_pod_registry FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_eye_pod_registry_updated_at
  BEFORE UPDATE ON public.eye_pod_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.pod_folds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pod_id UUID REFERENCES public.eye_pod_registry(id) ON DELETE CASCADE,
  router_id UUID REFERENCES public.mesh_routers(id) ON DELETE SET NULL,
  capability TEXT NOT NULL,
  source_ref TEXT,
  source_hash TEXT NOT NULL,
  color TEXT,
  glyph TEXT,
  embedding vector(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pod_folds TO authenticated;
GRANT ALL ON public.pod_folds TO service_role;
ALTER TABLE public.pod_folds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own folds select" ON public.pod_folds FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own folds insert" ON public.pod_folds FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own folds delete" ON public.pod_folds FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX pod_folds_hnsw ON public.pod_folds USING hnsw (embedding vector_cosine_ops);
CREATE INDEX pod_folds_user_pod_idx ON public.pod_folds (user_id, pod_id, created_at DESC);

ALTER TABLE public.mesh_routers ADD COLUMN pod_id UUID REFERENCES public.eye_pod_registry(id) ON DELETE SET NULL;
