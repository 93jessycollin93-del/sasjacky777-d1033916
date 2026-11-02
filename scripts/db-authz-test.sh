#!/usr/bin/env bash
#
# Runs the migration chain against a throwaway PostgreSQL and then tries, as a
# second signed-in user, every cross-tenant move the security review asked us to
# prove impossible.
#
# The probes that matter run as the `authenticated` role, because that is the
# role a browser actually gets. Each runs in its own transaction: a refusal
# aborts the transaction it is in, and sharing one would turn the first refusal
# into a cascade of false passes for everything after it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGPORT="${PGPORT:-5433}"
PGHOST="${PGHOST:-/tmp}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-sasjacky_authz_test}"
PSQL_BASE=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER")

fail=0
pass=0

if ! "${PSQL_BASE[@]}" -d postgres -tAc 'select 1' >/dev/null 2>&1; then
  echo "No PostgreSQL reachable at $PGHOST:$PGPORT — start one first." >&2
  echo "  initdb -D \$PGDATA -A trust -U postgres && pg_ctl -D \$PGDATA -o '-p $PGPORT -k /tmp' start" >&2
  exit 2
fi

echo "==> rebuilding $DB"
"${PSQL_BASE[@]}" -d postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

PSQL=("${PSQL_BASE[@]}" -d "$DB")

"${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_shim.sql" >/dev/null || {
  echo "shim failed" >&2; exit 2; }

echo "==> applying migrations"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  if ! out=$("${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    # Two migrations in the existing history cannot apply to a fresh database.
    # Both are pre-existing defects, not regressions this suite tests for, and
    # both are superseded by later migrations that land the intended state:
    #
    #   ...180014  re-creates user_roles/app_role, already made by ...073000.
    #   ...181911  drops public.has_role while the audit_events policy still
    #              references it. Completed by 20260914120100.
    #
    # Anything else failing is a real break and stops the run.
    case "$(basename "$f")" in
      20260817180014_*|20260817181911_*)
        echo "    (tolerating known-broken $(basename "$f"))"
        continue
        ;;
    esac
    echo "MIGRATION FAILED: $(basename "$f")" >&2
    echo "$out" | grep -i error | head -3 >&2
    exit 2
  fi
done

echo "==> service-role and RPC probes"
if out=$("${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/01_tenant_isolation.sql" 2>&1); then
  echo "$out" | grep -E '^ (svc|rate|unknown|rotation|double|rotating|provider)' || true
  pass=$((pass + 1))
else
  echo "$out" | tail -20
  echo "SERVICE-ROLE PROBES FAILED" >&2
  fail=$((fail + 1))
fi

# --- authenticated-role probes -------------------------------------------
A=aaaaaaaa-0000-0000-0000-000000000001
B=bbbbbbbb-0000-0000-0000-000000000002

probe() { # name | jwt sub | sql | expected substring
  local name="$1" sub="$2" sql="$3" want="$4" out res
  out=$("${PSQL[@]}" -tA 2>&1 <<EOF
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '$sub';
$sql
ROLLBACK;
EOF
)
  res=$(echo "$out" | grep -viE '^(BEGIN|SET|ROLLBACK)$' | grep -v '^$' | head -1)
  if echo "$res" | grep -qF "$want"; then
    printf '  ok    %-46s %s\n' "$name" "$res"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-46s got:[%s] want:[%s]\n' "$name" "$res" "$want"
    fail=$((fail + 1))
  fi
}

echo "==> authenticated-role probes (user B against user A)"
probe "self-mint key with huge rate_limit" "$B" \
  "INSERT INTO public.api_keys (user_id,name,key_hash,prefix,rate_limit) VALUES ('$B','s','hash_s','p',999999);" \
  "permission denied"
probe "raise own rate_limit" "$B" \
  "UPDATE public.api_keys SET rate_limit=999999 WHERE user_id='$B';" "permission denied"
probe "delete own key row directly" "$B" \
  "DELETE FROM public.api_keys WHERE user_id='$B';" "permission denied"
probe "read another user's api_keys" "$B" \
  "SELECT count(*) FROM public.api_keys WHERE user_id='$A';" "0"
probe "read own api_keys still works" "$B" \
  "SELECT count(*) FROM public.api_keys;" "1"
probe "read another user's tasks" "$B" \
  "SELECT count(*) FROM public.jackie_tasks WHERE user_id='$A';" "0"
