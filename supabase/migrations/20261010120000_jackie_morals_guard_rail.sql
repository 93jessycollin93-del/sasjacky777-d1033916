-- Jackie's morals, and the guard rail that shows whether anything touched them.
--
-- Three tables:
--
--   jackie_morals                 what the owner wants Jackie to hold to. Every
--                                 engine adds the enabled ones to her persona.
--   jackie_morals_ledger          every change to those morals, and every seal,
--                                 as an append-only hash chain. Written only by
--                                 the triggers and functions below.
--   jackie_persona_attestations   what each engine actually ran: which persona,
--                                 which morals, or a caller's own system prompt
--                                 in place of both. Written only by the engines.
--
-- The point is visibility, so the honest limits belong here too. A database
-- superuser can disable the triggers and rewrite the ledger with a chain that
-- verifies. The page answers that with a witness: each browser remembers the
-- last head it verified, and a history that no longer contains it is reported
-- as rewritten. What it cannot catch is a rewrite that happens before any
-- browser has looked — which is why the seal also lives in the ledger, and why
-- the docs say plainly that git history and CI remain the real anchor for code.

-- --- morals -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jackie_morals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  rule       text NOT NULL CHECK (char_length(btrim(rule)) BETWEEN 1 AND 280),
  category   text NOT NULL DEFAULT 'custom'
             CHECK (category IN ('honesty', 'care', 'privacy', 'safety', 'fairness', 'custom')),
  enabled    boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.jackie_morals ENABLE ROW LEVEL SECURITY;
-- Supabase's default privileges hand every new table to the service role whole,
-- TRUNCATE included. TRUNCATE fires no row triggers, so it would empty the morals
-- without a single ledger entry; it is taken away here and refused below.
REVOKE ALL ON public.jackie_morals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jackie_morals TO authenticated, service_role;

-- One set, for Jackie, editable by whoever holds the owner seat. Any account
-- can sign in to this app; signing in must not make anyone her author.
DROP POLICY IF EXISTS "owners read morals" ON public.jackie_morals;
DROP POLICY IF EXISTS "owners write morals" ON public.jackie_morals;
CREATE POLICY "owners read morals" ON public.jackie_morals
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role));
CREATE POLICY "owners write morals" ON public.jackie_morals
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'owner'::public.app_role));

-- --- ledger -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jackie_morals_ledger (
  seq       bigint PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  -- NULL means the write did not come from a signed-in account: the service
  -- role, a migration, the SQL editor. The page shows that as its own finding.
  actor     uuid,
  action    text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'seal')),
  moral_id  uuid,
  -- The hashed record. Displayed from here rather than from the columns above,
  -- which exist for ordering and filtering and are not part of the chain.
  payload   text NOT NULL,
  prev_hash text NOT NULL,
  hash      text NOT NULL
);

ALTER TABLE public.jackie_morals_ledger ENABLE ROW LEVEL SECURITY;
-- Read-only for every API role, the service role included: Supabase's default
-- privileges would otherwise leave it INSERT, and a forged entry carrying a
-- correct hash would verify. Only the SECURITY DEFINER append below writes.
REVOKE ALL ON public.jackie_morals_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.jackie_morals_ledger TO authenticated, service_role;

DROP POLICY IF EXISTS "owners read the morals ledger" ON public.jackie_morals_ledger;
CREATE POLICY "owners read the morals ledger" ON public.jackie_morals_ledger
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role));

-- Append-only for everyone, the service role included: no grant to write is
-- given above, and these triggers refuse even a role that bypasses grants.
CREATE OR REPLACE FUNCTION private.jackie_morals_ledger_is_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'jackie_morals_ledger is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS jackie_morals_ledger_no_change ON public.jackie_morals_ledger;
CREATE TRIGGER jackie_morals_ledger_no_change
  BEFORE UPDATE OR DELETE ON public.jackie_morals_ledger
  FOR EACH ROW EXECUTE FUNCTION private.jackie_morals_ledger_is_append_only();
DROP TRIGGER IF EXISTS jackie_morals_ledger_no_truncate ON public.jackie_morals_ledger;
CREATE TRIGGER jackie_morals_ledger_no_truncate
  BEFORE TRUNCATE ON public.jackie_morals_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION private.jackie_morals_ledger_is_append_only();

-- The only way in. Each entry hashes the one before it, so editing, removing or
-- reordering any entry breaks every hash after it.
--
-- The browser recomputes exactly this (src/lib/jackie-morals.ts, ledgerHash):
--   sha256_hex( prev_hash || '\n' || seq || '\n' || action || '\n' || payload )
-- over UTF-8, with 'genesis' as the first entry's prev_hash. Change one side and
-- every entry reads as tampered.
CREATE OR REPLACE FUNCTION private.jackie_morals_append(
  p_action text,
  p_moral_id uuid,
  p_body jsonb,
  p_actor uuid
) RETURNS public.jackie_morals_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  last_seq  bigint;
  last_hash text;
  next_seq  bigint;
  body      text;
  entry     public.jackie_morals_ledger;
BEGIN
  -- Serialise appends: two concurrent writers reading the same head would fork
  -- the chain, and a fork reads exactly like tampering.
  PERFORM pg_advisory_xact_lock(hashtext('public.jackie_morals_ledger'));

  SELECT seq, hash INTO last_seq, last_hash
    FROM public.jackie_morals_ledger ORDER BY seq DESC LIMIT 1;
  next_seq := coalesce(last_seq, 0) + 1;
  last_hash := coalesce(last_hash, 'genesis');

  body := (jsonb_build_object(
    'at', now(),
    'actor', p_actor,
    'action', p_action,
    'moral_id', p_moral_id
  ) || coalesce(p_body, '{}'::jsonb))::text;

  INSERT INTO public.jackie_morals_ledger (seq, actor, action, moral_id, payload, prev_hash, hash)
  VALUES (
    next_seq, p_actor, p_action, p_moral_id, body, last_hash,
    encode(sha256(convert_to(
      last_hash || E'\n' || next_seq::text || E'\n' || p_action || E'\n' || body, 'UTF8')), 'hex')
  )
  RETURNING * INTO entry;
  RETURN entry;
