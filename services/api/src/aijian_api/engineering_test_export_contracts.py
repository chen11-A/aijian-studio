"""Desktop-facing synthetic engineering export DTOs, never product receipts."""

from __future__ import annotations

from typing import Final, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

ENGINEERING_OPERATION_ID_PATTERN = r"^etexp_[0-9a-f]{32}$"
ENGINEERING_FIXTURE_ID: Final = "vfr-pattern-25fps-proxy"
ENGINEERING_FIXTURE_SHA256: Final = (
    "0801c350d098061a9694017f4adcc3cbe8a37c24dce67c864644f928f286b67a"
)
ENGINEERING_MEDIA_MAX_BYTES = 32 * 1024 * 1024


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class EngineeringTestExportRequest(_Closed):
    operation_id: str = Field(pattern=ENGINEERING_OPERATION_ID_PATTERN)
    fixture_id: Literal["vfr-pattern-25fps-proxy"]
    fixture_sha256: Literal["0801c350d098061a9694017f4adcc3cbe8a37c24dce67c864644f928f286b67a"]


class EngineeringTestExportOutput(_Closed):
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    byte_size: int = Field(gt=0, le=ENGINEERING_MEDIA_MAX_BYTES)
    probe_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    verified_at: str
    media_url: str = Field(pattern=r"^/api/v1/engineering-test/exports/etexp_[0-9a-f]{32}/media$")


EngineeringStatus = Literal["CLAIMED", "RUNNING", "UNKNOWN", "CANCELLED", "SUCCEEDED"]
EngineeringProgressPhase = Literal["QUEUED", "ENCODING", "VERIFYING"]


class EngineeringTestExportData(_Closed):
    scope: Literal["ENGINEERING_TEST"] = "ENGINEERING_TEST"
    operation_id: str = Field(pattern=ENGINEERING_OPERATION_ID_PATTERN)
    fixture_id: Literal["vfr-pattern-25fps-proxy"] = ENGINEERING_FIXTURE_ID
    fixture_sha256: Literal["0801c350d098061a9694017f4adcc3cbe8a37c24dce67c864644f928f286b67a"] = (
        ENGINEERING_FIXTURE_SHA256
    )
    status: EngineeringStatus
    progress_phase: EngineeringProgressPhase
    progress_frames: int = Field(ge=0, le=64)
    total_frames: Literal[64] = 64
    cancel_requested_at: str | None
    unknown_reason: str | None
    output: EngineeringTestExportOutput | None
    created_at: str
    updated_at: str
    started_at: str | None
    finished_at: str | None

    @model_validator(mode="after")
    def consistent(self) -> Self:
        if self.status == "SUCCEEDED" and self.output is None:
            raise ValueError("successful engineering test needs an output receipt")
        if self.status != "SUCCEEDED" and self.output is not None:
            raise ValueError("only a successful engineering test may expose media")
        if self.status == "UNKNOWN" and self.unknown_reason is None:
            raise ValueError("unknown engineering status needs a reason")
        return self


class EngineeringTestExportResponse(_Closed):
    data: EngineeringTestExportData
    request_id: UUID
