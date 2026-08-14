"""Provider runtime contracts for deterministic text generation boundaries."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from aijian_api.story_bible_drafts import StoryBibleContentDraftV1, StorySourceSpanDraftV1

type ProviderErrorCode = Literal[
    "TIMEOUT",
    "REMOTE_UNKNOWN",
    "REFUSED",
    "PROTOCOL_ERROR",
    "AUTH_ERROR",
    "RATE_LIMITED",
    "REMOTE_UNAVAILABLE",
]


class ProviderRuntimeError(RuntimeError):
    """Base class for provider runtime exceptions before a result can be trusted."""


class ProviderProtocolError(ProviderRuntimeError):
    """Raised when a provider response cannot be parsed into the runtime contract."""


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
