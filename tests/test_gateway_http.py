"""Live HTTP tests. Skipped unless the gateway extra is installed.

These exist because the pure-function tests could not have caught a 422 caused
by how FastAPI resolves handler annotations — only a real request could.
"""

import pytest

fastapi = pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from jackierouter import EchoAdapter, Provider, RateLimited, Router  # noqa: E402
from jackierouter.gateway import create_app  # noqa: E402


class Dead:
    def complete(self, messages, request):
        raise RateLimited("quota spent", provider="dead", retry_after=60)


@pytest.fixture
def client():
    router = Router(
        [
            Provider(name="dead", model="dead-1", adapter=Dead(), tier=0),
            Provider(name="backup", model="backup-1", adapter=EchoAdapter(reply="carried on"), tier=1),
        ]
    )
    return TestClient(create_app(router))


def test_generate_returns_200_and_the_legacy_shape(client):
    response = client.post("/api/generate", json={"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 200
    body = response.json()
    assert body["result"] == "carried on"
    assert body["model_used"] == "backup-1"
    assert body["handoffs"] == 1
    assert [(t["provider"], t["outcome"]) for t in body["trace"]] == [
        ("dead", "rate_limited"),
        ("backup", "ok"),
    ]


def test_bare_prompt_still_works(client):
    assert client.post("/api/generate", json={"prompt": "hi"}).status_code == 200


def test_unservable_request_is_a_503_with_the_reason(client):
    response = client.post("/api/generate", json={"prompt": "hi", "model": "nonexistent"})
    assert response.status_code == 503
    assert response.json()["trace"][0]["detail"] == "pinned provider is not configured"


def test_probes_and_status(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").json()["providers"] == ["dead", "backup"]
    assert {p["name"] for p in client.get("/status").json()["providers"]} == {"dead", "backup"}


class DiesMidStream:
    def stream(self, messages, request):
        from jackierouter.types import StreamEvent

        yield StreamEvent(text="BEGIN; ")
        raise RateLimited("quota spent", provider="dead", retry_after=60)


def test_stream_endpoint_emits_sse_and_hides_the_failover():
    router = Router(
        [
            Provider(name="dead", model="d", adapter=DiesMidStream(), tier=0),
            Provider(name="backup", model="b", adapter=EchoAdapter(reply="COMMIT;"), tier=1),
        ]
    )
    response = TestClient(create_app(router)).post(
        "/api/generate/stream", json={"prompt": "down-migration"}
    )
    assert response.status_code == 200

    import json as _json

    payloads = [
        _json.loads(line[5:].strip())
        for line in response.text.splitlines()
        if line.startswith("data:") and line[5:].strip() != "[DONE]"
    ]
    deltas = [p["delta"] for p in payloads if "delta" in p]
    final = next(p for p in payloads if p.get("done"))

    assert "".join(deltas) == "BEGIN; COMMIT;"
    assert final["provider"] == "backup"
    assert final["handoffs"] == 1
    assert response.text.rstrip().endswith("data: [DONE]")


def test_stream_endpoint_reports_an_unroutable_request_in_band():
    router = Router([Provider(name="off", model="m", adapter=EchoAdapter(), enabled=False)])
    response = TestClient(create_app(router)).post("/api/generate/stream", json={"prompt": "x"})
    assert response.status_code == 200  # the stream already started; errors ride in it
    assert "disabled" in response.text


def test_system_endpoint_describes_the_machine(client):
    body = client.get("/system").json()
    assert "accelerator" in body and "ollama_reachable" in body


def test_ready_still_reports_gpu_presence(client):
    body = client.get("/ready").json()
    assert set(body) >= {"status", "gpu_available", "gpus", "npu_available", "providers"}
