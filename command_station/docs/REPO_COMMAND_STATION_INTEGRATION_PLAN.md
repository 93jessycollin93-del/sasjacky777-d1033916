# Repo Command Station Integration Plan
**Repo:** yyb84ycgt6-oss/sasjacky777-d1033916  
**Goal:** Turn the repo into a unified command station for AI Workstation organization, model vault management, and JackieOS engine integration  
**Date:** 2026-08-28

## Current Repo Assessment

**Type:** Lovable-hosted UI-first app with Jackie assistant core docs
**Structure:**
- `Jackie/` — identity, behavior rules, architecture docs, cluster modules
- `src/` — React/Vue UI
- `docs/` — empty
- `Jackie/core/` — currently `.gitkeep` only

**Strengths:**
- Clear identity/behavior foundation
- Modular folder intent already defined
- GitHub as single source of truth

**Gaps for Command Station:**
- No filesystem organization layer
- No model vault manifest management
- No path sanitization / Windows compatibility layer
- No tools for duplicate detection, mirroring, integrity checks
- No hybrid CPU/GPU/DRAM routing config

## Proposed Integration Architecture

Keep UI layer untouched. Add command station as parallel engine layer.

```
sasjacky777-d1033916/
├── Jackie/
│   ├── core/
│   │   ├── engine/
│   │   │   ├── fs/               # NEW - Path sanitization, resolver, vault routing
│   │   │   │   ├── path_sanitizer.py
│   │   │   │   ├── resolver.py
│   │   │   │   ├── vault_router.py
│   │   │   │   ├── tool_runner.py
│   │   │   │   └── manifest_locator.py
│   │   │   ├── routing/
│   │   │   │   └── hybrid_router.py
│   │   │   └── orchestrator/
│   │   │       └── maintenance_orchestrator.py
│   │   └── ... existing cluster modules
│   ├── knowledge/
│   └── ...
├── command_station/              # NEW TOP-LEVEL
│   ├── models/
│   │   ├── manifests/
│   │   │   └── E_PERMANENT_MASTER_MANIFEST.json
│   │   └── configs/
│   │       ├── hybrid_routing_config.json
│   │       └── workstation_config.json
│   ├── tools/
│   │   ├── Robocopy_LMStudio_to_E.bat
│   │   ├── Robocopy_E_to_LMStudio.bat
│   │   ├── vault_diff_tool.py
│   │   ├── integrity_dashboard.py
│   │   ├── test_router_suite.py
│   │   └── maintenance_orchestrator.bat
│   ├── memory_vault/
│   │   ├── pods/
│   │   └── embeddings/
│   └── docs/
│       ├── QWYTHOS_9B_1M_HANDOFF_PLAN.md
│       └── ORGANIZATION_MANIFEST.md
├── src/                          # Existing UI - unchanged
└── docs/                         # Repo docs
```

## Why This Is A Good Idea

1. **Non-destructive:** UI layer remains untouched. Command station is additive.
2. **Reversible:** All new files are new directories, no existing code modified.
3. **Context-aware:** Respects Jackie_Rebuild, KEEP, MY HOME boundaries via vault_router config.
4. **Drive-wide clarity:** Centralizes manifests, tools, and routing configs in one repo.
5. **Workstation-grade:** Provides stable, quiet, efficient operational layer.

## Integration Steps

> **All four phases complete (verified 12 Sep 2026).**
>
> 1. `Jackie/core/engine/fs/` — `path_sanitizer.py`, `resolver.py`, `vault_router.py`,
>    `tool_runner.py`, `manifest_locator.py`, with `__init__.py`
> 2. `command_station/` — manifests, tools and docs at the top level
> 3. `.env.example` — `AI_WORKSPACE_ROOT` and `PERMANENT_STORAGE` declared
> 4. `command_station/models/manifests/E_PERMANENT_MASTER_MANIFEST.json`
>
> One caveat worth carrying forward: nothing runs the Python side. There are 42 `.py`
> files here and in `Jackie/`, `Jackie/tests/` is empty, and `npm test` covers only
> `src/`. Whether that code is live, reference or archive is still an open question.


### Phase 1 - Engine/fs Layer Sync
1. Create `Jackie/core/engine/fs/` in repo
2. Push existing local files
3. Add `__init__.py` for importability

### Phase 2 - Command Station Scaffold
1. Create `command_station/` top-level
2. Move manifests, tools, docs from local AI_Workstation into repo
3. Convert Windows paths to portable placeholders

### Phase 3 - Path Sanitization Integration
1. Update all batch scripts to use `safe()` quoting
2. Add `.env.example` for `AI_WORKSPACE_ROOT`, `PERMANENT_STORAGE`
3. Document Windows space handling

### Phase 4 - Model Vault Link
1. Add `models/manifests/` with master manifest
2. Add `models/configs/` for hybrid routing
3. Create symlink/pointer docs to `E:\AI_Permanent\Models`

## Recommendation

Yes, this is a good idea. Repo has strong identity/UI foundation. Adding command station makes it a true workstation control plane without breaking Lovable workflow.
