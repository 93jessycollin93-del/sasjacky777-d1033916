CREATE TABLE public.jackie_core_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_file TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jackie_core_docs TO authenticated;
GRANT ALL ON public.jackie_core_docs TO service_role;
ALTER TABLE public.jackie_core_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners read core docs" ON public.jackie_core_docs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::public.app_role));

CREATE POLICY "owners write core docs" ON public.jackie_core_docs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));

CREATE TABLE public.jackie_core_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.jackie_core_access TO authenticated;
GRANT ALL ON public.jackie_core_access TO service_role;
ALTER TABLE public.jackie_core_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners manage core access" ON public.jackie_core_access
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));

CREATE OR REPLACE FUNCTION public.claim_core_access()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _email TEXT;
BEGIN
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid();
  IF _email IS NULL THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.jackie_core_access WHERE lower(email) = _email) THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'owner'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN TRUE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_core_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_core_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_core_access() TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

INSERT INTO public.jackie_core_access (email, note) VALUES
  ('93jessycollin93@gmail.com', 'primary account'),
  ('zhao09682@gmail.com', 'primary account (alt)');

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'owner'::public.app_role FROM auth.users
WHERE lower(email) IN ('93jessycollin93@gmail.com', 'zhao09682@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.jackie_core_docs (slug, title, source_file, sort_order, body) VALUES
  ('core-identity', 'Core Identity', 'CORE_IDENTITY.md', 1, $doc$Pending sync — open Jackie Core and press "Sync from repo".$doc$),
  ('behavior-rules', 'Behavior Rules', 'BEHAVIOR_RULES.md', 2, $doc$Pending sync — open Jackie Core and press "Sync from repo".$doc$),
  ('memory-model', 'Memory Model', 'MEMORY_MODEL.md', 3, $doc$Pending sync — open Jackie Core and press "Sync from repo".$doc$),
  ('security-principles', 'Security Principles', 'SECURITY_PRINCIPLES.md', 4, $doc$Pending sync — open Jackie Core and press "Sync from repo".$doc$),
  ('architecture', 'Architecture', 'ARCHITECTURE.md', 5, $doc$Pending sync — open Jackie Core and press "Sync from repo".$doc$),
  ('roadmap', 'Roadmap', 'ROADMAP.md', 6, $doc$Pending sync — open Jackie Core and press "Sync from repo".$doc$);