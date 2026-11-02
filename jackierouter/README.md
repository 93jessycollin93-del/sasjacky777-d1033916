# jackierouter

Predictive, cost-tiered AI routing with context-preserving failover.

Most multi-provider setups are a `try/except` around one API call: run until a
429, then panic. That fails the request that hits the wall, and whatever the
model was halfway through writing is gone.

This library does four things instead:

1. **Forecasts exhaustion instead of waiting for it.** A sliding-window ledger
   measures burn rate per provider and predicts seconds-to-exhaustion, so the
   router migrates while headroom remains.
2. **Climbs the cost ladder only when it must.** Tier 0 is hardware you own. A
   paid provider is never reached for while a free one is healthy, and rolling
   spend caps are the hard stop behind that.
3. **Carries the thread across.** Every failover attaches a briefing built from
   the interrupted turn — the task, what was established, and the tail of the
   partial output — so the next model continues mid-thought. This works
   mid-stream too: the reader sees one continuous response even when the
   provider changed halfway through a sentence.
4. **Knows what machine it is on.** "Prefer local hardware" is only honest if
   something checks the hardware. Providers declare what they need — free VRAM,
   a GPU below a temperature, the model actually pulled — and are skipped
   *before* the call when the box cannot serve them.

No third-party dependencies in the core. `pip install jackierouter[gateway]`
adds FastAPI if you want it on a port.

## Recognising your system

```
$ python -m jackierouter detect
host          tower
os            Windows 11 (AMD64)
cpu           AMD Ryzen 9 5950X
              32 logical / 16 physical cores
ram           128.0 GB total, 93.8 GB available
accelerator   nvidia
  gpu 0       NVIDIA GeForce RTX 3090 (24.0 GB, 22.0 GB free, 47C)
npu           none detected
ollama        reachable, 2 model(s)
  - qwen3.5:latest
  - gemma4:26b
```

`python -m jackierouter suggest -o router.config.json` turns that into a
ladder: one tier-0 provider per model Ollama really has, each gated on the
VRAM that model actually needs and on a temperature below the throttle point,
plus a cloud rung left **disabled** so nothing reaches the network until you
add a key.

Everything is measured, never assumed. A value the machine cannot report comes
back `None` and is treated as "unknown", not as a failed check — refusing to
route because a sensor is missing would be worse than routing.

| requirement | skips the provider when |
| --- | --- |
| `require_gpu` | no GPU is detected |
| `min_free_vram_mb` | the largest card has less free VRAM than that |
| `min_free_ram_mb` | the machine has less RAM available |
| `max_gpu_temp_c` | the hottest GPU is above it — move work off the box *before* the clocks drop |
| `require_ollama` | Ollama is not answering (the box is asleep) |
| `require_ollama_model` | that model was never pulled |

A misspelled requirement is rejected at load time rather than ignored: a
thermal gate that silently never fires is worse than no gate.

## Use

```python
from jackierouter import RouteRequest, router_from_env

router = router_from_env()  # reads $JACKIEROUTER_CONFIG
result = router.dispatch(RouteRequest(
    messages=[{"role": "user", "content": "write the down-migration"}],
    capability="code",
))

print(result.text)
print(result.provider, result.model, result.cost, result.handoffs)
for attempt in result.trace:
    print(attempt.provider, attempt.outcome, attempt.detail)
```

### Streaming

```python
stream = router.stream(RouteRequest(messages=[...]))
for chunk in stream:      # text deltas, live
    print(chunk, end="", flush=True)

print(stream.result.provider, stream.result.cost, stream.result.handoffs)
```

If a provider dies partway through generating, the text already shown to the
reader becomes the partial output in the briefing handed to the next provider,
which resumes from the cut point. Nothing is repeated and nothing is lost.
Adapters without a `stream()` method still work — they yield their whole
response as one chunk.

### Surviving a restart

Set `state_path` in the config (or pass `state_store=StateStore(path)`) and the
ledger and spend are written to disk atomically, keyed to wall clock. A
restarted service comes back knowing what it had already burned instead of
handing a provider a fresh quota mid-burn. State older than a day is dropped on
load, and a corrupt or future-versioned file is ignored rather than fatal.

