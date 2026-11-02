# Bonsai 1.7B — permanent guidance weights

The app carries its own guidance model. This folder is where it lives, so a
clone of this repo can answer questions about itself on a machine that has never
been online.

```
public/models/bonsai-1.7b/
├── Modelfile            # how Ollama builds the model from the weights here
├── README.md            # this file
└── bonsai-1.7b.gguf     # tracked with Git LFS — not in a fresh clone
```

## Where the model comes from

**`prism-ml/Bonsai-1.7B-gguf`** on Hugging Face.

That is pinned in `scripts/guidance-weights-source.mjs`, and the same string is
declared to the app as `GUIDE_WEIGHTS_SOURCE` in `src/lib/guide/weights.ts`. A
test asserts the two agree, so "which model is Jackie's guide" has one answer
however you come at it.

## Getting the weights

On a machine with a network:

```sh
npm run weights
```

It reads what the repository publishes, takes the best quantisation it finds,
checks the file really is a GGUF of a plausible size, writes it here, and
updates the size the app advertises to match what it actually got.

```sh
npm run weights -- --list             # what is published, download nothing
npm run weights -- --quant q5_k_m     # take a specific quantisation
npm run weights -- --url https://…    # a build from somewhere else entirely
npm run weights -- --sha256 <hex>     # check you got the file you meant
```

Quantisations are not interchangeable. The smallest is a few hundred megabytes
and noticeably worse; the largest is several gigabytes and will not ship inside
a web app's `public/`. `q4_k_m` is taken by default as the smallest that still
answers in coherent sentences.

## Without a machine of your own

A GitHub runner has git-lfs and a network, so the repo can fetch its own model:

**Actions → Add guidance weights → Run workflow.** No inputs needed — the source
is pinned. It runs the same `npm run weights`, commits the result as an LFS
object and opens a pull request. Nothing runs on a schedule: the download and
the LFS quota it spends happen when someone asks.

## Why it is not in a fresh clone

The `.gguf` is tracked with **Git LFS**, because GitHub rejects any single file
over 100 MB pushed as a normal blob. A clone without LFS gets a few hundred byte
pointer instead of the model — the Guide panel detects exactly that and says so
rather than claiming the model is installed.

```sh
git lfs install          # once per machine
git lfs pull             # fetch the weights for this clone
```

## Installing it into Ollama

```sh
ollama create bonsai-1.7b -f public/models/bonsai-1.7b/Modelfile
```

No network is involved: `FROM` points at the file beside the Modelfile. Once
`ollama list` shows `bonsai-1.7b`, the Guide answers in sentences everywhere in
the app. Until then it still answers — from the route manifest, deterministically
— it just answers shorter.

## Why it is not precached by the service worker

`vite.config.ts` excludes `models/**` from the PWA precache. Workbox has a
per-file limit and an entry this size fails the build outright, the same way the
embedded PC's on-device AI wasm does. The file is still served, and still
available offline once Ollama has built the model from it.

## Running it in the browser

The chat's **On-device** engine runs these exact weights in the browser tab
(`docs/ON_DEVICE_CHAT.md`). It downloads them from this folder when the host serves
the real file, and from Hugging Face — the same SHA-256, nothing newer — when it
serves only the LFS pointer. Changing the weights here means changing the pins
in `src/lib/microai/bonsaiDevice.ts`; `src/test/jackie-device.test.ts` fails
until the two agree.
