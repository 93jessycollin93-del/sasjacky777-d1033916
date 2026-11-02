# The device rung

`contextRouter.ts` has always described an offline-first ladder — `device`, then
`lan`, then `network` — and said plainly that the network is where updates come
from and never where answers come from.

Only the LAN rungs existed. `contextRouterService.ts` registered Ollama and LM
Studio, both `lan`, so every router that called itself offline-first was in fact
leaning on another machine being awake on the same network. The Keeper router,
whose whole contract is `ladder: ["device"]` because vault context must never
leave the machine, had no engine at all and could not answer a single question.

The model now runs in the tab.

## Why llama.cpp in WebAssembly, and not ONNX

The repository already ships its model: `public/models/bonsai-1.7b/` holds
248 MB of GGUF, tracked with Git LFS, served from the app's own origin so a
clone can answer a question about itself on a machine that has never been
online.

`transformers.js` and `onnxruntime-web` cannot read GGUF. Either one would have
meant converting Bonsai to ONNX and shipping a **second** copy of the same
weights — doubling what a clone carries in order to run the model the clone
already has. `@wllama/wllama` is llama.cpp compiled to WASM, and it loads that
exact file.

## What it costs before you ask it anything

Nothing, and that is enforced in three places rather than hoped for:

- **`available()` never downloads.** It asks whether WebAssembly exists and
  whether the weights are really on disk — a HEAD request, through
  `checkGuideWeights`, which already knows how to tell a 248 MB model from the
  few hundred bytes of LFS pointer a clone gets without `git lfs pull`.
- **The library is a dynamic import.** A static one put wllama and its 8.4 MB
  binary into the main bundle, paid for by every visitor to every route
  including the ones who never ask a question. It is a 312 KB chunk now, fetched
  on first use.
- **The binary is excluded from the PWA precache.** It fits under workbox's
  per-file limit, which was exactly the problem: it was quietly precached on
  first load, undoing the other two. It is runtime-cached instead
  (`eye-wasm`), so it is kept from the first time it is genuinely used.

After that first load the weights live in wllama's cache, so the second question
costs nothing and works with the radio off. That is the whole point of the rung.

## One ladder, written down once

Every caller used to assemble its own engine list, and each assembled a
different one — the Guide took LM Studio and Ollama, the Workstation took Ollama
alone, the squads took Ollama alone. That is *why* an unimplemented rung could
go unnoticed: there was no single place where the ladder was written down, so
nothing could be compared against what `contextRouter.ts` promised.

`defaultEngines()` in `contextRouterService.ts` is that place now. Device first;
LM Studio before Ollama, because the operator's weights already live there and
pointing at them copies nothing; the network nowhere, because it never answers.

## What it will not do

- **It serves Bonsai and nothing else.** Asked for another model it answers with
  Bonsai and reports `bonsai-1.7b` as the model that ran — never the model that
  was requested, which would be a claim it cannot support.
- **An empty generation is an error**, not an empty answer. So is a
  `content_filter` finish, named the same way `jackie-stream.ts` names it.
- **A failed load does not poison the engine.** The usual cause is a clone
  without its LFS objects, which is fixed by `git lfs pull` rather than by
  reloading the page, so the next run tries again.

`src/test/device-engine.test.ts` covers each of those.

## Running it

Nothing to install. The weights need fetching once in a fresh clone:

```bash
git lfs pull          # or: npm run weights
```

`/guide` reports whether they are present, and says which command to run when
they are not.

The main chat can answer from the same weights too, downloaded into the browser
when the host does not serve them: `docs/ON_DEVICE_CHAT.md`. This rung uses that
download and that loaded model. `available()` counts a copy in the browser's
storage before it asks the server, so on a host that deploys only the LFS
pointer the rung works once the owner has downloaded Bonsai from the chat. It
fetches from the app's own copy when it has to fetch at all, and never from
Hugging Face: a 237 MB download from a third party is started by the Download
button, not by a question to the Guide.
