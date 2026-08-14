from uuid import UUID

import pytest
from aijian_api.provider_runtime import (
    TEXT_PROVIDER_RESULT_ADAPTER,
    ProviderFailureError,
    ProviderFailureResult,
    ProviderProtocolError,
    ProviderSuccessResult,
    TextProviderRequest,
    TextProviderSourceBlock,
    TextProviderUsage,
    validate_story_extract_result,
)
from pydantic import ValidationError


def request_payload() -> dict[str, object]:
    text = "林岚来到雾城旧站。"
    return {
        "operation": "story.extract",
        "request_id": "11111111-1111-1111-1111-111111111111",
        "provider_connection_id": "pcn_" + "1" * 32,
        "model_id": "fake-story-v1",
        "idempotency_key": "story-1",
        "source_manifest_version_id": "ver_" + "2" * 32,
        "timeout_ms": 30_000,
        "instruction": "抽取可审阅 StoryBible。",
        "documents": [
            {
                "source_document_id": "src_" + "3" * 32,
                "raw_sha256": "a" * 64,
                "filename": "story.txt",
                "blocks": [
                    {
                        "source_block_id": "srcb_" + "4" * 32,
                        "chapter_index": 1,
                        "start_byte": 0,
                        "end_byte": len(text.encode("utf-8")),
                        "text": text,
                    }
                ],
            }
        ],
    }


def minimal_output_payload() -> dict[str, object]:
    return {
        "content": {
            "title": "雾城来信",
            "logline": "林岚在雾城旧站收到无名信。",
            "source_scope": {
                "source_manifest_version_id": "ver_" + "2" * 32,
                "scope_type": "full_work",
                "documents": [
                    {
                        "source_document_id": "src_" + "3" * 32,
                        "raw_sha256": "a" * 64,
                        "source_block_ids": ["srcb_" + "4" * 32],
                        "chapter_indices": [1],
                    }
                ],
                "exclusions": [],
            },
            "entities": [
                {
                    "entity_id": {"ref_type": "client_key", "client_key": "character.primary"},
                    "kind": "character",
                    "name": "林岚",
                    "aliases": [],
                }
            ],
            "facts": [
                {
                    "fact_id": {"ref_type": "client_key", "client_key": "fact.identity"},
                    "kind": "character_fact",
                    "importance": "core",
                    "origin": "source_explicit_assertion",
                    "canon_status": "proposed",
                    "extraction_confidence_bps": 8000,
                    "canon_certainty": "likely",
                    "viewpoint_entity_id": None,
                    "source_reliability": "reliable",
                    "decision_reason": None,
                    "impact_scope": [],
                    "supersedes_fact_ids": [],
                    "derived_from_fact_ids": [],
                    "character_id": {"ref_type": "client_key", "client_key": "character.primary"},
                    "attribute": "开篇状态",
                    "value": "来到旧站",
                    "validity": None,
                }
            ],
            "questions": [],
            "conflicts": [],
        },
        "source_spans": [
            {
                "fact_id": {"ref_type": "client_key", "client_key": "fact.identity"},
                "source_document_id": "src_" + "3" * 32,
                "source_block_id": "srcb_" + "4" * 32,
                "role": "supports",
                "start_byte": 0,
                "end_byte": len("林岚来到".encode()),
                "claim": "林岚来到",
            }
        ],
        "reviewer_notes": [],
    }


def test_text_provider_request_rejects_unknown_fields_and_bad_usage_totals() -> None:
    payload = request_payload()
    payload["unexpected"] = True
    with pytest.raises(ValidationError, match="Extra inputs"):
        TextProviderRequest.model_validate(payload)

    with pytest.raises(ValidationError, match="total"):
        TextProviderUsage(input_tokens=1, output_tokens=1, total_tokens=3)


def test_text_provider_request_validates_byte_ranges_and_document_identity() -> None:
    payload = request_payload()
    document = payload["documents"][0]  # type: ignore[index]
    block = document["blocks"][0]  # type: ignore[index]
    block["end_byte"] = 1  # type: ignore[index]
    with pytest.raises(ValidationError, match="exceeds"):
        TextProviderRequest.model_validate(payload)

    payload = request_payload()
    document = payload["documents"][0]  # type: ignore[index]
    document["blocks"].append(dict(document["blocks"][0]))  # type: ignore[index]
    with pytest.raises(ValidationError, match="block IDs"):
        TextProviderRequest.model_validate(payload)

    payload = request_payload()
    payload["documents"].append(dict(payload["documents"][0]))  # type: ignore[index]
    with pytest.raises(ValidationError, match="document IDs"):
        TextProviderRequest.model_validate(payload)


