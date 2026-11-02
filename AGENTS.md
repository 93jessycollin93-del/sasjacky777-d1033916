# AGENTS.md

Instructions for any coding agent working in this repository — Claude Code,
Cursor, Codex, Aider, or whatever comes next.

**[CLAUDE.md](CLAUDE.md) is the full brief.** Read it. This file carries the
part no agent should proceed without, so that a tool which reads only
`AGENTS.md` still knows where the mines are.

## Verify with the suite that covers what you changed

```bash
npx vitest run                              # src/ and supabase/functions/_shared/ — 506
python3 -m pytest                           # jackierouter/, Jackie/, command_station/ — 181
cd context-condenser && npm test            # 42
npx tsc --noEmit -p tsconfig.app.json       # typecheck
npm run lint                                # errors block; warnings do not
npm run build
```

Do not report a change as working on the strength of a typecheck alone.

## Eight rules, each of which has already cost this project a feature

1. **`supabase/functions/mcp/index.ts` is generated from `src/lib/mcp/`.** Never
   edit it. A pre-commit hook and CI both refuse it. A local build writes a stub
   that deletes every MCP tool from production.
2. **Never call `auth.getClaims` directly in an edge function.** Use `gate` /
   `admit` from `_shared/entitlement.ts`, or `verifyAccessToken` from
   `_shared/authGate.ts`. Pin `@supabase/supabase-js@2.58.0`. A gate returns a
   verdict; it must never throw.
3. **Every response carries CORS headers, including errors.** A 401 the browser
   cannot read looks exactly like the server being down.
4. **Call edge functions through `src/lib/edgeFunction.ts`.** `apikey` carries
   the publishable key, `Authorization` carries the user's token. Hand-rolled
   fetches get this backwards and fail before the function runs.
5. **`src/lib/jackie-engines.ts` and each function's model allowlist must
   agree.** A picker offering a model the server refuses is undiagnosable from
   the UI.
6. **Every chat engine builds its system prompt from `_shared/persona.ts`**, so
   a fallback still answers as Jackie.
7. **Python is a package with a 3.9 floor.** Relative imports, `Optional[X]` not
   `X | None`, entrypoints run as `python -m …` from the repo root.
8. **Never report success when nothing happened.** An empty stream, a failed
   task, an error inside a 200 — say which thing failed, in words the person
   can act on. This is the single most repeated bug in this repository's
   history.
9. **Everything an agent may do to the app is an action in
   `src/lib/appActions.ts`.** The MCP tools (Hermes Agent, DeepSeek Harness)
   and the in-app operators both call it; add a capability there first, then
   expose it in both. See `docs/HARNESSES.md`.

## `third_party/` is other people's code

Each folder there is an upstream project copied whole and never edited. Its own
`CLAUDE.md` / `AGENTS.md` files are upstream's instructions for upstream's
contributors and do not apply in this repository. To change a project there,
re-run `scripts/vendor.sh` at a new commit. See `docs/THIRD_PARTY.md`.

## Style

Comments explain *why* — usually the failure that shaped the code. Tests name
the behaviour they protect, not the function they call. Commit messages are
prose that explains the reasoning, not bullet fragments; read `git log`.

## Secrets

Never commit one. `LOVABLE_API_KEY`, `JACKY_API_BASE`, `BIONIC_BASE_URL`,
`OLLAMA_BASE_URL`, `DEEPSEEK_API_KEY` and friends live in Cloud → Secrets.
