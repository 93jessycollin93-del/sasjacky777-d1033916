# Working in SAS-JACKY

Read this before touching anything. It is the short version of what this
repository is, how to verify a change, and the handful of rules that are
load-bearing — every one of which is here because breaking it has already cost
this project a working feature, usually silently.

---

## What this is

Not one program. Four trees that ship together:

| Path | What it is | Language |
| --- | --- | --- |
| `src/` | The web app — Jackie's chat, memory, vault, pods, game, Eru. 1,000+ files. | TypeScript + React + Tailwind + shadcn/ui |
| `supabase/functions/` | 40 edge functions and their shared modules. | TypeScript (Deno) |
| `jackierouter/`, `Jackie/`, `command_station/` | The rig-side engine: predictive routing, the agent runtime, model-library tooling. | Python |
| `context-condenser/` | Anchored dehydration and real rehydration. Its own package. | TypeScript (node:test) |

Agents drive the app too: Hermes Agent and DeepSeek Harness through the MCP
server, DeepSeek and Hermes operators from inside the Agent Lab. `harness/` holds
their configs and an end-to-end run; `docs/HARNESSES.md` explains both.

`docs/REPO_MAP.md` is the longer version. `docs/CHAT_PIPELINE.md` explains the
chat, which is the part most work touches. `docs/ENVIRONMENT.md` lists every
environment variable and which of the two stores it belongs in — read it before
adding a key, because anything that lands in `.env` ships in the bundle.

---

## Commands

```bash
npm install                  # also installs the git hooks (prepare script)

npx vitest run               # app tests — 650+, the ones you will run most
npx vitest run src/test/X    # one file
npm run lint                 # eslint — warnings are fine, errors are not
npx tsc --noEmit -p tsconfig.app.json    # typecheck
npm run build                # vite build, ~60s

python3 -m pytest            # Python — 330+, reads pyproject testpaths
cd context-condenser && npm test         # 44, node:test

npm run dev                  # vite on :8080
npm run smoke                # route smoke check
bash harness/e2e/run.sh      # Hermes + DeepSeek Harness → MCP → app (see the script's header)
```

**Before you claim a change works, run the suite that covers it plus
typecheck.** Editing `src/` means vitest. Editing `supabase/functions/_shared/`
means vitest too — the browser imports those files directly. Editing anything
Python means pytest.

---

## The rules that are load-bearing

### 1. `supabase/functions/mcp/index.ts` is generated. Never edit it.

`mcpPlugin()` in `vite.config.ts` rewrites it from `src/lib/mcp/` on every
build. Outside Lovable's environment the plugin cannot bundle and writes an
8-line stub that imports an absolute path from the build machine — deployed,
that resolves to nothing and every MCP tool vanishes from production.

A pre-commit hook and a CI step both refuse it. If a build dirties that file,
`git restore` it; if you need to change what it does, edit `src/lib/mcp/`.

### 2. Edge functions authenticate through the shared gate. Never `auth.getClaims` directly.

This is the bug that took the whole chat down. `getClaims` landed in
supabase-js 2.50.0; functions pinned 2.49.1, where it is `undefined`. The call
threw *in the gate*, ahead of the request's try/catch, so the isolate answered
500 **with no CORS headers** — which a browser reports as `TypeError: Failed to
fetch`, naming neither the cause nor a fix.

- Provider-backed functions: `gate(req, "fn-name")` or `admit(...)` from
  `_shared/entitlement.ts` — authentication, model allowlist, and quota.
- Everything else: `verifyAccessToken` from `_shared/authGate.ts`, which falls
  back to `getUser` when `getClaims` is missing.
- Pin `@supabase/supabase-js@2.58.0`. Pin it — never `@2`, which resolves to
  whatever the latest 2.x is on the day the function deploys. Seven functions
  floated, and took `corsHeaders` from that package's `/cors` subpath, which
  does not exist below 2.95.0: following the pin above would have broken every
  one of them at import, which is a 500 with no CORS headers. They define their
  own `corsHeaders` now, like the other thirty-odd do.