def test_source_block_rejects_empty_or_reversed_ranges() -> None:
    with pytest.raises(ValidationError, match="empty or reversed"):
        TextProviderSourceBlock.model_validate(
            {
                "source_block_id": "srcb_" + "4" * 32,
                "chapter_index": 1,
                "start_byte": 2,
                "end_byte": 2,
                "text": "x",
            }
        )


def test_provider_results_are_discriminated_and_json_serializable() -> None:
    success = ProviderSuccessResult.model_validate(
        {
            "kind": "success",
            "request_id": "11111111-1111-1111-1111-111111111111",
            "provider_request_id": "remote-1",
            "output": minimal_output_payload(),
            "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
            "latency_ms": 12,
        }
    )

    dumped = success.model_dump(mode="json")
    parsed = TEXT_PROVIDER_RESULT_ADAPTER.validate_python(dumped)

    assert isinstance(parsed, ProviderSuccessResult)
    assert dumped["request_id"] == "11111111-1111-1111-1111-111111111111"

    failure = TEXT_PROVIDER_RESULT_ADAPTER.validate_python(
        {
            "kind": "failure",
            "request_id": UUID("11111111-1111-1111-1111-111111111111"),
            "error": {
                "code": "REMOTE_UNKNOWN",
                "message": "Accepted remotely but final status is unknown",
                "retryable": False,
            },
            "usage": None,
            "latency_ms": 999,
        }
    )

    assert isinstance(failure, ProviderFailureResult)
    assert failure.error.code == "REMOTE_UNKNOWN"


def test_failure_error_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="Extra inputs"):
        ProviderFailureError.model_validate(
            {
                "code": "TIMEOUT",
                "message": "timed out",
                "retryable": True,
                "unknown": "field",
            }
        )

    with pytest.raises(ValidationError, match="must never be marked retryable"):
        ProviderFailureError.model_validate(
            {
                "code": "REMOTE_UNKNOWN",
                "message": "Remote acceptance is unknown",
                "retryable": True,
            }
        )


def test_story_extract_result_must_match_request_provenance() -> None:
    request = TextProviderRequest.model_validate(request_payload())
    payload = {
        "kind": "success",
        "request_id": request.request_id,
        "provider_request_id": "remote-1",
        "output": minimal_output_payload(),
        "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
        "latency_ms": 12,
    }
    result = ProviderSuccessResult.model_validate(payload)

    assert validate_story_extract_result(request, result) is result

    wrong_manifest = result.model_copy(
        update={
            "output": result.output.model_copy(
                update={
                    "content": result.output.content.model_copy(
                        update={
                            "source_scope": result.output.content.source_scope.model_copy(
                                update={"source_manifest_version_id": "ver_" + "f" * 32}
                            )
                        }
                    )
                }
            )
        }
    )
    with pytest.raises(ProviderProtocolError, match="different source manifest"):
        validate_story_extract_result(request, wrong_manifest)

    wrong_request = result.model_copy(update={"request_id": UUID(int=0)})
    with pytest.raises(ProviderProtocolError, match="request ID"):
        validate_story_extract_result(request, wrong_request)


def test_story_extract_result_rejects_foreign_or_misaligned_source_spans() -> None:
    request = TextProviderRequest.model_validate(request_payload())
    result = ProviderSuccessResult.model_validate(
        {
            "kind": "success",
            "request_id": request.request_id,
            "provider_request_id": "remote-1",
            "output": minimal_output_payload(),
            "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
            "latency_ms": 12,
        }
    )
    span = result.output.source_spans[0]

    foreign_block = result.model_copy(
        update={
            "output": result.output.model_copy(
                update={
                    "source_spans": [
                        span.model_copy(update={"source_block_id": "srcb_" + "f" * 32})
                    ]
                }
            )
        }
    )
    with pytest.raises(ProviderProtocolError, match="declared source scope"):
        validate_story_extract_result(request, foreign_block)

    misaligned = result.model_copy(
        update={
            "output": result.output.model_copy(
                update={"source_spans": [span.model_copy(update={"start_byte": 1})]}
            )
        }
    )
    with pytest.raises(ProviderProtocolError, match="UTF-8 boundaries"):
        validate_story_extract_result(request, misaligned)
