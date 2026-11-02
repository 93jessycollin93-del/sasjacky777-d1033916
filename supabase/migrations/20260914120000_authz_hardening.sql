-- Authorization hardening: make ownership a database fact, not a code habit.
--
-- Every edge function that writes with the service role bypasses RLS entirely,
-- so a missing `.eq("user_id", ...)` in TypeScript is a cross-tenant write with
-- nothing underneath to catch it. Three of them were missing one. Rather than
-- only fixing the call sites, this makes the invalid row impossible to store:
-- a usage log or a bot link whose key belongs to someone else now fails on a
-- foreign key, whatever the function believed it was doing.
--
-- It also moves two decisions that were spread across several statements —
-- "may this key serve this request" and "rotate this key" — into single
-- transactional functions, because a rate limit that counts in one statement
-- and admits in another is a race, and a rotation that half-applies leaves a
-- live key whose secret nobody received.

-- ---------------------------------------------------------------------------
-- 1. Same-owner relationships, enforced by the schema
-- ---------------------------------------------------------------------------

-- A composite foreign key needs a composite unique to point at. `id` alone is
-- already unique, so this adds no new restriction — it only gives the
-- referencing tables something that carries the owner along with the id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'api_keys_id_user_id_key'
      AND conrelid = 'public.api_keys'::regclass
  ) THEN
    ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_id_user_id_key UNIQUE (id, user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_bots_id_user_id_key'
      AND conrelid = 'public.user_bots'::regclass
  ) THEN
    ALTER TABLE public.user_bots ADD CONSTRAINT user_bots_id_user_id_key UNIQUE (id, user_id);
  END IF;
END
$$;

-- Rows that the constraints below would reject cannot be kept: each one is a
-- log or link claiming a key or bot that does not belong to its stated owner,
-- which is exactly the state this migration exists to make unreachable.
DELETE FROM public.api_usage_logs l
WHERE NOT EXISTS (
  SELECT 1 FROM public.api_keys k
  WHERE k.id = l.api_key_id AND k.user_id = l.user_id
);

DELETE FROM public.bot_api_keys l
WHERE NOT EXISTS (
  SELECT 1 FROM public.api_keys k
  WHERE k.id = l.api_key_id AND k.user_id = l.user_id
);

DELETE FROM public.bot_api_keys l
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_bots b
  WHERE b.id = l.bot_id AND b.user_id = l.user_id
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_usage_logs_key_owner_fkey'
      AND conrelid = 'public.api_usage_logs'::regclass
  ) THEN
    ALTER TABLE public.api_usage_logs
      ADD CONSTRAINT api_usage_logs_key_owner_fkey
      FOREIGN KEY (api_key_id, user_id)
      REFERENCES public.api_keys(id, user_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_api_keys_key_owner_fkey'
      AND conrelid = 'public.bot_api_keys'::regclass
  ) THEN
    ALTER TABLE public.bot_api_keys
      ADD CONSTRAINT bot_api_keys_key_owner_fkey
      FOREIGN KEY (api_key_id, user_id)
      REFERENCES public.api_keys(id, user_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_api_keys_bot_owner_fkey'
      AND conrelid = 'public.bot_api_keys'::regclass
  ) THEN
    ALTER TABLE public.bot_api_keys
      ADD CONSTRAINT bot_api_keys_bot_owner_fkey
      FOREIGN KEY (bot_id, user_id)
      REFERENCES public.user_bots(id, user_id) ON DELETE CASCADE;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Key lifecycle belongs to the server
-- ---------------------------------------------------------------------------
--
-- `api_keys` was writable straight from the browser: the Gunit key panel minted
-- a key client-side and inserted the hash over PostgREST. RLS pinned `user_id`,
-- so nobody could forge a key for someone else — but the *caller* chose
-- `rate_limit`, and a caller-chosen rate limit is not a rate limit. It also
-- let a client set `expires_at` and `superseded_by`, the two columns rotation
-- relies on. Minting now happens only in the `api-keys` function, so the write
-- grants come off and the SELECT policy stays for the panels that list keys.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.api_keys FROM authenticated, anon;
REVOKE ALL ON public.api_keys FROM anon;

DROP POLICY IF EXISTS "Users can insert own keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can update own keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can delete own keys" ON public.api_keys;

