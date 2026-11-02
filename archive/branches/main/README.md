# SAS-JACKY Command Station

Jackie core assistant framework with integrated AI Workstation Command Station for model vault management, hybrid CPU/GPU/DRAM routing, and filesystem organization.

## Command Station

This repository now includes a unified command station for AI Workstation organization, model vault management, and JackieOS engine integration.

### Overview
- **Model Vault**: Permanent storage on `E:\AI_Permanent\Models` with indefinite retention
- **Hybrid Routing**: CPU/GPU/DRAM orchestration for QWYTHOS-9B, Muse-Glimmer-30B, GPT-OSS, Qwen2-7B, Llama3-8B, Mistral-7B, Phi-3-mini — resource detection is measured, and unmeasurable values stay unknown rather than being invented
- **Path Safety**: Windows-safe path sanitization for `AI_ Workspace` with spaces
- **Tools Suite**: Integrity dashboard, vault diff, maintenance orchestrator, router test suite

### Structure
```
command_station/
├── docs/          # Manifests, handoff plans, implementation docs
├── tools/         # Robocopy scripts, router, integrity checks
├── models/        # Model configs and manifests
└── memory_vault/  # Context chunks and embedding pods
```

### Quick Start
1. Copy `.env.example` to `.env` and set `AI_WORKSPACE_ROOT` and `PERMANENT_STORAGE`
2. Run `command_station/tools/maintenance_orchestrator.bat` for nightly maintenance
3. Use `Jackie/core/engine/fs/` for path-safe operations

See `command_station/README.md` for full details.

## jackierouter

`jackierouter/` is the routing library that sits behind the gateway — the piece
that is worth installing on its own.

- **Predictive quota forecasting.** A sliding-window ledger measures burn rate
  per provider and predicts seconds-to-exhaustion, so the router migrates while
  headroom remains instead of discovering a 429.
- **Cost-tiered failover.** Tier 0 is your own hardware. A paid provider is
  never reached for while a free one is healthy, and rolling hourly/daily spend
  caps are the hard stop behind that.
- **Context-preserving handoff.** Each failover attaches a briefing built from
  the interrupted turn — the task, what was established, the tail of the partial
  output — so the next model continues mid-thought rather than starting cold.
  Works mid-stream: the reader sees one continuous response across a provider
  change.
- **Hardware awareness.** It detects the actual machine — GPU, VRAM free, GPU
  temperature, RAM, NPU, and which Ollama models are really pulled — and skips a
  local provider *before* the call when the box is asleep, thermally gated, out
  of VRAM, or missing the model.
- **Durable state.** Quota and spend are persisted, so a restarted service does
  not hand a provider a fresh quota mid-burn.

Zero third-party dependencies in the core. Full docs: `jackierouter/README.md`.

```bash
python -m jackierouter detect                      # what this machine is
python -m jackierouter suggest -o router.config.json   # a ladder for it
export JACKIEROUTER_CONFIG=$PWD/router.config.json
python -m jackierouter ask "hello" --stream        # route a prompt
python examples/demo_failover.py                   # offline proof, no API keys
python examples/demo_hardware.py                   # thermal + VRAM gating
python -m pytest                                   # 172 tests, no network
```

`router_final.py` is now a thin HTTP shell over it (`pip install fastapi uvicorn`),
serving the same `/api/generate`, `/ready` and `/health` as before, plus
`/api/generate/stream` (SSE), `/system` for detected hardware, and `/status`
for live quota, spend and gating.

## Jackie Core

Persistent personal AI assistant built to be grounded, useful, protective, modular, and adaptable.

- Identity: `Jackie/core/`
- Engine FS layer: `Jackie/core/engine/fs/`
- Behavior rules and architecture docs in `Jackie/`

## Development

This project was built with Lovable. Live app: https://sasjacky777.lovable.app

Continue developing in Lovable editor or locally with Node.js/npm.