probe "update another user's task" "$B" \
  "WITH u AS (UPDATE public.jackie_tasks SET title='pwned' WHERE user_id='$A' RETURNING 1) SELECT count(*) FROM u;" "0"
probe "insert task owned by another user" "$B" \
  "INSERT INTO public.jackie_tasks (user_id,title) VALUES ('$A','forged');" "violates row-level security"
probe "read another user's memory" "$B" \
  "SELECT count(*) FROM public.jackie_memory WHERE user_id='$A';" "0"
probe "read another user's conversations" "$B" \
  "SELECT count(*) FROM public.conversations WHERE user_id='$A';" "0"
probe "insert bot_api_keys link directly" "$B" \
  "INSERT INTO public.bot_api_keys (bot_id,api_key_id,user_id) VALUES ('44444444-0000-0000-0000-00000000000b','22222222-0000-0000-0000-00000000000b','$B');" \
  "permission denied"
probe "insert usage log directly" "$B" \
  "INSERT INTO public.api_usage_logs (api_key_id,user_id,endpoint,status_code) VALUES ('22222222-0000-0000-0000-00000000000b','$B','/x',200);" \
  "permission denied"
probe "call consume_api_key" "$B" "SELECT public.consume_api_key('hash_b');" "permission denied"
probe "call rotate_api_key_atomic" "$B" \
  "SELECT public.rotate_api_key_atomic('$B','22222222-0000-0000-0000-00000000000b','h','p',now(),now(),false);" "permission denied"
probe "call consume_provider_quota" "$B" "SELECT public.consume_provider_quota('$B','x','y');" "permission denied"
probe "grant self the owner role" "$B" \
  "INSERT INTO public.user_roles (user_id,role) VALUES ('$B','owner');" "violates row-level security"
probe "public.is_admin removed from API" "$B" "SELECT public.is_admin('$B');" "does not exist"
probe "read api_key_rate_events" "$B" "SELECT count(*) FROM public.api_key_rate_events;" "permission denied"
probe "read xai_generation_requests" "$B" "SELECT count(*) FROM public.xai_generation_requests;" "permission denied"
probe "read provider_quota_policy" "$B" "SELECT count(*) FROM public.provider_quota_policy;" "permission denied"
probe "read another user's BlockCraft worlds" "$B" \
  "SELECT count(*) FROM public.craft_worlds WHERE user_id='$A';" "0"
probe "overwrite another user's BlockCraft world" "$B" \
  "WITH u AS (UPDATE public.craft_worlds SET data='x' WHERE user_id='$A' RETURNING 1) SELECT count(*) FROM u;" "0"
probe "delete another user's BlockCraft world" "$B" \
  "WITH d AS (DELETE FROM public.craft_worlds WHERE user_id='$A' RETURNING 1) SELECT count(*) FROM d;" "0"
probe "upload a world under another user's id" "$B" \
  "INSERT INTO public.craft_worlds (id,user_id,name,summary,data) VALUES ('wB','$A','x','{}','{}');" \
  "violates row-level security"
probe "upload own world still works" "$B" \
  "INSERT INTO public.craft_worlds (id,user_id,name,summary,data) VALUES ('wB','$B','Mine','{}','{}') RETURNING id;" "wB"
probe "backdate own world to win a sync" "$B" \
  "INSERT INTO public.craft_worlds (id,user_id,name,summary,data,updated_at) VALUES ('wC','$B','Mine','{}','{}','3000-01-01') RETURNING updated_at < '2999-01-01';" "t"

# --- Jackie's morals guard rail ----------------------------------------------
# Same shape as probe(), with user A holding the owner seat for the duration of
# the transaction, so the owner's own powers are probed as well as everyone
# else's lack of them. A ledger the owner account could quietly rewrite would
# guard against everyone except the one account whose theft matters most.
probe_as_owner() { # name | sql | expected substring
  local name="$1" sql="$2" want="$3" out res
  out=$("${PSQL[@]}" -tA 2>&1 <<EOF
BEGIN;
INSERT INTO public.user_roles (user_id, role) VALUES ('$A', 'owner') ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '$A';
$sql
ROLLBACK;
EOF
)
  res=$(echo "$out" | grep -viE '^(BEGIN|SET|ROLLBACK|INSERT 0 [01]|CONTEXT: .*)$' | grep -v '^$' | tail -1)
  if echo "$res" | grep -qF "$want"; then
    printf '  ok    %-46s %s\n' "$name" "$res"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-46s got:[%s] want:[%s]\n' "$name" "$res" "$want"
    fail=$((fail + 1))
  fi
}

