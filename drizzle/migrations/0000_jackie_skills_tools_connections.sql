CREATE OR REPLACE FUNCTION private.request_client_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(
    nullif(current_setting('request.jwt.claim.client_id', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id'
  ), '');
$$;
REVOKE ALL ON FUNCTION private.request_client_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.request_client_id() TO authenticated, service_role;

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

CREATE OR REPLACE FUNCTION private.visible_length(t text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT char_length(btrim(t, E' \t\r\n\f\x0B'));
$$;

CREATE TABLE IF NOT EXISTS public.jackie_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  name        text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,47}$'),
  title       text NOT NULL CHECK (private.visible_length(title) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (private.visible_length(description) BETWEEN 1 AND 300),
  body        text NOT NULL CHECK (private.visible_length(body) BETWEEN 1 AND 8000),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'archived')),
  proposed_by text CHECK (proposed_by IS NULL OR char_length(proposed_by) <= 64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.jackie_custom_tools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid(),
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jackie_skills TO authenticated;
GRANT ALL ON public.jackie_skills TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jackie_custom_tools TO authenticated;
GRANT ALL ON public.jackie_custom_tools TO service_role;
ALTER TABLE public.jackie_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jackie_custom_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows" ON public.jackie_skills FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rows" ON public.jackie_custom_tools FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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
    NEW.proposed_by := 'agent:mcp';
    IF to_jsonb(NEW)::text ~ '[\u202A-\u202E\u2066-\u2069\U000E0000-\U000E007F\U000E0100-\U000E01EF]' THEN
      RAISE EXCEPTION 'This % contains invisible or text-reordering characters (bidi controls or Unicode tags). A person reviewing it would not see what an agent reads.', kind
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME), hashtext(NEW.user_id::text));
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

CREATE TRIGGER jackie_skills_agent_rule BEFORE INSERT OR UPDATE OR DELETE ON public.jackie_skills
  FOR EACH ROW EXECUTE FUNCTION private.agent_proposals_only();
CREATE TRIGGER jackie_custom_tools_agent_rule BEFORE INSERT OR UPDATE OR DELETE ON public.jackie_custom_tools
  FOR EACH ROW EXECUTE FUNCTION private.agent_proposals_only();

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
  user_id          uuid NOT NULL DEFAULT auth.uid(),
  name             text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,47}$'),
  title            text NOT NULL CHECK (private.visible_length(title) BETWEEN 1 AND 80),
  description      text NOT NULL CHECK (private.visible_length(description) BETWEEN 1 AND 300),
  base_url         text NOT NULL CHECK (
                     char_length(base_url) <= 300
                     AND base_url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(/[^?#@\s]*)?$'),
  auth_type        text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'header', 'query')),
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jackie_connections TO authenticated;
GRANT ALL ON public.jackie_connections TO service_role;
ALTER TABLE public.jackie_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows" ON public.jackie_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.jackie_connection_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.jackie_connections(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  iv            text NOT NULL,
  ciphertext    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.jackie_connection_secrets TO service_role;
ALTER TABLE public.jackie_connection_secrets ENABLE ROW LEVEL SECURITY;

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
CREATE TRIGGER jackie_connections_key_follows_address AFTER UPDATE ON public.jackie_connections
  FOR EACH ROW EXECUTE FUNCTION private.connection_key_follows_address();
CREATE TRIGGER jackie_connections_agent_rule BEFORE INSERT OR UPDATE OR DELETE ON public.jackie_connections
  FOR EACH ROW EXECUTE FUNCTION private.agent_proposals_only();

CREATE OR REPLACE FUNCTION private.agent_connection_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER jackie_connections_agent_grants BEFORE INSERT ON public.jackie_connections
  FOR EACH ROW EXECUTE FUNCTION private.agent_connection_grants();

GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.visible_length(text), private.custom_tool_params_valid(jsonb), private.custom_tool_steps_valid(jsonb), private.connection_param_valid(jsonb, text), private.connection_operations_valid(jsonb), private.agent_proposals_only(), private.agent_connection_grants() TO authenticated, service_role;