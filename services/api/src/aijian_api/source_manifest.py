"""Typed SourceManifest v1 content owned by the ingestion boundary."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SourceManifestBlockV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source_block_id: str = Field(pattern=r"^srcb_[0-9a-f]{32}$")
    ordinal: int = Field(ge=0)
    kind: Literal["chapter_heading", "paragraph"]
    chapter_index: int = Field(ge=1)
    start_byte: int = Field(ge=0)
    end_byte: int = Field(gt=0)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def validate_byte_range(self) -> "SourceManifestBlockV1":
        if self.end_byte <= self.start_byte:
            raise ValueError("Source block byte range is empty or reversed")
        return self


class SourceManifestDocumentV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source_document_id: str = Field(pattern=r"^src_[0-9a-f]{32}$")
    import_order: int = Field(ge=1)
    filename: str = Field(min_length=1, max_length=255)
    media_type: Literal["text/plain"]
    encoding: Literal["utf-8"]
    byte_size: int = Field(ge=0)
    raw_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    normalized_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    chapter_count: int = Field(ge=1)
    blocks: list[SourceManifestBlockV1] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_blocks(self) -> "SourceManifestDocumentV1":
        ordinals = [block.ordinal for block in self.blocks]
        if ordinals != list(range(len(self.blocks))):
            raise ValueError("Source blocks must be complete and ordered")
        previous_end = -1
        for block in self.blocks:
            if block.start_byte < previous_end:
                raise ValueError("Source block ranges overlap or are out of order")
            previous_end = block.end_byte
        return self


class SourceManifestContentV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    scope_type: Literal["full_work"] = "full_work"
    documents: list[SourceManifestDocumentV1] = Field(min_length=1)
    exclusions: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_documents(self) -> "SourceManifestContentV1":
        document_ids = [document.source_document_id for document in self.documents]
        if len(set(document_ids)) != len(document_ids):
            raise ValueError("Source manifest document IDs must be unique")
        if [document.import_order for document in self.documents] != list(
            range(1, len(self.documents) + 1)
        ):
            raise ValueError("Source manifest import order must be contiguous")
        return self
