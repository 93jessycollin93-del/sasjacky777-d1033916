# The Constellation

One flow across every repo, offline first.

## The problem this closes

The system was seventeen repos and about forty routes, and nothing anywhere
could answer two questions a person actually has: *what is this made of*, and
*what of it is running right now*. Each surface knew its own corner. The map
lived in someone's head, which meant a station that had quietly stopped working
stayed broken until somebody went looking.

`/workstation` is that map, made of live checks instead of memory, with one next
step at the top of it.

## The walk

Four stages, in the order they have to hold:

| Stage | What it establishes | Gated by |
|---|---|---|
| **Ignition** | The shell is up and the device granted room to hold the system offline | `jackie-shell`, `partitions` |
| **Core** | Identity, vault, and the engine that decides where work runs | `vault` |
| **Workstation** | The desk: the PC, the foundry, the mesh, the pods | `workstation-pc` |
| **Field** | Everything that runs away from this screen — hosts, phones, agents | nothing (declared) |

A stage is blocked when a station marked `required` did not answer a check. The
flow does not advance past a blocked stage, and the next action points at the
blocker rather than at the desk. `resolveFlow` is pure — statuses in, flow out —
so the refusal to advance is a unit test, not something you have to unplug a
machine to see.

## The stations

Declared once, in `src/lib/constellation/stations.ts`, and checked against the
route manifest by `src/test/constellation-stations.test.ts` so an in-app station
can never point at a route the router does not serve.

| Station | Repo | Offline | How it is checked |
|---|---|---|---|
| Jackie | `sasjacky777-d1033916` | full | in-app |
| Offline Partitions | `sasjacky777-d1033916` | full | `navigator.storage.estimate()` against the partition floors |
| Vault | `core-light-vault` | full | in-app |
| Core Keeper | `jackie-core-keeper` | full | in-app |
| Jacky Engine | `jacky` | sync | `jacky-proxy → /api/status` |
| Jacky Console | `Jacky-Console-` | sync | in-app |
| The PC | `my-pc-companion` | full | `GET /pc-os/index.html` |
| Bot Foundry, Router Mesh, Pod Station | `sasjacky777-d1033916` | sync / full | in-app |
| Ollama Host | `jacky` | full | `GET localhost:11434/api/tags` |
| Off Grid Mobile, LLMFarm, MobileLLM, llama.cpp, MobileRun, Xagent | own repos | full / sync | **declared** |

`declared` is not a soft `live`. It means real, named, and not observable from a
browser — an iOS app, an Android driver, a C++ library. Reporting those as live
because the repo exists would be a lie the panel then repeats every time it
loads, so the probe refuses to make it and the flow never counts them as
running.

## Offline is the product

Online is a sync-and-download hub. Nothing in the walk depends on it: every
`required` station is `offline: "full"`, asserted by a test, so the flow cannot
become online-only by accident.

### Partitions

Six partitions, declared in `src/lib/partitions/registry.ts`, each owning one
purpose and reserving its own share of the device budget up front:

| Partition | Floor | Tier | Backups | Router |
|---|---|---|---|---|
| Vault | 64 MB | critical | 5 | keeper |
| Model Bay | 1200 MB | critical | 1 | operator |
| Context Store | 256 MB | critical | 3 | recall |
| Conversations | 128 MB | standard | 5 | recall |
| Pod State | 64 MB | standard | 3 | maker |
| Media Cache | 32 MB | standard | 1 | maker |

`planBudget(mb)` divides a real quota: critical floors first, then standard
floors, then the surplus by weight. A device that cannot cover the critical
floors comes back `viable: false` with the short partitions named — and the
ignition stage blocks on it, rather than letting you download a model into a bay
that cannot hold one.

Every write carries an FNV-1a checksum. A read whose body no longer matches
throws instead of returning damaged content, and `heal()` restores from the
newest backup whose own checksum still verifies, then re-verifies and reports
whether it actually worked. A heal that could not fix it says so.

Backups live beside the records they copy, under a reserved key prefix, so a
restore needs no network and cannot be stranded by a device that dropped one
database and kept another.

**A backup never captures damage.** `backup()` verifies before it copies and
refuses a partition holding a bad record. This is not defensive padding — the
first version copied first and verified second, and a test caught what that
costs: copying a corrupted record produces a backup that is itself perfectly
valid (its checksum covers the damaged body), so the next restore hands the
damage straight back, and the rotation pushes the last good copy out to make
room for it. Restore is guarded from the other side too: a copy that is intact
as a file but holds records failing their own checksums is skipped, and an
older one is tried.

### Sync

`runSync` takes steps that each declare whether they need a network, and skips —
does not fail — the network ones when there isn't one. The order is fixed: back
up, verify and heal, *then* talk to the network. A sync that fetched first could
overwrite good local state with bad remote state and have nothing to go back to.

The backup step names any partition it passed over as damaged, so a sync that
copied less than the whole system says so rather than reporting a clean run.

## Squads and predictive routing

