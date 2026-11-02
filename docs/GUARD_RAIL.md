# Jackie's morals and the guard rail

`/morals` (owner only) is where the owner sets what Jackie holds to, and where
they can see what the system is actually doing and whether anything changed
that they did not approve.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Morals | `jackie_morals` table | Up to 24 short rules. Owner-only by RLS. |
| Morals block | `_shared/morals.ts` | Turns the enabled morals into the text added to Jackie's persona. Shared by the engines and the browser, so both compute the same fingerprint. |
| The guard | `_shared/personaGuard.ts` | Every engine builds its system prompt here: persona + morals (read server-side with the service role, never from the request), and records an attestation of what it ran. `guardedRigPrompt` does the same for Jacky (`jacky-proxy`), whose persona is the rig's own: the morals go in front of its prompt, and it reports as `rig`. |
| Ledger | `jackie_morals_ledger` | Every change to a moral, from any path, plus every seal. Written only by a SECURITY DEFINER append; read-only for every API role including the service role; UPDATE, DELETE and TRUNCATE refused by trigger even for a superuser; each entry hashes the one before it, and who and when are inside the hashed record. TRUNCATE on the morals themselves is refused too, since it fires no row triggers. |
| Attestations | `jackie_persona_attestations` | One row per distinct setup each engine has run with: persona fingerprint and morals fingerprint; `override` (one row per engine, not per prompt) when a caller sent its own system prompt; `rig` for Jacky. |
| Status and seal | `functions/jackie-morals` | Owner-only. Returns the live persona text and fingerprint (all of `persona.ts`, game-design section included); seals the current persona and morals into the ledger — and refuses if they moved since the owner was shown them. |
| The page | `src/pages/JackieMorals.tsx`, `src/lib/jackie-morals.ts` | Re-verifies the whole chain in the browser (paged past PostgREST's 1,000-row cap), keeps a witness of the last head it verified, rebuilds the morals from the ledger to compare with the table, and turns everything into checks. |

## What each check means

- **Change history**: the chain verifies. A break names the first entry that does not.
- **This browser's memory**: the history still contains the last entry this browser verified. A history that verifies but no longer contains it was rewritten.
- **Morals against their history**: replaying every create, update and delete in the ledger gives exactly the morals the table holds. A difference means the table was written with the triggers off.
- **Changes made outside the app**: an entry with no account behind it, which means the service role, the SQL editor or a migration made the change. Red after the latest seal; a seal accepts the ones before it.
- **Tables missing**: if a browser that has verified the ledger before finds the tables gone, that is red, not "not set up".
- **Your seal / persona / morals**: the live persona and morals against what was last sealed. The persona comes from code, so a deploy that changes it shows here, and the Persona tab shows the diff.
- **Engines**: what each engine reported running on its latest request. Red for answering without the morals, with a persona nobody sealed after the seal, or with morals that were never in force at the time it answered (the ledger replay says which were, when). An engine that simply has not answered since the latest change or seal is grey, not red. Requests that carried their own system prompt (Agent Lab, operators, `jackie-orchestrate`) are counted, because the morals are not added to those.

After a break or a rewrite the owner can choose **trust the history from here**: this browser re-anchors at the current end, checks only what comes after, relies on no seal from before, and the owner seals again.

## What it cannot see

- Someone with full database access can disable the triggers and write a whole new chain that verifies. The witness catches that only in a browser that looked before the rewrite. (Editing the morals with the triggers off, without rewriting the chain, is caught by the replay.)
- Jacky's persona lives on the rig and cannot be fingerprinted from here; only the morals sent to it are checked.
- On-device answers (Bonsai in the browser) are generated where no function can see them. `jackie-device` builds and attests the prompt it hands the tab, so the page shows what the device was *given*; that the tab then ran it is the browser's own code, held to it by `src/test/jackie-device.test.ts`.
- Code that reports a false fingerprint about itself cannot be caught from inside the app. Git history and CI are the anchor for code, and `src/test/jackie-morals.test.ts` fails if an engine stops going through the guard.
- Agents with their own system prompt do not get the morals. Adding prose to a prompt that must answer in strict JSON breaks the agent. They are counted instead.

## Switching it on

The migration does not run itself:

```bash
supabase db push            # 20261010120000_jackie_morals_guard_rail.sql
# deploy functions (Lovable does this), then regenerate types if you want them typed:
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

Until then the page says it is not set up, and every engine answers on the base
persona and records `persona-without-morals` once the attestation table exists.
Then open `/morals`, add morals (or the suggested set), review the Persona tab,
and **Seal**. Everything after is measured from that seal.

## Rules for changing it

- No agent surface (`appActions.ts`, `appAgent*.ts`, `src/lib/mcp/`) may read or write the morals. An agent that can edit the rules binding it makes them suggestions. A test enforces this.
- A new engine that answers in Jackie's name calls `guardedSystemPrompt` and is added to `PERSONA_ENGINES`. A test walks `supabase/functions` and fails if the two disagree.
- The ledger hash is `sha256(prev_hash \n seq \n action \n payload)` in both SQL and the browser. `src/test/fixtures/morals-ledger.golden.json` was written by PostgreSQL and pins them together.
- The morals fingerprint is `sha256(buildMoralsBlock(...))` from `_shared/morals.ts`, computed by the engines on what they send and by the browser when it replays the ledger — one function, so the two cannot disagree about what a fingerprint means.
- A function that calls a model is either in `PERSONA_ENGINES` or named in the test's `NOT_JACKIE` list with what it is instead.
