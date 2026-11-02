# SAS-JACKY Command Station

Jackie core assistant framework with integrated AI Workstation Command Station for model vault management, hybrid CPU/GPU/DRAM routing, and filesystem organization.

## Command Station

This repository now includes a unified command station for AI Workstation organization, model vault management, and JackieOS engine integration.

### Overview
- **Model Vault**: Permanent storage on `E:\AI_Permanent\Models` with indefinite retention
- **Hybrid Routing**: CPU/GPU/DRAM orchestration for QWYTHOS-9B, Muse-Glimmer-30B, GPT-OSS, Qwen2-7B, Llama3-8B, Mistral-7B, Phi-3-mini
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

## Jackie Core

Persistent personal AI assistant built to be grounded, useful, protective, modular, and adaptable.

- Identity: `Jackie/core/`
- Engine FS layer: `Jackie/core/engine/fs/`
- Behavior rules and architecture docs in `Jackie/`

## Development

This project was built with Lovable. Live app: https://sasjacky777.lovable.app

Continue developing in Lovable editor or locally with Node.js/npm.
