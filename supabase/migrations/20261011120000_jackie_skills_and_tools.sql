-- Skills and custom tools for the agents that drive Jackie.
--
--   jackie_skills         named instructions an agent loads when a task fits:
--                         "how to run my weekly review", "how I like bug reports".
--   jackie_custom_tools   named recipes of the actions agents already have
--                         (list_tasks, create_task, remember_fact, …), with
--                         parameters. They compose existing capabilities; they
--                         add none — no code, no network, no new table.
--
-- Agents may PROPOSE either. Only the person, from the app, can switch one on.
-- That rule lives here rather than in the tools because an agent harness holds
-- a real access token and is one HTTP call from PostgREST: a check in the MCP
-- tool would bind the polite agent and not the other kind. Tokens the MCP
-- server accepts carry a `client_id` claim (the OAuth client); the app's own
-- browser session does not. So a write that carries one may only add a
-- proposal, and may not change or remove anything.

-- The OAuth client behind this request, or NULL for the app's own session.
-- PostgREST publishes claims either one per setting (older, and these probes)
-- or as one JSON document (Supabase today); both are read.
CREATE OR REPLACE FUNCTION private.request_client_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(
    nullif(current_setting('request.jwt.claim.client_id', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id'
  ), '');
$$;
REVOKE ALL ON FUNCTION private.request_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.request_client_id() TO authenticated, service_role;

-- What a custom tool's steps may call: everything an agent may do itself —
-- its own rows, asking Jackie, and the person's approved connections (whose
-- own rules apply to each call; docs/CONNECTIONS.md). Kept in step with
-- CUSTOM_TOOL_ACTIONS in src/lib/customTools.ts by a test.
CREATE OR REPLACE FUNCTION private.custom_tool_steps_valid(steps jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(steps) = 'array'
     AND jsonb_array_length(steps) BETWEEN 1 AND 8
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(steps) s
       WHERE jsonb_typeof(s) <> 'object'
          OR s->>'action' IS NULL
          OR s->>'action' NOT IN (
               'list_tasks', 'create_task', 'update_task', 'delete_task',
               'search_memory', 'remember_fact', 'forget_fact',
               'list_conversations', 'read_conversation', 'create_conversation',
               'ask_jackie', 'call_connection')
          OR (s ? 'args' AND jsonb_typeof(s->'args') <> 'object')
     );
$$;

-- A tool's parameters, in the shape customTools.ts insists on. Without it a
-- row written around the app ([null], a name with spaces) is stored, approved
-- from a card that cannot show it, and then breaks list_custom_tools for every
-- agent. Kept in step with validateToolSpec by a test.
CREATE OR REPLACE FUNCTION private.custom_tool_params_valid(params jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(params) = 'array'
     AND jsonb_array_length(params) <= 8
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(params) p
       WHERE jsonb_typeof(p) <> 'object'
          OR coalesce(p->>'name', '') !~ '^[a-z][a-z0-9_]{0,31}$'
          OR p->>'name' = 'steps'
          OR coalesce(p->>'type', '') NOT IN ('string', 'number', 'boolean')
          OR (p ? 'required' AND jsonb_typeof(p->'required') <> 'boolean')
          OR (p ? 'description' AND (jsonb_typeof(p->'description') <> 'string' OR char_length(p->>'description') > 200))
     )
     AND (SELECT count(DISTINCT p->>'name') FROM jsonb_array_elements(params) p) = jsonb_array_length(params);
$$;