-- Links are relationship rows the server maintains alongside the key.
REVOKE INSERT, UPDATE, DELETE ON public.bot_api_keys FROM authenticated, anon;
DROP POLICY IF EXISTS "Users can insert own bot keys" ON public.bot_api_keys;
DROP POLICY IF EXISTS "Users can delete own bot keys" ON public.bot_api_keys;

-- The audit trail was already insert-revoked; the policy that implied
-- otherwise is removed so the grant and the policy tell the same story.
DROP POLICY IF EXISTS "Users can insert own logs" ON public.api_usage_logs;

-- ---------------------------------------------------------------------------
-- 3. A tenant boundary that survives a careless policy
-- ---------------------------------------------------------------------------
--
-- Permissive policies are OR-ed: one broad `USING (true)` added later re-opens
-- a table no matter how correct its siblings are. This table had exactly that
-- once ("Allow all access to conversations"), dropped in a later migration.
-- A RESTRICTIVE policy is AND-ed instead, so it cannot be outvoted — it is the
-- floor under every present and future permissive policy on these tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'jackie_tasks', 'jackie_memory', 'conversations', 'chat_messages',
    'chat_attachments', 'user_bots', 'api_keys', 'api_usage_logs', 'bot_api_keys'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_boundary', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING ((SELECT auth.uid()) = user_id)
         WITH CHECK ((SELECT auth.uid()) = user_id)',
      t || '_owner_boundary', t
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Rate limiting that actually counts the thing it limits
-- ---------------------------------------------------------------------------
--
-- The old limiter counted rows in `api_usage_logs`, which the *caller* wrote
-- afterwards through a separate endpoint. A bot that simply never called
-- /log-usage was never rate limited. Worse, counting and admitting were two
-- statements, so N concurrent requests all read the same count and all passed.
--
-- Runtime admissions are their own table, written by the admission decision
-- itself inside the same transaction, so there is nothing a client can decline
-- to report.
CREATE TABLE IF NOT EXISTS public.api_key_rate_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  endpoint   text NOT NULL DEFAULT 'runtime',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_key_rate_events_key_owner_fkey
    FOREIGN KEY (api_key_id, user_id)
    REFERENCES public.api_keys(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS api_key_rate_events_window_idx
  ON public.api_key_rate_events (api_key_id, created_at DESC);

ALTER TABLE public.api_key_rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_key_rate_events FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.api_key_rate_events TO service_role;

-- Verifies a runtime key and consumes one slot, atomically.
--
-- Returns jsonb rather than a table: in plpgsql, RETURNS TABLE column names
-- become variables in scope, so a body that also says `WHERE user_id = ...`
-- against api_keys raises "column reference user_id is ambiguous" at runtime.
-- One returned document sidesteps the whole class of problem.
--
-- The FOR UPDATE on the key row is what makes the limit real: concurrent
-- requests for the same key serialize behind it, so the count each one reads
-- already includes every admission before it.
CREATE OR REPLACE FUNCTION public.consume_api_key(
  p_key_hash text,
  p_endpoint text DEFAULT 'runtime'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  k       public.api_keys%ROWTYPE;
  v_now   timestamptz := clock_timestamp();
  v_count integer;
  v_limit integer;
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE key_hash = p_key_hash FOR UPDATE;

  IF NOT FOUND OR NOT COALESCE(k.is_active, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_revoked');
  END IF;

  -- A rotated key stays is_active on purpose for its grace window; expiry is
  -- the only thing that ends it, so it has to be checked separately.
  IF k.expires_at IS NOT NULL AND k.expires_at <= v_now THEN
    UPDATE public.api_keys SET is_active = false WHERE id = k.id;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', CASE WHEN k.superseded_by IS NOT NULL THEN 'rotated' ELSE 'expired' END
    );
  END IF;

  v_limit := GREATEST(COALESCE(k.rate_limit, 60), 1);

  DELETE FROM public.api_key_rate_events e
  WHERE e.api_key_id = k.id AND e.created_at < v_now - interval '10 minutes';

  SELECT count(*)::integer INTO v_count
  FROM public.api_key_rate_events e
  WHERE e.api_key_id = k.id AND e.created_at > v_now - interval '1 minute';

  IF v_count >= v_limit THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'rate_limit', v_limit, 'retry_after', 60
    );
  END IF;

  INSERT INTO public.api_key_rate_events (api_key_id, user_id, endpoint, created_at)
  VALUES (k.id, k.user_id, left(COALESCE(NULLIF(p_endpoint, ''), 'runtime'), 255), v_now);

  UPDATE public.api_keys SET last_used_at = v_now WHERE id = k.id;

  RETURN jsonb_build_object(
    'ok', true,
    'key_id', k.id,
    'user_id', k.user_id,
    'scopes', COALESCE(k.scopes, '[]'::jsonb),
    'rate_limit', v_limit
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.consume_api_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_key(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Rotation as one transaction
-- ---------------------------------------------------------------------------
--
-- Rotation issues a replacement, carries the bot links across, then retires the
-- original. Done as three statements, a failure on the last one leaves a live
-- replacement key whose secret was never returned to anyone — an active
-- credential with no owner. Inside one function all three commit or none do.
CREATE OR REPLACE FUNCTION public.rotate_api_key_atomic(
  p_user_id    uuid,
  p_key_id     uuid,
  p_key_hash   text,
  p_prefix     text,
  p_rotated_at timestamptz,
  p_expires_at timestamptz,
  p_immediate  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  existing_key    public.api_keys%ROWTYPE;
  v_replacement   uuid;
  v_links         bigint := 0;
BEGIN
  SELECT * INTO existing_key
  FROM public.api_keys
  WHERE id = p_key_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KEY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF existing_key.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'KEY_ALREADY_ROTATED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.api_keys (
    user_id, name, key_hash, prefix, scopes, rate_limit,
    is_active, rotated_from, rotated_at
  )
  VALUES (
    p_user_id, existing_key.name, p_key_hash, p_prefix,
    existing_key.scopes, existing_key.rate_limit,
    true, existing_key.id, p_rotated_at
  )
  RETURNING id INTO v_replacement;

  INSERT INTO public.bot_api_keys (bot_id, api_key_id, user_id)
  SELECT l.bot_id, v_replacement, p_user_id
  FROM public.bot_api_keys l
  WHERE l.api_key_id = existing_key.id AND l.user_id = p_user_id
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_links = ROW_COUNT;

  UPDATE public.api_keys
  SET superseded_by = v_replacement,
      expires_at    = p_expires_at,
      is_active     = NOT p_immediate
  WHERE id = existing_key.id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'replacement_id', v_replacement,
    'bots_carried_over', v_links
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rotate_api_key_atomic(uuid, uuid, text, text, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_api_key_atomic(uuid, uuid, text, text, timestamptz, timestamptz, boolean)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Provider-side async jobs get a local owner
-- ---------------------------------------------------------------------------
--
-- Polling an xAI video generation only ever proved that you knew a request id.
-- The id is issued by the provider and shared across the whole project account,
-- so "hard to guess" was doing the work that an ownership record should do.
CREATE TABLE IF NOT EXISTS public.xai_generation_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_request_id text NOT NULL UNIQUE,
  model               text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS xai_generation_requests_user_idx
  ON public.xai_generation_requests (user_id, created_at DESC);

ALTER TABLE public.xai_generation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xai_generation_requests FROM anon, authenticated;
GRANT ALL ON public.xai_generation_requests TO service_role;

-- ---------------------------------------------------------------------------
-- 7. The privilege allowlist is matched exactly
-- ---------------------------------------------------------------------------
--
-- core-claim looked the caller's email up with ILIKE, which is pattern
-- matching: `_` and `%` are wildcards there. On the lookup that decides whether
-- to grant the 'owner' role, a stored address containing either character
-- matches addresses nobody put on the list. Exact equality is only safe if the
-- stored form is canonical, so the column is normalized and then held that way.
DO $$
BEGIN
  IF to_regclass('public.jackie_core_access') IS NULL THEN RETURN; END IF;

  -- Two rows differing only by case would collide under the UNIQUE constraint
  -- once folded, so the older grant wins and the duplicate goes.
  DELETE FROM public.jackie_core_access a
  USING public.jackie_core_access b
  WHERE lower(btrim(a.email)) = lower(btrim(b.email))
    AND (a.created_at, a.id) > (b.created_at, b.id);

  UPDATE public.jackie_core_access
  SET email = lower(btrim(email))
  WHERE email IS NOT NULL AND email <> lower(btrim(email));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jackie_core_access_email_normalized'
      AND conrelid = 'public.jackie_core_access'::regclass
  ) THEN
    ALTER TABLE public.jackie_core_access
      ADD CONSTRAINT jackie_core_access_email_normalized
      CHECK (email = lower(btrim(email)));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 8. One place that decides whether a paid provider call may happen
-- ---------------------------------------------------------------------------
--
-- Roughly twenty functions each hold a shared provider credential and, having
-- confirmed the caller is *someone*, spend against it without limit. Model
-- allowlists cap what a request may cost; nothing capped how many. This is the
-- missing middle: an admission record per call, counted per user against a
-- per-minute and per-day ceiling, with an optional per-user override row so a
-- deployment can raise or disable it without a code change.
CREATE TABLE IF NOT EXISTS public.provider_quota_policy (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  per_minute integer NOT NULL DEFAULT 20 CHECK (per_minute >= 0),
  per_day    integer NOT NULL DEFAULT 1000 CHECK (per_day >= 0),
  enabled    boolean NOT NULL DEFAULT true,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_quota_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_quota_policy FROM anon, authenticated;
GRANT ALL ON public.provider_quota_policy TO service_role;

CREATE TABLE IF NOT EXISTS public.provider_usage_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name text NOT NULL,
  model         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_usage_events_user_window_idx
  ON public.provider_usage_events (user_id, created_at DESC);

ALTER TABLE public.provider_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_usage_events FROM anon, authenticated;
GRANT ALL ON public.provider_usage_events TO service_role;

-- Owners read their own usage; nobody writes it from a client.
DROP POLICY IF EXISTS "owners read provider usage" ON public.provider_usage_events;
CREATE POLICY "owners read provider usage" ON public.provider_usage_events
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
GRANT SELECT ON public.provider_usage_events TO authenticated;

-- Admits one provider call, or explains why not. Same shape and the same
-- reasoning as consume_api_key: decide and record in one transaction, because
-- a check that admits before it records is not a limit.
CREATE OR REPLACE FUNCTION public.consume_provider_quota(
  p_user_id  uuid,
  p_function text,
  p_model    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_now        timestamptz := clock_timestamp();
  v_per_minute integer := 20;
  v_per_day    integer := 1000;
  v_enabled    boolean := true;
  v_minute     integer;
  v_day        integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  -- Serializes this user's concurrent calls when an override row exists; the
  -- default path stays lock-free, which is the common case.
  SELECT p.per_minute, p.per_day, p.enabled
    INTO v_per_minute, v_per_day, v_enabled
  FROM public.provider_quota_policy p
  WHERE p.user_id = p_user_id
  FOR UPDATE;

  IF FOUND AND NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quota_disabled');
  END IF;

  v_per_minute := COALESCE(v_per_minute, 20);
  v_per_day    := COALESCE(v_per_day, 1000);

  DELETE FROM public.provider_usage_events e
  WHERE e.user_id = p_user_id AND e.created_at < v_now - interval '2 days';

  SELECT count(*)::integer INTO v_minute
  FROM public.provider_usage_events e
  WHERE e.user_id = p_user_id AND e.created_at > v_now - interval '1 minute';

  IF v_minute >= v_per_minute THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'scope', 'per_minute', 'limit', v_per_minute, 'retry_after', 60
    );
  END IF;

  SELECT count(*)::integer INTO v_day
  FROM public.provider_usage_events e
  WHERE e.user_id = p_user_id AND e.created_at > v_now - interval '1 day';

  IF v_day >= v_per_day THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'quota_exceeded',
      'scope', 'per_day', 'limit', v_per_day, 'retry_after', 3600
    );
  END IF;

  INSERT INTO public.provider_usage_events (user_id, function_name, model)
  VALUES (p_user_id, left(COALESCE(p_function, 'unknown'), 128), left(p_model, 200));

  RETURN jsonb_build_object(
    'ok', true,
    'per_minute_remaining', v_per_minute - v_minute - 1,
    'per_day_remaining', v_per_day - v_day - 1
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.consume_provider_quota(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_provider_quota(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.consume_provider_quota(uuid, text, text) IS
  'Admission control for shared paid provider credentials. Call before every upstream request.';
