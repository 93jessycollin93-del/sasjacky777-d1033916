# Bringing a newer Eru in

Eru (Cybernetic67) lives inside this app under `src/eru/`, mounted at `/eru/*`.
It is still developed on its own, on Base44, so from time to time a newer copy
needs to come across. This is how, without undoing anything Jackie changed.

```bash
node scripts/import-eru.mjs <path-to-eru>/src            # dry run: says what would change
node scripts/import-eru.mjs <path-to-eru>/src --write    # does it
```

Then run the suites (`npx vitest run`, typecheck, `npm run build`) — the nav bar
and the route manifest pick new Eru pages up on their own, and their tests fail
if a route collides with one of Jackie's.

## Why there is a script

The first import was done by hand, and `routes.generated.ts` claimed a
generator nobody had committed. So the only way to refresh Eru was another hand
copy — and a hand copy is how a bridge file gets overwritten with Eru's
original, after which the Eru pages quietly stop signing in as the Jackie user.
The script makes the rules the first import followed explicit.

## The rules

1. **Imports are rewritten**: `@/x` in Eru is `@/eru/x` here.
2. **Jackie's bridge files are never overwritten** (`JACKIE_OWNED` in the
   script). Eru's own versions assume Eru is the whole app:

   | File | Eru's version | Jackie's version |
   | --- | --- | --- |
   | `api/base44Client.js` | talks to Base44 | a shim signed in as the Jackie user, degrading instead of crashing when Base44 is absent |
   | `lib/AuthContext.jsx` | Base44 login | Jackie's Supabase session |
   | `context/LanguageContext.jsx` | its own language setting | the app-wide locale service |
   | `context/ThemeContext.jsx` | writes its theme onto the whole page | the same, put back when you leave Eru |
   | `lib/economyVerification.js` | imports Node's `crypto`, which a browser does not have | the browser's crypto |

   When Eru changes one of these upstream, the run lists it under "review by
   hand": carry anything new across into Jackie's version yourself.
3. **Eru's shell stays out**: its `App.jsx`, `main.jsx`, `index.css`, and its
   documents. Also its own `jackyClient`/`jackyBootstrap` — see below.
4. **Routes are regenerated** from Eru's `App.jsx`, minus the sign-in routes
   (Jackie signs people in), the catch-all, and anything in `EXCLUDED_ROUTES`.
5. **Nothing is deleted.** A file Eru dropped is reported, not removed, because
   something of Jackie's may still import it.

## Decisions made on the 2026-09 import

- **`/eru/jacky-live` is not mounted.** Eru's page seeds its gauges with
  invented readings (GPU 54%, CPU 32%…), and inside Jackie its engine call
  resolves to nothing, so it would show fabricated "live" telemetry
  indefinitely. Jackie's own `/jacky-live` reads the real engine.
- **Eru's `jackyClient` / `jackyBootstrap` are not imported.** They can reach
  the engine directly with a token kept in the browser; Jackie's
  `src/lib/jackyClient.ts` goes through the owner-gated `jacky-proxy` function
  and keeps the token server-side. Only Eru's `main.jsx` loaded them, so they
  would have been unreachable — a second, weaker client waiting to be wired up
  by mistake.
- **The auth shim gained `currentUser`, `navigateToLogin` and
  `checkAppState`.** The newer pages call them; without them they would have
  thrown "navigateToLogin is not a function" on mount.

## Known weak spots in Eru itself

Reported, not patched, because patching Eru's files here makes the next import
a merge:

- **Secure Slice** (`lib/secureSlice.js`, `/eru/admin/secure-slice`) is real
  cryptography — PBKDF2 at 500,000 rounds into AES-GCM, and a hash-chained
  audit log — but its storage keys are not per account, and it wipes the vault
  after ten wrong passphrases. On a shared browser, someone signed in as a
  different account can trigger that wipe. The fix is to key its storage by
  user id, as the notes and the nav bar do; it belongs in Eru.
- **Base44 cloud functions** (`invokeExternalModel`, `renderPromptTemplate`,
  `jackyProxy`) resolve to "offline" inside Jackie, so the Eru pages that use
  them for model calls do nothing here. Jackie's own engines do that work.