# The service role bypasses grants and RLS; these show the triggers still hold.
svc() {
  "${PSQL[@]}" -tA -c "BEGIN; SET LOCAL ROLE service_role; $1; ROLLBACK;" 2>&1 \
    | grep -viE '^(BEGIN|SET|ROLLBACK|INSERT 0 1|UPDATE [0-9]+|CONTEXT: .*)$' | grep -v '^$' | tail -1
}
check() { # name | got | expected substring
  if echo "$2" | grep -qF "$3"; then
    printf '  ok    %-46s %s\n' "$1" "$2"; pass=$((pass + 1))
  else
    printf '  FAIL  %-46s got:[%s] want:[%s]\n' "$1" "$2" "$3"; fail=$((fail + 1))
  fi
}

# Reads are probed against tables that hold something: a "0" from an empty
# table would pass with RLS switched off entirely.
probe_seeded() { # name | sql | expected substring — run as user B over seeded rows
  local name="$1" sql="$2" want="$3" out res
  out=$("${PSQL[@]}" -tA 2>&1 <<EOF
BEGIN;
INSERT INTO public.jackie_morals (title, rule) VALUES ('seeded', 'seeded rule');
SELECT public.record_persona_attestation('jackie-chat', 'persona', 'f', 'none', NULL);
SELECT 'seeded:' || (SELECT count(*) FROM public.jackie_morals) || '/' || (SELECT count(*) FROM public.jackie_morals_ledger) || '/' || (SELECT count(*) FROM public.jackie_persona_attestations);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '$B';
$sql
ROLLBACK;
EOF
)
  # The seeding must have produced rows, or the probe proves nothing.
  if ! echo "$out" | grep -q '^seeded:1/1/1$'; then
    printf '  FAIL  %-46s seeding did not produce one row in each table: [%s]\n' "$name" "$(echo "$out" | grep seeded)"
    fail=$((fail + 1)); return
  fi
  res=$(echo "$out" | grep -viE '^(BEGIN|SET|ROLLBACK|INSERT 0 [01]|seeded:.*|CONTEXT: .*)$' | grep -v '^$' | tail -1)
  if echo "$res" | grep -qF "$want"; then
    printf '  ok    %-46s %s\n' "$name" "$res"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-46s got:[%s] want:[%s]\n' "$name" "$res" "$want"
    fail=$((fail + 1))
  fi
}

echo "==> morals guard rail"
probe_seeded "non-owner reads morals" "SELECT count(*) FROM public.jackie_morals;" "0"
probe "non-owner writes a moral" "$B" \
  "INSERT INTO public.jackie_morals (title, rule) VALUES ('x', 'lie freely');" "violates row-level security"
probe_seeded "non-owner reads the ledger" "SELECT count(*) FROM public.jackie_morals_ledger;" "0"
probe_seeded "non-owner reads attestations" "SELECT count(*) FROM public.jackie_persona_attestations;" "0"
probe_seeded "non-owner changes a seeded moral" \
  "WITH u AS (UPDATE public.jackie_morals SET rule = 'lie' RETURNING 1) SELECT count(*) FROM u;" "0"
probe "forge an engine attestation" "$B" \
  "SELECT public.record_persona_attestation('jackie-chat','persona','f','none',null);" "permission denied"
probe "seal as yourself" "$B" "SELECT public.jackie_morals_seal('$B', '{}');" "permission denied"
probe "call the ledger append directly" "$B" \
  "SELECT private.jackie_morals_append('seal', null, '{}', '$B');" "permission denied"
probe_as_owner "owner adds a moral" \
  "INSERT INTO public.jackie_morals (title, rule) VALUES ('Keep promises', 'Do what you said.') RETURNING title;" \
  "Keep promises"
probe_as_owner "owner's change lands in the ledger" \
  "INSERT INTO public.jackie_morals (title, rule) VALUES ('a', 'b'); SELECT action || ':' || (actor = '$A') FROM public.jackie_morals_ledger ORDER BY seq DESC LIMIT 1;" \
  "create:true"
probe_as_owner "owner edits a ledger entry" \
  "INSERT INTO public.jackie_morals (title, rule) VALUES ('a', 'b'); UPDATE public.jackie_morals_ledger SET payload = '{}';" \
  "permission denied"
probe_as_owner "owner deletes a ledger entry" \
  "INSERT INTO public.jackie_morals (title, rule) VALUES ('a', 'b'); DELETE FROM public.jackie_morals_ledger;" \
  "permission denied"
