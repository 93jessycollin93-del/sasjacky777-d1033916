# The chat pipeline, and why it was silent

Jackie's main chat runs through five pieces:

```
src/pages/Index.tsx            the surface — history, memory, attachments, stop
  └─ src/lib/jackie-router.ts     picks an engine, falls back when it cannot answer
       ├─ src/lib/jackie-engines.ts   the engine registry and the chain's order
       └─ src/lib/jackie-stream.ts    reads the SSE stream, decides success or failure
            └─ src/lib/edgeFunction.ts   builds headers the gateway will accept
                 └─ supabase/functions/…   auth, validation, the engine itself
```

Three shared modules sit under `supabase/functions/_shared/` and are imported by
both sides, so there is no second copy to drift:

- `authGate.ts` — verifies the caller's access token.
- `chatRequest.ts` — the model list, message validation, the context budget.
- `persona.ts` — who Jackie is. Every engine builds its system prompt from it,
  so a fallback answers as Jackie and not as some anonymous assistant.

## The engine chain

The chat used to have exactly one brain, which made every outage total: if the
cloud gateway was rate-limited, out of credit or unreachable, Jackie had nothing
to say — on a rig that was sitting there with its own engine running and a model
loaded. It has a chain now, and `jackie-router.ts` walks it.

| # | Engine | Function | Secret | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Jacky** | `jacky-proxy` | `JACKY_API_BASE` (+ optional `JACKY_API_TOKEN`) | The rig's own Flask engine. Picks its own route and model. Answers whole, so the router paces it onto the screen. |
| 2 | **Bionic** | `jackie-bionic` | `BIONIC_BASE_URL` (+ optional `BIONIC_API_KEY`, `BIONIC_MODEL`) | BionicGPT, LM Studio, llama.cpp, vLLM — anything OpenAI-compatible on your hardware. Streams. |
| 3 | **Ollama** | `jackie-ollama` | `OLLAMA_BASE_URL` (+ optional `OLLAMA_API_KEY`, `OLLAMA_MODEL`) | Your GPU or laptop over a tunnel. Streams. |
| 4 | **DeepSeek** | `jackie-deepseek` | `DEEPSEEK_API_KEY` | DeepSeek's own API (V4 Flash by default). Cheap per token; skipped at no cost when the key is unset. Streams. |
| 5 | **Cloud** | `jackie-chat` | `LOVABLE_API_KEY` | The Lovable gateway. Leaves your hardware and costs credit, so it answers last. |

Order is priority. The engine picked in the composer is tried first and the rest
follow in table order, so choosing Ollama by hand does not mean Jacky and Bionic
are gone — it means they come after.

Every link is gated by `_shared/entitlement.ts`: who is this, may they run this
model, and have they got quota left. The model allowlists live next to each
function and are kept in step with `jackie-engines.ts`, because a picker that
offers a model the allowlist refuses is a failure that looks exactly like the
engine being down. An unconfigured engine is detected before admission, so
probing a chain link that is not set up costs the caller nothing.

The first three links belong to the owner — their rig, their GPU — so they
answer only an account holding the `owner` role. For anyone else they refuse
with `OWNER_ONLY` before quota is spent, and the walk moves on to the cloud.

