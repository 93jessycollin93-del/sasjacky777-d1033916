# On-device in the chat: Bonsai and small models in the browser

Jackie's chat can answer from **a model running in the browser tab**: pick
**On-device** in the engine menu, pick a model, press **Download** once, and
ask. No AI provider sees the question. This is what PocketPal does on a phone,
done inside the web app.

| Model | Size | Where it fits | Licence |
| --- | --- | --- | --- |
| Bonsai 1.7B (default) | 237 MB, 1-bit | anywhere, phones included | Apache-2.0 |
| SmolLM2 360M Instruct | about 270–390 MB | anywhere; fastest | Apache-2.0 |
| Qwen2.5 0.5B Instruct | about 400–500 MB | anywhere | Apache-2.0 |
| SmolLM2 1.7B Instruct | about 1.1 GB | laptop or desktop | Apache-2.0 |
| Qwen2.5 Coder 1.5B Instruct | about 1.1 GB | laptop or desktop; code | Apache-2.0 |
| SmolLM3 3B | about 1.9 GB | desktop | Apache-2.0 |
| Phi-3.5 mini Instruct | about 2.4 GB | desktop | MIT |

The six after Bonsai are the chat models from the owner's download queue.
One model is in memory at a time; picking another
unloads the last, and the panel lists what else is stored so it can be
removed.

It builds on the device rung (`docs/ON_DEVICE.md`), which runs the same weights
in the tab for the Guide and the Keeper router. The two share one download and
one loaded model: on a host that deploys only the LFS pointer, downloading
Bonsai here is also what makes the Guide's rung available, and a tab that uses
both holds one copy of the model in memory, not two.

## Why not PocketPal itself

PocketPal is a React Native app built on `llama.rn`, the native llama.cpp
binding for iOS and Android. A web page cannot embed it. What can be embedded
is the engine underneath it: **wllama** is the same llama.cpp compiled to
WebAssembly. It reads Bonsai's 1-bit `Q1_0` GGUF as published, and it was
already a dependency (the guidance rung in `deviceEngine.ts`).

## Using it

1. Open the chat, open the engine menu (the chip left of the model name), and
   choose **On-device**. It sits below the numbered chain. Then pick the model
   in the model menu beside it; Bonsai is the default.
2. The panel above the composer says whether this browser can run it and
   whether it has WebGPU. Press **Download**. Progress is shown; **Stop**
   cancels it and deletes the part that arrived. Switching engine does not:
   the download belongs to the page, not the panel, and the panel picks it
   up again when you come back.
3. Ask. The first answer of a session loads the model and reads Jackie's
   persona, and the composer shows how far it has got. Later answers reuse
   what was read (llama.cpp's prompt cache), so they start much sooner.
4. **Remove** deletes the 237 MB from this browser.

It needs the **owner** account (see below) and any browser with WebAssembly.
Current Chrome and Edge run llama.cpp's fast build. Safari — and so every
browser on an iPhone or iPad, since Chrome, Edge and Firefox there are Safari
underneath — runs wllama's slower compatibility build, served from this app.
The panel says which.

## Keeping it on an iPhone

Download it from the **Home Screen app**, not a Safari tab:

1. In Safari, Share → **Add to Home Screen** (it is named "eYe").
2. Open it from the Home Screen and sign in.
3. Choose On-device and download there.

Two reasons. Safari deletes everything a website has stored once it goes seven
days of browsing without a visit; Home Screen apps are exempt. And a Home Screen
app keeps its own storage, separate from Safari's, so a copy downloaded in a
tab does not follow it. The panel shows this advice in an iPhone browser tab.

The compatibility build is slower, and a phone gives a tab far less memory than
a desktop does, so on it the model stores its attention keys at 8 bits, which
saves about 115 MB of the 460 MB the window costs. Whether a given iPhone has
the memory for the whole 4,096-token window has not been measured: if Bonsai
fails to start, the chat says "could not start on this device" with the reason.

## Which bytes, from where

**Bonsai** is exactly one build: SHA-256 `3d7c6c90…cae5f7e3`, 248,302,272 bytes — the file
`public/models/bonsai-1.7b/bonsai-1.7b.gguf`'s LFS pointer names. A test reads
that pointer and fails if the pins in `bonsaiDevice.ts` drift from it.

- **From the app itself**, when the host serves the real weights at
  `/models/bonsai-1.7b/bonsai-1.7b.gguf` at exactly that size. A self-hosted
  build after `git lfs pull` does.
- **Otherwise from Hugging Face** (`prism-ml/Bonsai-1.7B-gguf`). Most hosts,
  Lovable's included, deploy the 134-byte LFS pointer rather than the weights.
  The app asks Hugging Face's API for the repository's file list, takes only
  the file whose SHA-256 is the pinned one, and downloads it from the commit
  that list came from. If the repository no longer has that build, nothing is
  downloaded and the panel says why. A newer upload under the same name is a
  different model.

Either way the size that arrives is checked against the pin, and a download of
the wrong size is deleted.

**The other models** cannot be pinned the same way: nothing in this repository
could reach Hugging Face to read their bytes. They are resolved on the device
when Download is pressed (`src/lib/microai/deviceModels.ts`):

- from a named repository — the publisher's own first (Qwen, HuggingFaceTB,
  ggml-org), then a well-known re-quantizer (bartowski, MaziyarPanahi);
- in a named quantization — Q4_K_M, else Q4_0, Q5_K_M or Q8_0 — and one file:
  never a vision projector, one shard of a split model, or an ARM-only repack;