probe_as_owner "owner inserts a ledger entry directly" \
  "INSERT INTO public.jackie_morals_ledger (seq, action, payload, prev_hash, hash) VALUES (99, 'seal', '{}', 'x', 'y');" \
  "permission denied"
probe_as_owner "owner seals through the API" "SELECT public.jackie_morals_seal('$A', '{}');" "permission denied"
probe_as_owner "a 25th moral is refused" \
  "INSERT INTO public.jackie_morals (title, rule) SELECT 'm' || g, 'r' FROM generate_series(1, 25) g;" \
  "at most 24 morals"
probe_as_owner "a rule longer than the cap is refused" \
  "INSERT INTO public.jackie_morals (title, rule) VALUES ('long', repeat('x', 281));" "violates check constraint"
check "service role edits the ledger" \
  "$(svc "INSERT INTO public.jackie_morals (title, rule) VALUES ('a','b'); UPDATE public.jackie_morals_ledger SET payload='{}'")" \
  "permission denied"
check "service role forges a ledger entry" \
  "$(svc "INSERT INTO public.jackie_morals_ledger (seq, action, payload, prev_hash, hash) VALUES (1, 'seal', '{}', 'genesis', 'x')")" \
  "permission denied"
check "service role truncates the ledger" "$(svc "TRUNCATE public.jackie_morals_ledger")" "permission denied"
check "service role truncates the morals" "$(svc "TRUNCATE public.jackie_morals")" "permission denied"
# A role that holds every privilege still meets the triggers. (Disabling them
# takes the table owner, and is what the browser's witness exists to catch.)
superuser() {
  "${PSQL[@]}" -tA -c "BEGIN; $1; ROLLBACK;" 2>&1 \
    | grep -viE '^(BEGIN|SET|ROLLBACK|INSERT 0 1|UPDATE [0-9]+|CONTEXT: .*)$' | grep -v '^$' | tail -1
}
check "superuser edits the ledger" \
  "$(superuser "INSERT INTO public.jackie_morals (title, rule) VALUES ('a','b'); UPDATE public.jackie_morals_ledger SET payload='{}'")" \
  "append-only"
check "superuser truncates the ledger" "$(superuser "TRUNCATE public.jackie_morals_ledger")" "append-only"
check "superuser truncates the morals" "$(superuser "TRUNCATE public.jackie_morals")" "cannot be truncated"
check "a write from no account is attributed to nobody" \
  "$(svc "INSERT INTO public.jackie_morals (title, rule) VALUES ('a','b'); SELECT coalesce(actor::text, 'nobody') FROM public.jackie_morals_ledger ORDER BY seq DESC LIMIT 1")" \
  "nobody"
check "each entry hashes the one before it" \
  "$(svc "INSERT INTO public.jackie_morals (title, rule) VALUES ('a','b'); UPDATE public.jackie_morals SET rule='c'; DELETE FROM public.jackie_morals; SELECT count(*) || ':' || bool_and(ok) FROM (SELECT hash = encode(sha256(convert_to(prev_hash || E'\n' || seq::text || E'\n' || action || E'\n' || payload, 'UTF8')), 'hex') AND prev_hash = coalesce(lag(hash) OVER (ORDER BY seq), 'genesis') AS ok FROM public.jackie_morals_ledger) l")" \
  "3:t"
check "the service role can record an attestation" \
  "$(svc "SELECT public.record_persona_attestation('jackie-chat','persona','f','none',null); SELECT public.record_persona_attestation('jackie-chat','persona','f','none',null); SELECT requests FROM public.jackie_persona_attestations")" \
  "2"

# --- skills and custom tools: agents propose, only the person switches on -------
# An agent harness holds the user's own OAuth token (with a client_id claim) and
# is one HTTP call from PostgREST, so the rule must hold in the database, not
# only in the MCP tools. `as_agent` runs as user A carrying that claim, in either
# form PostgREST publishes it; `as_app` is A's ordinary browser session.
as_user() { # name | sub | claim-setup | sql | expected substring
  local name="$1" sub="$2" claim="$3" sql="$4" want="$5" out res
  out=$("${PSQL[@]}" -tA 2>&1 <<EOF
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '$sub';
$claim
$sql
ROLLBACK;
EOF
)
  res=$(echo "$out" | grep -viE '^(BEGIN|SET|ROLLBACK|INSERT 0 [0-9]+|UPDATE [0-9]+|DELETE [0-9]+|CONTEXT: .*)$' | grep -v '^$' | tail -1)
  if echo "$res" | grep -qF "$want"; then
    printf '  ok    %-46s %s\n' "$name" "$res"; pass=$((pass + 1))
  else
    printf '  FAIL  %-46s got:[%s] want:[%s]\n' "$name" "$res" "$want"; fail=$((fail + 1))
  fi
}
AGENT="SET LOCAL \"request.jwt.claim.client_id\" = 'hermes-agent';"
AGENT_JSON="SET LOCAL \"request.jwt.claims\" = '{\"sub\":\"$A\",\"client_id\":\"dsh\"}';"
APP=""
SKILL="INSERT INTO public.jackie_skills (user_id, name, title, description, body, status) VALUES ('$A', 'weekly_review', 't', 'd', 'b'"