-- Text the page shows must not be blank to the eye: btrim strips only spaces
-- by default, so a title of a lone newline would pass.
CREATE OR REPLACE FUNCTION private.visible_length(t text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT char_length(btrim(t, E' \t\r\n\f\x0B'));
$$;

-- --- tables -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jackie_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,47}$'),
  title       text NOT NULL CHECK (private.visible_length(title) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (private.visible_length(description) BETWEEN 1 AND 300),
  body        text NOT NULL CHECK (private.visible_length(body) BETWEEN 1 AND 8000),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'archived')),
  -- Who wrote it: NULL for the person, else the surface an agent proposed it from.
  proposed_by text CHECK (proposed_by IS NULL OR char_length(proposed_by) <= 64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.jackie_custom_tools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  -- A custom tool may not take a built-in's name: "delete_task" meaning
  -- something else would be a trap for every agent that reads the list.
  name        text NOT NULL CHECK (
                name ~ '^[a-z][a-z0-9_]{1,47}$'
                AND name NOT IN (
                  'list_tasks', 'create_task', 'update_task', 'update_task_status', 'delete_task',
                  'search_memory', 'remember_fact', 'forget_fact', 'list_conversations',
                  'read_conversation', 'create_conversation', 'ask_jackie', 'list_skills', 'get_skill',
                  'propose_skill', 'list_custom_tools', 'run_custom_tool', 'propose_tool',
                  'list_connections', 'call_connection', 'propose_connection')),
  description text NOT NULL CHECK (private.visible_length(description) BETWEEN 1 AND 300),
  params      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (private.custom_tool_params_valid(params)),
  steps       jsonb NOT NULL CHECK (private.custom_tool_steps_valid(steps)),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'archived')),
  proposed_by text CHECK (proposed_by IS NULL OR char_length(proposed_by) <= 64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS jackie_skills_user_status ON public.jackie_skills (user_id, status);
CREATE INDEX IF NOT EXISTS jackie_custom_tools_user_status ON public.jackie_custom_tools (user_id, status);

-- Each person's own, like their tasks and memory: the agents act as the
-- signed-in user, so a skill is that user's, not the app's.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jackie_skills', 'jackie_custom_tools'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "own rows" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "own rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
  END LOOP;
END $$;

-- --- what an agent may do ---------------------------------------------------------

CREATE OR REPLACE FUNCTION private.agent_proposals_only()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kind text := CASE TG_TABLE_NAME WHEN 'jackie_skills' THEN 'skill' WHEN 'jackie_connections' THEN 'connection' ELSE 'tool' END;
  pending integer;
  total integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.created_at := OLD.created_at;
    NEW.user_id := OLD.user_id;
  END IF;

  IF private.request_client_id() IS NOT NULL THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'An agent can propose a %, not change or remove one. Ask the person to do it in the app.', kind
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'proposed' THEN
      RAISE EXCEPTION 'An agent can only propose a % (status "proposed"); the person switches it on in the app.', kind
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Who proposed it is the database's to say, not the agent's: a token that
    -- wrote NULL or 'agent:app' would have the card read "proposed by you".
    NEW.proposed_by := 'agent:mcp';
    -- Bidi controls and Unicode tags show the person one text and the model
    -- another (textSafety.ts); an agent writing around the MCP tools meets
    -- the same refusal here.
    IF to_jsonb(NEW)::text ~ '[\u202A-\u202E\u2066-\u2069\U000E0000-\U000E007F\U000E0100-\U000E01EF]' THEN
      RAISE EXCEPTION 'This % contains invisible or text-reordering characters (bidi controls or Unicode tags). A person reviewing it would not see what an agent reads.', kind
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Counted under a per-account lock: without it, parallel requests each
    -- count only committed rows and all pass, and the caps mean nothing.
    PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME), hashtext(NEW.user_id::text));
    -- A runaway agent proposing in a loop must not bury the person's list.
    EXECUTE format('SELECT count(*) FILTER (WHERE status = ''proposed''), count(*) FROM public.%I WHERE user_id = $1', TG_TABLE_NAME)
      INTO pending, total USING NEW.user_id;
    IF NEW.status = 'proposed' AND pending >= 20 THEN
      RAISE EXCEPTION '20 % proposals are already waiting for review. Approve or reject some first.', kind
        USING ERRCODE = 'check_violation';
    END IF;
    IF total >= 200 THEN
      RAISE EXCEPTION 'At most 200 %s per account. Archive or delete some first.', kind
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS jackie_skills_agent_rule ON public.jackie_skills;
CREATE TRIGGER jackie_skills_agent_rule
  BEFORE INSERT OR UPDATE OR DELETE ON public.jackie_skills
  FOR EACH ROW EXECUTE FUNCTION private.agent_proposals_only();
DROP TRIGGER IF EXISTS jackie_custom_tools_agent_rule ON public.jackie_custom_tools;
CREATE TRIGGER jackie_custom_tools_agent_rule
  BEFORE INSERT OR UPDATE OR DELETE ON public.jackie_custom_tools
  FOR EACH ROW EXECUTE FUNCTION private.agent_proposals_only();

-- --- what the activity trail may say --------------------------------------------
-- "What agents did" reads audit_events, which every signed-in session may
-- append to in its own name. An agent's token could therefore write rows whose
-- actor reads "person" or "agent:app" — history in which the person did what
-- the agent did. A row written with an agent's token is the agent's, whatever
-- it says.
CREATE OR REPLACE FUNCTION private.agent_actor_pinned()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF private.request_client_id() IS NOT NULL THEN
    NEW.actor := 'agent:mcp';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_events_agent_actor ON public.audit_events;
CREATE TRIGGER audit_events_agent_actor
  BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.agent_actor_pinned();
