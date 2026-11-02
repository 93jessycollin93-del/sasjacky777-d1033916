"""Optional HTTP gateway.

The library is the product; this is the shell that puts it on a port for
Jackie to talk to. Everything except the route declarations is plain functions
so the request handling is testable without FastAPI installed.
"""

import json
import logging
from typing import Any, Dict, List, Optional

from .errors import NoProviderAvailable
from .router import Router
from .system_profile import probe
from .types import Message, RouteRequest, RoutingResult

logger = logging.getLogger("jackierouter.gateway")

CODE_SIGNALS = ("def ", "class ", "import ", "print(", "```", "return ", "->", "#include")
LONG_PROMPT_CHARS = 1500


def detect_gpu() -> Dict[str, Any]:
    """Report local GPU presence — the tier-0 story starts with owning the metal.

    Kept for the ``/ready`` shape existing callers expect; the full picture
    (VRAM, temperature, installed models) is on ``/system`` and ``/status``.
    """
    profile = probe()
    return {"has_gpu": profile.has_gpu, "gpus": [gpu.name for gpu in profile.gpus]}


def detect_npu() -> Dict[str, Any]:
    profile = probe()
    return {"has_npu": profile.npu.get("detected", False), "details": profile.npu.get("details", [])}


def extract_messages(payload: Dict[str, Any]) -> List[Message]:
    """Accept either a chat transcript or a bare prompt.

    The previous gateway read ``messages[0]`` only, which silently dropped
    every turn after the first. The router needs the whole transcript: the
    handoff briefing is built from it.
    """
    messages = payload.get("messages")
    if isinstance(messages, list) and messages:
        normalized = []
        for message in messages:
            if isinstance(message, dict) and message.get("content"):
                normalized.append(
                    {"role": message.get("role", "user"), "content": str(message["content"])}
                )
        if normalized:
            return normalized

    prompt = payload.get("prompt") or ""
    return [{"role": "user", "content": str(prompt)}]


def capability_for(payload: Dict[str, Any], messages: List[Message]) -> Optional[str]:
    """Map Jackie's pod/backpack hints — then content — onto a capability.

    Capabilities replace the old hard-coded model names: the gateway says what
    kind of work this is, and the configured ladder decides which model gets it.
    """
    explicit = payload.get("capability")
    if explicit:
        return str(explicit)

    pod = payload.get("pod_id")
    backpack = payload.get("backpack_id")
    if pod == "code" or backpack == "code":
        return "code"
    if pod == "chat":
        return "chat"

    text = messages[-1]["content"] if messages else ""
    lowered = text.lower()
    if any(signal in lowered for signal in CODE_SIGNALS):
        return "code"
    if len(text) > LONG_PROMPT_CHARS:
        return "long-context"
    return None


def build_request(payload: Dict[str, Any]) -> RouteRequest:
    messages = extract_messages(payload)
    model = payload.get("model")
    return RouteRequest(
        messages=messages,
        capability=capability_for(payload, messages),
        max_output_tokens=int(payload.get("max_tokens", 512)),
        pin=model if model and model != "auto" else None,
        metadata={"pod_id": payload.get("pod_id"), "backpack_id": payload.get("backpack_id")},
    )


def result_payload(result: RoutingResult) -> Dict[str, Any]:
    """Response body. ``result`` and ``model_used`` stay for existing callers."""
    return {
        "result": result.text,
        "model_used": result.model,
        "provider": result.provider,
        "cost": round(result.cost, 6),
        "handoffs": result.handoffs,
        "usage": {
            "input_tokens": result.usage.input_tokens,
            "output_tokens": result.usage.output_tokens,
        },
        "trace": [
            {
                "provider": attempt.provider,
                "tier": attempt.tier,
                "outcome": attempt.outcome,
                "detail": attempt.detail,
                "seconds_to_exhaustion": attempt.seconds_to_exhaustion,
            }
            for attempt in result.trace
        ],
    }


def failure_payload(error: NoProviderAvailable) -> Dict[str, Any]:
    return {
        "error": str(error),
        "trace": [
            {
                "provider": attempt.provider,
                "outcome": attempt.outcome,
                "detail": attempt.detail,
            }
            for attempt in error.trace
        ],
    }


def create_app(router: Optional[Router] = None):
    """Build the FastAPI app. Requires ``fastapi`` — the core library does not."""
    # NB: no ``from __future__ import annotations`` in this module. FastAPI
    # resolves handler annotations against module globals, and ``Request`` is
    # imported here, inside the function — as a string annotation it would not
    # resolve, and every request would fail validation with a 422.
    try:
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse, StreamingResponse
        from starlette.concurrency import run_in_threadpool
    except ImportError as exc:  # pragma: no cover - depends on the install extra
        raise RuntimeError(
            "the HTTP gateway needs fastapi and uvicorn: pip install 'jackierouter[gateway]'"
        ) from exc

    if router is None:
        from .config import router_from_env

        router = router_from_env()

    app = FastAPI(title="Jackie Router", version="0.1.0")

    @app.post("/api/generate")
    async def generate(request: Request):
        payload = await request.json()
        route_request = build_request(payload)
        try:
            # dispatch does blocking HTTP to the providers. Calling it directly
            # from an async handler would stall the event loop for every other
            # request, including /health, for the length of a model call.
            result = await run_in_threadpool(router.dispatch, route_request)
        except NoProviderAvailable as exc:
            logger.warning("no provider could serve the request: %s", exc)
            return JSONResponse(status_code=503, content=failure_payload(exc))
        logger.info("served by %s (%d handoffs)", result.provider, result.handoffs)
        return result_payload(result)

    @app.get("/ready")
    async def ready():
        gpu = await run_in_threadpool(detect_gpu)  # shells out to nvidia-smi
        return {
            "status": "ok",
            "gpu_available": gpu["has_gpu"],
            "gpus": gpu["gpus"],
            "npu_available": detect_npu()["has_npu"],
            "providers": [p.name for p in router.providers if p.enabled],
        }

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/api/generate/stream")
    async def generate_stream(request: Request):
        """Server-sent events. Failover mid-stream is invisible to the reader:
        the next provider resumes from the cut point."""
        payload = await request.json()
        route_request = build_request(payload)
        stream = router.stream(route_request)

        def produce():
            try:
                for chunk in stream:
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"
            except NoProviderAvailable as exc:
                yield f"data: {json.dumps(failure_payload(exc))}\n\n"
                yield "data: [DONE]\n\n"
                return
            if stream.result is not None:
                yield f"data: {json.dumps({'done': True, **result_payload(stream.result)})}\n\n"
            yield "data: [DONE]\n\n"

        async def relay():
            # The ladder does blocking provider I/O, so it is driven on a
            # worker thread and its chunks handed back to the event loop.
            iterator = produce()
            while True:
                chunk = await run_in_threadpool(lambda: next(iterator, None))
                if chunk is None:
                    return
                yield chunk

        return StreamingResponse(relay(), media_type="text/event-stream")

    @app.get("/system")
    async def system():
        """What machine this router is on, as it sees it right now."""
        return await run_in_threadpool(lambda: probe().summary())

    @app.get("/status")
    async def status():
        """Live quota forecasts, spend, and hardware — the router's vital signs."""
        return await run_in_threadpool(router.status)

    return app
