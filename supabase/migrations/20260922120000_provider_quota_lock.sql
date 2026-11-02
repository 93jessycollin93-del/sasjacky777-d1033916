-- Close the race in consume_provider_quota.
--
-- 20260914120000 says it plainly: "a check that admits before it records is
-- not a limit". Its own default path was exactly that. The row lock it takes
-- exists only for users with a provider_quota_policy override row, which is
-- almost none of them, so for everyone else N concurrent calls read the same
-- per-minute count and all passed. A per-user transaction-scoped advisory lock
-- serializes them without needing a row to lock. Same signature, same grants.

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

  -- One caller at a time per user, for the length of this transaction. The
  -- FOR UPDATE below only locks when an override row exists, and almost nobody
  -- has one — so the common path counted and admitted without any lock, and N
  -- concurrent requests all read the same count and all passed.
  PERFORM pg_advisory_xact_lock(hashtextextended('consume_provider_quota:' || p_user_id::text, 0));

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
