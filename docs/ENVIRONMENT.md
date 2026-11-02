# Environment and secrets

Every environment variable this repository reads, where each one belongs, and
what breaks when it is missing. Written to be the thing you open when you are
adding a key, so that the question "does this go in `.env` or in Cloud →
Secrets?" has an answer you do not have to guess at.

The inventory below is derived from the code, not from memory: the browser
variables are every `import.meta.env.*` under `src/`, and the function
variables are every `Deno.env.get(…)` under `supabase/functions/`, including
the ones read indirectly through each provider's `const SECRET` and through
`allowlistFromEnv`.

---

## The one rule

There are two stores, and they are not interchangeable.

| Store | Holds | Who can read it |
| --- | --- | --- |
| `.env` in the repo | **Publishable values only.** Everything here is compiled into the browser bundle. | Anyone who loads the app |
| Supabase **Cloud → Secrets** | Every API key, token and private base URL. | Only the edge functions |

**Anything in `.env` is public.** Vite inlines `VITE_*` into the JavaScript it
ships, so a key put there is readable by anyone who opens devtools — it has
been published whether or not the repo is private. There is no such thing as a
secret `VITE_` variable.

So: a provider key never goes in `.env`. It goes in Cloud → Secrets, and the
browser reaches it only by calling the edge function that holds it. That
indirection is the entire reason the `jackie-*` functions exist.

`.env.local` and `.env.*.local` are gitignored; `.env` itself is committed, which
is only safe while the rule above holds.

---

## `.env` — the browser's variables

These are the only variables the app itself reads. All are publishable.

| Variable | Required | What it does |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Project API root. `edgeFunction.ts` builds every function URL on it. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | The `sb_publishable_…` key. Sent as the `apikey` header — never as a bearer token (see rule 4 in `CLAUDE.md`). |
| `VITE_SUPABASE_PROJECT_ID` | yes | Project ref, used where a bare id is needed rather than a URL. |
| `VITE_BASE` | no | Base path for the built app. Leave unset unless serving from a subdirectory. |
| `VITE_MEDIA_CONVERTER_URL` | no | External media-converter service for the Eru converter page. |
| `VITE_PHOENIX_INVESTOR_URL` | no | External link target. Cosmetic. |

Vite also exposes `DEV`, `PROD` and `MODE`. Those are built in — do not set them.

---

## Cloud → Secrets — the edge functions' variables

Set these in the Supabase dashboard under Cloud → Secrets. None belong in any
file in this repository.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
into every function by the platform. You do not set them, and
`SUPABASE_SERVICE_ROLE_KEY` in particular must never be copied anywhere else —
it bypasses every RLS policy in `supabase/migrations/`.

### The gateway

| Secret | Used by |
| --- | --- |
| `LOVABLE_API_KEY` | `jackie-chat`, `jackie-image`, `jackie-langcheck`, `jackie-orchestrate`, `bot-generate`, `gunit-chat`, `gunit-bot-gen`, `gunit-agent-cycle`, `github-sync`, `gemini-engine`, `pod-fold`, `pod-search` |

This is the one that matters most: it backs the `cloud` engine — the last rung
of the fallback chain — and both pod embedding functions. Without it the chain
has no final fallback and pod search cannot embed anything.

### Chat providers

Each is needed only by its own function. A provider whose key is unset reports
itself unconfigured and the router moves down the chain, which is a normal,
frequent event rather than an error.

