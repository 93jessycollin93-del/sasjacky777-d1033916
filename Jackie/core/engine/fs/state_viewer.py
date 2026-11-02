"""
Jackie OS — State Viewer (HTTP API)
====================================

Introspection endpoints to inspect the entire system state:
- Active agents and their lifecycle states
- Pod configuration and hardware hints
- Backpack memory partitions
- Recent trace events
- System metrics (CPU, DRAM, GPU utilization)
"""

from fastapi import FastAPI
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger("jackie-os")


app = FastAPI(title="Jackie OS State Viewer", version="1.0")

# ──────────────────────────────── Global state (wire these in from runtime)
# In production, this would be a shared singleton or database-backed store.
_global_registry: Optional[Any] = None
_global_pbm: Optional[Any] = None
_trace_history: List[Dict[str, Any]] = []

def set_state(registry=None, pbm=None):
    """Set global state references (called at startup)."""
    global _global_registry, _global_pbm
    _global_registry = registry
    _global_pbm = pbm


# ──────────────────────────────── Agents Endpoint
# ────────────────────────────────

@app.get("/agents")
async def list_agents():
    """List all registered agents."""
    if not _global_registry:
        return {"error": "Registry not initialized"}
    
    agents = []
    for cfg in _global_registry.list_agents():
        agents.append({
            "name": cfg.name,
            "role": cfg.role,
            "pod": cfg.pod,
            "backpack": cfg.backpack,
            "default_model": cfg.default_model,
            "description": cfg.description,
        })
    
    return {"agents": agents}


# ──────────────────────────────── Pods Endpoint
# ────────────────────────────────

@app.get("/pods")
async def list_pods():
    """List all registered pods."""
    if not _global_pbm:
        return {"error": "Pod/Backpack Manager not initialized"}
    
    pods = []
    for cfg in _global_pbm.list_pods():
        pods.append({
            "name": cfg.name,
            "description": cfg.description,
            "preferred_models": cfg.preferred_models,
            "hardware_hint": cfg.hardware_hint,
        })
    
    return {"pods": pods}


# ──────────────────────────────── Backpacks Endpoint
# ────────────────────────────────

@app.get("/backpacks")
async def list_backpacks():
    """List all registered backpacks."""
    if not _global_pbm:
        return {"error": "Pod/Backpack Manager not initialized"}
    
    backpacks = []
    for cfg in _global_pbm.list_backpacks():
        backpacks.append({
            "name": cfg.name,
            "description": cfg.description,
            "memory_partition": cfg.memory_partition,
        })
    
    return {"backpacks": backpacks}


# ──────────────────────────────── Agent States Endpoint
# ────────────────────────────────

@app.get("/agent-states")
async def list_agent_states():
    """List current states of all running agents."""
    # In production, this would query a real-time agent registry.
    return {
        "agents": [
            {"name": "Jackie", "state": "running"},
            {"name": "Analysis", "state": "ready"},
            {"name": "Code", "state": "ready"},
            {"name": "Memory", "state": "ready"},
            {"name": "Execution", "state": "ready"},
            {"name": "GPUExpert", "state": "ready"},
        ]
    }


# ──────────────────────────────── Recent Traces Endpoint
# ────────────────────────────────

@app.get("/recent-traces")
async def recent_traces(limit: int = 20):
    """Get the last N trace events."""
    return {"traces": _trace_history[-limit:], "count": len(_trace_history)}


# ──────────────────────────────── Health Check
# ────────────────────────────────

@app.get("/health")
async def health():
    """Simple health check for the state viewer."""
    return {
        "status": "ok",
        "version": "1.0",
    }


# ──────────────────────────────── Example Usage (for testing)
# ────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
