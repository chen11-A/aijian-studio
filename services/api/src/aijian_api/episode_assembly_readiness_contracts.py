"""Read-only observations over one saved assembly; never a lock or release."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyVersionData


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class EpisodeAssemblyReadinessSourceCheck(_Closed):
    scope: Literal["SCRIPT", "STORYBOARD"]
    status: Literal["CURRENT", "NOT_BOUND", "BLOCKED", "UNKNOWN"]
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,79}$")


class EpisodeAssemblyReadinessBlocker(_Closed):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,79}$")
    scope: Literal[
        "ASSEMBLY",
        "SCRIPT",
        "STORYBOARD",
        "MEDIA",
        "SOUND",
        "SUBTITLE",
        "PICTURE_LOCK",
        "FINISHING",
        "RELEASE",
    ]
    message: str = Field(min_length=1, max_length=240)


class EpisodeAssemblyReadinessData(_Closed):
    assembly: EpisodeMediaAssemblyVersionData
    is_current_head: bool
    source_checks: tuple[EpisodeAssemblyReadinessSourceCheck, ...] = Field(
        min_length=2, max_length=2
    )
    blockers: tuple[EpisodeAssemblyReadinessBlocker, ...] = Field(min_length=1, max_length=10_000)
    checked_at: datetime
    picture_lock_status: Literal["NO_PICTURE_LOCK"] = "NO_PICTURE_LOCK"
    export_status: Literal["NO_EXPORT_CLAIM"] = "NO_EXPORT_CLAIM"
    formal_status: Literal["BLOCKED"] = "BLOCKED"

    @model_validator(mode="after")
    def exact_read_observation(self) -> Self:
        if tuple(check.scope for check in self.source_checks) != ("SCRIPT", "STORYBOARD"):
            raise ValueError("Readiness needs exactly one ordered check for each source kind")
        offset = self.checked_at.utcoffset()
        if offset is None or offset.total_seconds() != 0:
            raise ValueError("Readiness observation must use UTC")
        return self


class EpisodeAssemblyReadinessResponse(_Closed):
    data: EpisodeAssemblyReadinessData
    request_id: UUID
