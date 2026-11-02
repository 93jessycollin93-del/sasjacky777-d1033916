-- BlockCraft worlds kept in the cloud, so a world follows its owner between devices.
--
-- The game is local-first: worlds live in the browser's IndexedDB and play
-- with no network at all. This table is a copy a person chooses to make
-- ("Upload to cloud") and chooses to bring back ("Download"). Nothing in the
-- game reads it while playing, so a missing table or a dropped connection costs
-- the cloud button, never the world.
--
-- `data` is the same export file the world list writes to disk (a JSON document
-- whose chunk payloads are already gzipped and base64'd), stored as text rather
-- than jsonb: nothing here queries inside it, and jsonb would re-parse and
-- re-encode several megabytes on every write for no benefit. `summary` is the
-- small part the cloud list shows — name, mode, day, thumbnail — so listing a
-- dozen worlds never downloads a dozen worlds.

CREATE TABLE IF NOT EXISTS public.craft_worlds (
  -- The world's own id, minted in the browser. Per user, as with crafted_indexes:
  -- the key is what the export file carries, so uploading the same world again
  -- replaces its row instead of piling up copies.
  id          text        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  summary     jsonb       NOT NULL,
  data        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, id),

  CONSTRAINT craft_worlds_id_shape CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT craft_worlds_name_length CHECK (char_length(name) BETWEEN 1 AND 64),
  CONSTRAINT craft_worlds_summary_is_object CHECK (jsonb_typeof(summary) = 'object'),
  -- The thumbnail is the only sizeable thing in a summary (a small JPEG).
  CONSTRAINT craft_worlds_summary_bounded CHECK (pg_column_size(summary) < 65536),
  -- A well-explored world is a few megabytes. The client refuses above this
  -- with a sentence that says to export to a file instead; this is the backstop.
  CONSTRAINT craft_worlds_data_bounded CHECK (octet_length(data) <= 12582912)
);

COMMENT ON TABLE public.craft_worlds IS
  'Per-user BlockCraft world backups. A copy the owner uploads; IndexedDB is the play path.';

CREATE INDEX IF NOT EXISTS craft_worlds_user_updated_idx
  ON public.craft_worlds (user_id, updated_at DESC);

ALTER TABLE public.craft_worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.craft_worlds FORCE ROW LEVEL SECURITY;

-- Owner-only, one policy per verb, WITH CHECK on writes so a row can never be
-- written under someone else's id.
DROP POLICY IF EXISTS "owners read their worlds" ON public.craft_worlds;
CREATE POLICY "owners read their worlds" ON public.craft_worlds
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owners create their worlds" ON public.craft_worlds;
CREATE POLICY "owners create their worlds" ON public.craft_worlds
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owners update their worlds" ON public.craft_worlds;
CREATE POLICY "owners update their worlds" ON public.craft_worlds
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "owners delete their worlds" ON public.craft_worlds;
CREATE POLICY "owners delete their worlds" ON public.craft_worlds
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.craft_worlds FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.craft_worlds TO authenticated;

-- The server's clock, not the uploader's, says which copy is newer.
CREATE OR REPLACE FUNCTION public.craft_worlds_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS craft_worlds_touch_updated_at ON public.craft_worlds;
CREATE TRIGGER craft_worlds_touch_updated_at
  BEFORE INSERT OR UPDATE ON public.craft_worlds
  FOR EACH ROW EXECUTE FUNCTION public.craft_worlds_touch();
