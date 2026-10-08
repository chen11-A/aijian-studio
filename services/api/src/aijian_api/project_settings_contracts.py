"""Project settings v1: one project revision, no copied brief or episode truth.

Writes cover project metadata only. ProductionBrief, episodes, and existing
artifact versions require their own explicit commands and revision guards.
"""

from __future__ import annotations

import unicodedata
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aijian_api.contracts import PROJECT_ID_PATTERN
from aijian_api.media_contracts import SequenceTimebaseData

PROJECT_SETTINGS_OPERATION_ID_PATTERN = r"^pso_[0-9a-f]{32}$"
_REVISION_MAX = 2**63 - 1


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ProjectSettingsChangesV1(_Closed):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    status: Literal["active", "archived"] | None = None
    description: str | None = Field(default=None, max_length=4000)
    sequence_timebase: SequenceTimebaseData | None = None

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("name", "description")
    @classmethod
    def reject_controls(cls, value: str | None, info: object) -> str | None:
        allow_lf = getattr(info, "field_name", None) == "description"
        if value is not None and any(
            unicodedata.category(char).startswith("C") and not (allow_lf and char == "\n")
            for char in value
        ):
            raise ValueError("Project settings text contains unsupported control characters")
        return value

    @model_validator(mode="after")
    def require_explicit_changes(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one project setting must be supplied")
        if any(
            getattr(self, field) is None
            for field in self.model_fields_set - {"sequence_timebase"}
        ):
            raise ValueError("Only sequence_timebase can be explicitly cleared")
        return self


class UpdateProjectSettingsRequestV1(_Closed):
    operation_id: str = Field(pattern=PROJECT_SETTINGS_OPERATION_ID_PATTERN)
    expected_project_revision: int = Field(ge=1, lt=_REVISION_MAX)
    changes: ProjectSettingsChangesV1

    def identity_payload(self) -> dict[str, object]:
        """Hash with the URL project_id; omitted fields and explicit null differ."""
        return {
            "operation_id": self.operation_id,
            "expected_project_revision": self.expected_project_revision,
            "changes": self.changes.model_dump(mode="json", exclude_unset=True),
        }


class ProjectSettingsDataV1(_Closed):
    schema_version: Literal[1] = 1
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    name: str = Field(min_length=1, max_length=80)
    status: Literal["active", "archived"]
    description: str = Field(max_length=4000)
    sequence_timebase: SequenceTimebaseData | None
    # Existing authoritative columns remain read-only in this settings version.
    aspect_ratio: Literal["9:16"]
    target_duration_seconds: int = Field(gt=0)
    source_language: Literal["zh-CN"]
    revision: int = Field(ge=1, le=_REVISION_MAX)
    created_at: datetime
    updated_at: datetime


class ProjectSettingsBoundaryV1(_Closed):
    settings_scope: Literal["PROJECT_METADATA_ONLY"] = "PROJECT_METADATA_ONLY"
    existing_artifact_versions_modified: Literal[False] = False
    sequence_timebase_effect: Literal["DECLARED_DEFAULT_REQUIRES_EXPLICIT_ADOPTION"] = (
        "DECLARED_DEFAULT_REQUIRES_EXPLICIT_ADOPTION"
    )
    aspect_duration_language: Literal["READ_ONLY_PENDING_CONSUMER_CAPABILITIES"] = (
        "READ_ONLY_PENDING_CONSUMER_CAPABILITIES"
    )
    episode_settings: Literal["SEPARATE_EPISODE_CAS"] = "SEPARATE_EPISODE_CAS"
    production_intent: Literal["SEPARATE_PRODUCTION_BRIEF_VERSION"] = (
        "SEPARATE_PRODUCTION_BRIEF_VERSION"
    )
    generation_remote_version_policies: Literal["NO_EDITABLE_PROJECT_POLICY_CONTRACT"] = (
        "NO_EDITABLE_PROJECT_POLICY_CONTRACT"
    )


class ProjectSettingsResponseV1(_Closed):
    data: ProjectSettingsDataV1
    boundary: ProjectSettingsBoundaryV1


class ProjectSettingsWriteReceiptV1(_Closed):
    operation_id: str = Field(pattern=PROJECT_SETTINGS_OPERATION_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    request_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    base_revision: int = Field(ge=1, lt=_REVISION_MAX)
    result_revision: int = Field(ge=1, le=_REVISION_MAX)
    result: ProjectSettingsDataV1
    created_at: datetime

    @model_validator(mode="after")
    def bind_result(self) -> Self:
        if self.result_revision not in {self.base_revision, self.base_revision + 1}:
            raise ValueError("Settings revision must be a no-op or one CAS increment")
        if self.result.project_id != self.project_id or self.result.revision != self.result_revision:
            raise ValueError("Settings receipt must bind its exact historical result")
        return self
