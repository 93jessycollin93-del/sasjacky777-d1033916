---
description: Add a new engine to the chat's fallback chain
argument-hint: "[engine name, e.g. vllm]"
---

Add **$ARGUMENTS** as an engine in the chat's fallback chain. Read
`docs/CHAT_PIPELINE.md` first; it explains the chain and why it is shaped this
way.

There are five places, and missing any one of them produces a failure that
looks like the engine being down:

1. **`supabase/functions/jackie-$ARGUMENTS/index.ts`** — model it on
   `jackie-bionic`. It must:
   - gate with `admit(req, FUNCTION_NAME, chosen.model)` from
     `_shared/entitlement.ts`;
   - check its base-URL secret **before** `admit`, returning
     `{ code: "PROVIDER_UNCONFIGURED", needs_secret: "…" }` with 503, so probing
     an unconfigured link costs the caller no quota;
   - validate history with `normalizeMessages` from `_shared/chatRequest.ts`;
   - build its system prompt with `buildSystemPrompt(clampContext(context))`
     from `_shared/persona.ts`;
   - answer OpenAI-compatible SSE, and carry CORS headers on every path.

2. **`src/lib/jackie-engines.ts`** — an entry in `ENGINES`. Position in the
   array *is* the fallback order: local and free before remote and paid.

3. **The model allowlist** in the new function must list exactly what the
   registry offers in the picker. These two drifting apart is the most common
   way a new engine ships broken.

4. **`src/test/jackie-router.test.ts`** — the chain-order assertion is explicit
   and will fail. Update it, and add a case proving the new engine both serves
   and falls through.

5. **Docs** — the engine table in `docs/CHAT_PIPELINE.md` and the deploy list in
   `SECURITY_HARDENING.md`.

Then run `npx vitest run` and `npx tsc --noEmit -p tsconfig.app.json`.
