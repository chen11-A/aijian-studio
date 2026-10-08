"""Strict local product export operation identities and durable receipts.

Claim assertions are compared with repository truth in one write transaction.
These DTOs alone authorize neither encoding nor a product export claim.
"""

from __future__ import annotations

import unicodedata
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aijian_api.episode_media_assembly_contracts import AssemblyMediaRefV1
from aijian_api.product_timeline_export_contracts import (
    CONTENT_HASH_PATTERN,
    EPISODE_ID_PATTERN,
    PROJECT_ID_PATTERN,
    ProductExportSpec,
    VERSION_ID_PATTERN,
)

PRODUCT_EXPORT_OPERATION_ID_PATTERN = r"^peop_[0-9a-f]{32}$"
PRODUCT_EXPORT_ARTIFACT_ID_PATTERN = r"^art_[0-9a-f]{32}$"
PRODUCT_EXPORT_RIGHTS_DECISION_ID_PATTERN = r"^ard_[0-9a-f]{32}$"
PRODUCT_EXPORT_RAW_SHA256_PATTERN = r"^[0-9a-f]{64}$"


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ProductExportRightsAssertion(_Closed):
    media: AssemblyMediaRefV1
    decision_id: str = Field(pattern=PRODUCT_EXPORT_RIGHTS_DECISION_ID_PATTERN)
    revision: int = Field(ge=1)
    decision_content_hash: str = Field(pattern=PRODUCT_EXPORT_RAW_SHA256_PATTERN)


class ProductExportAssemblyAssertion(_Closed):
    artifact_id: str = Field(pattern=PRODUCT_EXPORT_ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    head_revision: int = Field(ge=1)


class ProductExportClaimRequest(_Closed):
    """One durable key per project; media assertions must cover the whole assembly."""

    operation_id: str = Field(pattern=PRODUCT_EXPORT_OPERATION_ID_PATTERN)
    assembly: ProductExportAssemblyAssertion
    media_rights: tuple[ProductExportRightsAssertion, ...] = Field(max_length=8)
    spec: ProductExportSpec
    output_relative_path: str = Field(min_length=5, max_length=255)

    @field_validator("media_rights", mode="before")
    @classmethod
    def accept_json_media_rights(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def unique_and_local(self) -> Self:
        refs = [
            (item.media.asset_id, item.media.asset_version_id)
            for item in self.media_rights
        ]
        if len(refs) != len(set(refs)):
            raise ValueError("each selected media version needs one rights assertion")
        path = self.output_relative_path
        device_name = path.split(".", 1)[0].casefold()
        if (
            not path.endswith(".mp4")
            or path.startswith((".", " "))
            or path != unicodedata.normalize("NFC", path)
            or any(char in path for char in '/\\:<>"|?*')
            or path.endswith((" ", "."))
            or device_name in {
                "con", "prn", "aux", "nul",
                *(f"com{i}" for i in range(1, 10)),
                *(f"lpt{i}" for i in range(1, 10)),
            }
            or any(ord(char) < 32 for char in path)
        ):
            raise ValueError("output_relative_path must be one safe local MP4 filename")
        return self


ProductExportOperationStatus = Literal[
    "CLAIMED", "RUNNING", "CANCELLED", "SUCCEEDED", "UNKNOWN",
]
ProductExportProgressPhase = Literal["QUEUED", "ENCODING", "VERIFYING"]


class ProductExportOutputReceipt(_Closed):
    absolute_path: str = Field(min_length=1, max_length=2048)
    sha256: str = Field(pattern=PRODUCT_EXPORT_RAW_SHA256_PATTERN)
    byte_size: int = Field(gt=0)
    probe_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    verified_at: str


class ProductExportOperationData(_Closed):
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    operation_id: str = Field(pattern=PRODUCT_EXPORT_OPERATION_ID_PATTERN)
    request_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    assembly: ProductExportAssemblyAssertion
    status: ProductExportOperationStatus
    progress_phase: ProductExportProgressPhase
    progress_frames: int = Field(ge=0)
    total_frames: int = Field(gt=0)
    inputs_sealed_at: str | None
    cancel_requested_at: str | None
    unknown_reason: str | None
    output: ProductExportOutputReceipt | None
    created_at: str
    updated_at: str
    started_at: str | None
    finished_at: str | None
    reconciled_at: str | None

    @model_validator(mode="after")
    def consistent_receipt(self) -> Self:
        if self.progress_frames > self.total_frames:
            raise ValueError("product export progress exceeds total frames")
        if self.status == "SUCCEEDED" and self.output is None:
            raise ValueError("successful product export requires a verified receipt")
        if self.status != "SUCCEEDED" and self.output is not None:
            raise ValueError("non-successful product export cannot present an output")
        return self
