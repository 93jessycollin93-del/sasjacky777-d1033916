"""The gateway's request/response logic, tested without FastAPI installed."""

import re
from pathlib import Path

import pytest

from jackierouter import EchoAdapter, NoProviderAvailable, Provider, Router
from jackierouter.gateway import (
    auto_complete_payload,
    build_request,
    chat_completion_payload,
    capability_for,
    create_app,
    extract_messages,
    failure_payload,
    result_payload,
)
from jackierouter.types import Attempt, RouteRequest


def test_whole_transcript_survives_not_just_the_first_turn():
    messages = extract_messages(
        {"messages": [{"role": "user", "content": "one"}, {"role": "assistant", "content": "two"}]}
    )
    assert [m["content"] for m in messages] == ["one", "two"]


def test_bare_prompt_is_accepted():
    assert extract_messages({"prompt": "hello"}) == [{"role": "user", "content": "hello"}]


def test_malformed_messages_fall_back_to_the_prompt():
    assert extract_messages({"messages": [{}], "prompt": "hello"})[0]["content"] == "hello"


def test_empty_payload_yields_an_empty_prompt_not_a_crash():
    assert extract_messages({}) == [{"role": "user", "content": ""}]


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"pod_id": "code"}, "code"),
        ({"backpack_id": "code"}, "code"),
        ({"pod_id": "chat"}, "chat"),
        ({"capability": "vision"}, "vision"),
        ({}, None),
    ],
)
def test_pod_hints_map_to_capabilities(payload, expected):
    assert capability_for(payload, [{"role": "user", "content": "plain words"}]) == expected


def test_code_is_detected_from_content_when_no_hint_is_given():
    messages = [{"role": "user", "content": "def add(a, b):\n    return a + b"}]
    assert capability_for({}, messages) == "code"


def test_long_prompts_ask_for_long_context():
    assert capability_for({}, [{"role": "user", "content": "x" * 2000}]) == "long-context"


def test_explicit_model_becomes_a_pin_but_auto_does_not():
    assert build_request({"prompt": "hi", "model": "gemma4:26b"}).pin == "gemma4:26b"
    assert build_request({"prompt": "hi", "model": "auto"}).pin is None


def test_response_keeps_the_legacy_keys():
    router = Router(
        [Provider(name="e", model="echo-1", adapter=EchoAdapter(reply="hi"))],
    )
    body = result_payload(router.dispatch(RouteRequest(messages=[{"role": "user", "content": "x"}])))
    assert body["result"] == "hi"
    assert body["model_used"] == "echo-1"
    assert body["provider"] == "e"
    assert body["trace"][0]["outcome"] == "ok"


def test_failure_payload_explains_why_every_provider_was_passed_over():
    error = NoProviderAvailable(
        "nope", trace=[Attempt(provider="p", model="m", tier=0, outcome="skipped", detail="disabled")]
    )
    body = failure_payload(error)
    assert body["trace"][0]["detail"] == "disabled"


def test_create_app_explains_itself_when_fastapi_is_missing():
    pytest.importorskip
    try:
        import fastapi  # noqa: F401
    except ImportError:
        with pytest.raises(RuntimeError, match="fastapi"):
            create_app()
    else:  # pragma: no cover - only when the gateway extra is installed
        app = create_app(Router([Provider(name="e", model="m", adapter=EchoAdapter())]))
        assert {route.path for route in app.routes} >= {
            "/api/generate", "/chat/completions", "/complete/auto", "/ready", "/health", "/status",
        }


def test_chat_completions_answers_in_the_shape_the_agent_runtime_reads():
    router = Router([Provider(name="e", model="echo-1", adapter=EchoAdapter(reply="hi"))])
    body = chat_completion_payload(router.dispatch(RouteRequest(messages=[{"role": "user", "content": "x"}])))
    # quickstart.py reads exactly this path; anything else prints an empty answer.
    assert body["choices"][0]["message"] == {"role": "assistant", "content": "hi"}
    assert body["model"] == body["model_used"] == "echo-1"
    assert body["result"] == "hi"
    assert set(body["usage"]) >= {"prompt_tokens", "completion_tokens"}


def test_auto_complete_answers_under_response():
    router = Router([Provider(name="e", model="echo-1", adapter=EchoAdapter(reply="hi"))])
    body = auto_complete_payload(router.dispatch(RouteRequest(messages=[{"role": "user", "content": "x"}])))
    assert body["response"] == "hi"
    assert body["model_used"] == "echo-1"


def test_the_gateway_serves_every_endpoint_the_agent_runtime_calls():
    """
    Read from the source rather than a running app, so it holds in CI, which
    does not install FastAPI. The runtime posted to /chat/completions for weeks
    while the router it ships with served only /api/generate: every agent call
    was a 404, and each half passed its own tests.
    """
    root = Path(__file__).resolve().parents[1]
    client = (root / "Jackie/core/engine/fs/jackie_router_client.py").read_text(encoding="utf-8")
    gateway = (root / "jackierouter/gateway.py").read_text(encoding="utf-8")
    called = set(re.findall(r'self\.router_url}(/[\w/]+)', client))
    served = set(re.findall(r'@app\.(?:get|post)\("([^"]+)"\)', gateway))
    assert called, "found no router calls in the client; the pattern above needs updating"
    assert called <= served, f"called but not served: {sorted(called - served)}"
