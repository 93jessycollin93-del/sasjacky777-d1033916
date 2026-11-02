"""
Jackie OS — Router Client
=========================

Deterministic, pod-aware, backpack-aware client for talking to the router.
This is the canonical client Jackie will use to send requests.

Deliberately stdlib-only. `requests` was the single third-party import in the
whole Python tree and was never declared in pyproject, so CI — which installs
pytest and nothing else — could not even collect
`tests/test_jackie_os_runtime.py`. The suite written to prove this runtime
works had therefore never run in the one place that would have caught it,
which is the exact failure that runtime was recovered from.
"""

import json
import urllib.error
import urllib.request
from typing import Dict, Any, Optional


def _post_json(url: str, payload: Dict[str, Any], timeout: int) -> Dict[str, Any]:
    """POST JSON, read JSON back. Raises; callers turn that into an error dict."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _get_json(url: str, timeout: int) -> Dict[str, Any]:
    """GET JSON. Raises; callers turn that into an error dict."""
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _describe_failure(error: Exception) -> str:
    """
    The router's own reason, when it gave one.

    The router answers an unservable request with a 503 whose body names the
    cause ("pinned provider is not configured", every rung rate-limited). urllib
    raises on the status and `str()` of that is "HTTP Error 503: Service
    Unavailable" — the one sentence that tells the orchestrator nothing about
    what to fix.
    """
    if isinstance(error, urllib.error.HTTPError):
        try:
            body = json.loads(error.read().decode("utf-8"))
        except Exception:
            body = None
        if isinstance(body, dict) and body.get("error"):
            return f"router {error.code}: {body['error']}"
        if isinstance(body, dict) and body.get("detail"):
            return f"router {error.code}: {body['detail']}"
    return str(error)


class JackieRouterClient:
    """
    Jackie → Router → Ollama

    Deterministic sovereign OS client.

    Never rewrites itself.
    Never rewrites the router.
    Never mutates payloads.
    Never tries to be 'helpful'.
    Never calls tools.
    Never spawns subprocesses.
    Never changes your environment.
    """

    def __init__(self, router_url: str = "http://127.0.0.1:4000"):
        self.router_url = router_url.rstrip("/")

    # ────────────────────────────────────────
    # Core call builder
    # ────────────────────────────────────────

    def build_payload(
        self,
        task: str,
        content: str,
        pod: str = "general",
        backpack: str = "general",
        model: str = "auto",
        agent: str = "Jackie",
        memory_partition: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build a router-compatible payload."""
        payload = {
            "agent": agent,
            "task": task,
            "model": model,
            "pod_id": pod,
            "backpack_id": backpack,
            "messages": [{"role": "user", "content": content}],
        }

        if memory_partition:
            payload["memory_partition"] = memory_partition

        return payload

    # ────────────────────────────────────────
    # Main call to router
    # ────────────────────────────────────────

    def send(
        self,
        task: str,
        content: str,
        pod: str = "general",
        backpack: str = "general",
        model: str = "auto",
        agent: str = "Jackie",
        memory_partition: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a request to the router and return the result."""
        payload = self.build_payload(
            task=task,
            content=content,
            pod=pod,
            backpack=backpack,
            model=model,
            agent=agent,
            memory_partition=memory_partition,
        )

        try:
            return _post_json(f"{self.router_url}/chat/completions", payload, 120)

        except Exception as e:
            return {
                "error": _describe_failure(e),
                "router_url": self.router_url,
                "payload": payload,
            }

    # ────────────────────────────────────────
    # Lightweight auto-complete endpoint
    # ────────────────────────────────────────

    def auto(self, prompt: str, model: str = "auto") -> Dict[str, Any]:
        """Send a lightweight auto-complete request."""
        try:
            return _post_json(
                f"{self.router_url}/complete/auto",
                {"prompt": prompt, "model": model},
                120,
            )

        except Exception as e:
            return {"error": _describe_failure(e), "prompt": prompt}

    # ────────────────────────────────────────
    # Health checks
    # ────────────────────────────────────────

    def ready(self) -> Dict[str, Any]:
        """Check if the router is running."""
        try:
            return _get_json(f"{self.router_url}/ready", 5)
        except Exception as e:
            return {"ready": False, "error": str(e)}

    def health(self) -> Dict[str, Any]:
        """Get detailed router health info."""
        try:
            return _get_json(f"{self.router_url}/health", 5)
        except Exception as e:
            return {"status": "offline", "error": str(e)}
