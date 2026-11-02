#!/usr/bin/env bash
#
# End-to-end: Hermes Agent and DeepSeek Harness driving the app, for real.
#
# Stands up a local copy of the app's backend and points both harnesses at it
# using the configs in harness/, then checks the database for what they did:
#
#   PostgreSQL        the real migration chain (scripts/db-authz-test.sh's shim)
#   PostgREST         over it, verifying ES256 tokens like Supabase does
#   Deno              the real, built MCP function and the real jackie-bionic
#   gateway.mjs       one localhost front door, shaped like a Supabase project
#   model.mjs         a scripted model in place of DeepSeek / Hermes (see there)
#
# What this proves: each harness discovers the app's tools, calls them through
# MCP with a user's token, and the app's data really changes — tasks, memory,
# and a conversation in which Jackie (through jackie-bionic) answers. What it
# does not: the browser OAuth sign-in (it needs the real project) and a real
# model's judgement (it needs your API keys). docs/HARNESSES.md says how to
# check those two yourself.
#
# Needs a running PostgreSQL you can administer (like db-authz-test.sh), and:
#   POSTGREST_BIN  path to a PostgREST 12 binary
#   DENO_BIN       path to deno (2.x)
#   HERMES_BIN     path to `hermes`   (optional; skipped when unset)
#   DSH_BIN        path to `dsh`      (optional; skipped when unset)
# Run `npm run build` first, so supabase/functions/mcp/index.ts is current.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/harness/e2e"
E2E_DIR="${E2E_DIR:-$(mktemp -d)}"
PGHOST="${PGHOST:-/tmp}"; PGPORT="${PGPORT:-5433}"; PGUSER="${PGUSER:-postgres}"
DB="${DB:-sas_jacky_e2e}"
GATEWAY_PORT=54321
ORIGIN="http://localhost:$GATEWAY_PORT"
ISSUER="$ORIGIN/auth/v1"
MCP_URL="$ORIGIN/functions/v1/mcp"
OWNER_ID="0e2e0000-0000-4000-8000-000000000001"
JACKIE_ANSWER="Jackie here — the end-to-end run reached me through ask_jackie."
: "${POSTGREST_BIN:?set POSTGREST_BIN}" "${DENO_BIN:?set DENO_BIN}"

mkdir -p "$E2E_DIR/logs"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
fail() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -qtA)

wait_for() { # url, name
  # Any HTTP answer except the gateway's own 502 means the thing is listening.
  local code
  for _ in $(seq 1 120); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$1")"
    [ "$code" != 000 ] && [ "$code" != 502 ] && return 0
    sleep 0.5
  done
  fail "$2 did not come up ($1) — see $E2E_DIR/logs"
}

echo "==> database ($DB)"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null || fail "cannot create $DB"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/00_supabase_shim.sql" >/dev/null || fail "shim"
# PostgREST 12 publishes claims as one JSON setting; Supabase's auth.uid()
# reads that too. The shim only reads the older per-claim form.
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL' || fail "auth.uid"
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         current_setting('request.jwt.claims', true)::json->>'sub'), '')::uuid;
$$;
SQL
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  if ! out=$("${PSQL[@]}" -d "$DB" -f "$f" 2>&1); then
    case "$(basename "$f")" in
      20260817180014_*|20260817181911_*) continue ;; # known, superseded (see db-authz-test.sh)
    esac
    echo "$out" | grep -i error | head -3 >&2
    fail "migration $(basename "$f")"
  fi
done
"${PSQL[@]}" -d "$DB" >/dev/null <<SQL || fail "seed"
INSERT INTO auth.users (id, email) VALUES ('$OWNER_ID', 'owner@example.test');
-- The owner role: jackie-bionic, like the rig's other engines, answers the owner only.
INSERT INTO public.user_roles (user_id, role) VALUES ('$OWNER_ID', 'owner');
NOTIFY pgrst, 'reload schema';
SQL
ok "migrations applied, owner seeded"

echo "==> keys"
node "$HERE/keys.mjs" "$E2E_DIR" "$ISSUER" "$OWNER_ID" >/dev/null || fail "keys"
tok() { node -e "process.stdout.write(require('$E2E_DIR/tokens.json')['$1'])"; }
ANON="$(tok anon)"; SERVICE="$(tok service)"; USER_TOKEN="$(tok user)"

