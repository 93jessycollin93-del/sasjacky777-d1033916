
CREATE OR REPLACE FUNCTION public.match_pod_folds(
  query_embedding extensions.vector(768),
  match_user uuid,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid, pod_id uuid, router_id uuid, capability text,
  source_ref text, source_hash text, color text, glyph text,
  created_at timestamptz, similarity float
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT f.id, f.pod_id, f.router_id, f.capability, f.source_ref,
         f.source_hash, f.color, f.glyph, f.created_at,
         1 - (f.embedding <=> query_embedding) AS similarity
  FROM public.pod_folds f
  WHERE f.user_id = match_user
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_pod_folds(extensions.vector(768), uuid, int) TO authenticated, service_role;
