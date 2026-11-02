-- Audit trail: an append-only record of sensitive actions.
--
-- Mirrors the PC's lib/auditLog.ts (action, actor, category, details, result),
-- which describes itself as an append-only immutable log but is localStorage —
-- so it is neither durable nor immutable, and anyone with a devtools console
-- can rewrite it. Here immutability is a property of the schema.
--
-- jackie_control_audit already exists and stays as it is: it records control
-- commands specifically, and its rows are user-owned and user-deletable. This
-- table is the general trail — permission changes, key access, data exports —
-- and the difference that matters is that nobody can edit or erase it through
-- the API, including the owner.
--
-- There are deliberately no UPDATE and no DELETE policies. RLS denies whatever
-- no policy permits, so those verbs are simply unavailable to authenticated
-- callers. A trail an admin can quietly prune is not a trail. Retention and
-- pruning belong to the service role, which bypasses RLS by design.

CREATE TYPE public.audit_category AS ENUM (
  'model_call',
  'file_access',
  'permission_change',
  'shell_exec',
  'data_export',
  'auth',
  'other'
);

CREATE TYPE public.audit_result AS ENUM ('success', 'denied', 'error');

CREATE TABLE public.audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- What happened, and which scope/app did it — the PC's actor field.
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'jackie',
  category public.audit_category NOT NULL DEFAULT 'other',
  details JSONB,
  result public.audit_result NOT NULL DEFAULT 'success'
);

-- The trail is read newest-first, per user or wholesale by an auditor.
CREATE INDEX idx_audit_events_user_ts ON public.audit_events (user_id, ts DESC);
CREATE INDEX idx_audit_events_ts ON public.audit_events (ts DESC);
CREATE INDEX idx_audit_events_category_ts ON public.audit_events (category, ts DESC);

GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- You can always read your own trail. Auditors and admins read everyone's --
-- which is the whole point of the auditor role: oversight without the ability
-- to change anything, since no write policy admits them either.
CREATE POLICY "read own or audit all" ON public.audit_events
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'auditor')
  );

-- You may only append events attributed to yourself. Without the WITH CHECK a
-- caller could write entries in someone else's name, which is worse than no
-- trail: it is a trail that lies.
CREATE POLICY "append own events" ON public.audit_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.audit_events IS
  'Append-only audit trail. No UPDATE/DELETE policies exist, so authenticated callers cannot alter or erase history; pruning is service-role only.';