echo "==> PostgREST"
cat > "$E2E_DIR/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@/$DB?host=$PGHOST&port=$PGPORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "@$E2E_DIR/jwks.json"
server-host = "127.0.0.1"
server-port = 3300
CONF
"$POSTGREST_BIN" "$E2E_DIR/postgrest.conf" >"$E2E_DIR/logs/postgrest.log" 2>&1 & PIDS+=($!)
wait_for http://127.0.0.1:3300/ PostgREST

echo "==> scripted models"
plan() { # harness label, conversation title
  cat <<JSON
[{"tool":"create_task","args":{"title":"$1 was here","priority":"high"}},
 {"tool":"remember_fact","args":{"key":"e2e_$2","value":"$1 connected through MCP"}},
 {"tool":"list_tasks","args":{"status":"todo"}},
 {"tool":"ask_jackie","args":{"message":"Hello from $1","engine":"bionic","title":"$1 session"}}]
JSON
}
MODEL_PORT=8200 MODEL_LOG="$E2E_DIR/logs/model-jackie.jsonl" node "$HERE/model.mjs" >"$E2E_DIR/logs/model-jackie.log" 2>&1 & PIDS+=($!)
MODEL_PORT=8201 MODEL_PLAN="$(plan "Hermes Agent" hermes)" MODEL_LOG="$E2E_DIR/logs/model-hermes.jsonl" node "$HERE/model.mjs" >"$E2E_DIR/logs/model-hermes.log" 2>&1 & PIDS+=($!)
MODEL_PORT=8202 MODEL_PLAN="$(plan "DeepSeek Harness" dsh)" MODEL_LOG="$E2E_DIR/logs/model-dsh.jsonl" node "$HERE/model.mjs" >"$E2E_DIR/logs/model-dsh.log" 2>&1 & PIDS+=($!)
for p in 8200 8201 8202; do wait_for "http://127.0.0.1:$p/v1/models" "model:$p"; done

echo "==> edge functions under Deno"
cat > "$E2E_DIR/std-http.ts" <<'TS'
export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  Deno.serve({ port: Number(Deno.env.get("PORT")), hostname: "127.0.0.1" }, handler);
}
TS
cat > "$E2E_DIR/import_map.json" <<JSON
{ "imports": {
  "https://deno.land/std@0.168.0/http/server.ts": "$E2E_DIR/std-http.ts",
  "https://esm.sh/@supabase/supabase-js@2.58.0": "npm:@supabase/supabase-js@2.58.0"
} }
JSON
echo '{"nodeModulesDir":"none"}' > "$E2E_DIR/deno.json"
# The built MCP function, with only its issuer pointed at the local sign-in.
# It calls Deno.serve() with no options, so it listens on Deno's default, 8000.
sed "s#issuer: \`https://\${projectRef}.supabase.co/auth/v1\`#issuer: \"$ISSUER\"#" \
  "$ROOT/supabase/functions/mcp/index.ts" > "$E2E_DIR/mcp.ts"
