# What actually works, and what only looks like it does

An audit of every route and every feature area, run because "some don't
function as they should, some don't seem to want to render" is two different
complaints and they need two different instruments.

Rendering was measured with `npm run smoke`, which opens all 133 routes in a
real browser against a real build and fails on an uncaught exception or a
console error. Function was measured by reading each area for whether anything
it displays comes from a real source.

---

## Rendering: 133/133, after one fix

Every route comes up. One did not, and it had been failing quietly:

**`/marvels`** — six `<path> attribute d: Expected moveto path command ('M' or
'm'), "undefined"` errors on mount, one per racer.

The tail of each racer was a `motion.path` keyframing the `d` attribute. Framer
Motion has no interpolator for `d` — it is a path grammar, not a number or a
colour — so on the frames before it gave up it wrote the literal string
`"undefined"` into the attribute. The tail still waved once the animation
settled, which is exactly why this survived: the errors were transient and the
end state was correct, so nothing looked wrong unless you had the console open.

Fixed by animating with SVG's own `<animate>`, which interpolates `d` natively
when the keyframes share a command structure — as these do, differing only in
the control points that flip the wave. `npm run smoke` is now 133/133.

### Pages that look empty and are not

Three routes render very little text and are all working as designed. Recording
them so they are not "fixed" by someone reading the same numbers later:

| Route | Text | Why |
| --- | --- | --- |
| `/pc` | 46 chars | An iframe around `public/pc-os/`. All its content is inside the frame, where a text count cannot see it. |
| `/local-ai` | 68 chars | Genuinely a small form — model, prompt, run. |
| Most `/eru/admin/*` | 100–200 chars | Empty states. The smoke run has no backend, and a page that renders its empty state offline is working. |

---

## Function: two areas are furniture

These render perfectly, are listed in the nav, and show populated screens. None
of what they show is real. This is the harder failure, because a blank page
tells you it is broken and a page full of plausible rows does not.

### The Vault — `/vault`

Four pages — `VaultDashboard`, `LibraryScreen`, `QueueScreen`, `OutputReview` —
render `MOCK_MEDIA_ITEMS`, `MOCK_JOBS` and `MOCK_OUTPUTS` from
`src/vault/mockData.ts` (176 lines of fixtures: "Podcast Season 2" and
friends). There is no `supabase`, no `callEdgeFunction`, not even a
`localStorage` call anywhere under `src/vault/`. Nothing you do there persists,
and nothing you see there exists.

What is real, and worth keeping: `src/vault/services.ts` is 156 lines of sound,
pure logic — file validation with size and MIME limits, link classification
into authorized-source versus external-reference, output filename derivation,
library filtering by tab, search and tags. It is correct and it is testable.

What is missing is both ends: nothing stores a media item, and
`conversionService.createJob` builds a job object that no worker ever picks up.
There is no ffmpeg, no edge function, no queue. A job is created with
`status: 'waiting'` and waits forever.

**Built.** See `docs/VAULT.md`. It went local rather than server-side: blobs and
metadata in IndexedDB, conversion through ffmpeg compiled to WebAssembly, on the
machine that already holds the file. `mockData.ts` is deleted, and `services.ts`
— which was always sound and simply never called by anything that stored a
result — is unchanged.

### Sentinel — `/sentinel`, `/sentinel/board`

**Removed** (2026-09-27, `docs/MISSION_PLAN.md` mission 2.1). `src/sentinel/lib/mockData.ts`
was 624 lines of incidents, wallets, clusters and trace paths, and
`SentinelDashboard`, `SentinelBoard` and `RelationshipGraph` read it directly —
there was no fetch of any kind in `src/sentinel/`, so the fixtures *were* the
model. Nothing real had been chosen for it to watch, so the pages, the routes
and the sidebar link went, rather than keep a screen of plausible rows that came
from nowhere. The old URLs now land on the not-found page. It is all in git
history (the commit that removed it) for when there is something real to watch:
the audit log, the edge-function logs and the API-key usage table are the
candidates that already produce data.

---

## Everything else

The chat, memory, tasks, tags, files and archive are real and covered by
tests. The engine chain is real (`docs/CHAT_PIPELINE.md`). The micro-AI context
routers are real and run against Ollama and LM Studio. `jackierouter/` and
`context-condenser/` are real with 152 and 42 tests.

The `device` rung — which this audit originally recorded as an honest gap,
because the routers declared a `device` → `lan` → `network` ladder and only the
LAN rungs existed — is now implemented by `src/lib/microai/deviceEngine.ts`:
Bonsai 1.7B running in the tab through llama.cpp compiled to WebAssembly, off
the GGUF the repository already ships. See `docs/ON_DEVICE.md`.

---

## The rule this audit exists to enforce

CLAUDE.md rule 8 says never report success when nothing happened. A page that
renders fixtures is that rule broken at the level of a whole feature: it
reports, continuously and convincingly, that a system is working when no such
system has been built.

Fixtures are fine while a thing is being built. They are not fine in the nav.