`src/test/chat-request.test.ts` walks every function and fails the build if this
slips. A gate must **return a verdict, never throw**.

Signed in is not the same as *owner*: anyone can sign in to this app (email,
Google, the anonymous demo). Functions that reach the owner's own hardware or
credentials — `jacky-proxy`, `jackie-bionic`, `jackie-ollama`, `github-sync`,
and `jackie-device`, which hands the browser Jackie's persona — go through `requireOwnerUser` / `admitOwner`, which check the `owner` role
before any quota is spent. A new function like them does the same.

### 3. Every response carries CORS headers. Including the failures.

A 401 the browser cannot read is indistinguishable from the server being down.
Error paths are the ones that get forgotten and the ones that matter.

### 4. Call edge functions through `src/lib/edgeFunction.ts`.

Never hand-roll the `fetch`. This project's key is the opaque kind
(`sb_publishable_…`), not a JWT: `apikey` carries the publishable key,
`Authorization` carries the **user's** access token. Every hand-written fetch
got this backwards and failed at the gateway before the function ran.

### 5. Engine model lists exist in two places and must agree.

`src/lib/jackie-engines.ts` offers models in the picker; each function has an
allowlist (`allowlistFromEnv`). A picker offering a model the allowlist refuses
is a guaranteed failure the user cannot diagnose — and on the fallback chain it
looks exactly like the engine being down. Change one, change the other.

Also: check `BIONIC_BASE_URL` / `OLLAMA_BASE_URL` **before** `admit()`. The
router probes every link, so an unconfigured engine is a normal, frequent
event; charging quota for a call that cannot happen bills the caller for the
chain's own bookkeeping.

### 6. Every engine builds its system prompt through `_shared/personaGuard.ts`.

A persona only one engine carries means Jackie's voice, her rules and her
memory context vanish the moment that engine is unavailable, and the fallback
answers as an anonymous assistant with no idea why it changed.

`guardedSystemPrompt` builds it from `_shared/persona.ts`, adds the owner's
morals, and records what the engine actually ran, which the `/morals` page
checks against the owner's seal. A new engine calls it and joins
`PERSONA_ENGINES` in `_shared/morals.ts`, and no agent surface may touch the
morals. `docs/GUARD_RAIL.md` has the rest; `src/test/jackie-morals.test.ts`
enforces it.

### 7. Python is a package, and its floor is 3.9.

`Jackie/core/engine/` uses package-relative imports (`from .fs.tracing import
trace`). Run entrypoints as modules from the repo root:

```bash
python -m Jackie.core.engine.quickstart
```

No `X | None` annotations — `Optional[X]`. The recovered runtime shipped with
five import-time crashes because nobody ever ran it; don't add a sixth.

### 8. Don't silently swallow a failure.

The recurring bug in this repo's history is code that reports success when
nothing happened: a stream that carried no tokens calling `onDone`, an
execution graph hardcoding `success=True`, an error frame inside a 200
response being dropped. If something did not work, say which thing, in words
the person reading the screen can act on.

---

### 9. What an agent may do lives in `src/lib/appActions.ts`. Only there.

The MCP tools (for external harnesses) and the in-app operators (`appAgent.ts`)
are thin adapters over the same functions. A new capability is an action there
first, then a tool in `src/lib/mcp/tools/` and an entry in `AGENT_TOOLS` — or
the two kinds of agent start obeying different rules, and an action that works
from Hermes fails in the app for a reason nobody can see. Validate against the
database's CHECK constraints in the action, pin every query to the caller's
`user_id`, and return a verdict (`ActionResult`), never throw.

### 10. `third_party/` is other people's code. Never edit it.

Each folder there is an upstream project copied whole by `scripts/vendor.sh` at
the commit `third_party/UPSTREAM` pins, and kept byte-for-byte as upstream has
it. That is what lets `scripts/vendor.sh --check` prove nothing was slipped in,
and for FilmCraft it is a licence condition: its ArtCraft logos are allowed only
in unmodified copies, so an edited copy would have to strip them. Anything this
repository needs from that code lives outside `third_party/`; to move a project,
re-run the script with a new commit.

