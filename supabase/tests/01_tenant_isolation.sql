-- Cross-tenant probes. Every one of these must be refused.
--
-- Each probe runs in its own transaction and rolls back, so a refusal that
-- aborts the transaction cannot cascade into the next probe and report a false
-- pass. Results are collected into one table and compared at the end, so the
-- script fails loudly rather than requiring someone to read the output.

\set ON_ERROR_STOP off
\pset pager off

CREATE TEMP TABLE results (probe text, outcome text, expected text);

-- Fixtures --------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','a@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002','b@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO public.api_keys (id, user_id, name, key_hash, prefix, rate_limit) VALUES
  ('11111111-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','A key','hash_a','sk_live_aaaa',3),
  ('22222222-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','B key','hash_b','sk_live_bbbb',60)
ON CONFLICT DO NOTHING;

INSERT INTO public.user_bots (id, user_id, name) VALUES
  ('33333333-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','A bot'),
  ('44444444-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','B bot')
ON CONFLICT DO NOTHING;

INSERT INTO public.jackie_tasks (user_id, title)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','A private task');

INSERT INTO public.craft_worlds (id, user_id, name, summary, data)
VALUES ('wA', 'aaaaaaaa-0000-0000-0000-000000000001', 'A world', '{}', '{}')
ON CONFLICT DO NOTHING;

-- Service-role writes: the schema must refuse what a buggy function permits --
-- These are the exact inserts the unfixed api-keys function would have made.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.api_usage_logs (api_key_id, user_id, endpoint, status_code)
    VALUES ('11111111-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000002','/x',200);
    INSERT INTO results VALUES ('svc: log usage against another user''s key','ALLOWED','REFUSED');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO results VALUES ('svc: log usage against another user''s key','REFUSED','REFUSED');
  END;

  BEGIN
    INSERT INTO public.bot_api_keys (bot_id, api_key_id, user_id)
    VALUES ('33333333-0000-0000-0000-00000000000a','22222222-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002');
    INSERT INTO results VALUES ('svc: link another user''s bot','ALLOWED','REFUSED');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO results VALUES ('svc: link another user''s bot','REFUSED','REFUSED');
  END;

  BEGIN
    INSERT INTO public.bot_api_keys (bot_id, api_key_id, user_id)
    VALUES ('44444444-0000-0000-0000-00000000000b','11111111-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000002');
    INSERT INTO results VALUES ('svc: link to another user''s key','ALLOWED','REFUSED');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO results VALUES ('svc: link to another user''s key','REFUSED','REFUSED');
  END;

  BEGIN
    INSERT INTO public.bot_api_keys (bot_id, api_key_id, user_id)
    VALUES ('33333333-0000-0000-0000-00000000000a','11111111-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001');
    INSERT INTO results VALUES ('svc: same-owner link','ALLOWED','ALLOWED');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO results VALUES ('svc: same-owner link','REFUSED','ALLOWED');
  END;
END
$$;

-- Rate limiting is authoritative -----------------------------------------
-- Key A allows 3/minute. The fourth call must be refused by the limiter
-- itself, not by anything the caller chose to report afterwards.
DO $$
DECLARE r jsonb; admitted int := 0;
BEGIN
  FOR i IN 1..5 LOOP
    r := public.consume_api_key('hash_a');
    IF (r->>'ok')::boolean THEN admitted := admitted + 1; END IF;
  END LOOP;
  INSERT INTO results VALUES (
    'rate limit admits exactly 3 of 5',
    CASE WHEN admitted = 3 THEN 'PASS' ELSE 'admitted=' || admitted END,
    'PASS');

  r := public.consume_api_key('no-such-hash');
  INSERT INTO results VALUES ('unknown key refused', r->>'reason', 'invalid_or_revoked');
END
$$;

-- Rotation is all-or-nothing ---------------------------------------------
DO $$
DECLARE r jsonb;
BEGIN
  r := public.rotate_api_key_atomic(
    'aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-00000000000a',
    'hash_a_new','sk_live_new', now(), now() + interval '24 hours', false);
  INSERT INTO results VALUES ('rotation carries bot links',
    CASE WHEN (r->>'bots_carried_over')::int = 1 THEN 'PASS' ELSE r->>'bots_carried_over' END, 'PASS');

  BEGIN
    r := public.rotate_api_key_atomic(
      'aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-00000000000a',
      'h2','p2', now(), now(), false);
    INSERT INTO results VALUES ('double rotation refused','ALLOWED','REFUSED');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results VALUES ('double rotation refused','REFUSED','REFUSED');
  END;

  BEGIN
    r := public.rotate_api_key_atomic(
      'bbbbbbbb-0000-0000-0000-000000000002','22222222-0000-0000-0000-00000000000b',
      'h3','p3', now(), now(), false);
    -- B rotating B's own key is legitimate; rotating A's is not.
    r := public.rotate_api_key_atomic(
      'bbbbbbbb-0000-0000-0000-000000000002','11111111-0000-0000-0000-00000000000a',
      'h4','p4', now(), now(), false);
    INSERT INTO results VALUES ('rotating another user''s key refused','ALLOWED','REFUSED');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results VALUES ('rotating another user''s key refused','REFUSED','REFUSED');
  END;
END
$$;

-- Provider quota admits then blocks --------------------------------------
DO $$
DECLARE r jsonb; admitted int := 0;
BEGIN
  INSERT INTO public.provider_quota_policy (user_id, per_minute, per_day)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 2, 100)
  ON CONFLICT (user_id) DO UPDATE SET per_minute = 2, per_day = 100;

  FOR i IN 1..4 LOOP
    r := public.consume_provider_quota('aaaaaaaa-0000-0000-0000-000000000001','jackie-openai','m');
    IF (r->>'ok')::boolean THEN admitted := admitted + 1; END IF;
  END LOOP;
  INSERT INTO results VALUES ('provider quota admits exactly 2 of 4',
    CASE WHEN admitted = 2 THEN 'PASS' ELSE 'admitted=' || admitted END, 'PASS');
END
$$;

SELECT probe, outcome, expected,
       CASE WHEN outcome = expected THEN 'ok' ELSE 'FAIL' END AS verdict
FROM results ORDER BY probe;

-- Non-zero exit when anything drifted.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM results WHERE outcome IS DISTINCT FROM expected;
  IF bad > 0 THEN
    RAISE EXCEPTION '% authorization probe(s) failed', bad;
  END IF;
  RAISE NOTICE 'all service-role and RPC probes passed';
END
$$;
