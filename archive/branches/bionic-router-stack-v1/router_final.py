#!/usr/bin/env python3
"""
Local AI Router Gateway - Direct Ollama Calls
Jackie → Router → Ollama → GPU/NPU → Pods/Backpacks
"""

from fastapi import FastAPI, Request
import requests, logging, time, subprocess, json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jackie-router")

app = FastAPI(title="Local AI Router", version="1.0")
OLLAMA_URL = "http://localhost:11434"


def detect_gpu():
    """Return basic GPU presence info."""
    try:
        out = subprocess.check_output(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                                      stderr=subprocess.DEVNULL, text=True)
        gpus = [line.strip() for line in out.splitlines() if line.strip()]
        return {"has_gpu": len(gpus) > 0, "gpus": gpus}
    except Exception:
        return {"has_gpu": False, "gpus": []}


def detect_npu():
    """Placeholder for NPU detection (Windows / DirectML / vendor APIs)."""
    return {"has_npu": False, "details": []}


def extract_pod_metadata(payload: dict):
    """Read pod/backpack hints from the request."""
    pod_id = payload.get("pod_id")
    backpack_id = payload.get("backpack_id")
    return {"pod_id": pod_id, "backpack_id": backpack_id}


def choose_model_by_pod(pod_meta: dict, prompt: str):
    """Pod-aware routing hook."""
    pod_id = pod_meta.get("pod_id")
    backpack_id = pod_meta.get("backpack_id")

    if pod_id == "code" or backpack_id == "code":
        return "gemma4:26b"
    if pod_id == "chat":
        return "qwen3.5:latest"
    return auto_route(prompt)


def auto_route(prompt: str):
    """Simple content-based routing."""
    if not prompt or len(prompt) < 10:
        return "qwen3.5:latest"

    lower = prompt.lower()
    code_signals = ["def ", "class ", "import ", "print(", "# ", "```", "return ", "->"]
    if any(sig in lower for sig in code_signals):
        return "gemma4:26b"

    if len(prompt) > 1500:
        return "gemma4:26b"

    return "qwen3.5:latest"


def pick_model(payload: dict, prompt: str):
    """Unified model selection."""
    explicit = payload.get("model")
    if explicit and explicit != "auto":
        return explicit

    pod_meta = extract_pod_metadata(payload)
    return choose_model_by_pod(pod_meta, prompt)


@app.post("/api/generate")
async def generate(request: Request):
    """POST /api/generate — Jackie sends messages here."""
    body = await request.json()
    prompt = body.get("messages", [{}])[0].get("content", "")

    model = pick_model(body, prompt)
    logger.info(f"Routing to {model}")

    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": model, "prompt": prompt},
            timeout=60
        )
        if resp.status_code == 200:
            data = resp.json()
            return {"result": data.get("response"), "model_used": model}
        raise Exception(resp.text)
    except Exception as e:
        logger.error(f"Ollama call failed: {e}")
        return {"error": str(e)}


@app.get("/ready")
async def ready():
    """/ready — health check."""
    gpu = detect_gpu()
    npu = detect_npu()
    return {
        "status": "ok",
        "gpu_available": gpu["has_gpu"],
        "npu_available": npu["has_npu"],
        "ollama_url": OLLAMA_URL,
    }


@app.get("/health")
async def health():
    """/health — lightweight probe."""
    return {"status": "ok"}