END;
$$;

REVOKE ALL ON FUNCTION private.jackie_morals_append(text, uuid, jsonb, uuid) FROM PUBLIC;

-- Every write to the morals, from any path, lands in the ledger: the page, the
-- SQL editor, a migration, an agent that found a token. Not only the ones made
-- through the page.
CREATE OR REPLACE FUNCTION private.jackie_morals_record_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_action text := lower(TG_OP);
  v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN v_action := 'create'; END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  PERFORM private.jackie_morals_append(
    v_action,
    v_id,
    jsonb_build_object(
      'before', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      'after',  CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
    ),
    auth.uid()
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS jackie_morals_ledger_record ON public.jackie_morals;
CREATE TRIGGER jackie_morals_ledger_record
  AFTER INSERT OR UPDATE OR DELETE ON public.jackie_morals
  FOR EACH ROW EXECUTE FUNCTION private.jackie_morals_record_change();

-- Row triggers do not fire on TRUNCATE, so it would be the one way to remove
-- every moral without the ledger seeing it. Refused for whoever still holds it.
CREATE OR REPLACE FUNCTION private.jackie_morals_refuse_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'jackie_morals cannot be truncated: delete the rows, so each removal is recorded'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS jackie_morals_no_truncate ON public.jackie_morals;
CREATE TRIGGER jackie_morals_no_truncate
  BEFORE TRUNCATE ON public.jackie_morals
  FOR EACH STATEMENT EXECUTE FUNCTION private.jackie_morals_refuse_truncate();

-- Housekeeping that has to hold however the row was written.
CREATE OR REPLACE FUNCTION private.jackie_morals_before_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Locked, so two inserts at once cannot both count 23 and both go in.
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext('public.jackie_morals'));
  END IF;
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM public.jackie_morals) >= 24 THEN
    RAISE EXCEPTION 'Jackie can hold at most 24 morals. Disable or remove one first.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jackie_morals_before_write ON public.jackie_morals;
CREATE TRIGGER jackie_morals_before_write
  BEFORE INSERT OR UPDATE ON public.jackie_morals
  FOR EACH ROW EXECUTE FUNCTION private.jackie_morals_before_write();

-- Sealing: the owner's statement that the current persona and morals are the
-- ones they approve. Called by the jackie-morals function after it has checked
-- the owner role, with the persona text as that function's deployed code has
-- it — the browser does not get to say what was sealed.
CREATE OR REPLACE FUNCTION public.jackie_morals_seal(p_actor uuid, p_body jsonb)
RETURNS public.jackie_morals_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_actor IS NULL OR NOT private.has_role(p_actor, 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'only an owner can seal Jackie''s morals' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN private.jackie_morals_append('seal', NULL, p_body, p_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.jackie_morals_seal(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jackie_morals_seal(uuid, jsonb) TO service_role;

-- --- attestations ---------------------------------------------------------------

-- One row per distinct configuration an engine has run with. A new persona or
-- morals fingerprint starts a new row instead of overwriting the old one, so the
-- day a change arrived stays visible, and the table stays bounded by how many
-- configurations there have been rather than by how many messages.
CREATE TABLE IF NOT EXISTS public.jackie_persona_attestations (
  engine     text NOT NULL CHECK (char_length(engine) BETWEEN 1 AND 64),
  -- 'rig' is Jacky: the owner's rig brings its own persona, which this side
  -- cannot fingerprint, and gets the morals in front of its prompt.
  mode       text NOT NULL CHECK (mode IN ('persona', 'persona-without-morals', 'override', 'rig')),
  persona_fp text NOT NULL CHECK (char_length(persona_fp) BETWEEN 1 AND 64),
  morals_fp  text NOT NULL CHECK (char_length(morals_fp) BETWEEN 1 AND 64),
  detail     text CHECK (detail IS NULL OR char_length(detail) <= 300),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  requests   bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (engine, mode, persona_fp, morals_fp)
);

ALTER TABLE public.jackie_persona_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jackie_persona_attestations FROM anon, authenticated;
GRANT SELECT ON public.jackie_persona_attestations TO authenticated;
GRANT ALL ON public.jackie_persona_attestations TO service_role;

DROP POLICY IF EXISTS "owners read attestations" ON public.jackie_persona_attestations;
CREATE POLICY "owners read attestations" ON public.jackie_persona_attestations
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'owner'::public.app_role));

CREATE OR REPLACE FUNCTION public.record_persona_attestation(
  p_engine text, p_mode text, p_persona_fp text, p_morals_fp text, p_detail text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.jackie_persona_attestations (engine, mode, persona_fp, morals_fp, detail)
  VALUES (p_engine, p_mode, p_persona_fp, p_morals_fp, left(p_detail, 300))
  ON CONFLICT (engine, mode, persona_fp, morals_fp) DO UPDATE
    SET last_seen = now(),
        requests  = public.jackie_persona_attestations.requests + 1,
        detail    = excluded.detail;
$$;

REVOKE ALL ON FUNCTION public.record_persona_attestation(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_persona_attestation(text, text, text, text, text)
  TO service_role;
