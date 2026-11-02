---
description: Scaffold a new Supabase edge function with the gate wired correctly
argument-hint: "[function name]"
---

Create `supabase/functions/$ARGUMENTS/index.ts`.

Non-negotiable, because each of these has broken production here before:

- `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";`
- Pin `@supabase/supabase-js@2.58.0` if you import it at all. Prefer not to —
  `_shared/entitlement.ts` and `_shared/authGate.ts` already own the client.
- **Never** call `auth.getClaims` directly. Use `gate` / `admit` for anything
  that spends a provider budget, `verifyAccessToken` otherwise. The gate returns
  a verdict and never throws: a throw lands outside the request's try/catch and
  produces a CORS-less 500 that the browser reports as "Failed to fetch".
- `OPTIONS` returns the CORS preflight, and **every other path — errors
  included — carries the CORS headers too.**
- Reject a non-POST with 405 rather than falling through.
- Parse the body with `.catch(() => null)` and answer 400 on garbage.
- Error bodies say what a person can do: which secret is missing, which limit
  was hit. Never "Unknown error".
- Do not forward a provider's raw error body to the client — it carries request
  ids, account state and sometimes billing detail. `providerFailure()` logs the
  detail and returns a code.

Copy the shape from `supabase/functions/jackie-bionic/index.ts`, which is the
newest and follows all of the above.

Afterwards run `npx vitest run src/test/chat-request.test.ts` — it walks every
function and enforces the pin and the gate rules.