grep -q "issuer: \"$ISSUER\"" "$E2E_DIR/mcp.ts" || fail "could not point the MCP bundle at $ISSUER"
FN_ENV=(SUPABASE_URL="$ORIGIN" SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICE")
DENO_RUN=("$DENO_BIN" run -A -q --no-lock --no-check --config="$E2E_DIR/deno.json" --import-map="$E2E_DIR/import_map.json")
env "${FN_ENV[@]}" "${DENO_RUN[@]}" "$E2E_DIR/mcp.ts" >"$E2E_DIR/logs/fn-mcp.log" 2>&1 & PIDS+=($!)
env "${FN_ENV[@]}" PORT=8102 BIONIC_BASE_URL=http://127.0.0.1:8200 BIONIC_MODEL=bonsai-1.7b \
  "${DENO_RUN[@]}" "$ROOT/supabase/functions/jackie-bionic/index.ts" >"$E2E_DIR/logs/fn-bionic.log" 2>&1 & PIDS+=($!)

echo "==> gateway"
GATEWAY_PORT=$GATEWAY_PORT POSTGREST=http://127.0.0.1:3300 JWKS_FILE="$E2E_DIR/jwks.json" \
  FUNCTIONS='{"mcp":8000,"jackie-bionic":8102}' node "$HERE/gateway.mjs" >"$E2E_DIR/logs/gateway.log" 2>&1 & PIDS+=($!)
wait_for "$ISSUER/.well-known/jwks.json" gateway
wait_for "$MCP_URL/.well-known/oauth-protected-resource" "MCP function"
wait_for "http://127.0.0.1:8102/" "jackie-bionic"

db() { "${PSQL[@]}" -d "$DB" -c "$1"; }

# One skill and one tool the owner switched on from the app (no OAuth client
# behind the write), for the MCP check to load and run. Agents can only
# propose; this is the part only the person can do.
db "insert into jackie_skills (user_id, name, title, description, body)
    values ('$OWNER_ID', 'e2e_skill', 'E2E skill', 'When the end-to-end run asks.', 'Say E2E-SKILL-LOADED.')" >/dev/null \
  || fail "could not seed a skill"
db "insert into jackie_custom_tools (user_id, name, description, params, steps)
    values ('$OWNER_ID', 'e2e_start', 'Create a task and start it.',
            '[{\"name\":\"topic\",\"type\":\"string\",\"required\":true}]',
            '[{\"action\":\"create_task\",\"args\":{\"title\":\"E2E {{topic}}\"}},{\"action\":\"update_task\",\"args\":{\"id\":\"{{steps.0.id}}\",\"status\":\"in_progress\"}}]')" >/dev/null \
  || fail "could not seed a custom tool"

echo "==> MCP protocol check (official SDK client)"
MCP_URL="$MCP_URL" TOKENS="$E2E_DIR/tokens.json" node "$HERE/mcp-check.mjs" || fail "MCP check (logs in $E2E_DIR/logs)"

# What the MCP check's agent proposed stayed a proposal, and what it did was
# recorded where the person can see it.
[ "$(db "select status from jackie_skills where user_id='$OWNER_ID' and name='e2e_proposed'")" = proposed ] \
  || fail "an agent's proposed skill is not waiting as a proposal"
[ "$(db "select count(*) from audit_events where user_id='$OWNER_ID' and action in ('skill.load','tool.run') and actor='agent:mcp'")" = 2 ] \
  || fail "loading a skill and running a tool over MCP were not both recorded"
ok "skills and tools: an agent's proposal waits for the person, and what agents used is on record"

# ask_jackie goes through the engine's own gate, not around it: the owner
# check passed and each ask spent a unit of quota.
[ "$(db "select count(*) from provider_usage_events where user_id='$OWNER_ID' and function_name='jackie-bionic'")" = 2 ] \
  || fail "ask_jackie did not go through jackie-bionic's quota gate"
ok "ask_jackie was metered by the engine's quota, as the owner"

assert_harness() { # label, key suffix, model log
  local label="$1" key="$2" log="$3"
  [ "$(db "select count(*) from jackie_tasks where user_id='$OWNER_ID' and title='$label was here' and priority='high'")" = 1 ] \
    || fail "$label: no task on the board"
  [ "$(db "select category from jackie_memory where user_id='$OWNER_ID' and key='e2e_$key'")" = context ] \
    || fail "$label: no memory entry"
  local conv
  conv="$(db "select id from conversations where user_id='$OWNER_ID' and title='$label session'")"
  [ -n "$conv" ] || fail "$label: no conversation"
  [ "$(db "select count(*) from chat_messages where conversation_id='$conv' and role='assistant' and content='$JACKIE_ANSWER'")" = 1 ] \
    || fail "$label: Jackie's answer is not in the conversation"
  node -e "
    const lines = require('fs').readFileSync('$log','utf8').trim().split('\n').map(JSON.parse);
    const offered = lines.find((l) => l.tools?.length)?.tools ?? [];
    const want = ['ask_jackie','create_task','list_tasks','remember_fact','search_memory','update_task','delete_task','forget_fact','read_conversation','list_conversations','create_conversation','update_task_status',
      'list_skills','get_skill','propose_skill','list_custom_tools','run_custom_tool','propose_tool',
      'list_connections','call_connection','propose_connection'];
    const missing = want.filter((w) => !offered.some((o) => o === w || o.endsWith('_' + w)));
    if (missing.length) { console.error('offered: ' + offered.join(', ')); process.exit(1); }
    // Harnesses also make tool-less side calls (session titles), so the plan's
    // finishing turn is looked for, not assumed to be the last request.
    const done = lines.some((l) => (l.decision?.text ?? '').startsWith('E2E-DONE after 4'));
    if (!done) { console.error('turns: ' + lines.map((l) => JSON.stringify(l.decision ?? l.unhandled)).join(' | ')); process.exit(1); }
  " || fail "$label: did not see all twenty-one tools, or did not finish the plan (see $log)"
  ok "$label: saw all 21 tools, created a task, stored a memory, and talked to Jackie"
}

if [ -n "${HERMES_BIN:-}" ]; then
  echo "==> Hermes Agent (harness/hermes/config.yaml)"
  export HERMES_HOME="$E2E_DIR/hermes-home"; mkdir -p "$HERMES_HOME"
  # The committed config, with the three things a local run must change: the
  # URL, a token in place of the browser sign-in, and the scripted model.
  sed -e "s#https://iezgzdhhmwmbqshnxrie.supabase.co/functions/v1/mcp#$MCP_URL#" \
      -e 's#^    auth: oauth#    headers:\n      Authorization: "Bearer ${SAS_JACKY_TOKEN}"#' \
      -e 's#^  provider: "deepseek"#  provider: "custom"\n  base_url: "http://127.0.0.1:8201/v1"\n  api_key: "e2e"#' \
      -e 's#^  default: "deepseek-v4-flash"#  default: "e2e-scripted"#' \
      "$ROOT/harness/hermes/config.yaml" > "$HERMES_HOME/config.yaml"
  (cd "$E2E_DIR" && SAS_JACKY_TOKEN="$USER_TOKEN" timeout 300 "$HERMES_BIN" -z \
     "Operate my SAS-JACKY app: add a task, remember a fact, check the board, and say hello to Jackie." \
     >"$E2E_DIR/logs/hermes.out" 2>"$E2E_DIR/logs/hermes.err") || fail "Hermes Agent exited non-zero (see $E2E_DIR/logs/hermes.*)"
  assert_harness "Hermes Agent" hermes "$E2E_DIR/logs/model-hermes.jsonl"
else
  echo "--  Hermes Agent skipped (HERMES_BIN unset)"
fi

if [ -n "${DSH_BIN:-}" ]; then
  echo "==> DeepSeek Harness (harness/deepseek-harness/sas-jacky.token.patch.yml)"
  export DSH_HOME="$E2E_DIR/dsh-home"; mkdir -p "$DSH_HOME" "$E2E_DIR/dsh-work"
  # DeepSeek's adapter, pointed at the scripted model instead of api.deepseek.com.
  cat > "$E2E_DIR/dsh-model.patch.yml" <<'YAML'
- id: llm-deepseek
  config:
    baseURL: http://127.0.0.1:8202
    apiKeyEnv: DEEPSEEK_API_KEY
YAML
  (cd "$E2E_DIR/dsh-work" && SAS_JACKY_MCP_URL="$MCP_URL" SAS_JACKY_TOKEN="$USER_TOKEN" DEEPSEEK_API_KEY=e2e \
     timeout 300 "$DSH_BIN" --profile headless \
       --patch "$ROOT/harness/deepseek-harness/sas-jacky.token.patch.yml" \
       --patch "$E2E_DIR/dsh-model.patch.yml" \
       "Operate my SAS-JACKY app: add a task, remember a fact, check the board, and say hello to Jackie." \
     >"$E2E_DIR/logs/dsh.out" 2>"$E2E_DIR/logs/dsh.err") || fail "DeepSeek Harness exited non-zero (see $E2E_DIR/logs/dsh.*)"
  assert_harness "DeepSeek Harness" dsh "$E2E_DIR/logs/model-dsh.jsonl"
  # The browser-login variant cannot sign in here (that needs the real
  # project), but it must at least compose into a valid dsh configuration.
  (cd "$E2E_DIR/dsh-work" && "$DSH_BIN" --profile headless \
     --patch "$ROOT/harness/deepseek-harness/sas-jacky.oauth.patch.yml" --dump-config) \
     >"$E2E_DIR/logs/dsh-oauth-config.yml" 2>&1 || fail "sas-jacky.oauth.patch.yml does not compose"
  grep -q "mcp-remote@" "$E2E_DIR/logs/dsh-oauth-config.yml" || fail "sas-jacky.oauth.patch.yml: mcp-remote entry missing after composition"
  ok "DeepSeek Harness: the browser-login patch composes into a valid configuration"
else
  echo "--  DeepSeek Harness skipped (DSH_BIN unset)"
fi

echo
echo "End-to-end passed. Logs: $E2E_DIR/logs"

# E2E_HOLD=1 keeps the stack up afterwards, to point a harness at by hand:
# MCP at $MCP_URL, a user token in $E2E_DIR/tokens.json ("user").
if [ -n "${E2E_HOLD:-}" ]; then
  echo "Holding the stack up (Ctrl+C to stop). MCP: $MCP_URL"
  wait
fi
