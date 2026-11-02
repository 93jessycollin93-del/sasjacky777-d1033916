-- PermissionBroker foundation: roles, and a way to ask about them from RLS.
--
-- The PC has a permission broker (lib/permissions.ts); Jackie has had no notion
-- of a role at all. Every table here is scoped with `auth.uid() = user_id`,
-- which answers "is this mine" but never "am I allowed" — so there is no way to
-- express an operator who may dispatch a job but not rotate a key, or an
-- auditor who may read the trail and change nothing.
--
-- Roles live in their own table rather than on a profile row. A profile is
-- editable by the user it describes, so a role column there is a privilege the
-- holder can grant themselves. Separating the table is what makes that
-- impossible.
--
-- has_role() is SECURITY DEFINER for a specific reason: a policy ON user_roles
-- that reads user_roles re-enters RLS and recurses. A definer function runs as
-- its owner with RLS bypassed, so the policy can ask the question without
-- asking it of itself.

CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'operator', 'auditor');

CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- One row per role per user; re-granting is a no-op rather than a duplicate.
  UNIQUE (user_id, role)
);

CREATE INDEX idx_user_roles_user ON public.user_roles (user_id);

-- STABLE, not VOLATILE: the planner may call this once per statement instead of
-- once per row, which matters when it sits in a policy over a large table.
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
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

-- Convenience for the common "owner or admin" test, so policies do not have to
-- spell out the disjunction and drift apart over time.
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
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

GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Anyone may see what they themselves hold; an admin may see everyone's.
CREATE POLICY "read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Granting is an admin act. Note these deliberately do NOT carry a
-- `auth.uid() = user_id` escape: without this, any user could insert their own
-- 'owner' row and the whole table would be decorative.
CREATE POLICY "admins grant roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "admins revoke roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "admins change roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Bootstrapping: with no admin, no one can grant one through the API — by
-- design, since a self-service first owner is a self-service privilege
-- escalation. Seed the first owner with the service role, which bypasses RLS:
--
--   INSERT INTO public.user_roles (user_id, role)
--   VALUES ('<the owner uuid from auth.users>', 'owner');

COMMENT ON TABLE public.user_roles IS
  'Role grants, kept off the profile so a user cannot grant themselves. Query via has_role()/is_admin() from RLS policies.';