- at the commit the listing came from, and kept only at the size it listed.

That is the same trust wllama's own Hugging Face loader extends, with the
publisher chosen here rather than by whoever uploaded last. The panel says
which repository a model comes from before anything downloads.

The file is kept in wllama's cache, in the browser's origin-private file system,
and the download asks the browser to keep it (`navigator.storage.persist()`), so
it is not the first thing evicted when the disk fills.

## What leaves the machine

- **The question and the answer stay in the tab** as far as any model is
  concerned: Bonsai runs here.
- **The chat is still saved** to your history in the database, as it is for
  every engine, and memories are extracted from it the same way.
- **Before each answer, one request goes to `jackie-device`** with the memory
  context (its last 2,000 characters), and comes back with Jackie's system
  prompt. That is the only network call an on-device answer makes.

That last request is why on-device is not offline. Jackie's persona is kept out
of the browser bundle so that loading the app does not hand it to anyone who
asks, so the tab cannot build it alone. `jackie-device` builds it with the same
guard every other engine uses (`_shared/personaGuard.ts`: persona, the owner's
morals, the context) and records the attestation, so the morals page lists
`jackie-device` with the other engines. It is owner-only, like `jacky-proxy` and
`jackie-ollama`, and spends no quota; another account gets a refusal that says
why. If the prompt cannot be fetched, the device does not answer — it does not
answer as an anonymous assistant instead (rule 6).

## Not in the fallback chain

On-device answers only when chosen, and nothing answers in its place. A failure
— not downloaded, the persona unreachable, the model writing nothing — is
reported, and the question is not passed to a cloud engine, which is exactly
where someone who chose On-device did not want it to go. No server engine falls
back to it either.

## How fast

It depends almost entirely on whether the browser has a GPU it will lend to
WebGPU. llama.cpp offloads every layer to WebGPU when it can and runs on the CPU
when it cannot; the panel says which.

The only measurements so far come from the cloud container this was built in,
which has no GPU and a slow CPU, so they are a floor, not an estimate:

| Run (headless Chromium, no GPU) | Time |
| --- | --- |
| Download from the app's own origin (local) | ~3 s |
| First answer with Jackie's full persona (1,229 prompt tokens, 64 out), wllama called directly, single thread | 12 min 3 s |
| Next answer in the same session (1,225 of 1,313 tokens reused from the cache) | 76 s |
| Same two, through WebGPU on SwiftShader (a software GPU, so also the CPU) | 12 min 37 s, then 85 s |
| `bonsaiDevice.ts` end to end in Chromium: download from the app's origin, then a one-line system prompt and "What is 2 + 2?" (39 prompt tokens) | download 2.5 s; first token 52 s, including loading the model; answer "2 + 2 = 4." at 60 s |
| The same through the compatibility build, in Chromium with JSPI and 64-bit memory hidden as on Safari (31 prompt tokens, 8-bit keys) | answer "4." at 38.5 s, including loading the model; every request to this app's own origin |

On a laptop or phone with a real GPU, prompt reading is many times faster; that
has not been measured here. Multi-threading would also help on the CPU, but it
needs the page to be cross-origin isolated (COOP/COEP headers). The app does
not set them: isolation blocks every cross-origin resource that has not opted
in, and what that would break elsewhere in the app has not been checked.

## Limits

- **Window:** 4,096 tokens, about 460 MB of memory on top of the 237 MB model.
  Jackie's persona, morals and the memory context take roughly half; the oldest
  turns of a long conversation are dropped first, and the question being asked
  never is. A message that cannot fit beside the persona is refused with a
  reason rather than cut.
- **Answers** stop at 512 tokens.
- **One question at a time.** A second send waits for the first, and so does
  a Guide question asked while the chat is answering: they share the model.
- **Thinking off.** Bonsai's Qwen-family template thinks aloud first unless
  told not to; at CPU speed that is minutes of tokens nobody sees.
- wllama would otherwise fetch its compatibility build from `cdn.jsdelivr.net`
  for browsers without JSPI or 64-bit memory — third-party code running beside
  Jackie's persona and memory. It comes from `@wllama/wllama-compat` instead,
  pinned to exactly the runtime's version and served from this app
  (`wllamaRuntime.ts`); a test fails if the two versions part.

## Deploying it

No migration and no secret. Deploy the new function, `jackie-device`, with the
others; the browser half ships with the app. Until the function is deployed,
an on-device answer fails with "Jackie's persona could not be fetched".

## Files

| File | What |
| --- | --- |
| `src/lib/microai/bonsaiDevice.ts` | Pins, source resolution, download, status, remove, the streamed answer |
| `src/lib/microai/wllamaRuntime.ts` | Starting wllama: lazy, same-origin, no CDN; the compatibility build for Safari |
| `src/lib/microai/deviceModels.ts` | The models On-device offers, and how each is found on Hugging Face |
| `src/components/microai/DeviceModelPanel.tsx` | The download / progress / remove panel, per model |
| `src/lib/jackie-engines.ts`, `src/lib/jackie-router.ts` | The `device` engine and its turn |
| `supabase/functions/jackie-device/` | Jackie's guarded system prompt for the device |
| `src/test/jackie-device.test.ts` | Pins, sources, window fitting, streaming, routing |
| `src/test/device-models.test.ts` | File choice, repository fallback, routing the picked model, one download at a time |
| `src/test/wllama-runtime.test.ts` | Which build a browser gets, and that Safari's comes from this app |
