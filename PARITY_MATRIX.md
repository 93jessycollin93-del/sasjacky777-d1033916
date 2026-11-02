# Parity Matrix

The living tracker `FLEET_PARITY_PLAN.md` §6 calls for. **Generated**, not hand-kept:
run `node scripts/gen-parity-matrix.mjs` to rebuild it from `src/lib/routeManifest.ts`
and `src/eru/routes.generated.ts`, so a renamed route changes this file in the same
commit instead of quietly making it wrong.

Last generated: 2026-09-27 · 48 native routes + 84 Eru modules.

## How to read the status column

| Status | Means |
|---|---|
| `native` | Built in this app, in TSX, on this app's own backend. |
| `via-embed` | Served by the embedded PC OS under `public/pc-os/`, framed by a route here. |
| `imported` | An Eru page ported into `src/eru/`, running on the shared shell. |
| `todo` | Named in the plan, not built here. |

Only Jackie's column is filled in: this repo can see its own routes and nothing else.
**Eru and PC columns need someone with those repos open** — that is the missing half of
this tracker, and pretending otherwise is what §6 was trying to avoid.


## Core

| Route | What it is | Jackie | Eru | PC |
|---|---|---|---|---|
| `/` | Home | native | ? | ? |
| `/workstation` | Workstation (the whole system, one flow) | native | ? | ? |
| `/guide` | Guide (how to use this app, answered on device) | native | ? | ? |
| `/path` | Path Router | native | ? | ? |
| `/core` | Jackie Core (owner only) | native | ? | ? |
| `/pc` | The PC | via-embed | ? | ? |
| `/pc-apps` | PC App Library | via-embed | ? | ? |
| `/repair` | Repair Bay | native | ? | ? |
| `/bridge` | Local Bridge (terminal + model vault) | native | ? | ? |
| `/play` | Play | native | ? | ? |
| `/craft` | CollinSurvivalCraft (Minecraft-style block building and survival) | native | ? | ? |
| `/hub` | Telegram Hub | native | ? | ? |
| `/tasks` | Task Board (everything you and your agents are working on) | native | ? | ? |
| `/tasks/calendar` | Task Calendar (tasks by the day they are due) | native | ? | ? |
| `/vault` | Vault | native | ? | ? |
| `/sandbox` | Sandbox | native | ? | ? |
| `/welcome` | Welcome (what this is) | native | ? | ? |
| `/auth` | Sign in | native | ? | ? |

## AI

| Route | What it is | Jackie | Eru | PC |
|---|---|---|---|---|
| `/bots` | Bot Foundry | native | ? | ? |
| `/swarm` | Bot Swarm | native | ? | ? |
| `/control` | Jackie Control | native | ? | ? |
| `/providers` | AI Providers | native | ? | ? |
| `/grok` | Grok Studio | native | ? | ? |
| `/forge` | Index Forge (craft your own micro-AI indexes) | native | ? | ? |
| `/agent-lab` | Agent Lab | native | ? | ? |
| `/agent-compare` | Agent Compare | native | ? | ? |
| `/local-ai` | Local AI Test (Ollama on this machine) | native | ? | ? |
| `/jacky-live` | Jacky Live | native | ? | ? |
| `/keys` | API Keys | native | ? | ? |
| `/micro` | Jacky Micro-AI | native | ? | ? |
| `/micro/board` | Micro-Model Board | native | ? | ? |

## Ops

| Route | What it is | Jackie | Eru | PC |
|---|---|---|---|---|
| `/gunit` | G-Unit Dashboard | native | ? | ? |
| `/gunit/bots` | G-Unit Bot Factory | native | ? | ? |
| `/gunit/chat` | G-Unit Chat | native | ? | ? |
| `/gunit/agents` | G-Unit Agents | native | ? | ? |
| `/gunit/users` | G-Unit Users | native | ? | ? |
| `/gunit/keys` | G-Unit API Keys | native | ? | ? |
| `/sphere` | Sphere Command | native | ? | ? |
| `/veilops` | VeilOps Threat Intel | native | ? | ? |
| `/apex` | Apex Hub | native | ? | ? |
| `/marvels` | Microscopic Marvels | native | ? | ? |
| `/pods` | eYe Pod Station | native | ? | ? |
| `/pods/surface` | Fold Surface (merged seeds) | native | ? | ? |
| `/mesh` | Router Mesh | native | ? | ? |
| `/mesh/docs` | Router Mesh Docs | native | ? | ? |
| `/nervous` | Nervous System (impulses + filing cabinet) | native | ? | ? |
| `/github` | GitHub Sync | native | ? | ? |

## Eru

| Route | What it is | Jackie | Eru | PC |
|---|---|---|---|---|
| `/eru/visualizers` | Visualizer Lab | native | ? | ? |

## Eru modules

84 pages are mounted under `/eru/*` from `src/eru/routes.generated.ts`,
all `imported`, all rendering (`npm run smoke`). They are listed there rather than
repeated here — that file is generated from Eru's own App.jsx and is the authority.

## What this tracker cannot tell you

- **Whether an imported page works against a real backend.** `npm run smoke` proves each
  renders; it does not prove Base44 or Supabase answers it.
- **Feature-level parity.** This is a route census. The per-app checklist §6 describes needs
  `FEATURE_AUDIT.md`, which is not in this repo.
