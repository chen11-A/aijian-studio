"""Closed official director contracts; generated proposals never claim human authorship."""

from __future__ import annotations

import json
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
from aijian_api.media_contracts import SequenceTimebaseData
from aijian_api.official_text_contracts import OPERATION_PATTERN as OPERATION_PATTERN
from aijian_api.shot_plan_contracts import (
    AdoptShotPlanRequest,
    Closed,
    ShotPlanAdoptionData,
    ShotPlanContentV1,
    ShotPlanCreativeAuthority,
    ShotPlanIssueV1,
    ShotPlanShotV1,
    ShotPlanStoryboardBase,
    Text,
)


class OfficialDirectorOptions(Closed):
    target_shot_count: StrictInt | None = Field(ge=1, le=1_000)
    pacing: Literal["BALANCED", "FAST", "SLOW"]


class PrepareOfficialDirectorRequest(Closed):
    operation_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    profile_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    model: StrictStr = Field(min_length=1, max_length=200)
    authority: ShotPlanCreativeAuthority
    storyboard_base: ShotPlanStoryboardBase | None
    intent: StrictStr = Field(min_length=1, max_length=4_000)
    options: OfficialDirectorOptions

    @field_validator("model", "intent")
    @classmethod
    def meaningful_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Text cannot be blank")
        return value


class ReserveOfficialDirectorRequest(PrepareOfficialDirectorRequest):
    request_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)


class OfficialDirectorPreparedRequest(ReserveOfficialDirectorRequest):
    input_text: StrictStr = Field(max_length=100_000)
    instructions: StrictStr = Field(min_length=1, max_length=20_000)
    script_stored_content: dict[str, object]
    production_brief_stored_content: dict[str, object]


class OfficialDirectorContentV1(Closed):
    schema_version: Literal["1.0.0"]
    provenance: Literal["AI"]
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    authority: ShotPlanCreativeAuthority
    storyboard_base: ShotPlanStoryboardBase | None
    timebase: SequenceTimebaseData
    visual_constraints: tuple[Text, ...] = Field(max_length=32)
    shots: tuple[ShotPlanShotV1, ...] = Field(min_length=1, max_length=1_000)
    issues: tuple[ShotPlanIssueV1, ...] = Field(max_length=1_000)

    @field_validator("shots", "visual_constraints", "issues", mode="before")
    @classmethod
    def json_arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def validate_plan_structure(self) -> Self:
        # Reuse the established structure validation without altering the HUMAN-only API.
        self.projection_input()
        return self

    def projection_input(self) -> ShotPlanContentV1:
        content = self.model_dump(mode="json")
        content["provenance"] = "HUMAN"
        return ShotPlanContentV1.model_validate(content)


class CompleteOfficialDirectorRequest(BaseModel):
    # Raw rejected provider output is retained verbatim, including malformed JSON/NUL.
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    operation_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    profile_id: StrictStr = Field(pattern=OPERATION_PATTERN)
    model: StrictStr = Field(min_length=1, max_length=200)
    request_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    response_id: StrictStr = Field(min_length=1, max_length=240)
    text: StrictStr = Field(max_length=4_194_304)
    completed_at: StrictStr = Field(min_length=20, max_length=40)

    @model_validator(mode="after")
    def valid_completion(self) -> Self:
        if len(self.text.encode("utf-8")) > 4_194_304 or (
            len(json.dumps(self.text, ensure_ascii=False).encode("utf-8")) > 4_194_304
        ):
            raise ValueError("Raw provider output exceeds the transport byte ceiling")
        if any("\x00" in value for value in (self.response_id, self.model, self.completed_at)):
            raise ValueError("Provider metadata cannot contain NUL")
        if not self.response_id.strip() or not self.model.strip():
            raise ValueError("Provider identity must be meaningful")
        stamp = datetime.fromisoformat(self.completed_at.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError("Completion timestamp must include timezone")
        return self


class OfficialDirectorNotSentRequest(Closed):
    code: StrictStr = Field(pattern=r"^[A-Z][A-Z0-9_]{0,79}$")


class AdoptOfficialDirectorRequest(AdoptShotPlanRequest):
    proposal_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)


class RejectOfficialDirectorRequest(AdoptOfficialDirectorRequest):
    reason: StrictStr = Field(min_length=1, max_length=2_000)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Rejection reason cannot be blank")
        return value


class OfficialDirectorValidationIssue(Closed):
    code: StrictStr = Field(pattern=r"^[A-Z][A-Z0-9_]{0,79}$")
    message: StrictStr = Field(min_length=1, max_length=1_000)


class OfficialDirectorProposal(Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    content: OfficialDirectorContentV1
    capability_losses: tuple[ShotPlanIssueV1, ...]


class OfficialDirectorRejection(Closed):
    actor_id: StrictStr = Field(min_length=1, max_length=240)
    reason: StrictStr = Field(min_length=1, max_length=2_000)
    rejected_at: StrictStr


class OfficialDirectorOperation(Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    request: OfficialDirectorPreparedRequest
    status: Literal["REMOTE_UNKNOWN", "COMPLETED", "NOT_SENT", "INVALID"]
    error_code: StrictStr | None
    created_at: StrictStr
    task_id: StrictStr
    attempt_id: StrictStr
    attempt_status: Literal["REMOTE_UNKNOWN", "SUCCEEDED", "FAILED", "NOT_SUBMITTED"]
    completion: CompleteOfficialDirectorRequest | None
    validation_issues: tuple[OfficialDirectorValidationIssue, ...] = Field(max_length=100)
    proposal: OfficialDirectorProposal | None
    adoption: ShotPlanAdoptionData | None
    rejection: OfficialDirectorRejection | None


class OfficialDirectorPreparationData(Closed):
    request: OfficialDirectorPreparedRequest


class OfficialDirectorPreparationResponse(Closed):
    data: OfficialDirectorPreparationData
    request_id: UUID


class OfficialDirectorOperationResponse(Closed):
    data: OfficialDirectorOperation
    request_id: UUID


class OfficialDirectorListResponse(Closed):
    data: list[OfficialDirectorOperation]
    has_more: bool
    request_id: UUID


class OfficialDirectorMutationData(Closed):
    operation: OfficialDirectorOperation
    replayed: bool


class OfficialDirectorMutationResponse(Closed):
    data: OfficialDirectorMutationData
    request_id: UUID
