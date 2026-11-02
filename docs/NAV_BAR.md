# The nav bar, and SANDi on it

One bar, on every screen, customisable per person, in liquid glass. It is the
part of the app that keeps a large system manageable: everything is reachable
from it, and nothing is on it that you did not choose.

## Why one bar

There were four, stacked in the corner: the main nav, the Guide, the notes
toolbar and the Index Pill. Each was draggable on its own, each saved its
position under one key shared by everyone on the machine, and three of the main
nav's buttons did nothing — the bell had no action, search wrote to the console,
and "expand" opened four boxes labelled Pod Mini-Map, Agent Pulse, Task Queue
and System Health with nothing behind them.

The bar that replaced them is a port of Cybernetic's (Eru's
`src/eru/components/CenteredBottomNav.jsx`), which was the best-liked part of
that app. What each old bar did is now a button on it.

## Using it

| To | Do |
| --- | --- |
| Move it | Press and hold anywhere on it for half a second, then drag. A quick press is still a click. |
| Choose what is on it | The pencil. Tap pages and widgets on or off; search if you know the name. |
| Stack it | The number button cycles 1–4 rows (or columns, when vertical). |
| Turn it | The arrow button switches horizontal and vertical. |
| Shrink it | The round button cycles labels → icons only → control strip only. SANDi stays in all three. |
| Go anywhere, or ask | SANDi, or Ctrl+K (⌘K on a Mac) from any screen. |
| Put it back | Editor → Reset position. |

The layout is saved per account on this device (`jackie.navbar.v1:<user id>`).
Two people sharing a browser each get their own bar; signed-out visitors get one
of their own. If the browser refuses to save, the bar says so once rather than
quietly resetting on the next reload.

## What it can hold

`src/lib/navBar/catalog.ts`. Three sections:

- **Jackie** — the app's own pages, the common ones with chosen icons first.
- **Eru** — Cybernetic's forty-two pages, at `/eru/…`, then every other Eru module.
- **The PC** — every app in the embedded PC, opening straight into it.

Everything past the hand-picked list is **discovered** from the route manifest
and the PC roster, so a page added to the app can be pinned the day it lands.
`src/test/nav-bar.test.ts` fails if any route is unpinnable or any entry points
at a route the router does not serve.

Widgets — Guide, Notes, Voice — are switches in the editor, and ride on the bar
when on. A widget that cannot work here (notes while signed out, voice in a
browser with no speech voices) says why instead of offering a dead switch.

## SANDi

The index router. It grew out of the Index Pill (`INDEX_PILL.md`), and does what
the pill did, then keeps going where the pill stopped:

1. **Go.** A command — "Open Vault" — matched against the route manifest and
   the commands your crafted indexes declare. It moves the app at once: no
   model, no network, no wait.
2. **Your index.** A question one of your own indexes (made in the Forge)
   claims by keyword goes to it, on the engine ladder it declares.
3. **A specialist.** Anything else goes to one of the four built-in micro
   routers — Recall, Keeper, Operator, Maker — each a small model paired with
   the slice of local storage it knows. The pill answered "no index crafted yet"
   here; the specialists were built and tested and only ever counted.

The **extra weights** are the ladder a specialist climbs: the weights on this
device first, then a bigger model on a LAN runner (LM Studio, Ollama), then the
network — each only if that specialist allows it. Keeper allows the device
alone, because vault context does not leave the machine. The panel shows, before
you press Enter, which specialist will take the question and which rungs of its
ladder are ready (✓), down (✗), offline, or not configured (—).

`src/lib/sandi/plan.ts` decides; `src/test/sandi-plan.test.ts` holds it to that.

## Where things live

```
src/components/nav/JackieNavBar.tsx   the bar and its Customize sheet
src/components/nav/SandiPanel.tsx     SANDi
src/components/nav/GuidePanel.tsx     the Guide, opened from the bar
src/components/GlobalStickyNotes.tsx  the notes, and the provider the bar reads them through
src/lib/navBar/catalog.ts             every page and app it can hold
src/lib/navBar/prefs.ts               one person's layout
src/lib/sandi/plan.ts                 where SANDi sends what you type
src/index.css  .liquid-glass          the look, from the theme's own tokens
```

## Not carried over

- **Lock to ticker** — Cybernetic pins its bar under a price ticker. There is no
  ticker here.
- **Sounds** — Cybernetic clicks and whooshes. The bar vibrates on the hold on
  devices that can, and is otherwise silent.
- **The four "expand" boxes** — they had no data behind them. Task Queue and
  System Health have real sources now (the task board, the Workstation's
  checks) and are the obvious first real widgets.