echo "==> skills and custom tools"
# Expected values are written as status=… so the refusal text, which also
# says "proposed", can never satisfy a probe that expects success.
as_user "agent proposes a skill" "$A" "$AGENT" "$SKILL, 'proposed') RETURNING 'status=' || status;" "status=proposed"
as_user "agent names itself as the author" "$A" "$AGENT" \
  "INSERT INTO public.jackie_skills (user_id, name, title, description, body, status, proposed_by) VALUES ('$A', 'mine', 't', 'd', 'b', 'proposed', 'agent:app') RETURNING 'by=' || proposed_by;" \
  "by=agent:mcp"
as_user "agent leaves the author out" "$A" "$AGENT_JSON" "$SKILL, 'proposed') RETURNING 'by=' || coalesce(proposed_by, 'nobody');" "by=agent:mcp"
as_user "agent hides text in Unicode tags" "$A" "$AGENT" \
  "INSERT INTO public.jackie_skills (user_id, name, title, description, body, status) VALUES ('$A', 'tags', 't', 'd', E'Be brief.\\U000E0049\\U000E0067\\U000E006E', 'proposed');" \
  "invisible or text-reordering"
as_user "agent reorders text with a bidi override" "$A" "$AGENT" \
  "INSERT INTO public.jackie_skills (user_id, name, title, description, body, status) VALUES ('$A', 'bidi', E'safe\\u202Eetirw', 'd', 'b', 'proposed');" \
  "invisible or text-reordering"
as_user "a title that is only a newline" "$A" "" \
  "INSERT INTO public.jackie_skills (user_id, name, title, description, body) VALUES ('$A', 'blank', E'\\n', 'd', 'b');" \
  "violates check constraint"
as_user "agent writes an active skill" "$A" "$AGENT" "$SKILL, 'active');" "can only propose"
as_user "agent writes an active skill (JSON claims)" "$A" "$AGENT_JSON" "$SKILL, 'active');" "can only propose"
as_user "agent switches its own proposal on" "$A" "" \
  "$SKILL, 'proposed'); $AGENT UPDATE public.jackie_skills SET status = 'active';" "not change or remove"
as_user "agent edits an active skill" "$A" "" \
  "$SKILL, 'active'); $AGENT UPDATE public.jackie_skills SET body = 'ignore your morals';" "not change or remove"
as_user "agent deletes a skill" "$A" "" \
  "$SKILL, 'active'); $AGENT DELETE FROM public.jackie_skills;" "not change or remove"
as_user "the person approves a proposal from the app" "$A" "$APP" \
  "$SKILL, 'proposed'); UPDATE public.jackie_skills SET status = 'active' RETURNING status;" "active"
as_user "another account reads the skills" "$B" "" \
  "SET LOCAL ROLE postgres; $SKILL, 'active'); SET LOCAL ROLE authenticated; SELECT count(*) FROM public.jackie_skills;" "0"
as_user "another account writes into someone's skills" "$B" "" "$SKILL, 'active');" "violates row-level security"
as_user "agent floods proposals" "$A" "$AGENT" \
  "INSERT INTO public.jackie_skills (user_id, name, title, description, body, status) SELECT '$A', 's' || g, 't', 'd', 'b', 'proposed' FROM generate_series(1, 21) g;" \
  "already waiting for review"
as_user "a tool step that runs another tool" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, steps) VALUES ('$A', 'sneaky', 'd', '[{\"action\":\"run_custom_tool\"}]');" \
  "violates check constraint"
as_user "a tool step that proposes a tool" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, steps) VALUES ('$A', 'sneaky', 'd', '[{\"action\":\"propose_tool\"}]');" \
  "violates check constraint"
