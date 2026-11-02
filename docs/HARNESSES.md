# Driving SAS-JACKY with DeepSeek and Hermes

Two ways, and they share one set of rules.

- **From outside** — [Hermes Agent](https://github.com/NousResearch/hermes-agent)
  or [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) running
  on your computer, connected to the app's MCP server.
- **From inside** — DeepSeek and Hermes agents in the Agent Lab (`/agent-lab`)
  with **App control** on.

Both act through the same functions (`src/lib/appActions.ts`), as the signed-in
user, under the same row-level security. An action that works from one works
from the other, and one that is refused is refused by both, with the same words.

## What they can do

| Tool | What it does |
| --- | --- |
| `ask_jackie` | Talk to Jackie. She sees your memory and active tasks; the exchange is saved as a conversation in the app. `engine`: `cloud` (default), `deepseek`, `bionic`, `ollama`. |
| `list_tasks` · `create_task` · `update_task` · `update_task_status` · `delete_task` | The task board. Statuses: `todo`, `in_progress`, `done`, `blocked`. |
| `search_memory` · `remember_fact` · `forget_fact` | Jackie's long-term memory — what she knows in every chat. |
| `list_conversations` · `read_conversation` · `create_conversation` | Chat history. |
| `list_skills` · `get_skill` · `propose_skill` | Your skills: instructions an agent loads when a task fits. Agents may propose new ones; they stay off until you approve them on `/skills`. |
| `list_custom_tools` · `run_custom_tool` · `propose_tool` | Your custom tools: named recipes of the actions above, with parameters. Same rule for proposals. See [SKILLS.md](SKILLS.md). |
| `list_connections` · `call_connection` · `propose_connection` | Outside HTTPS services you connected, and the operations agents may call on each. Responses arrive marked untrusted. Writes need your say-so per connection; keys are never readable. See [CONNECTIONS.md](CONNECTIONS.md). |

The in-app agents have the same set, minus `update_task_status` (`update_task`
covers it). Deletes are off for them unless you turn on **Allow deletes**.

`bionic` and `ollama` answer the **owner only** — they run on your own
hardware. Your account needs the `owner` role (granted once by `core-claim`).

---

## Hermes Agent

1. **Install** Hermes Agent with its own installer (see
   [its install guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation)),
   which includes MCP support. Or from a clone, with the `[mcp]` extra:
   ```bash
   git clone https://github.com/NousResearch/hermes-agent && cd hermes-agent
   python3 -m venv .venv && .venv/bin/pip install -e ".[mcp]"
   ```
   `pip install git+https://…` does not work: Hermes refuses to build a wheel.
   And the `[mcp]` part matters. Without it, `hermes mcp test` says
   *"mcp.client.streamable_http is not available"* and Hermes cannot reach a
   URL-based server at all.

2. **Configure.** Copy [`harness/hermes/config.yaml`](../harness/hermes/config.yaml)
   to `~/.hermes/config.yaml`, or merge its `model`, `mcp_servers` and `tools`
   blocks into yours. It defaults to DeepSeek's API; the file lists the lines
   for Hermes 4 on OpenRouter, LM Studio and Ollama.

3. **Add your model key** to `~/.hermes/.env`:
   ```bash
   DEEPSEEK_API_KEY=sk-…        # or OPENROUTER_API_KEY=… for Hermes 4
   ```
   LM Studio and Ollama need no key.

4. **Connect and sign in:**
   ```bash
   hermes mcp test sas-jacky
   ```
   A browser opens to sign in to SAS-JACKY. The token is kept in
   `~/.hermes/mcp-tokens/sas-jacky.json` and refreshed automatically. You should
   see `✓ Tools discovered: 18`.

5. **Use it:**
   ```bash
   hermes -z "What's on my task board? Add 'ship v2' as high priority, then tell Jackie."
   hermes                        # interactive
   ```

## DeepSeek Harness

DeepSeek Harness (`dsh`) connects to MCP servers over stdio, or over HTTP with
fixed headers — it has no OAuth sign-in of its own. So there are two patch
files:

- **[`sas-jacky.oauth.patch.yml`](../harness/deepseek-harness/sas-jacky.oauth.patch.yml)** —
  for everyday use. `dsh` starts [`mcp-remote`](https://www.npmjs.com/package/mcp-remote),
  which opens a browser to sign in once, caches the token in `~/.mcp-auth`, and
  relays every call.
- **[`sas-jacky.token.patch.yml`](../harness/deepseek-harness/sas-jacky.token.patch.yml)** —
  for scripts, with an OAuth access token in `SAS_JACKY_TOKEN`.

```bash
export DEEPSEEK_API_KEY=sk-…
npx @deepseek-ai/dsh web --patch "$PWD/harness/deepseek-harness/sas-jacky.oauth.patch.yml"
# or, one job and exit:
npx @deepseek-ai/dsh --profile headless --patch "$PWD/harness/deepseek-harness/sas-jacky.oauth.patch.yml" \
  "Summarise my open tasks and remember that I prefer short answers."
```

To keep it on for every run, merge the file's `insert` entry into
`$DSH_HOME/cordis.patch.yml`. The tools appear to the model as
`mcp__sasjacky__<tool>`. `dsh` is built around DeepSeek's own models; for
Hermes models, use Hermes Agent.

---

## Inside the app: Agent Lab operators

1. Open **Agent Lab** (`/agent-lab`) → **Add DeepSeek & Hermes operators**. That
   installs five agents with **App control** on:

   | Agent | Model | Runs on | Needs |
   | --- | --- | --- | --- |
   | DeepSeek Operator | `deepseek-v4-flash` | DeepSeek API (`jackie-deepseek`) | `DEEPSEEK_API_KEY` in Cloud → Secrets |
   | Hermes Operator | Hermes 3 405B (free) | OpenRouter | `OPENROUTER_API_KEY` |
   | DeepSeek R1 · this PC | `deepseek-r1:14b` | Ollama on this computer | `ollama pull deepseek-r1:14b` |
   | Hermes 3 · this PC | `hermes3:8b` | Ollama on this computer | `ollama pull hermes3:8b` |
   | Hermes · LM Studio | whatever you load | LM Studio on this computer | a model loaded in LM Studio |

2. **Detect local models** lists what LM Studio and Ollama have, DeepSeek and
   Hermes builds first; click one to use it. "This computer" means the browser
   talks to `127.0.0.1:1234` (LM Studio) or `localhost:11434` (Ollama)
   directly: no tunnel, no secret, and the conversation never leaves the
   machine. Both servers must allow the app's origin — LM Studio: **Enable
   CORS** in the server settings; Ollama: start it with `OLLAMA_ORIGINS=*`.

3. Give it a task on the **Bench** and **Run**. Each action it takes is listed,
   with its result, above the final answer.

The action format is plain text — a fenced `action` block — rather than any
provider's tool-calling API, because DeepSeek's API, OpenRouter, LM Studio and
Ollama do not agree on one. Hermes models may also answer in their trained
`<tool_call>` format, which is understood too. DeepSeek R1's `<think>` blocks
are ignored.

DeepSeek also joins the main chat's engine chain (Jacky → Bionic → Ollama →
**DeepSeek** → Cloud) when `DEEPSEEK_API_KEY` is set, and is selectable on
`/micro` and in the provider picker.

---

## What was tested, and what you should check

`harness/e2e/run.sh` runs both harnesses against a local copy of the backend:
the real migrations under PostgREST, and the real built MCP function and
`jackie-bionic` under Deno. It runs in CI (`.github/workflows/harness-e2e.yml`)
whenever something an agent touches changes. It proves that:

- the MCP server refuses a call with no token, and a copied browser session;
- all twenty-one tools work against the real schema and row-level security,
  including `ask_jackie` reaching Jackie through the engine's own quota gate;
- a skill the person wrote loads over MCP and a custom tool runs both its
  steps, while what the agent proposes stays a proposal it cannot use, and
  both uses are recorded in the person's activity;
- **Hermes Agent**, using `harness/hermes/config.yaml`, discovers all twenty-one
  tools and uses them: it creates a task, stores a memory, reads the board, and
  holds a conversation with Jackie that lands in the app;
- **DeepSeek Harness**, using `sas-jacky.token.patch.yml`, does the same, and
  `sas-jacky.oauth.patch.yml` composes into a valid configuration.

The model in that run is scripted: it calls the tools in a fixed order. That
proves the wiring, not a model's judgement. Three things need your real
project and keys:

- [ ] **Sign-in.** `hermes mcp test sas-jacky` opens the SAS-JACKY sign-in and
      ends with `✓ Tools discovered: 18`. If it fails before the browser opens,
      check that the deployed `mcp` function lets unauthenticated requests reach
      its `/.well-known/oauth-protected-resource` document — see "Rig endpoints
      behind the platform JWT check" in `SECURITY_HARDENING.md`.
- [ ] **A real model.** `hermes -z "List my tasks, then add one called 'harness check'."`
      — the new task appears on the app's board.
- [ ] **In the app.** Agent Lab → DeepSeek Operator → Run "Add a task called
      'operator check' and remember that operators work." — two actions are
      listed, and the task and the memory entry exist.

To run the end-to-end yourself (Linux or macOS, with PostgreSQL 16 +
pgvector, Deno 2 and Node 22):

```bash
npm run build
PGHOST=/tmp PGPORT=5433 POSTGREST_BIN=… DENO_BIN=… \
HERMES_BIN=… DSH_BIN=… bash harness/e2e/run.sh
```

`E2E_HOLD=1` keeps the local stack running afterwards, to point a harness at by
hand.
