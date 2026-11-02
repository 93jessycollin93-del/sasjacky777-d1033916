# Mission Plan — SAS-JACKY and the fleet around it

The long-range plan: where SAS-JACKY is, what every other repository is for,
and the order the work goes in. Written 2026-09-27 from a survey of all 23
repositories attached to the session and a full run of this repo's suites.

**Multi-layered** just means the plan is stacked like floors of a building.
Each layer rests on the one below it, so the order matters: a lower floor that
wobbles makes everything above it wobble. You can stand on any finished floor
and it holds — you never have to finish the whole tower to have something
that works.

---

## Layer 0 — Ground truth: where we actually stand

Measured, not remembered:

| Check | Result |
| --- | --- |
| `npx vitest run` | **1,248 passed**, 78 files, 0 failed |
| `python3 -m pytest` | **333 passed**, 1 skipped |
| `npx tsc --noEmit -p tsconfig.app.json` | clean |
| Routes | 45 native + 84 Eru modules; `npm run smoke` last recorded 133/133 rendering |
| Edge functions | 41, all behind the shared gate (rule 2, enforced by a test) |
| Migrations | 36 |

The mothership is healthy. The problems are not in its code; they are in what
surrounds it:

1. **Copies.** SAS-JACKY exists in at least five repositories. `sasjacky777` is
   a strict, older subset of `sasjacky777-d1033916` — every file it has, this
   one has, except `src/vault/mockData.ts`, which this one deleted on purpose.
   `sas-jacky2`, `SAS_JACKY_X` and `ocd-jacky-777-forked` also exist on the
   account and were not reviewed. Every copy is a place where a fix can land and
   never reach the app you use.
2. **Furniture.** `/sentinel` and `/sentinel/board` still render 624 lines of
   fixtures from `src/sentinel/lib/mockData.ts`. `docs/FEATURE_AUDIT.md` named
   this; it is still open. A page full of plausible rows that come from nowhere
   is rule 8 broken at the scale of a whole feature. *(Closed by mission 2.1:
   Sentinel is removed.)*
3. **The missing engine.** `yyb84ycgt6-oss/jacky` — the Flask engine the Jacky
   Engine and Ollama Host stations probe — is not attached to this session, so
   nothing here can see or test it. `FLEET_PARITY_PLAN.md` calls a shared
   `jackyClient` "the unlock" and it has no home repo to be verified against.
4. **Declared stations.** Six stations (llama.cpp, LLMFarm, MobileRun, Xagent,
   Off Grid Mobile, MobileLLM) are honestly marked `declared`, not `live`. That is
   correct today and is the frontier for Layer 3.

---

## The fleet: what every repository is for

Every repo gets exactly one role. A repo with no role is how sprawl happens.

| Role | Meaning |
| --- | --- |
| **Mothership** | Where the product lives. Everything else feeds it. |
| **Donor** | Has something worth moving in. Once moved, archive it. |
| **Station** | A separate program that stays separate, linked through the Constellation. |
| **Engine** | Someone else's project we run and integrate with through an adapter. Never edit its core. |
| **Reference** | Reading material. Nothing ships from it. |
| **Retire** | Superseded. Archive on GitHub (read-only, nothing lost). |