| Secret | Function | Provider |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `jackie-anthropic` | Anthropic |
| `OPENAI_API_KEY` | `jackie-openai` | OpenAI |
| `GROQ_API_KEY` | `jackie-groq` | Groq |
| `CEREBRAS_API_KEY` | `jackie-cerebras` | Cerebras |
| `MISTRAL_API_KEY` | `jackie-mistral` | Mistral |
| `TOGETHER_API_KEY` | `jackie-together` | Together |
| `FIREWORKS_API_KEY` | `jackie-fireworks` | Fireworks |
| `DEEPINFRA_API_KEY` | `jackie-deepinfra` | DeepInfra |
| `HF_TOKEN` | `jackie-hf` | Hugging Face |
| `GOOGLE_AI_STUDIO_KEY` | `jackie-google` | Google AI Studio |
| `OPENROUTER_API_KEY` | `jackie-openrouter` | OpenRouter |
| `XAI_API_KEY` | `jackie-xai`, `jackie-xai-media` | xAI |
| `DEEPSEEK_API_KEY` | `jackie-deepseek` | DeepSeek (also the chat chain's fourth engine, and the `deepseek` engine of the MCP `ask_jackie` tool) |

### Self-hosted engines

| Secret | Required for | Notes |
| --- | --- | --- |
| `BIONIC_BASE_URL` | `jackie-bionic` | Your OpenAI-compatible endpoint. Checked **before** `admit()`, so an unconfigured engine costs no quota. |
| `BIONIC_API_KEY` | optional | Only if your endpoint demands one. |
| `BIONIC_MODEL` | optional | What the picker's "Server default" resolves to. |
| `OLLAMA_BASE_URL` | `jackie-ollama` | Same contract as Bionic. |
| `OLLAMA_API_KEY` | optional | Only if the endpoint is behind auth. |
| `JACKY_API_BASE` | `jacky-proxy` | Root of the rig's Flask engine. |
| `JACKY_API_TOKEN` | optional | Bearer token attached to proxied calls. |

All three engines — and `github-sync` — answer **only an account holding the
`owner` role** (granted by `core-claim` to an allowlisted, verified address).
Anyone can sign in to this app; signing in does not make the rig, the GPU or the
GitHub credential theirs. A non-owner gets `403 OWNER_ONLY`, checked before
quota, so the chat router moves past these engines at no cost.

### Everything else

| Secret | Used by | Notes |
| --- | --- | --- |
| `CONNECTIONS_SECRET_KEY` | `jackie-connect` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the keys people store for their connections. Lose it and every stored key must be re-entered; leak it alongside a database dump and every stored key is readable. Without it, connections that need no key still work. See `docs/CONNECTIONS.md`. |
| `GITHUB_API_KEY` | `github-sync` | Read-only repo access through the connector gateway. |
| `GITHUB_SYNC_REPOS` | optional | Comma-separated `owner/repo` list `github-sync` may read. Defaults to `93jessycollin93-del/sas-jacky`; any other repository is refused, however the request names it. |
| `TELEGRAM_API_KEY` | `telegram-validate` | The bot token. Validates `initData` HMAC signatures — the token *is* the signing key, so a leak forges logins. |
| `GEMINI_ENTERPRISE_API_KEY` | `gemini-engine` | With `_PROJECT_ID`, `_LOCATION` and `_ENGINE_ID` below. |
| `GEMINI_ENTERPRISE_PROJECT_ID` | `gemini-engine` | |
| `GEMINI_ENTERPRISE_LOCATION` | `gemini-engine` | |
| `GEMINI_ENTERPRISE_ENGINE_ID` | `gemini-engine` | |

### Model allowlists

Optional, comma-separated. Each overrides the default list compiled into its
function. Read rule 5 in `CLAUDE.md` before changing one: the picker in
`src/lib/jackie-engines.ts` and the allowlist must agree, or the picker offers
a model the server refuses and the failure looks exactly like the engine being
down.

| Variable | Function |
| --- | --- |
| `OPENROUTER_MODEL_ALLOWLIST` | `jackie-openrouter` |
| `OLLAMA_MODEL_ALLOWLIST` | `jackie-ollama` |
| `BIONIC_MODEL_ALLOWLIST` | `jackie-bionic` |
| `XAI_RESPONSE_MODEL_ALLOWLIST` | `jackie-xai-media` |

---

## Python

The rig-side trees read no secrets. `jackierouter/system_profile.py` reads
`NUMBER_OF_PROCESSORS` and `PROCESSOR_IDENTIFIER`, which the operating system
sets, for hardware profiling. Nothing under `Jackie/`, `jackierouter/` or
`command_station/` needs a key.

---

## Adding a new provider key

1. Add the secret in Cloud → Secrets. Not to `.env`, not to `.env.example`.
2. Give the function a `const SECRET = "YOUR_KEY_NAME"` and read it through
   `Deno.env.get(SECRET)`, matching the other `jackie-*` functions.
3. Check the key is present and return `needs_secret` when it is not, **before**
   calling `admit()` — otherwise an unconfigured provider bills quota for a call
   that cannot happen.
4. Register it in `src/lib/jackie-providers.ts` with a matching `requiresSecret`,
   so the UI can say which key is missing instead of showing a dead provider.
5. If it takes a model argument, add the allowlist and the picker entry together.

`/edge` and `/engine` scaffold most of this correctly.

## If a key leaks

Rotate it at the provider first, then update Cloud → Secrets. Removing it from
a file and committing does not unpublish it — anything that reached `.env` and
shipped in a bundle should be treated as public from the moment it was built.