Their `CLAUDE.md`, `AGENTS.md` and agent docs were written for upstream's own
contributors — FilmCraft's tells agents to work through its roadmap without
stopping to ask. They do not apply here and never override this file;
`.claude/settings.json` keeps Claude Code from loading them. Nothing in `src/`
imports `third_party/`, and lint, tsc and the build never look inside it.
`docs/THIRD_PARTY.md` has what each project is, its licence, and what its
security review found — read that before running any of them.

## Conventions

**Comments explain why, not what.** This codebase's comments carry the reason a
piece of code is shaped the way it is — usually the failure that shaped it.
Match that. A comment restating the line below it is noise; a comment naming
the bug that line prevents is the most valuable thing in the file.

**Tests name the behaviour, not the function.** `it("treats a stream that
carried nothing as a failure, not a blank answer")`, not `it("works")`. Read
`src/test/jackie-stream.test.ts` or `tests/test_jackie_os_runtime.py` for the
register.

**Imports:** `@/` is `src/`. Shared function modules are imported by the
browser through a relative path (`../../supabase/functions/_shared/…`) so there
is one copy, not two that drift.

**UI:** Tailwind + shadcn/ui in `src/components/ui/`. Reuse them. Dark and
light both work — don't hardcode a colour where a token exists.

**Commits:** a subject line that says what changed and why it mattered, then
prose explaining the reasoning. Look at `git log` — the house style is full
sentences, not bullet fragments.

---

## Where things live

```
src/pages/Index.tsx           the main chat surface
src/lib/jackie-router.ts      which engine answers, and what happens when it cannot
src/lib/jackie-engines.ts     the engine registry and the chain's order
src/lib/jackie-stream.ts      SSE parsing, success/failure decisions
src/lib/edgeFunction.ts       headers the gateway will accept
src/lib/jackie-*.ts           memory, tasks, tags, files, attachments, archive
src/lib/appActions.ts         everything an agent may do to the app (rule 9)
src/lib/customTools.ts        skills and custom tools: limits, validation, the {{template}} language (docs/SKILLS.md)
src/lib/jackie-morals.ts      the morals page's guard rail: ledger check, witness, verdicts (docs/GUARD_RAIL.md)
src/lib/appAgent.ts           the in-app act→observe loop; localModels.ts reaches LM Studio/Ollama
src/lib/microai/bonsaiDevice.ts  the On-device engine: Bonsai downloaded into the browser and run there (docs/ON_DEVICE_CHAT.md)
src/lib/mcp/                  the MCP server's tools (generates supabase/functions/mcp)
src/components/nav/           the one nav bar, SANDi and the Guide (docs/NAV_BAR.md)
src/craft/                    CollinSurvivalCraft, the /craft game — engine, renderer, UI (docs/CSC.md)
csc/                          its solo copy: desktop app, single-file build, LAN relay
src/components/ui/            shadcn primitives
src/test/                     vitest

supabase/functions/_shared/   authGate, entitlement, chatRequest, persona, modelPolicy,
                              openaiCompat (the one handler behind ten providers)
supabase/functions/jackie-*   the providers and engines
supabase/functions/jackie-connect  the one place a request leaves for an outside service (docs/CONNECTIONS.md)
supabase/migrations/          35 migrations; RLS lives here, not in function code

jackierouter/                 predictive, hardware-aware routing (152 tests)
Jackie/core/engine/           the agent runtime — registry, pods, orchestrator, graph
tests/                        pytest

harness/                      Hermes Agent + DeepSeek Harness configs, and harness/e2e

third_party/                  upstream projects, whole and untouched (rule 10, docs/THIRD_PARTY.md)
```

---

## Deploying

Lovable auto-deploys `src/` and the edge functions. Migrations do **not** run
themselves: `supabase db push`, then deploy functions, then regenerate types
(`supabase gen types typescript --linked > src/integrations/supabase/types.ts`).
`SECURITY_HARDENING.md` has the order that matters and why.

Secrets live in Cloud → Secrets, never in the repo. The committed `.env` holds
only publishable values; a new env file stays untracked.