| Repository | Role | What to take, and where it goes |
| --- | --- | --- |
| `sasjacky777-d1033916` | **Mothership** | SAS-JACKY. The `SAS-JACKY` branch is the trunk. |
| `sasjacky777` | **Retire** | Strict subset of the mothership. Archive it. |
| `sas-jacky2`, `SAS_JACKY_X`, `ocd-jacky-777-forked` | **Review → Retire** | Diff each against the mothership first; port anything unique, then archive. |
| `jackie-core-keeper` | Donor | Pages the mothership has no route for: `Tasks`, `TaskBoard`, `TaskCalendar`, `SecretsAudit`, `Files`, `Setup`. Functions: `hydra-coder`, `tool-exec`, `compress-pod`. Each goes through the gate (rule 2) and `appActions.ts` (rule 9) on the way in — not copied as-is. |
| `Jacky-Console-` | Donor | Older ancestor; everything it has is already here or in `jackie-core-keeper`. Confirm, then retire. |
| `mind-garden-explorer` | Donor | `GraphView` (a map of how memories connect) and the `DailyCheckinWidget`. Its `compression-bridge.ts` is superseded by `context-condenser/`. |
| `signal67`, `relational-compass` | Donor | The density-slider UI: a person choosing how hard to compress. That is a good front end for `context-condenser`; the local "compressor" underneath is a stop-word filter behind a fake delay and should not come across. |
| `remix-of-jackie-s-compass` | Donor → Retire | Offline chat on `localStorage` — the mothership's offline partitions already do this better. |
| `core-light-vault` | Donor → Retire | Knowledge-vault UI; the mothership's Vault is real now (`docs/VAULT.md`). |
| `clever-memory-bot` | Donor | The docs-site layout (`DocsSidebar`, `DocsContent`) — a home for `/guide` long-form docs. |
| `smart-filing-automaton` | Station | The auto-organiser for the D:\ hub. Its profile/category model maps onto the Vault's partitions; link it as a station, share the category schema. |
| `AI-Data-Analist` | Station | Ethereum value and mining economics — pure, tested libraries. A candidate Maker-squad tool. |
| `task-manager-enhanced` | Donor | One file; fold into the task board port above. |
| `my-pc-companion` | Station | The PC, embedded at `/pc`. `public/pc-os/` was last touched by a merge on 2026-09-16; the PC repo's newest commit is 2026-09-06 ("Added real desktop app shell"). A merge date is not a build date, so confirm that commit is what the embed holds. |
| `spatial-desktop` | Station | Rust surfaces-with-holes desktop layer. Long-range: Jackie's windows as surfaces on the real desktop. |
| `llama.cpp` | Engine | Already powers the `device` rung in the browser (`docs/ON_DEVICE.md`). Track upstream; don't patch. |
| `llmfarm` | Engine | iOS runner for the same GGUF models — Jackie's phone rung. |
| `mobilerun` | Engine | LLM agents driving Android/iOS. Future Field-stage station: Jackie operating a phone. |
| `xagent` | Engine | DAG plan-execute agent runtime. Compare against `Jackie/core/engine/`; borrow patterns, don't merge codebases. |
| `pi-web` | Engine | A web UI that keeps coding agents running in real workspaces. Candidate harness next to Hermes and DeepSeek (`docs/HARNESSES.md`). |
| `terraform-google-cloud-storage` | Reference | If the online sync hub ever needs off-device backup buckets, this is the module. Not before. |
| `the-book-of-secret-knowledge` | Reference | Ops and security cheat sheets. |
| `jacky` *(not attached)* | **Engine — critical** | Attach it to the next session. Layer 2 depends on it. |

---

## Layer 1 — One ship (consolidate)

**Why first:** every later layer adds code. Adding code to one of five copies is
work that has a four-in-five chance of landing somewhere you will not look.

| Mission | Done when |
| --- | --- |
| 1.1 Archive `sasjacky777` on GitHub (Settings → Archive). | It is read-only; nothing is deleted. |
| 1.2 Diff `sas-jacky2`, `SAS_JACKY_X`, `ocd-jacky-777-forked` against the mothership; list anything unique. | A table of unique files per repo exists, or "none". |
| 1.3 Port the donor pages from `jackie-core-keeper` one at a time, through `appActions.ts` and the gate. Task board first: the MCP tools already manage tasks and no screen shows them. | Each port has a route in `routeManifest.ts`, a test, and passes `/verify`. |
| ✅ 1.3a **Task board** — `/tasks`, 2026-09-27. Four columns including Blocked (the donor had three); reads and writes through `appActions.ts`; a refused move puts the card back and says why. `create_task` gained a `status` so a card lands in its column in one write. Remaining donor pages: `TaskCalendar`, `SecretsAudit`, `Files`, `Setup`. | Done. |
| ✅ 1.3b **Task calendar** — `/tasks/calendar`, 2026-09-27. The donor keyed days by the raw timestamp and so showed every day empty against this database; days now come from the board's `dueDay`. Late work and undated open work are listed, not hidden. Board and calendar share one data hook (`useTasks`). The chat's `/task list` and Jackie's task context now rank medium above low. Remaining donor pages: `SecretsAudit`, `Files`, `Setup`. | Done. |
| 1.4 Retire each donor once its useful part is in. | The Fleet table above has no "Donor" rows left. |

## Layer 2 — Nothing fake (make the furniture real)

**Why second:** a system you are going to trust with your memory and hardware
has to be honest about itself before it gets bigger.

| Mission | Done when |
| --- | --- |
| 2.1 Decide what Sentinel watches. Candidates that already produce real data: the audit log, the edge-function logs, the API-key usage table. Until decided, remove it from the nav. | `src/sentinel/lib/mockData.ts` is deleted, like the Vault's was. |
| ✅ 2.1 **Sentinel taken out** — 2026-09-27. The owner's call: nothing real to watch yet, so it goes rather than shows fixtures. The sidebar link, both routes, both pages and all of `src/sentinel/` are deleted (git history keeps them); the old URLs reach the not-found page. Bringing it back starts from deciding what it watches. | Done. |
| 2.2 Attach `jacky`, write `jackyClient` once, shared by the chain's first link, `/workstation` and the PC embed. | The Jacky Engine station reports `live` from a real `/api/status`, with a test for the unreachable case. |
| 2.3 Regenerate `PARITY_MATRIX.md` and fill in the PC column from `my-pc-companion`. | No `?` left in the PC column. |

