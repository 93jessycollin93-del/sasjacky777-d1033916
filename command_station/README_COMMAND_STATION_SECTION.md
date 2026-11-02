# Command Station - Repo Integration

## Overview
This repo now serves as a command station for AI Workstation organization, model vault management, and JackieOS engine integration.

## New Structure
- `Jackie/core/engine/fs/` - Path sanitization, resolver, vault router, tool runner
- `command_station/` - Operational layer for manifests, tools, memory vault

## Quick Start
```bash
cp .env.example .env
# Edit .env with AI_WORKSPACE_ROOT and PERMANENT_STORAGE
```

## Key Files
- `command_station/models/manifests/E_PERMANENT_MASTER_MANIFEST.json`
- `command_station/tools/Robocopy_LMStudio_to_E.bat`
- `Jackie/core/engine/bootstrap_fs.py`

## Principles
Non-destructive, reversible, predictable, context-aware, workstation-grade.

See `command_station/docs/REPO_COMMAND_STATION_INTEGRATION_PLAN.md` for full plan.
