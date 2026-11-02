-- Crafted indexes — the pills — synced between a person's own devices.
--
-- The forge is local-first: `src/lib/forge/store.ts` reads and writes
-- localStorage, and this table is a second copy that follows you between
-- devices and survives a cleared cache. Nothing here is on the read path of the
-- app, which is why an index still works with no network and no account.
--
-- The spec is stored as one jsonb document rather than shredded into columns,
-- and that is deliberate. An index is authored, versioned and validated as a
-- whole by `src/lib/forge/types.ts`; splitting it into columns would put a
-- second, weaker copy of that schema in the database, where it would drift from
-- the one the app actually enforces. The columns here are only what the
-- *database* needs to do its job: who owns it, and when it last changed.

CREATE TABLE IF NOT EXISTS public.crafted_indexes (
  -- The author's own id for the index ("recall-v2"), not a surrogate key. It is
  -- what the export file carries and what a person types, so the primary key is
  -- per user rather than global: two people may both craft a "keeper".
  id          text        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spec        jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, id),

  -- The app validates far more than this and is the real gate. These are the
  -- invariants worth also holding in the database, because a row breaking one
  -- of them is unreadable rather than merely wrong: the sync reads `spec->>id`
  -- to match rows against local ones, so a spec whose id disagrees with its own
  -- row would be pulled down under the wrong name and shadow a real index.
  CONSTRAINT crafted_indexes_spec_is_object CHECK (jsonb_typeof(spec) = 'object'),
  CONSTRAINT crafted_indexes_spec_id_matches CHECK (spec->>'id' = id),
  CONSTRAINT crafted_indexes_spec_has_name CHECK (coalesce(spec->>'name', '') <> ''),
  -- A micro model's context is small. 64 KB of spec is already far past what
  -- could usefully be sent to one, so this is a ceiling against accident and
  -- abuse rather than a design limit anyone will meet.
  CONSTRAINT crafted_indexes_spec_bounded CHECK (pg_column_size(spec) < 65536)
);

COMMENT ON TABLE public.crafted_indexes IS
  'Per-user specialised micro-AI indexes. A sync copy; localStorage is the read path.';

-- Every query the sync makes is "my rows, newest first".
CREATE INDEX IF NOT EXISTS crafted_indexes_user_updated_idx
  ON public.crafted_indexes (user_id, updated_at DESC);

ALTER TABLE public.crafted_indexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crafted_indexes FORCE ROW LEVEL SECURITY;

-- Owner-only, all four verbs, with WITH CHECK on the writes so a row cannot be
-- inserted or moved under another account's id. Written as separate policies
-- per command rather than FOR ALL: it costs four statements and makes each
-- permission legible on its own.
DROP POLICY IF EXISTS "owners read their indexes" ON public.crafted_indexes;
CREATE POLICY "owners read their indexes" ON public.crafted_indexes
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owners create their indexes" ON public.crafted_indexes;
CREATE POLICY "owners create their indexes" ON public.crafted_indexes
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owners update their indexes" ON public.crafted_indexes;
CREATE POLICY "owners update their indexes" ON public.crafted_indexes
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owners delete their indexes" ON public.crafted_indexes;
CREATE POLICY "owners delete their indexes" ON public.crafted_indexes
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Signed-out callers have no business here at all. The forge works without an
-- account by staying on the device; it never reads this table anonymously.
REVOKE ALL ON public.crafted_indexes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crafted_indexes TO authenticated;

-- updated_at is what the merge compares — `syncIndexes` overrides the spec's
-- own timestamp with this column when it reads a row — so it must not be
-- something a client can set. A spec dated the year 3000, by accident or by a
-- wrong system clock, would otherwise win every conflict for ever.
CREATE OR REPLACE FUNCTION public.crafted_indexes_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS crafted_indexes_touch_updated_at ON public.crafted_indexes;
CREATE TRIGGER crafted_indexes_touch_updated_at
  BEFORE INSERT OR UPDATE ON public.crafted_indexes
  FOR EACH ROW EXECUTE FUNCTION public.crafted_indexes_touch();
