-- Connections: outside HTTPS services the person lets their agents use.
-- docs/CONNECTIONS.md is the threat model; T-numbers refer to it.
--
--   jackie_connections         what the service is, how it authenticates, and
--                              the operations agents may call on it. Per user.
--   jackie_connection_secrets  the encrypted key for each connection. No API
--                              role can read or write it — only jackie-connect,
--                              with the service role, ever touches it (T1).
--
-- Agents propose, the person approves: the same database rule as skills and
-- tools (a write carrying an OAuth client_id may only insert a proposal), plus
-- one more here — an agent's proposal cannot arrive with writes or app data
-- already switched on. Those are the person's to grant, after reading it.

-- The shape the database insists on: the same rules as validateConnectionSpec
-- in supabase/functions/_shared/connections.ts, which the page, the actions and
-- the function all run. A row written around them — an agent's token posting
-- straight to the API — meets these instead. Every field an agent reads or the
-- function sends is checked, because approval only flips the status: a
-- parameter typed "object" would otherwise pass any array uncapped, and
-- accepts_app_data "false" (a string) would read as true where it is used.
-- CASE guards each jsonb_array_elements: SQL does not promise to evaluate OR
-- left to right, and expanding a non-array is an error, not a false.
CREATE OR REPLACE FUNCTION private.connection_param_valid(p jsonb, method text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'object'
     AND coalesce(p->>'name', '') ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
     AND coalesce(p->>'in', '') IN ('path', 'query', 'body')
     AND coalesce(p->>'type', '') IN ('string', 'number', 'boolean')
     AND NOT (p->>'in' = 'body' AND method = 'GET')
     AND (NOT p ? 'required' OR jsonb_typeof(p->'required') = 'boolean')
     AND (NOT p ? 'description' OR (jsonb_typeof(p->'description') = 'string' AND char_length(p->>'description') <= 300))
     AND CASE WHEN NOT p ? 'maxLength' THEN true
              WHEN jsonb_typeof(p->'maxLength') <> 'number' THEN false
              ELSE (p->>'maxLength')::numeric BETWEEN 1 AND 2000
                   AND (p->>'maxLength')::numeric = trunc((p->>'maxLength')::numeric) END;
$$;

CREATE OR REPLACE FUNCTION private.connection_operations_valid(ops jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(ops) <> 'array' THEN false ELSE
       jsonb_array_length(ops) BETWEEN 1 AND 20
   AND (SELECT count(DISTINCT o->>'name') FROM jsonb_array_elements(ops) o) = jsonb_array_length(ops)
   AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(ops) o
       WHERE CASE WHEN jsonb_typeof(o) <> 'object' OR jsonb_typeof(o->'params') IS DISTINCT FROM 'array' THEN true ELSE
               coalesce(o->>'name', '') !~ '^[a-z][a-z0-9_]{1,47}$'
            OR jsonb_typeof(o->'description') IS DISTINCT FROM 'string'
            OR private.visible_length(o->>'description') NOT BETWEEN 1 AND 300
            OR coalesce(o->>'method', '') NOT IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
            OR coalesce(o->>'path', '') !~ '^/'
            OR (o->>'path') ~ '^//'
            OR char_length(o->>'path') > 300
            OR (o->>'path') ~* '(^|/)\.\.?(/|$)|[?#\\]|%2e|%2f'
            OR (o ? 'accepts_app_data' AND jsonb_typeof(o->'accepts_app_data') <> 'boolean')
            OR jsonb_array_length(o->'params') > 12
            OR (SELECT count(DISTINCT p->>'name') FROM jsonb_array_elements(o->'params') p) <> jsonb_array_length(o->'params')
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(o->'params') p WHERE NOT private.connection_param_valid(p, o->>'method'))
            END
   ) END;
$$;

