"""Provider runtime contracts for deterministic text generation boundaries."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from aijian_api.story_bible_drafts import (
    ClientRefV1,
    LocalRefV1,
    StoryBibleContentDraftV1,
    StorySourceSpanDraftV1,
)

type ProviderErrorCode = Literal[
    "TIMEOUT",
    "REMOTE_UNKNOWN",
    "REFUSED",
    "PROTOCOL_ERROR",
    "AUTH_ERROR",
    "RATE_LIMITED",
    "REMOTE_UNAVAILABLE",
]

# TIMEOUT keeps the pre-T06A public/persisted class-name code for StoryExtractTaskData
# compatibility. HTTP matrix codes and other domain codes pass through unchanged.
_LEGACY_PUBLIC_RETRYABLE_ERROR_CODE = "ProviderRetryableError"


def public_provider_error_code(code: ProviderErrorCode) -> str:
    """Map typed provider codes to the public/persisted Task Ledger error_code."""

    if code == "TIMEOUT":
        return _LEGACY_PUBLIC_RETRYABLE_ERROR_CODE
    return code


class ProviderRuntimeError(RuntimeError):
    """Base class for provider runtime exceptions before a result can be trusted."""


class ProviderNonRetryableError(ProviderRuntimeError):
    """Raised when repeating the same provider request is not permitted."""

    def __init__(self, message: str, *, code: ProviderErrorCode = "PROTOCOL_ERROR") -> None:
        super().__init__(message)
        self.code = code

    @property
    def public_error_code(self) -> str:
        return public_provider_error_code(self.code)


class ProviderProtocolError(ProviderNonRetryableError):
    """Raised when a provider response cannot be parsed into the runtime contract."""


class ProviderRetryableError(ProviderRuntimeError):
    """Raised when a provider failure may legally re-enter the local retry path."""

    def __init__(
        self,
        message: str,
        *,
        code: ProviderErrorCode,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retry_after_seconds = retry_after_seconds

    @property
    def public_error_code(self) -> str:
        return public_provider_error_code(self.code)


class RemoteUnknownProviderError(ProviderRuntimeError):
    """Raised when acceptance is unknown and the attempt must be reconciled."""


class _StrictProviderModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class TextProviderUsage(_StrictProviderModel):
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    total_tokens: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_total(self) -> TextProviderUsage:
        if self.total_tokens != self.input_tokens + self.output_tokens:
            raise ValueError("Provider usage total must equal input plus output tokens")
        return self


class TextProviderSourceBlock(_StrictProviderModel):
    source_block_id: str = Field(pattern=r"^srcb_[0-9a-f]{32}$")
    chapter_index: int = Field(ge=1)
    start_byte: int = Field(ge=0)
    end_byte: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=200_000)

    @model_validator(mode="after")
    def validate_byte_range(self) -> TextProviderSourceBlock:
        if self.start_byte >= self.end_byte:
            raise ValueError("Provider source block range is empty or reversed")
        encoded_size = len(self.text.encode("utf-8"))
        if encoded_size > self.end_byte - self.start_byte:
            raise ValueError("Provider source block text exceeds its byte range")
        return self


class TextProviderSourceDocument(_StrictProviderModel):
    source_document_id: str = Field(pattern=r"^src_[0-9a-f]{32}$")
    raw_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    filename: str = Field(min_length=1, max_length=255)
    blocks: list[TextProviderSourceBlock] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_blocks(self) -> TextProviderSourceDocument:
        previous_end = -1
        block_ids = [block.source_block_id for block in self.blocks]
        if len(set(block_ids)) != len(block_ids):
            raise ValueError("Provider source block IDs must be unique within a document")
        for block in self.blocks:
            if block.start_byte < previous_end:
                raise ValueError("Provider source blocks overlap or are out of order")
            previous_end = block.end_byte
        return self


class TextProviderRequest(_StrictProviderModel):
    operation: Literal["story.extract"]
    request_id: UUID
    provider_connection_id: str = Field(pattern=r"^pcn_[0-9a-f]{32}$")
    model_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    idempotency_key: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    source_manifest_version_id: str = Field(pattern=r"^ver_[0-9a-f]{32}$")
    timeout_ms: int = Field(ge=1, le=600_000)
    documents: list[TextProviderSourceDocument] = Field(min_length=1, max_length=20)
    instruction: str = Field(min_length=1, max_length=10_000)

    @model_validator(mode="after")
    def validate_documents(self) -> TextProviderRequest:
        document_ids = [document.source_document_id for document in self.documents]
        if len(set(document_ids)) != len(document_ids):
            raise ValueError("Provider source document IDs must be unique")
        return self


class StoryExtractProviderOutput(_StrictProviderModel):
    content: StoryBibleContentDraftV1
    source_spans: list[StorySourceSpanDraftV1] = Field(min_length=1, max_length=20_000)
    reviewer_notes: list[str] = Field(default_factory=list, max_length=100)


class ProviderFailureError(_StrictProviderModel):
    code: ProviderErrorCode
    message: str = Field(min_length=1, max_length=1000)
    retryable: bool
    provider_request_id: str | None = Field(default=None, min_length=1, max_length=200)
    details: dict[str, str] = Field(default_factory=dict, max_length=20)
    http_status: int | None = Field(default=None, ge=100, le=599)
    retry_after_seconds: int | None = Field(default=None, ge=0, le=86_400)

    @model_validator(mode="after")
    def validate_failure_classification(self) -> ProviderFailureError:
        if self.code == "REMOTE_UNKNOWN" and self.retryable:
            raise ValueError("REMOTE_UNKNOWN must never be marked retryable")
        if self.code == "AUTH_ERROR" and self.retryable:
            raise ValueError("AUTH_ERROR must never be marked retryable")
        if self.code == "RATE_LIMITED" and not self.retryable:
            raise ValueError("RATE_LIMITED must be marked retryable")
        if self.code == "REMOTE_UNAVAILABLE" and not self.retryable:
            raise ValueError("REMOTE_UNAVAILABLE must be marked retryable")
        if self.retry_after_seconds is not None and self.code != "RATE_LIMITED":
            raise ValueError("retry_after_seconds is only valid for RATE_LIMITED")
        return self


class ProviderSuccessResult(_StrictProviderModel):
    kind: Literal["success"]
    request_id: UUID
    provider_request_id: str | None = Field(default=None, min_length=1, max_length=200)
    output: StoryExtractProviderOutput
    usage: TextProviderUsage
    latency_ms: int = Field(ge=0)


class ProviderFailureResult(_StrictProviderModel):
    kind: Literal["failure"]
    request_id: UUID
    error: ProviderFailureError
    usage: TextProviderUsage | None = None
    latency_ms: int = Field(ge=0)


TextProviderResult = Annotated[
    ProviderSuccessResult | ProviderFailureResult,
    Field(discriminator="kind"),
]
TEXT_PROVIDER_RESULT_ADAPTER: TypeAdapter[TextProviderResult] = TypeAdapter(TextProviderResult)


def validate_story_extract_result(
    request: TextProviderRequest,
    result: ProviderSuccessResult | ProviderFailureResult,
) -> ProviderSuccessResult | ProviderFailureResult:
    """Bind a structurally valid provider result to the exact source request."""

    if result.request_id != request.request_id:
        raise ProviderProtocolError("Provider result request ID does not match the request")
    if isinstance(result, ProviderFailureResult):
        return result

    scope = result.output.content.source_scope
    if scope.source_manifest_version_id != request.source_manifest_version_id:
        raise ProviderProtocolError("Provider result references a different source manifest")

    request_documents = {document.source_document_id: document for document in request.documents}
    scope_documents = {document.source_document_id: document for document in scope.documents}
    if scope.scope_type == "full_work" and scope_documents.keys() != request_documents.keys():
        raise ProviderProtocolError("Full-work provider result must cover every request document")

    scoped_blocks: dict[tuple[str, str], TextProviderSourceBlock] = {}
    for scoped_document in scope.documents:
        request_document = request_documents.get(scoped_document.source_document_id)
        if request_document is None:
            raise ProviderProtocolError("Provider result references an unknown source document")
        if scoped_document.raw_sha256 != request_document.raw_sha256:
            raise ProviderProtocolError("Provider result source hash does not match the request")

        request_blocks = {block.source_block_id: block for block in request_document.blocks}
        scoped_block_ids = set(scoped_document.source_block_ids)
        if not scoped_block_ids <= request_blocks.keys():
            raise ProviderProtocolError("Provider result references an unknown source block")
        if scope.scope_type == "full_work" and scoped_block_ids != request_blocks.keys():
            raise ProviderProtocolError("Full-work provider result must cover every request block")

        expected_chapters = sorted(
            {request_blocks[block_id].chapter_index for block_id in scoped_block_ids}
        )
        if scoped_document.chapter_indices != expected_chapters:
            raise ProviderProtocolError("Provider result chapters do not match its source blocks")
        for block_id in scoped_block_ids:
            scoped_blocks[(scoped_document.source_document_id, block_id)] = request_blocks[block_id]

    fact_refs = {_local_ref_key(fact.fact_id) for fact in result.output.content.facts}
    for span in result.output.source_spans:
        if _local_ref_key(span.fact_id) not in fact_refs:
            raise ProviderProtocolError("Provider source span references an unknown fact")
        block = scoped_blocks.get((span.source_document_id, span.source_block_id))
        if block is None:
            raise ProviderProtocolError("Provider source span is outside the declared source scope")
        relative_start = span.start_byte - block.start_byte
        relative_end = span.end_byte - block.start_byte
        encoded_text = block.text.encode("utf-8")
        if not (0 <= relative_start < relative_end <= len(encoded_text)):
            raise ProviderProtocolError(
                "Provider source span falls outside the supplied block text"
            )
        try:
            encoded_text[relative_start:relative_end].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ProviderProtocolError(
                "Provider source span is not aligned to UTF-8 boundaries"
            ) from error
    return result


def _local_ref_key(reference: LocalRefV1) -> tuple[str, str]:
    if isinstance(reference, ClientRefV1):
        return ("client_key", reference.client_key)
    return ("permanent_id", reference.permanent_id)