The routers used to answer the same question on every request: probe every
engine, walk the ladder, pick one. That is a full recalculation to arrive,
almost always, at the answer it had a second ago — work spent proving nothing
changed. And a squad of four routers paid for it four times.

Two pieces fix that.

**One look, shared.** `WorldObserver` owns availability. It takes a real look
when there is reason to — first time, window lapsed, connectivity flipped, or
asked to — and otherwise hands back the one it has. Connectivity flipping always
forces a fresh look, because that is exactly when the cached answer is most
likely wrong. `looks` and `reuses` are counted, so the saving is a number on the
page rather than a claim in a comment.

**Plan once, then watch.** `planPath` derives a route *and the short list of
conditions that would make it wrong*:

| Invariant | Breaks when |
|---|---|
| `engine-ready` | the chosen engine stops answering |
| `no-better-engine` | something the router ranks higher comes up |
| `engine-absent` | anything usable appears, for a plan that had no path |
| `online` | connectivity flips |

Afterwards `checkPlan` evaluates those — a handful of set lookups — instead of
re-deriving. `no-better-engine` is the one that earns its keep: watching only
"is my engine still up" would hold a plan on a LAN engine forever while the
device engine came back. Predicting the optimal path means noticing when a
better one opens, not only when the current one closes.

Measured: ten questions against an unchanged world cost **one** probe and
**one** derivation. The other nine are set lookups. That is a test, not an
estimate — `src/test/squad-units.test.ts`.

### The units

| Squad | Doctrine | Lead + support | Formation |
|---|---|---|---|
| **Recon** | Find out what is true right now | recall + operator | lead-and-support |
| **Armory** | Get a model running inside the budget | operator + recall | lead-and-support |
| **Vault Guard** | Identity, keys, backups — never leaves the device | keeper | lead-and-support |
| **Workshop** | Build the thing, with what was built before as reference | maker + recall + operator | relay |

A squad is operational only when its **lead** has a path. Support that cannot
reach an engine degrades the answer; a lead that cannot reach one means there is
no answer to degrade. Reporting a squad ready on two of three members is the
kind of green light that gets acted on and then fails.

Vault Guard is never reached by fallback, only by explicit match — a task
landing there by accident would be asking the strictest unit in the system a
question it was not meant to hold.

`SquadCommander` carries one plan per router across every unit that fields it.
Recall sits in both Recon and Workshop; two copies of its plan would be two
chances to disagree about which engine is answering, surfacing as one unit
reporting ready and the other grounded, on the same router, at the same instant.
The first version derived per unit, and a test caught it — `planAllSquads` now
carries plans forward through the pass, so a router derives once and later units
hold it.

## Crew

`src/lib/constellation/integrations.ts` holds the roster: seventy-odd tools
across nine areas, one specialist per area rather than one tool stretched over
all of them, and a priority stack of fifteen brought in first.

The useful half is `buildCompatibilityReport`, which names the exact capability
each tool is missing. `capabilitiesFrom` derives that environment from the
constellation's own sweep — `localOllama` because a probe got a model list back,
`python`/`gpu`/`cloudProxy` because the Jacky engine answered and reports GPU
thermals. What a browser cannot observe (Docker, Node, a VS Code extension host)
defaults to false and must be supplied by the host. A capability is claimed on
evidence or not at all, because being wrong costs a failed start.

Requirements are typed as `keyof EnvironmentCapabilities`, so a misspelt
requirement is a compile error rather than a tool that reports itself compatible
because nothing in the environment matched its typo.

## Micro-AI context routers

A micro model is small enough to run on the device and too small to know
everything, so the unit is a model *plus the slice of storage it is expert in*.
Four routers, in `src/lib/microai/contextRouter.ts`:

| Router | Specialty | Reads | Ladder |
|---|---|---|---|
| **Recall** | What was said, decided or stored before | context, conversations | device → LAN → network |
| **Keeper** | Identity, keys, vault records | vault | device only |
| **Operator** | Running models and reading the machine | models | device → LAN |
| **Maker** | Building pods, images, audio, surfaces | pods, media | device → LAN → network |

Each router's `reads` is derived from the partition table rather than written
twice, so the two cannot drift.

`selectEngine` walks the ladder and returns nothing at all rather than reaching
for a network engine while offline. Keeper has no network rung at any
connectivity — vault context does not leave the device, and the test asserts the
engine that comes back, not that a check was performed.

## Where things live

```
src/lib/constellation/
  types.ts      the Station and StationProbe contracts
  probes.ts     the four ways a station can be checked
  stations.ts   the station table + the real boundaries
  flow.ts       resolveFlow — pure, the four-stage walk
  service.ts    owns statuses, runs sweeps, projects a snapshot
  sync.ts       runSync — offline-tolerant step runner
  steps.ts      the real steps, wired to the services
src/lib/partitions/
  types.ts registry.ts store.ts service.ts budget.ts index.ts
src/lib/microai/contextRouter.ts
src/pages/Workstation.tsx   the View: observes, dispatches, decides nothing
src/hooks/useConstellation.ts
```

## Adding to it

