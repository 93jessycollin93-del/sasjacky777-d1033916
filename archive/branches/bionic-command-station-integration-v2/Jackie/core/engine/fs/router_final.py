"""
SASHub — Router Agent for Jackie OS
===============================
Local AI Router Gateway: Direct Ollama calls, multi-model routing.

Jackie → Router → Ollama → GPU/NPU → Pods/Backpacks

Endpoints:
  POST /chat/completions  - Primary endpoint (OpenAI-style)
  POST /complete/auto     - Lightweight auto-complete
  GET    /ready           - Health check + available models
  GET    /health          - Detailed health info
"""

from fastapi import FastAPI, Request
import requests
import logging
import time
import subprocess
import json
from typing import Dict, Any, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jackie-router")

app = FastAPI(title="Local AI Router", version="1.0", description="Jackie OS Router Gateway")
OLLAMA_URL = "http://localhost:11434"


# ────────────────────────────────
# Hardware / Environment Probes
# ────────────────────────────────

def detect_gpu() -> Dict[str, Any]:
    """Return basic GPU presence info."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        gpus = [line.strip() for line in out.splitlines() if line.strip()]
        return {"has_gpu": len(gpus) > 0, "gpus": gpus}
    except Exception:
        logger.warning("GPU detection failed")
        return {"has_gpu": False, "gpus": []}

def detect_npu() -> Dict[str, Any]:
    """Placeholder for NPU detection (Windows / DirectML / vendor APIs)."""
    # Extend with your actual NPU detection here
    logger.info("NPU detection placeholder — wire real NPU API later")
    return {"has_npu": False, "details": []}


# ──────────────────────────────── Pod / Backpack Partition Hooks
# ────────────────────────────────

def extract_pod_metadata(payload: Dict[str, Any]) -> Dict[str, str]:
    """Read pod/backpack hints from the request."""
    pod_id = payload.get("pod_id", "general")
    backpack_id = payload.get("backpack_id", "general")
    memory_partition = payload.get("memory_partition")
    return {
        "pod_id": pod_id,
        "backpack_id": backpack_id,
        "memory_partition": memory_partition or None,
    }


def choose_model_by_pod(pod_meta: Dict[str, str], prompt: str) -> str:
    """Pod-aware model selection (placeholder — wire to PodBackpackManager later)."""
    pod_id = pod_meta.get("pod_id", "general")

    # Example: specialize by pod
    if pod_id == "code":
        return "gemma4:26b"
    if pod_id in ("analysis", "planning"):
        return "qwen3.5:latest"
    if pod_id == "memory":
        return "gemma4:26b"

    # Fallback to content-based routing
    return auto_route(prompt)


# ──────────────────────────────── Core Routing Heuristics
# ────────────────────────────────

def auto_route(prompt: str) -> str:
    """Simple content-based routing heuristic."""
    if not prompt or len(prompt) < 10:
        return "qwen3.5:latest"

    lower = prompt.lower()

    # Code / math / structured tasks → heavier model
    code_signals = ["def ", "class ", "import ", "print(", "# ", "```", "return ", "->"]
    if any(sig in lower for sig in code_signals):
        return "gemma4:26b"

    # Long-form / heavy reasoning → heavier model
    if len(prompt) > 1500:
        return "gemma4:26b"

    # Default fast tier
    return "qwen3.5:latest"


def pick_model(payload: Dict[str, Any], prompt: str) -> str:
    """Unified model selection."""
    explicit = payload.get("model")
    if explicit and explicit != "auto":
        return explicit

    pod_meta = extract_pod_metadata(payload)
    return choose_model_by_pod(pod_meta, prompt)


# ──────────────────────────────── Ollama Helpers
# ────────────────────────────────

def list_ollama_models() -> list:
    """List available models in Ollama."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        data = resp.json()
        return [m["name"] for m in data.get("models", [])]
    except Exception as e:
        logger.warning(f"Ollama /api/tags failed: {e}")
        # Fallback to known models
        return ["qwen3.5:latest", "gemma4:26b", "phi3-mini:1.5"]


def call_ollama_generate(model: str, prompt: str) -> Dict[str, Any]:
    """Call Ollama /api/generate."""
    resp = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=120,
    )
    if resp.status_code != 200:
        raise RuntimeError(resp.text[:500])
    return resp.json()


# ──────────────────────────────── Health / Readiness Endpoints
# ────────────────────────────────

@app.get("/ready")
async def ready():
    """Check if Ollama is running and models are available."""
    models = list_ollama_models()
    return {
        "ready": len(models) > 0,
        "models": models,
        "gpu": detect_gpu(),
        "npu": detect_npu(),
    }


@app.get("/health")
async def health():
    """Detailed health information."""
    models = list_ollama_models()
    status = "healthy" if models else "degraded"
    return {
        "status": status,
        "ollama_connected": bool(models),
        "models": models or ["qwen3.5:latest", "gemma4:26b"],
        "gpu": detect_gpu(),
        "npu": detect_npu(),
    }


# ──────────────────────────────── Jackie → Router → Ollama
# ────────────────────────────────

@app.post("/chat/completions")
async def chat_completions(req: Request):
    """Primary endpoint for Jackie agents."""
    try:
        body_bytes = await req.body()
        payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
    except Exception:
        payload = {}

    messages = payload.get("messages", [])
    prompt = ""

    if isinstance(messages, list) and messages:
        first = messages[0]
        if isinstance(first, dict):
            prompt = str(first.get("content", "") or "")

    model_path = pick_model(payload, prompt)
    logger.info(
        f"[Router] pod={payload.get('pod_id')} backpack={payload.get('backpack_id')} "
        f"model={model_path} prompt_len={len(prompt)}"
    )

    try:
        data = call_ollama_generate(model_path, prompt)
        return {
            "id": f"local-{int(time.time())}",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": data.get("response", ""),
                    }
                }
            ],
            "model_used": model_path,
            "auto_routed": payload.get("model") in (None, "auto"),
            "gpu": detect_gpu(),
            "npu": detect_npu(),
            "pod": extract_pod_metadata(payload),
        }
    except Exception as e:
        logger.exception("Router error: %s", e)
        return {"error": str(e), "model_attempted": model_path}


@app.post("/complete/auto")
async def auto_complete(req: Request):
    """Lightweight endpoint for simple prompts."""
    try:
        body_bytes = await req.body()
        payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
    except Exception:
        payload = {}

    prompt = str(payload.get("prompt", "") or "")
    model_path = pick_model(payload, prompt)

    logger.info(f"[Router:auto] model={model_path} prompt_len={len(prompt)}")

    try:
        data = call_ollama_generate(model_path, prompt)
        return {
            "id": f"local-auto-{int(time.time())}",
            "response": data.get("response", ""),
            "model_used": model_path,
        }
    except Exception as e:
        logger.exception("Auto-complete error: %s", e)
        return {"error": str(e), "model_attempted": model_path}
