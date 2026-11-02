"""The gateway's request/response logic, tested without FastAPI installed."""

import pytest

from jackierouter import EchoAdapter, NoProviderAvailable, Provider, Router
from jackierouter.gateway import (
    build_request,
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
        assert {route.path for route in app.routes} >= {"/api/generate", "/ready", "/health", "/status"}
