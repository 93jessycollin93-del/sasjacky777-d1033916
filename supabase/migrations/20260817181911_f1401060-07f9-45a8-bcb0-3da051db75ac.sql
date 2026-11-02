-- Move the role-check helpers off the exposed API schema.
--
-- has_role()/is_admin() must stay SECURITY DEFINER: a policy ON user_roles that
-- reads user_roles re-enters RLS and recurses. What they must NOT be is
-- callable over the Data API by any signed-in client, which is what putting
-- them in `public` implied. A schema that PostgREST does not expose keeps the
-- policies working while removing the RPC surface.
--
-- claim_core_access() is deleted rather than moved: it wrote a privileged row,
-- and that decision now lives in the core-claim edge function, which verifies
-- the caller's JWT and the allowlist before using the service role.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION private.has_role(UUID, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin(UUID) TO authenticated, service_role;

-- Repoint every policy at the private helpers.
DROP POLICY "read own roles" ON public.user_roles;
DROP POLICY "admins grant roles" ON public.user_roles;
DROP POLICY "admins revoke roles" ON public.user_roles;
DROP POLICY "admins change roles" ON public.user_roles;

CREATE POLICY "read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.is_admin(auth.uid()));

CREATE POLICY "admins grant roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin(auth.uid()));

CREATE POLICY "admins revoke roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (private.is_admin(auth.uid()));

CREATE POLICY "admins change roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (private.is_admin(auth.uid()))
  WITH CHECK (private.is_admin(auth.uid()));

DROP POLICY "owners read core docs" ON public.jackie_core_docs;
DROP POLICY "owners write core docs" ON public.jackie_core_docs;

CREATE POLICY "owners read core docs" ON public.jackie_core_docs
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role));

CREATE POLICY "owners write core docs" ON public.jackie_core_docs
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'owner'::public.app_role));

DROP POLICY "owners manage core access" ON public.jackie_core_access;

CREATE POLICY "owners manage core access" ON public.jackie_core_access
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'owner'::public.app_role));

-- Now nothing in the exposed schema depends on these.
DROP FUNCTION IF EXISTS public.claim_core_access();
DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role);
DROP FUNCTION IF EXISTS public.is_admin(UUID);