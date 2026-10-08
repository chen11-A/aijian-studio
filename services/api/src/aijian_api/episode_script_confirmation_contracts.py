"""Explicit human confirmation of one existing EpisodeScript version."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN

CONFIRMATION_ID_PATTERN = r"^esc_[0-9a-f]{32}$"
ARTIFACT_ID_PATTERN = r"^art_[0-9a-f]{32}$"


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class CreateEpisodeScriptConfirmationRequest(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    expected_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    expected_head_revision: StrictInt = Field(ge=1)
    confirm: Literal[True]

    @model_validator(mode="before")
    @classmethod
    def require_explicit_boolean(cls, value: object) -> object:
        if isinstance(value, dict) and value.get("confirm") is not True:
            raise ValueError("Confirmation requires an explicit true boolean")
        return value


class EpisodeScriptConfirmationData(_Closed):
    confirmation_id: StrictStr = Field(pattern=CONFIRMATION_ID_PATTERN)
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    artifact_id: StrictStr = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    head_revision: StrictInt = Field(ge=1)
    actor_id: StrictStr = Field(min_length=1, max_length=240)
    confirmed_at: datetime


class EpisodeScriptConfirmationStatusData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    latest_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    latest_head_revision: StrictInt = Field(ge=1)
    confirmation: EpisodeScriptConfirmationData | None
    current: bool

    @model_validator(mode="after")
    def validate_current(self) -> Self:
        if self.current and (
            self.confirmation is None
            or self.confirmation.version_id != self.latest_version_id
            or self.confirmation.head_revision != self.latest_head_revision
        ):
            raise ValueError("Current confirmation must bind the latest script head")
        return self


class EpisodeScriptConfirmationStatusResponse(_Closed):
    data: EpisodeScriptConfirmationStatusData
    request_id: UUID


class EpisodeScriptConfirmationCreatedData(_Closed):
    status: EpisodeScriptConfirmationStatusData
    replayed: bool


class EpisodeScriptConfirmationCreatedResponse(_Closed):
    data: EpisodeScriptConfirmationCreatedData
    request_id: UUID