Building the ladder by hand instead of from config:

```python
from jackierouter import BudgetGuardian, Limit, OllamaAdapter, OpenAICompatAdapter, Provider, Router

router = Router(
    [
        Provider(
            name="local/qwen",
            model="qwen3.5:latest",
            adapter=OllamaAdapter("qwen3.5:latest"),
            tier=0,
            max_context=32768,
        ),
        Provider(
            name="groq/llama-70b",
            model="llama-3.3-70b-versatile",
            adapter=OpenAICompatAdapter(
                "llama-3.3-70b-versatile",
                base_url="https://api.groq.com/openai/v1",
                api_key_env="GROQ_API_KEY",
            ),
            tier=1,
            limits=[Limit(60, requests=30, label="rpm"), Limit(60, tokens=12000, label="tpm")],
        ),
    ],
    budget=BudgetGuardian.hourly_daily(per_hour=0.50, per_day=5.00),
    horizon_seconds=30,
)
```

## Configuration

One JSON document describes the whole ladder; see
`../router.config.example.json`. Point `JACKIEROUTER_CONFIG` at it.

| field | meaning |
| --- | --- |
| `tier` | cost ladder rung. 0 = your own hardware. The router never climbs while a lower rung is healthy. |
| `limits[]` | declared rate limits: `window_seconds` plus `requests` and/or `tokens`. This is what the forecast is computed against. |
| `cost_per_1k_input` / `cost_per_1k_output` | prices, used for both estimates and recorded spend. |
| `capabilities[]` | free-form tags (`code`, `chat`, `long-context`, `vision`). A request asking for one only sees providers that declare it. |
| `max_context` | requests estimated larger than this skip the provider. |
| `horizon_seconds` | how far ahead the forecast looks. A provider expected to run dry inside it is "at risk". |
| `risk_policy` | `migrate` (default): healthy beats cheap, so the move happens early. `conserve`: cheap beats healthy, so a free rung is used until it is genuinely spent. |
| `budget` | `per_hour` / `per_day` spend caps. `0` means **spend nothing**; omit the key for no cap. |
| `requires` | hardware preconditions — see the table above. |
| `state_path` | where to persist quota and spend across restarts. |
| `system_probe` | `enabled` / `ttl_seconds` / `ollama_url` for hardware detection. |
| `max_attempts` | how far down the ladder one request may walk (default 4). |

## Adapters

`OllamaAdapter`, `OpenAICompatAdapter` (OpenAI, Groq, Together, vLLM, LM
Studio) and `AnthropicAdapter` (native `/v1/messages`, `x-api-key`, top-level
`system`) ship with the library, all streaming-capable. A provider with
`"kind": "anthropic"` and no prices set picks up the published rates for its
model, so a Claude rung never budgets as if it were free.

`AnthropicAdapter` is written against raw HTTP rather than the `anthropic` SDK
on purpose: the core of this library installs with no dependency tree, and an
adapter layer that pulled in one vendor's SDK would break that for everyone
routing to Ollama. Use the SDK in your application code, where its retries and
typed errors earn their keep.

A refusal (`stop_reason: "refusal"`) is returned, never raised. Failing over on
a refusal would mean shopping the same prompt around providers until one
complies, which is not failover.

An adapter is anything with:

```python
def complete(self, messages, request) -> AdapterResult: ...
```

raising `RateLimited` or `ProviderError` on failure. `OllamaAdapter`,
`OpenAICompatAdapter` (OpenAI, Groq, Together, vLLM, LM Studio) and
`EchoAdapter` ship with the library. An adapter may attach `partial_output` to
the exception it raises; the router folds that into the handoff briefing so the
next model resumes from the exact cut point.

## Operating it

`router.status()` returns live per-provider headroom, seconds-to-exhaustion,
cooldowns, and spend against each cap — the same payload the gateway serves at
`GET /status`.

## Tests

```
python -m pytest
```

No network, no sleeping, no vendor tools required: the clock is injected and
every hardware probe is stubbed, so forecasting, gating, persistence and
mid-stream failover are all tested deterministically.