## Layer 3 — The whole constellation (connect the stations)

**Why third:** stations are only worth connecting once the thing they connect to
is single and honest.

| Mission | Done when |
| --- | --- |
| 3.1 Confirm the PC embed matches `my-pc-companion`'s latest build, refreshing it if not (`docs/PC_EMBED.md` has the steps), and record the PC commit the embed was built from. | The embed names its source commit, and it is the PC repo's newest. |
| 3.2 Promote one `declared` station to `live`: LLMFarm or llama.cpp's server, probed over LAN like Ollama. | Constellation shows it live with a real probe; the rest stay honestly declared. |
| 3.3 `pi-web` as a third harness beside Hermes and DeepSeek, over the same MCP server. | `harness/e2e/run.sh` drives the app from it. |
| 3.4 `smart-filing-automaton` shares one category schema with the Vault partitions. | A file dropped in the hub's inbox is visible in the Vault with the same category. |

## Layer 4 — Chaos with coherence (the far side of the box)

This is the layer the plan is named for, and it is a real engineering discipline,
not a slogan: **chaos engineering** — breaking your own system on purpose, under
control, to prove it survives the breakage it will meet anyway.

SAS-JACKY is unusually suited to it. Its whole design is a fallback chain
(Jacky → Bionic → Ollama → cloud), a predictive router, self-healing partitions
and squads that must admit when they are grounded. All of that is *claimed*
resilience until something knocks an engine over and watches.

| Mission | Done when |
| --- | --- |
| 4.1 A chaos switch, owner-only and dev-only: `src/lib/chaos/` injects named faults into the chain — engine down, stream cut mid-token, 500 with no CORS headers, quota exhausted, a corrupt partition record. | Each fault is one line to enable and off by default, asserted by a test. |
| 4.2 A test per fault, asserting the rules, not the happy path: the next engine answers (rule 5), Jackie's persona survives the handoff (rule 6), and the screen says which engine failed and which answered (rule 8). | `npx vitest run src/test/chaos*` passes with every fault on. |
| 4.3 A **Chaos Drill** panel on `/workstation`: run a drill, watch the flow block, reroute and recover live, with the log of what happened in plain words. | The owner can run a drill and read the result without opening a console. |

The *coherent awareness* part is the rule every drill enforces: the system is
allowed to fail; it is never allowed to fail silently.

## Layer 5 — How we talk (the symbiosis layer)

The code already has rules. The collaboration needs some too, so that a human
learning as they go and agents working across sessions stay aligned.

- **Plain words first.** Every doc opens with what the thing is for in one
  sentence a non-engineer can read, before any jargon. The "multi-layered"
  paragraph at the top of this file is the model.
- **Not knowing is data.** "I don't understand X" is a request to add X to the
  glossary below, never a failure. Same for agents: an agent that does not know
  says so (rule 8 applies to people's understanding too).
- **Every decision leaves a note.** When a mission is done, tick it here in the
  same commit, with one line of why. This file is the shared memory between
  sessions; a plan that is not updated becomes another piece of furniture.
- **One question per round.** When an agent needs a decision, it asks one
  specific question with a recommended answer, not a survey.

### Glossary

| Word | Meaning here |
| --- | --- |
| Fallback chain | The order of AI engines Jackie tries. If one is down, the next answers. |
| Edge function | A small program on Supabase's servers that the app calls — e.g. to reach a cloud AI. |
| Gate | The check every edge function runs first: who is asking, and are they allowed. |
| RLS | Row-level security. The database itself refuses to show you someone else's rows. |
| Offline-first | The app works with no internet; the internet is only for syncing and downloads. |
| Station | One program in the fleet, shown on `/workstation` with a live check. |
| Declared | A station we know exists but the browser cannot check (e.g. an iPhone app). |
| Chaos engineering | Breaking your own system on purpose, safely, to prove it recovers. |
| Furniture | A screen that looks working but shows made-up data. |

---

## The next three moves

1. **You:** archive `sasjacky777` on GitHub, and attach `jacky` to the next
   session. Both are decisions only the account owner can make.
2. ~~Mission 1.3 — the task board and calendar.~~ Done. Next port: `SecretsAudit`,
   which has to be checked against `SECURITY_HARDENING.md` before a line of it moves.
3. ~~Mission 2.1 — decide what Sentinel watches, or take it out of the nav.~~ Taken
   out. **Then:** mission 2.2, which waits on `jacky` being attached.
