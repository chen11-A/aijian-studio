"""Closed, credential-free contracts for official text proposals."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN

OPERATION_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class OfficialTextScriptBase(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    head_revision: StrictInt = Field(ge=1)


class ReserveOfficialTextRequest(_Closed):
    operation_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    profile_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    model: StrictStr = Field(min_length=1, max_length=200)
    input_text: StrictStr = Field(min_length=1, max_length=100_000)
    instructions: StrictStr | None = Field(default=None, min_length=1, max_length=20_000)
    request_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    base: OfficialTextScriptBase | None

    @field_validator("model", "input_text", "instructions")
    @classmethod
    def meaningful_text(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or "\x00" in value):
            raise ValueError("Text must be meaningful and contain no NUL")
        return value


class CompleteOfficialTextRequest(_Closed):
    operation_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    profile_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    model: StrictStr = Field(min_length=1, max_length=200)
    request_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    text: StrictStr = Field(min_length=1, max_length=100_000)
    completed_at: StrictStr = Field(min_length=20, max_length=40)

    @model_validator(mode="after")
    def valid_completion(self) -> Self:
        if not self.text.strip() or "\x00" in self.text:
            raise ValueError("Completion must have meaningful text")
        stamp = datetime.fromisoformat(self.completed_at.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError("Completion timestamp must include timezone")
        return self


class OfficialTextNotSentRequest(_Closed):
    code: StrictStr = Field(pattern=r"^[A-Z][A-Z0-9_]{0,79}$")


class AdoptOfficialTextRequest(_Closed):
    proposal_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    proposal_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    confirm: Literal[True]


class OfficialTextProposal(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    result: CompleteOfficialTextRequest


class OfficialTextAdoption(_Closed):
    script_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    script_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    actor_id: StrictStr
    adopted_at: StrictStr


class OfficialTextOperation(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    request: ReserveOfficialTextRequest
    status: Literal["REMOTE_UNKNOWN", "COMPLETED", "NOT_SENT"]
    error_code: StrictStr | None
    created_at: StrictStr
    proposal: OfficialTextProposal | None
    adoption: OfficialTextAdoption | None


class OfficialTextOperationResponse(_Closed):
    data: OfficialTextOperation
    request_id: UUID


class OfficialTextListResponse(_Closed):
    data: list[OfficialTextOperation]
    request_id: UUID


class OfficialTextMutationData(_Closed):
    operation: OfficialTextOperation
    replayed: bool


class OfficialTextMutationResponse(_Closed):
    data: OfficialTextMutationData
    request_id: UUID
