# Command Station

Central operational layer for AI Workstation organization, model vault management, and JackieOS engine integration.

## Purpose
- Non-destructive file organization and deduplication
- Model vault management with permanent storage on E:
- Hybrid CPU/GPU/DRAM routing configuration
- Path sanitization for Windows compatibility

## Structure
- `models/manifests/` - Master manifests for all model families
- `models/configs/` - Hybrid routing and workstation configs
- `tools/` - Robocopy scripts, vault diff, integrity dashboard, router tests
- `memory_vault/` - Context chunks and embedding pods
- `docs/` - Handoff plans and organization manifests

## Quick Start
```bash
# Set workspace root
export AI_WORKSPACE_ROOT="C:/Users/Eru/AI_ Workspace"
export PERMANENT_STORAGE="E:/AI_Permanent"

# Run maintenance
tools/maintenance_orchestrator.bat
```

## Principles
- Non-destructive — never delete unless explicitly ordered
- Reversible — every action logged
- Predictable — deterministic sorting rules
- Context-aware — respects Jackie_Rebuild, KEEP, MY HOME boundaries