CREATE TABLE IF NOT EXISTS public.jackie_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,47}$'),
  title            text NOT NULL CHECK (private.visible_length(title) BETWEEN 1 AND 80),
  description      text NOT NULL CHECK (private.visible_length(description) BETWEEN 1 AND 300),
  -- https, a DNS name, the default port, no credentials, query or fragment (T2).
  base_url         text NOT NULL CHECK (
                     char_length(base_url) <= 300
                     AND base_url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(/[^?#@\s]*)?$'),
  auth_type        text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'header', 'query')),
  -- A query name may carry _ and . (api_key, access_token); a header name is a
  -- token, and never one that frames the request or that the function sets
  -- (FORBIDDEN_KEY_HEADERS in connections.ts; a test keeps the lists equal).
  auth_name        text CHECK (auth_name IS NULL OR auth_name ~ '^[A-Za-z0-9_.-]{1,64}$'),
  operations       jsonb NOT NULL CHECK (private.connection_operations_valid(operations)),
  agents_may_write boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'archived')),
  proposed_by      text CHECK (proposed_by IS NULL OR char_length(proposed_by) <= 64),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  CHECK (auth_type IN ('none', 'bearer') OR auth_name IS NOT NULL),
  CHECK (auth_type <> 'header' OR (
    auth_name ~ '^[A-Za-z0-9-]{1,64}$'
    AND lower(auth_name) NOT IN (
      'host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'expect',
      'cookie', 'content-type', 'accept', 'user-agent', 'forwarded', 'proxy-authorization', 'proxy-connection',
      'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip')))
);
CREATE INDEX IF NOT EXISTS jackie_connections_user_status ON public.jackie_connections (user_id, status);

ALTER TABLE public.jackie_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jackie_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jackie_connections TO authenticated;
GRANT ALL ON public.jackie_connections TO service_role;
DROP POLICY IF EXISTS "own rows" ON public.jackie_connections;
CREATE POLICY "own rows" ON public.jackie_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- T1: the secrets. RLS on with no policy, and no grant to any API role but the
-- service role: neither the page, nor an agent, nor a curious person with
-- their own token can read a key back. jackie-connect seals and opens them.
CREATE TABLE IF NOT EXISTS public.jackie_connection_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.jackie_connections(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  iv            text NOT NULL,
  ciphertext    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jackie_connection_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jackie_connection_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.jackie_connection_secrets TO service_role;

-- T1: a key is given for one address and one placement. Changing either
-- clears it, so no edit — the person's own, or a row written around the app —
-- can send an existing key somewhere it was not given to. SECURITY DEFINER
-- because no API role may touch the secrets table, the person included.
CREATE OR REPLACE FUNCTION private.connection_key_follows_address()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.base_url IS DISTINCT FROM OLD.base_url
     OR NEW.auth_type IS DISTINCT FROM OLD.auth_type
     OR NEW.auth_name IS DISTINCT FROM OLD.auth_name THEN
    DELETE FROM public.jackie_connection_secrets WHERE connection_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.connection_key_follows_address() FROM PUBLIC;
DROP TRIGGER IF EXISTS jackie_connections_key_follows_address ON public.jackie_connections;
CREATE TRIGGER jackie_connections_key_follows_address
  AFTER UPDATE ON public.jackie_connections
  FOR EACH ROW EXECUTE FUNCTION private.connection_key_follows_address();

-- The propose-only rule, shared with skills and tools.
DROP TRIGGER IF EXISTS jackie_connections_agent_rule ON public.jackie_connections;
CREATE TRIGGER jackie_connections_agent_rule
  BEFORE INSERT OR UPDATE OR DELETE ON public.jackie_connections
  FOR EACH ROW EXECUTE FUNCTION private.agent_proposals_only();

-- And the one connections add: an agent cannot propose a connection with
-- writes or app data already allowed (T3, T8).
CREATE OR REPLACE FUNCTION private.agent_connection_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Any accepts_app_data an agent writes is refused, not read: a text cast
  -- turns "false" into false here while the function and the page, reading
  -- JSON, would take the string as true.
  IF private.request_client_id() IS NOT NULL AND (
       NEW.agents_may_write
       OR (jsonb_typeof(NEW.operations) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.operations) o
                       WHERE jsonb_typeof(o) = 'object' AND o ? 'accepts_app_data' AND o->'accepts_app_data' <> 'false'::jsonb))
     ) THEN
    RAISE EXCEPTION 'An agent cannot propose a connection with writes or app data already allowed; the person grants those after reading it.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jackie_connections_agent_grants ON public.jackie_connections;
CREATE TRIGGER jackie_connections_agent_grants
  BEFORE INSERT ON public.jackie_connections
  FOR EACH ROW EXECUTE FUNCTION private.agent_connection_grants();