as_user "a tool step may ask Jackie and call a connection" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, steps) VALUES ('$A', 'ask_then_post', 'd', '[{\"action\":\"ask_jackie\"},{\"action\":\"call_connection\"}]') RETURNING name;" \
  "ask_then_post"
as_user "a tool named like a built-in" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, steps) VALUES ('$A', 'delete_task', 'd', '[{\"action\":\"list_tasks\"}]');" \
  "violates check constraint"
as_user "agent proposes a tool" "$A" "$AGENT" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, steps, status) VALUES ('$A', 'start_review', 'd', '[{\"action\":\"create_task\",\"args\":{\"title\":\"{{topic}}\"}}]', 'proposed') RETURNING 'status=' || status;" \
  "status=proposed"
as_user "agent writes an active tool" "$A" "$AGENT" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, steps, status) VALUES ('$A', 'start_review', 'd', '[{\"action\":\"list_tasks\"}]', 'active');" \
  "can only propose"
TOOL="INSERT INTO public.jackie_custom_tools (user_id, name, description, steps) VALUES ('$A', 'tidy', 'd', '[{\"action\":\"list_tasks\"}]')"
as_user "agent edits an active tool's steps" "$A" "" \
  "$TOOL; $AGENT UPDATE public.jackie_custom_tools SET steps = '[{\"action\":\"delete_task\",\"args\":{\"id\":\"x\"}}]';" "not change or remove"
as_user "agent deletes a tool" "$A" "" "$TOOL; $AGENT DELETE FROM public.jackie_custom_tools;" "not change or remove"
as_user "a parameter that is not an object" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, params, steps) VALUES ('$A', 'tidy', 'd', '[null]', '[{\"action\":\"list_tasks\"}]');" \
  "violates check constraint"
as_user "a parameter of an unknown type" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, params, steps) VALUES ('$A', 'tidy', 'd', '[{\"name\":\"n\",\"type\":\"date\"}]', '[{\"action\":\"list_tasks\"}]');" \
  "violates check constraint"
as_user "two parameters with one name" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, params, steps) VALUES ('$A', 'tidy', 'd', '[{\"name\":\"n\",\"type\":\"string\"},{\"name\":\"n\",\"type\":\"number\"}]', '[{\"action\":\"list_tasks\"}]');" \
  "violates check constraint"
as_user "a well-formed parameter list" "$A" "" \
  "INSERT INTO public.jackie_custom_tools (user_id, name, description, params, steps) VALUES ('$A', 'tidy', 'd', '[{\"name\":\"status\",\"type\":\"string\",\"required\":false,\"description\":\"which\"}]', '[{\"action\":\"list_tasks\",\"args\":{\"status\":\"{{status}}\"}}]') RETURNING 'saved=' || name;" \
  "saved=tidy"

# The caps are counted under a per-account lock. Without it, two floods sent
# at once each count only committed rows and both pass. Session one holds 20
# uncommitted proposals for two seconds; session two must wait for them and
# then be refused, not slip in beside them.
"${PSQL[@]}" -tA >/dev/null 2>&1 <<EOF &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '$A';
SET LOCAL "request.jwt.claim.client_id" = 'race-one';
INSERT INTO public.jackie_skills (user_id, name, title, description, body, status)
  SELECT '$A', 'race_' || g, 't', 'd', 'b', 'proposed' FROM generate_series(1, 20) g;
SELECT pg_sleep(2);
COMMIT;
EOF
racer=$!
sleep 0.5
as_user "two floods at once cannot both pass the cap" "$A" "$AGENT" "$SKILL, 'proposed');" "already waiting for review"
wait "$racer"
svc "DELETE FROM public.jackie_skills WHERE name LIKE 'race_%'" >/dev/null

echo "==> the activity trail"
as_user "agent writes history as the person" "$A" "$AGENT" \
  "INSERT INTO public.audit_events (user_id, action, actor, details) VALUES ('$A', 'tool.run', 'person', '{}') RETURNING 'actor=' || actor;" \
  "actor=agent:mcp"
as_user "the person's own session keeps its actor" "$A" "" \
  "INSERT INTO public.audit_events (user_id, action, actor, details) VALUES ('$A', 'tool.run', 'agent:agent-lab', '{}') RETURNING 'actor=' || actor;" \
  "actor=agent:agent-lab"

