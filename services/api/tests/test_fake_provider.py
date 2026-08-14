import json

import pytest
from aijian_api.fake_provider import (
    FAKE_HTTP_429_RETRY_AFTER_SECONDS,
    FAKE_PROVIDER_SECRET_SENTINEL,
    FakeStoryExtractProvider,
)
from aijian_api.provider_runtime import (
    ProviderFailureResult,
    ProviderProtocolError,
    ProviderSuccessResult,
    TextProviderRequest,
)
from test_provider_runtime import minimal_output_payload, request_payload


def test_fake_provider_generates_deterministic_minimal_story_extract_output() -> None:
    provider = FakeStoryExtractProvider()
    request = TextProviderRequest.model_validate(request_payload())

    first = provider.invoke_story_extract(request)
    second = provider.invoke_story_extract(request_payload())

    assert isinstance(first, ProviderSuccessResult)
    assert isinstance(second, ProviderSuccessResult)
    assert first == second
    assert first.provider_request_id and first.provider_request_id.startswith("fake_")
    assert first.output.content.title == "林岚来到雾城旧站。"
    assert first.output.content.facts[0].kind == "event_fact"
    assert first.output.source_spans[0].start_byte == 0
    assert first.output.source_spans[0].end_byte == len("林岚来到雾城旧站。".encode())
    assert first.usage.total_tokens == first.usage.input_tokens + first.usage.output_tokens


def test_fake_provider_can_return_a_structured_fixture() -> None:
    result = FakeStoryExtractProvider(fixture=minimal_output_payload()).invoke_story_extract(
        request_payload()
    )

    assert isinstance(result, ProviderSuccessResult)
    assert result.output.content.facts[0].kind == "character_fact"
    assert result.output.source_spans[0].claim == "林岚来到"


@pytest.mark.parametrize(
    ("fault", "code", "retryable", "has_usage", "http_status", "retry_after_seconds"),
    [
        ("timeout", "TIMEOUT", True, False, None, None),
        ("remote_unknown", "REMOTE_UNKNOWN", False, False, None, None),
        ("refused", "REFUSED", False, True, None, None),
        ("protocol_error", "PROTOCOL_ERROR", False, False, None, None),
        ("http_401", "AUTH_ERROR", False, False, 401, None),
        ("http_429", "RATE_LIMITED", True, False, 429, FAKE_HTTP_429_RETRY_AFTER_SECONDS),
        ("http_500", "REMOTE_UNAVAILABLE", True, False, 500, None),
        ("http_502", "REMOTE_UNAVAILABLE", True, False, 502, None),
        ("http_503", "REMOTE_UNAVAILABLE", True, False, 503, None),
        ("http_504", "REMOTE_UNAVAILABLE", True, False, 504, None),
    ],
)
def test_fake_provider_faults_are_structured_results(
    fault: str,
    code: str,
    retryable: bool,
    has_usage: bool,
    http_status: int | None,
    retry_after_seconds: int | None,
) -> None:
    result = FakeStoryExtractProvider(fault=fault).invoke_story_extract(request_payload())  # type: ignore[arg-type]

    assert isinstance(result, ProviderFailureResult)
    assert result.error.code == code
    assert result.error.retryable is retryable
    assert (result.usage is not None) is has_usage
    assert result.error.provider_request_id and result.error.provider_request_id.startswith("fake_")
    assert result.error.http_status == http_status
    assert result.error.retry_after_seconds == retry_after_seconds
    if http_status is not None:
        assert result.error.details.get("http_status") == str(http_status)
    serialized = json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
    assert FAKE_PROVIDER_SECRET_SENTINEL not in serialized
    assert FAKE_PROVIDER_SECRET_SENTINEL not in result.error.message
    assert "Authorization" not in serialized
    assert "api_key" not in serialized


def test_fake_provider_http_429_retry_after_is_deterministic() -> None:
    first = FakeStoryExtractProvider(fault="http_429").invoke_story_extract(request_payload())
    second = FakeStoryExtractProvider(fault="http_429").invoke_story_extract(request_payload())

    assert isinstance(first, ProviderFailureResult)
    assert isinstance(second, ProviderFailureResult)
    assert first.error.retry_after_seconds == FAKE_HTTP_429_RETRY_AFTER_SECONDS
    assert first.error.retry_after_seconds == second.error.retry_after_seconds
    assert first.error.http_status == 429
    assert first == second


def test_fake_provider_rejects_invalid_fixture_as_protocol_error() -> None:
    fixture = minimal_output_payload()
    fixture["source_spans"] = []

    with pytest.raises(ProviderProtocolError, match="fixture"):
        FakeStoryExtractProvider(fixture=fixture)


def test_fake_provider_rejects_fixture_from_another_source_scope() -> None:
    fixture = minimal_output_payload()
    fixture["content"]["source_scope"]["source_manifest_version_id"] = "ver_" + "f" * 32  # type: ignore[index]

    with pytest.raises(ProviderProtocolError, match="different source manifest"):
        FakeStoryExtractProvider(fixture=fixture).invoke_story_extract(request_payload())


def test_fake_provider_rejects_unsupported_constructed_operation() -> None:
    request = TextProviderRequest.model_validate(request_payload())
    unsafe_request = request.model_copy(update={"operation": "image.generate"})

    with pytest.raises(ProviderProtocolError, match="story.extract"):
        FakeStoryExtractProvider().invoke_story_extract(unsafe_request)


def test_fake_provider_handles_blank_or_ascii_text_deterministically() -> None:
    blank_payload = request_payload()
    document = blank_payload["documents"][0]  # type: ignore[index]
    document["filename"] = "untitled.txt"  # type: ignore[index]
    block = document["blocks"][0]  # type: ignore[index]
    block["text"] = "   "  # type: ignore[index]
    block["end_byte"] = 3  # type: ignore[index]

    blank = FakeStoryExtractProvider().invoke_story_extract(blank_payload)

    assert isinstance(blank, ProviderSuccessResult)
    assert blank.output.content.title == "untitled"
    assert blank.output.content.entities[0].name == "主角"
    assert blank.output.source_spans[0].claim == "空白来源"

    ascii_payload = request_payload()
    document = ascii_payload["documents"][0]  # type: ignore[index]
    document["filename"] = ".txt"  # type: ignore[index]
    block = document["blocks"][0]  # type: ignore[index]
    block["text"] = "opening line"  # type: ignore[index]
    block["end_byte"] = len("opening line")  # type: ignore[index]

    ascii_result = FakeStoryExtractProvider().invoke_story_extract(ascii_payload)

    assert isinstance(ascii_result, ProviderSuccessResult)
    assert ascii_result.output.content.title == "opening line"
    assert ascii_result.output.content.entities[0].name == "主角"
