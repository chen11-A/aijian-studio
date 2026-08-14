"""Deterministic fake provider for story.extract boundary tests and fixtures."""

from __future__ import annotations

from hashlib import sha256
from typing import Literal

from pydantic import ValidationError

from aijian_api.provider_runtime import (
    ProviderFailureError,
    ProviderFailureResult,
    ProviderProtocolError,
    ProviderSuccessResult,
    StoryExtractProviderOutput,
    TextProviderRequest,
    TextProviderUsage,
)

type FakeProviderFault = Literal[
    "timeout",
    "remote_unknown",
    "refused",
    "protocol_error",
]


class FakeStoryExtractProvider:
    """A provider boundary double that never performs network or persistence work."""

    def __init__(
        self,
        *,
        fault: FakeProviderFault | None = None,
        fixture: StoryExtractProviderOutput | dict[str, object] | None = None,
    ) -> None:
        self._fault = fault
        try:
            self._fixture = (
                None if fixture is None else StoryExtractProviderOutput.model_validate(fixture)
            )
        except ValidationError as error:
            raise ProviderProtocolError("Fake provider fixture violates provider output") from error

    def invoke_story_extract(
        self,
        request: TextProviderRequest | dict[str, object],
    ) -> ProviderSuccessResult | ProviderFailureResult:
        parsed_request = TextProviderRequest.model_validate(request)
        if parsed_request.operation != "story.extract":
            raise ProviderProtocolError("Fake provider only supports story.extract")
        usage = _usage(parsed_request)
        if self._fault is not None:
            return _failure(parsed_request, self._fault, usage)
        output = self._fixture or _extract_story(parsed_request)
        return ProviderSuccessResult(
            kind="success",
            request_id=parsed_request.request_id,
            provider_request_id=_provider_request_id(parsed_request),
            output=output,
            usage=usage,
            latency_ms=0,
        )


def _failure(
    request: TextProviderRequest,
    fault: FakeProviderFault,
    usage: TextProviderUsage,
) -> ProviderFailureResult:
    code_by_fault = {
        "timeout": "TIMEOUT",
        "remote_unknown": "REMOTE_UNKNOWN",
        "refused": "REFUSED",
        "protocol_error": "PROTOCOL_ERROR",
    }
    retryable_by_fault = {
        "timeout": True,
        "remote_unknown": True,
        "refused": False,
        "protocol_error": False,
    }
    return ProviderFailureResult(
        kind="failure",
        request_id=request.request_id,
        error=ProviderFailureError(
            code=code_by_fault[fault],
            message=f"Fake provider injected {fault.replace('_', ' ')}",
            retryable=retryable_by_fault[fault],
            provider_request_id=_provider_request_id(request),
            details={"source": "fake_provider"},
        ),
        usage=usage if fault == "refused" else None,
        latency_ms=0,
    )


def _extract_story(request: TextProviderRequest) -> StoryExtractProviderOutput:
    document = request.documents[0]
    block = document.blocks[0]
    text = block.text.strip()
    title = _title(document.filename, text)
    protagonist = _first_name(text) or "主角"
    location = "故事现场"
    first_claim = _first_claim(text)
    first_claim_bytes = first_claim.encode("utf-8")
    start_byte = block.start_byte + block.text.encode("utf-8").find(first_claim_bytes)
    if start_byte < block.start_byte:
        start_byte = block.start_byte
    end_byte = start_byte + len(first_claim_bytes)

    content = {
        "title": title,
        "logline": f"{protagonist}在{location}经历了开篇事件。",
        "source_scope": {
            "source_manifest_version_id": request.source_manifest_version_id,
            "scope_type": "full_work",
            "documents": [
                {
                    "source_document_id": item.source_document_id,
                    "raw_sha256": item.raw_sha256,
                    "source_block_ids": [
                        source_block.source_block_id for source_block in item.blocks
                    ],
                    "chapter_indices": sorted(
                        {source_block.chapter_index for source_block in item.blocks}
                    ),
                }
                for item in request.documents
            ],
            "exclusions": [],
        },
        "entities": [
            {
                "entity_id": {"ref_type": "client_key", "client_key": "character.primary"},
                "kind": "character",
                "name": protagonist,
                "aliases": [],
            },
            {
                "entity_id": {"ref_type": "client_key", "client_key": "location.primary"},
                "kind": "location",
                "name": location,
                "aliases": [],
            },
        ],
        "facts": [
            {
                "fact_id": {"ref_type": "client_key", "client_key": "fact.opening_event"},
                "kind": "event_fact",
                "importance": "core",
                "origin": "source_explicit_assertion",
                "canon_status": "proposed",
                "extraction_confidence_bps": 7000,
                "canon_certainty": "likely",
                "viewpoint_entity_id": None,
                "source_reliability": "reliable",
                "decision_reason": None,
                "impact_scope": [],
                "supersedes_fact_ids": [],
                "derived_from_fact_ids": [],
                "participants": [
                    {"ref_type": "client_key", "client_key": "character.primary"},
                ],
                "location_id": {"ref_type": "client_key", "client_key": "location.primary"},
                "source_narrative_order": 1,
                "story_time_order": 1,
                "temporal_relations": [],
                "caused_by_fact_ids": [],
                "state_changes": [],
            }
        ],
        "questions": [],
        "conflicts": [],
    }
    span = {
        "fact_id": {"ref_type": "client_key", "client_key": "fact.opening_event"},
        "source_document_id": document.source_document_id,
        "source_block_id": block.source_block_id,
        "role": "supports",
        "start_byte": start_byte,
        "end_byte": end_byte,
        "claim": first_claim,
    }
    return StoryExtractProviderOutput.model_validate(
        {
            "content": content,
            "source_spans": [span],
            "reviewer_notes": ["Fake provider output is deterministic and requires review."],
        }
    )


def _title(filename: str, text: str) -> str:
    first_line = next((line.strip(" #　") for line in text.splitlines() if line.strip()), "")
    if first_line:
        return first_line[:120]
    return filename.rsplit(".", 1)[0][:120] or "未命名故事"


def _first_name(text: str) -> str | None:
    for token in ("林岚", "阿岚", "李雷", "韩梅梅"):
        if token in text:
            return token
    for character in text:
        if "\u4e00" <= character <= "\u9fff":
            return character
    return None


def _first_claim(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped[:120]
    return "空白来源"


def _usage(request: TextProviderRequest) -> TextProviderUsage:
    input_tokens = sum(
        len(block.text) for document in request.documents for block in document.blocks
    )
    output_tokens = max(1, input_tokens // 4)
    return TextProviderUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
    )


def _provider_request_id(request: TextProviderRequest) -> str:
    digest = sha256(
        f"{request.provider_connection_id}:{request.model_id}:{request.idempotency_key}".encode()
    ).hexdigest()
    return f"fake_{digest[:32]}"
