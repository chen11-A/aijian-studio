"""Local DRAFT receipts. These never constitute a product release approval."""

from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN

DRAFT_OPERATION_PATTERN = r"^dmp_[0-9a-f]{32}$"
DraftStatus = Literal[
    "QUEUED",
    "RUNNING",
    "VERIFYING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "INTERRUPTED",
]


class CreateDraftExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    operation_id: str = Field(pattern=DRAFT_OPERATION_PATTERN)
    assembly_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    assembly_content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    rights_declaration: Literal["OWNED_OR_SYNTHETIC"]
    # Trusted native main only: the renderer IPC never accepts a path.
    output_path: str = Field(min_length=1, max_length=2048)


class DraftExportJob(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    operation_id: str = Field(pattern=DRAFT_OPERATION_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    assembly_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    assembly_content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    status: DraftStatus
    progress_frames: int = Field(ge=0)
    total_frames: int = Field(gt=0)
    output_filename: str
    output_path: str | None = None
    output_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    output_bytes: int | None = Field(default=None, gt=0)
    error_code: str | None = None
    error_message: str | None = None
    created_at: str
    updated_at: str
    toolchain_profile_id: str
    draft: Literal[True] = True
    rights_declaration: Literal["OWNED_OR_SYNTHETIC"] = "OWNED_OR_SYNTHETIC"

    @model_validator(mode="after")
    def coherent_receipt(self) -> Self:
        if self.progress_frames > self.total_frames:
            raise ValueError("Draft progress cannot exceed the saved assembly")
        proof = (self.output_path, self.output_sha256, self.output_bytes)
        if self.status == "SUCCEEDED":
            if any(value is None for value in proof) or self.progress_frames != self.total_frames:
                raise ValueError("Successful draft requires a completed output proof")
        elif any(value is not None for value in proof):
            raise ValueError("Unsuccessful draft cannot claim a completed file")
        return self


class DraftExportResponse(BaseModel):
    data: DraftExportJob
    request_id: UUID


class DraftExportListData(BaseModel):
    items: list[DraftExportJob]


class DraftExportListResponse(BaseModel):
    data: DraftExportListData
    request_id: UUID
