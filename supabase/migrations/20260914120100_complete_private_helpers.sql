-- Finish the move of the role helpers out of the exposed API schema.
--
-- 20260817181911 set out to do this: put has_role()/is_admin() in a schema
-- PostgREST does not expose, repoint every policy at them, and delete
-- claim_core_access() — a SECURITY DEFINER function, EXECUTE granted to
-- `authenticated`, that writes the caller an 'owner' row. That migration
-- cannot succeed. It repoints seven policies and misses an eighth: the
-- "read own or audit all" policy on audit_events, added a week earlier, also
-- calls public.is_admin() and public.has_role(). So the DROP FUNCTION at the
-- end fails on a dependency and the migration errors out — every time, on any
-- database that has audit_events.
--
-- What that leaves behind depends on whether the runner wrapped it in a
-- transaction, and neither outcome is the intended one: either nothing applied
-- and the helpers are still in `public`, or everything but the drops applied
-- and the helpers are still in `public`. Both keep claim_core_access() callable
-- over the Data API by any signed-in user, and both leave is_admin() available
-- for probing whether an arbitrary user id is an admin.
--
-- This migration is written to land correctly from any of those states.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('owner','admin'));
$$;

REVOKE ALL ON FUNCTION private.has_role(UUID, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin(UUID) TO authenticated, service_role;

-- The policy 20260817181911 forgot. Recreated verbatim except for the schema
-- the helpers live in, so an auditor keeps exactly the oversight they had.
DROP POLICY IF EXISTS "read own or audit all" ON public.audit_events;
CREATE POLICY "read own or audit all" ON public.audit_events
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR private.is_admin(auth.uid())
    OR private.has_role(auth.uid(), 'auditor'::public.app_role)
  );

-- The seven the original migration did handle, repeated so this lands whether
-- or not any of it took effect.
DROP POLICY IF EXISTS "read own roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins grant roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins revoke roles" ON public.user_roles;
DROP POLICY IF EXISTS "admins change roles" ON public.user_roles;

CREATE POLICY "read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.is_admin(auth.uid()));

-- No `auth.uid() = user_id` escape here on purpose: with one, any user could
-- insert their own 'owner' row and the table would be decorative.
CREATE POLICY "admins grant roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (private.is_admin(auth.uid()));
CREATE POLICY "admins revoke roles" ON public.user_roles
  FOR DELETE TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "admins change roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "owners read core docs" ON public.jackie_core_docs;
DROP POLICY IF EXISTS "owners write core docs" ON public.jackie_core_docs;
CREATE POLICY "owners read core docs" ON public.jackie_core_docs
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role));
CREATE POLICY "owners write core docs" ON public.jackie_core_docs
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'owner'::public.app_role));

DROP POLICY IF EXISTS "owners manage core access" ON public.jackie_core_access;
CREATE POLICY "owners manage core access" ON public.jackie_core_access
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'owner'::public.app_role));

-- Now nothing in the exposed schema depends on them.
--
-- Deliberately not CASCADE: if some policy still references these, the drop
-- should fail loudly the way it has been, rather than silently deleting the
-- policy and leaving a table readable by everyone. A failure here means
-- another dependency appeared and this migration needs the same treatment.
DROP FUNCTION IF EXISTS public.claim_core_access();
DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role);
DROP FUNCTION IF EXISTS public.is_admin(UUID);