A link that breaks *after* streaming some of an answer is handled apart from
one that never started. The next engine begins a fresh answer, so the router
calls `onReset` first and the composer clears the half answer — otherwise the
two were saved as one reply ("The capital of France is Paris is the capital of
France."). A stream that stops with neither `[DONE]` nor a finish reason is
reported as cut off rather than saved as complete.

Two things, and only two, stop the walk:

- **the user stopped the answer** — not a failure, and retrying it somewhere
  else would be the opposite of what was asked;
- **there is no signed-in session** — every engine refuses that identically, so
  trying five of them is five identical errors.

Everything else — a missing secret, a refused key, a rate limit, an unreachable
host, an answer of nothing at all — moves to the next engine, because the next
engine is a different machine with different limits.

Nothing about this is silent. Each attempt is reported through `onRoute`, the
composer says so while it happens, and the finished answer carries a badge
naming the engine that served it and what it fell back from. An answer that
quietly came from somewhere other than the engine named on screen is how a chat
ends up lying about what it is.

`src/test/jackie-router.test.ts` covers the walk, both stop conditions, and the
rule that one engine's model id is never handed to the next — a Gemini id means
nothing to Ollama, and carrying it across made every switch fail twice.

## On-device: Bonsai in the browser

One engine sits outside the chain: **On-device**, Bonsai 1.7B running in the
browser tab through wllama (llama.cpp compiled to WebAssembly). It is chosen
from the same menu, downloads once (237 MB, into the browser's own storage) and
answers from there. `docs/ON_DEVICE_CHAT.md` has the whole of it; the parts that
touch the pipeline:

- **A chain of one.** `chainFrom("device")` is `["device"]` and no other chain
  contains it. Picking it means no provider sees the question, so falling back
  to the cloud would do exactly what was not asked; and no server engine falls
  back *to* it, because that would start a 237 MB model nobody chose.
- **Its persona comes from a function.** The persona never ships in the bundle,
  so before each answer the router asks `jackie-device` (owner-only) for the
  system prompt, which the same guard as every other engine builds and attests.
  Only the memory context is sent; the conversation is not. If the prompt cannot
  be fetched, the device does not answer — it does not answer as somebody else.
- **It reports what it is doing.** Loading the model and reading the persona can
  take minutes on a CPU, so `onStatus` carries a line for the composer until the
  first token arrives.

## What was broken

`jackie-chat` opened with `supabase.auth.getClaims(token)` against a client
pinned to `@supabase/supabase-js@2.49.1`.

`getClaims` was added in **2.50.0**. At 2.49.1 it is `undefined`.

So the gate was not rejecting requests — it was throwing
`TypeError: ... is not a function` before authentication was attempted at all,
on every request. That throw happened *outside* the request's `try/catch`, so
the isolate answered 500 with **no CORS headers**. A browser is not allowed to
read such a response, so what reached the user was:

```
TypeError: Failed to fetch
```

which names neither the pin nor anything a person could act on. Twenty-one
functions had the same line, including `jacky-proxy` — the bridge to the real
Jacky engine — so the telemetry and the squads were down for the same reason.

## What holds it up now

- The pin is 2.58.0 wherever `getClaims` is used, and
  `src/test/chat-request.test.ts` walks every deployed function to keep it
  there.
- `verifyAccessToken` falls back to `getUser`, which has existed for the whole
  v2 line, whenever `getClaims` is missing or throws. A version skew now costs
  a round trip, not the product.
- It never throws. Every path returns a verdict, and every answer from
  `jackie-chat` carries CORS headers — a 401 the browser cannot read is
  indistinguishable from the server being down.

## The failures that looked like answers

Fixing the crash exposed three quieter ones, all of which rendered as an empty
assistant bubble:

| Failure | Was | Now |
| --- | --- | --- |
| Gateway reports an error inside a 200 stream | dropped; `onDone` called | reported with the gateway's own words |
| Model stops on its content filter | dropped | said plainly |
| Stream carries no content at all | saved as an empty message | an error naming it |
| Memory + tasks + files outgrow the prompt budget | every request failed | context clamped, tail kept |
| A model id from an older build | server silently used its own default | resolved against the shared list |

`src/test/jackie-stream.test.ts` covers each one.

## Stopping an answer

The composer's Send becomes Stop while an answer is streaming. Stopping is a
third outcome: `streamChat` calls neither `onDone` nor `onError`, and whatever
already arrived is kept and saved rather than thrown away.

## If the chat is quiet again

The message on screen now names the cause. The ones worth knowing:

- *"Jackie has no model key"* — set the `LOVABLE_API_KEY` secret on the project.
- *"Jackie's model key was refused"* — the key is set but the gateway rejected it.
- *"Your session expired"* — sign in again.
- *"Server auth is not configured"* — `SUPABASE_URL` / `SUPABASE_ANON_KEY` are
  missing from the function's environment.
- *"Could not reach the jackie-chat function"* — it is not deployed to this
  project, or the browser is offline.
- *"Every engine refused (jacky → bionic → ollama → cloud)"* — the whole chain
  is down or unconfigured. The message carries the last engine's own words; the
  console carries one line per attempt. The quickest fix is usually one secret:
  `JACKY_API_BASE` to reach the rig, or `LOVABLE_API_KEY` for the net.
- *"Bionic is not connected"* / *"OLLAMA_BASE_URL not configured"* — those
  engines are simply not set up. They are skipped, not fatal; the chat carries
  on down the chain.