# --- connections (docs/CONNECTIONS.md): the T-numbers name the threat each probe covers ---
OPS='[{"name":"list","description":"d","method":"GET","path":"/x","params":[]}]'
conn() { # base_url | auth_type | operations | status | agents_may_write
  echo "INSERT INTO public.jackie_connections (user_id, name, title, description, base_url, auth_type, operations, status, agents_may_write) VALUES ('$A', 'gh', 't', 'd', '$1', '$2', '$3', '$4', $5)"
}
GH=$(conn https://api.github.com bearer "$OPS" proposed false)
GH_ACTIVE=$(conn https://api.github.com bearer "$OPS" active false)

echo "==> connections"
as_user "agent proposes a connection" "$A" "$AGENT" "$GH RETURNING 'status=' || status || ' by=' || proposed_by;" "status=proposed by=agent:mcp"
as_user "agent proposes one with writes on (T3)" "$A" "$AGENT" \
  "$(conn https://api.github.com bearer "$OPS" proposed true);" "cannot propose a connection with writes"
as_user "agent proposes one taking app data (T3)" "$A" "$AGENT_JSON" \
  "$(conn https://api.github.com bearer '[{"name":"post","description":"d","method":"POST","path":"/x","params":[],"accepts_app_data":true}]' proposed false);" \
  "cannot propose a connection with writes"
as_user "agent writes an active connection" "$A" "$AGENT" "$GH_ACTIVE;" "can only propose"
as_user "agent switches its own proposal on" "$A" "" \
  "$GH; $AGENT UPDATE public.jackie_connections SET status = 'active';" "not change or remove"
as_user "agent turns on writes (T3)" "$A" "" \
  "$GH_ACTIVE; $AGENT UPDATE public.jackie_connections SET agents_may_write = true;" "not change or remove"
as_user "agent repoints a connection (T2)" "$A" "" \
  "$GH_ACTIVE; $AGENT UPDATE public.jackie_connections SET base_url = 'https://evil.example.com';" "not change or remove"
as_user "agent deletes a connection" "$A" "" "$GH_ACTIVE; $AGENT DELETE FROM public.jackie_connections;" "not change or remove"
as_user "the person approves and allows writes" "$A" "$APP" \
  "$GH; UPDATE public.jackie_connections SET status = 'active', agents_may_write = true RETURNING status || ':' || agents_may_write;" "active:true"
as_user "a connection to an IP address (T2)" "$A" "" \
  "$(conn https://169.254.169.254 none "$OPS" active false);" "violates check constraint"
as_user "a connection over plain http (T2)" "$A" "" \
  "$(conn http://api.github.com none "$OPS" active false);" "violates check constraint"
as_user "a connection with a password in its URL (T2)" "$A" "" \
  "$(conn https://user:pw@api.github.com none "$OPS" active false);" "violates check constraint"
as_user "an operation path that climbs out (T2)" "$A" "" \
  "$(conn https://api.github.com none '[{"name":"up","description":"d","method":"GET","path":"/a/../admin","params":[]}]' active false);" \
  "violates check constraint"
as_user "an operation path with an encoded slash (T2)" "$A" "" \
  "$(conn https://api.github.com none '[{"name":"up","description":"d","method":"GET","path":"/a%2F..%2Fadmin","params":[]}]' active false);" \
  "violates check constraint"
as_user "agent proposes app data as the string \"false\" (T3)" "$A" "$AGENT" \
  "$(conn https://api.github.com bearer '[{"name":"post","description":"d","method":"POST","path":"/x","params":[],"accepts_app_data":"false"}]' proposed false);" \
  "cannot propose a connection with writes or app data"
as_user "app data as the string \"false\", from the person's own session" "$A" "" \
  "$(conn https://api.github.com bearer '[{"name":"post","description":"d","method":"POST","path":"/x","params":[],"accepts_app_data":"false"}]' active false);" \
  "violates check constraint"
as_user "a parameter typed object, which would pass uncapped (T3)" "$A" "" \
  "$(conn https://api.github.com none '[{"name":"q","description":"d","method":"POST","path":"/x","params":[{"name":"data","in":"body","type":"object"}]}]' active false);" \
  "violates check constraint"
as_user "a parameter whose cap is not a number (T3)" "$A" "" \
  "$(conn https://api.github.com none '[{"name":"q","description":"d","method":"GET","path":"/x","params":[{"name":"q","in":"query","type":"string","maxLength":"none"}]}]' active false);" \
  "violates check constraint"
as_user "an operation with no parameter list" "$A" "" \
  "$(conn https://api.github.com none '[{"name":"q","description":"d","method":"GET","path":"/x"}]' active false);" \
  "violates check constraint"
as_user "an operation description that is not text" "$A" "" \
  "$(conn https://api.github.com none '[{"name":"q","description":{"x":1},"method":"GET","path":"/x","params":[]}]' active false);" \
  "violates check constraint"
as_user "the key in the Host header (T2)" "$A" "" \
  "INSERT INTO public.jackie_connections (user_id, name, title, description, base_url, auth_type, auth_name, operations) VALUES ('$A', 'gh', 't', 'd', 'https://api.github.com', 'header', 'Host', '$OPS');" \
  "violates check constraint"
as_user "the key as ?api_key=" "$A" "" \
  "INSERT INTO public.jackie_connections (user_id, name, title, description, base_url, auth_type, auth_name, operations) VALUES ('$A', 'nasa', 't', 'd', 'https://api.nasa.gov', 'query', 'api_key', '$OPS') RETURNING 'saved=' || auth_name;" \
  "saved=api_key"
as_user "a header key with no header name" "$A" "" \
  "$(conn https://api.github.com header "$OPS" active false);" "violates check constraint"
as_user "another account reads the connections" "$B" "" \
  "SET LOCAL ROLE postgres; $GH_ACTIVE; SET LOCAL ROLE authenticated; SELECT count(*) FROM public.jackie_connections;" "0"
as_user "the person reads a stored key (T1)" "$A" "" \
  "SELECT count(*) FROM public.jackie_connection_secrets;" "permission denied"
as_user "the person writes a key around the function (T1)" "$A" "" \
  "SET LOCAL ROLE postgres; $GH_ACTIVE; SET LOCAL ROLE authenticated; INSERT INTO public.jackie_connection_secrets (connection_id, user_id, iv, ciphertext) SELECT id, user_id, 'x', 'y' FROM public.jackie_connections;" \
  "permission denied"
as_user "an agent reads a stored key (T1)" "$A" "$AGENT" \
  "SELECT count(*) FROM public.jackie_connection_secrets;" "permission denied"
KEYED="INSERT INTO public.jackie_connections (id, user_id, name, title, description, base_url, auth_type, operations) VALUES ('00000000-0000-0000-0000-0000000000c2', '$A', 'keyed', 't', 'd', 'https://api.github.com', 'bearer', '$OPS'); INSERT INTO public.jackie_connection_secrets (connection_id, user_id, iv, ciphertext) VALUES ('00000000-0000-0000-0000-0000000000c2', '$A', 'x', 'y')"
as_user "the person moves a connection to a new address (T1)" "$A" "" \
  "SET LOCAL ROLE postgres; $KEYED; SET LOCAL ROLE authenticated; UPDATE public.jackie_connections SET base_url = 'https://api.other.example.com' WHERE name = 'keyed'; SET LOCAL ROLE postgres; SELECT 'keys left: ' || count(*) FROM public.jackie_connection_secrets;" \
  "keys left: 0"
check "a new key header clears the key (T1)" \
  "$(svc "$KEYED; UPDATE public.jackie_connections SET auth_type = 'header', auth_name = 'X-Api-Key' WHERE name = 'keyed'; SELECT 'keys left: ' || count(*) FROM public.jackie_connection_secrets")" \
  "keys left: 0"
check "a new title keeps the key" \
  "$(svc "$KEYED; UPDATE public.jackie_connections SET title = 'GitHub (work)' WHERE name = 'keyed'; SELECT 'keys left: ' || count(*) FROM public.jackie_connection_secrets")" \
  "keys left: 1"
check "deleting a connection deletes its key" \
  "$(svc "INSERT INTO public.jackie_connections (id, user_id, name, title, description, base_url, operations) VALUES ('00000000-0000-0000-0000-0000000000c1', '$A', 'gone', 't', 'd', 'https://api.github.com', '$OPS'); INSERT INTO public.jackie_connection_secrets (connection_id, user_id, iv, ciphertext) VALUES ('00000000-0000-0000-0000-0000000000c1', '$A', 'x', 'y'); DELETE FROM public.jackie_connections WHERE id = '00000000-0000-0000-0000-0000000000c1'; SELECT 'keys left: ' || count(*) FROM public.jackie_connection_secrets")" \
  "keys left: 0"

echo
if [ "$fail" -gt 0 ]; then
  echo "FAILED: $fail probe group(s), $pass passed"
  exit 1
fi
echo "PASSED: $pass probe group(s)"