- **A station**: one entry in `stations.ts` with a probe. No caller changes.
- **A partition**: one entry in `registry.ts`. Its router picks it up for free.
- **A new kind of check**: a new probe in `probes.ts`. The service does not
  learn about it.

## Hosting itself

`host/` is an attachment: drop the folder beside a build and run it.

```sh
npm run host          # or: node host/serve.mjs ./dist
```

No dependencies, no install, no network, one file. A system whose claim is that
it works with the radio off cannot depend on a hosting service being reachable,
so the last piece of the offline story is the product serving itself from disk.

It registers as the `self-host` station and is probed like anything else, via
`GET /__host/health`. Absent is the ordinary answer when the app is behind some
other server; it is optional and never blocks the walk.

The decisions that can be wrong quietly are pure functions exported from
`host/serve.mjs`, and `src/test/host-attachment.test.ts` imports that same file —
no second copy to drift:

- **Path traversal is refused, not rewritten.** The `..` check runs on the
  decoded path and *before* normalization. Checking before decoding misses
  `%2e%2e`; checking after normalizing misses everything, because `normalize`
  turns `/../../etc/passwd` into `/etc/passwd` — the segments are gone by the
  time you look. A test caught exactly that, and the guard moved.
- **A traversal never falls back to the shell.** 200 with the app shell reads as
  success to anything probing.
- **`sw.js` is `no-store`.** A worker cached for a year cannot be replaced, and
  the app is frozen at that build on every device that loaded it.
- **`/pc-os/` falls back to its own shell**, not Jackie's, or the PC cannot start
  in its own tab offline.
- **Range requests are served**, because model weights are gigabytes and a
  resumed download must not start over.

Verified live against a real build: SPA fallback 200, missing asset 404, raw
traversal 404 with `--path-as-is`, `sw.js` `no-store`, and a 206 with a correct
`content-range`.

## Localization

Six languages as a first-class layer, not a wrapper over English.

### What was there before

Three i18n systems that did not know about each other, and one of them did not
work at all:

- `src/game/i18n.tsx` did `const translations = en` and exposed a `setLocale`
  documented as a no-op. Beside it sat `ru.ts`, `uk.ts` and `zh.ts` — written,
  complete, and unreachable. `LanguageSwitcher` was `return null`. So there were
  four language files, a language switcher, and no way to change language, and
  none of that was visible without reading three files together.
- Eru had its own provider — a good one — with its own locale state, its own
  storage key, and its own writes to `<html lang>`.
- Nothing else was localized.

All three now read one service. Eru keeps its own catalogs; the bridge maps the
tags the two spell differently (`zh` against `zh-Hans`) and migrates a choice
saved under the old key, so nobody's language is lost by the change.

### Plurals, which is where this usually breaks

English has two forms. Russian and Ukrainian have four, and the rule is not
"large numbers differ": **21 is `one`, 11 is `many`, 22 is `few`, 12 is `many`,
and 1.0 is `other`.** A message written with `one` and `other` renders "5
станция" forever, in a build whose tests passed because they were written in
English.

`Intl.PluralRules` *is* the CLDR table, so it is used rather than restated. The
work here is making the failure impossible: `auditCatalog` asks the runtime
which categories a locale requires and fails the build when a message does not
supply them.

That audit caught two real omissions in this repo's own catalogs. Modern CLDR
gives **Spanish and French a `many` category** for exact millions, because both
languages genuinely change there — "un millón **de** registros", "un million
**d'**enregistrements". Both were missing. No reviewer of six languages would
have caught it by eye.

### What the audit blocks

| Issue | Why it must not ship |
|---|---|
| `missing-plural-category` | Renders grammatically wrong text on every count |
| `placeholder-mismatch` | A dropped `{count}` renders a literal brace to the user |
| `untranslated` | Counted, not blocked — some strings are correctly identical |
| `expansion-risk` | Advisory: a string far past its predicted length will overflow |

`LOCALE_SPECS` carries expansion factors as measured data — Chinese runs ~40%
short, Slavic ~15% long — so overflow is flagged before a device shows it.

### Decisions worth naming

- **Ukrainian never falls back to Russian.** A technically convenient fallback
  that a large part of the audience reads as a political one. It falls to
  English.
- **A fallback string renders with the plural rules of the language it came
  from**, not the one requested — otherwise a French string reached by fallback
  is selected against Russian's table.
- **Currency is never inferred from the interface language.** A French user
  paying in USD must see dollars; showing euros because their UI is French is a
  financial error, not a preference.
- **The picker lists every language in its own name.** "Ukrainian" is useless to
  someone who reads only Ukrainian.
- **A missing key renders as the key**, which is ugly and therefore gets fixed —
  unlike an empty string, which looks like a deliberately blank label.

## Not in the constellation

`awesome-go`, `awesome-selfhosted`, `terraform-google-cloud-storage`,
`task-manager-enhanced` and `SAS_opencode_Ai` are in the same account but are not
part of this system — upstream lists, unrelated infrastructure, and a separate
editor. They are left out on purpose rather than listed to make the map look
fuller.
