# The pill

> **Now SANDi, on the nav bar.** The pill was its own floating bar; it is now
> the SANDi button on the one nav bar (Ctrl/⌘+K), and questions no crafted
> index claims go on to a built-in specialist instead of stopping. See
> [NAV_BAR.md](NAV_BAR.md). What follows still describes how commands and
> crafted indexes are matched, which is unchanged.

The forge at `/forge` makes indexes. The pill is where they get used. It is
mounted beside the router rather than on a page, so it is on every screen.

## Two paths, and the fast one is tried first

The mockup this was built from promised a **"0% latency command list"**, and
that phrase is worth taking literally rather than decoratively. "Open Vault"
should move the app before a model has finished loading, let alone answering. A
launcher that routes a navigation request through an LLM is slower than the menu
it replaced and wrong more often.

So:

1. **Command.** Matched against the route manifest and the commands crafted
   indexes declare. A string comparison over a list already in memory, then a
   navigation. No model, no network, no `await`.
2. **Question.** Everything else, routed to whichever index is expert in it by
   keyword, and answered on that index's own engine ladder.

`src/lib/forge/commands.ts` owns the line between them, and it is a pure
function so the ambiguous cases are settled in tests rather than in a browser.

### Where the line is

A command needs a verb or an exact phrase. That rule is the whole design:

> "what did I write about the vault" → **question**, not navigation to `/vault`

The word appears, but nothing asked to go anywhere. Silently navigating away
from a question is far more annoying than answering a navigation request as a
question, so ambiguity resolves toward answering.

A phrase a crafted index declared wins over a route that merely shares its
words: someone who wrote "Open Board" for their own index meant that one.

### Picking the index

Whole-word keyword matches count double. Without that, an index keyed on "art"
claims every question containing "start", "chart" or "partition" — and the wrong
index answering is worse than none, because it brings the wrong partitions with
it.

Nothing claiming a question is reported, not guessed at.

## Voice

Real Web Speech API, not a recording round trip. `VoiceRecorder` already existed
and records audio to a blob for transcription elsewhere — the wrong shape here,
because the pill needs the words *as they are spoken* to match a command and
move, and a round trip to a transcription service would undo the entire point of
a command list that costs nothing.

Where the browser cannot listen — Firefox, by default — **the microphone is
absent rather than dead.** A button that does nothing when pressed leaves the
person unable to tell whether they misheard themselves, whether permission was
denied, or whether the feature was never there.

Error codes are translated, never forwarded: `not-allowed` becomes "The
microphone was blocked. Allow it for this site and try again."

## The status line is real

The mockup ended in "WASM Ready • Weights Pending Load" beside a console
printing invented allocations — 8 MB, then 64, then 32, then 24. Decoration.

Every word in this footer is measured:

| Shown | Measured by |
| --- | --- |
| `WASM ready` / `no WASM` | `wasmSupported()` |
| `weights on disk` / `weights missing` | `checkGuideWeights()` — which tells 248 MB of model from a few hundred bytes of LFS pointer |
| `… ready` / `no engine ready` | `available()` on each rung of the real ladder |

A status line that cannot be wrong is worth more than one that looks busy.

It is probed once per open rather than per keystroke: the answer does not change
until someone installs weights or starts a runner, and a panel that polls a host
which is not there is noise on the network tab.

## Tests

`src/test/forge-commands.test.ts` covers the command/question line, the
phrasings people use, crafted-command precedence, and the whole-word keyword
rule. Writing them found a real bug: `VERBS` was matched in declaration order,
so "show" was found before "show me" and *"show me vault"* was left asking for
"me vault". The list is sorted longest-first now, and the comment says why.
