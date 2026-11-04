"""Human-authored typed director plans. No renderer route can claim AI provenance."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self
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

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_confirmation_contracts import CONFIRMATION_ID_PATTERN
from aijian_api.episode_script_contracts import (
    BLOCK_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    MAX_SCRIPT_BYTES,
    PROPOSAL_ACCEPTANCE_ID_PATTERN,
    SCENE_ID_PATTERN,
    VERSION_ID_PATTERN,
    EpisodeScriptContentV1,
)
from aijian_api.episode_storyboard_contracts import SHOT_ID_PATTERN
from aijian_api.media_contracts import SequenceTimebaseData
from aijian_api.production_brief import ProductionBriefContentV1

MAX_SHOT_PLAN_BYTES = 2_000_000
# Read-only ceiling safely above the existing closed brief field/count maxima.
MAX_SHOT_PLAN_BRIEF_PROOF_BYTES = 1_000_000
VersionId = Annotated[StrictStr, Field(pattern=VERSION_ID_PATTERN)]
BlockId = Annotated[StrictStr, Field(pattern=BLOCK_ID_PATTERN)]
SpanId = Annotated[StrictStr, Field(pattern=r"^spn_[0-9a-f]{32}$")]
Text = Annotated[StrictStr, Field(min_length=1, max_length=4_000)]
Coverage = Literal["ACTION", "DIALOGUE", "ESTABLISHING", "REACTION", "TRANSITION"]


class Closed(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, strict=True, revalidate_instances="always"
    )

    @field_validator("*", mode="after")
    @classmethod
    def valid_unicode(cls, value: object) -> object:
        if isinstance(value, str):
            value.encode("utf-8")
            if "\x00" in value:
                raise ValueError("NUL is not allowed")
        return value


class ShotPlanExactVersion(Closed):
    version_id: VersionId
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)


class ShotPlanScriptPin(ShotPlanExactVersion):
    confirmation_id: StrictStr = Field(pattern=CONFIRMATION_ID_PATTERN)
    head_revision: StrictInt = Field(ge=1, le=9_007_199_254_740_991)


class ShotPlanStoryboardBase(ShotPlanExactVersion):
    head_revision: StrictInt = Field(ge=1, le=9_007_199_254_740_991)


class ShotPlanOriginalAuthority(Closed):
    mode: Literal["ORIGINAL"]
    script: ShotPlanScriptPin
    production_brief: ShotPlanExactVersion


class ShotPlanAdaptedAuthority(Closed):
    mode: Literal["ADAPTED"]
    script: ShotPlanScriptPin
    production_brief: ShotPlanExactVersion
    source_extraction: ShotPlanExactVersion
    source_proposal_acceptance_id: StrictStr = Field(pattern=PROPOSAL_ACCEPTANCE_ID_PATTERN)
    source_span_ids: tuple[SpanId, ...] = Field(min_length=1, max_length=10_000)

    @field_validator("source_span_ids", mode="before")
    @classmethod
    def json_arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def unique_spans(self) -> Self:
        if len(set(self.source_span_ids)) != len(self.source_span_ids):
            raise ValueError("Source span IDs must be unique")
        return self


ShotPlanCreativeAuthority = Annotated[
    ShotPlanOriginalAuthority | ShotPlanAdaptedAuthority, Field(discriminator="mode")
]


class ShotPlanMovement(Closed):
    subject: Text
    environment: Text
    camera: StrictStr = Field(min_length=1, max_length=160)


class ShotPlanCutWindow(Closed):
    start_frame: StrictInt = Field(ge=0, le=864_000)
    end_frame: StrictInt = Field(ge=1, le=864_000)

    @model_validator(mode="after")
    def positive_window(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("Safe cut window must be a positive half-open interval")
        return self


class ShotPlanShotV1(Closed):
    shot_id: StrictStr = Field(pattern=SHOT_ID_PATTERN)
    ordinal: StrictInt = Field(ge=1, le=1_000)
    script_scene_id: StrictStr = Field(pattern=SCENE_ID_PATTERN)
    script_block_ids: tuple[BlockId, ...] = Field(min_length=1, max_length=500)
    title: StrictStr = Field(min_length=1, max_length=240)
    narrative_purpose: Text
    coverage: tuple[Coverage, ...] = Field(min_length=1, max_length=5)
    framing: Literal["EXTREME_WIDE", "WIDE", "MEDIUM", "CLOSE_UP", "EXTREME_CLOSE_UP"]
    composition: Text
    performance: Text
    movement: ShotPlanMovement
    start_state: Text
    end_state: Text
    duration_frames: StrictInt = Field(ge=1, le=864_000)
    handle_in_frames: StrictInt = Field(ge=0, le=864_000)
    handle_out_frames: StrictInt = Field(ge=0, le=864_000)
    safe_cut_window: ShotPlanCutWindow
    rhythm: Text
    sound_intent: Text
    dialogue_block_ids: tuple[BlockId, ...] = Field(max_length=500)

    @field_validator("script_block_ids", "coverage", "dialogue_block_ids", mode="before")
    @classmethod
    def json_arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def valid_identity_and_timing(self) -> Self:
        for values in (self.script_block_ids, self.coverage, self.dialogue_block_ids):
            if len(set(values)) != len(values):
                raise ValueError("Shot references and coverage must be unique")
        if not set(self.dialogue_block_ids).issubset(self.script_block_ids):
            raise ValueError("Dialogue intentions must refer to this shot's script blocks")
        if (
            self.handle_in_frames + self.handle_out_frames >= self.duration_frames
            or self.safe_cut_window.start_frame < self.handle_in_frames
            or self.safe_cut_window.end_frame > self.duration_frames - self.handle_out_frames
        ):
            raise ValueError("Handles must leave an in-range safe cut window")
        if any(
            not value.strip()
            for value in (
                self.title,
                self.narrative_purpose,
                self.composition,
                self.performance,
                self.movement.subject,
                self.movement.environment,
                self.movement.camera,
                self.start_state,
                self.end_state,
                self.rhythm,
                self.sound_intent,
            )
        ):
            raise ValueError("Director intentions cannot be blank; mark unknown explicitly")
        return self


class ShotPlanIssueV1(Closed):
    code: StrictStr = Field(pattern=r"^[A-Z][A-Z0-9_]{0,79}$")
    severity: Literal["WARNING", "BLOCKING"]
    shot_id: StrictStr | None = Field(pattern=SHOT_ID_PATTERN)
    message: Text


class ShotPlanContentV1(Closed):
    schema_version: Literal["1.0.0"]
    provenance: Literal["HUMAN"]
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
    def unique_order_and_issue_refs(self) -> Self:
        if [shot.ordinal for shot in self.shots] != list(range(1, len(self.shots) + 1)):
            raise ValueError("Shot ordinals must be contiguous; identity is independent of order")
        ids = {shot.shot_id for shot in self.shots}
        if len(ids) != len(self.shots):
            raise ValueError("Shot IDs must be unique")
        if any(issue.shot_id is not None and issue.shot_id not in ids for issue in self.issues):
            raise ValueError("Issue references an unknown shot")
        if any(not value.strip() or "\x00" in value for value in self.visual_constraints):
            raise ValueError("Visual constraints must be meaningful")
        for value in self.visual_constraints:
            value.encode("utf-8")
        if len(set(self.visual_constraints)) != len(self.visual_constraints):
            raise ValueError("Visual constraints must be unique")
        return self


class CreateHumanShotPlanRequest(Closed):
    content: ShotPlanContentV1
    parent_version_id: VersionId | None
    expected_revision: StrictInt | None = Field(ge=1, le=9_007_199_254_740_991)
    change_summary: StrictStr = Field(min_length=1, max_length=240)

    @model_validator(mode="after")
    def revision_pair(self) -> Self:
        if (self.parent_version_id is None) != (self.expected_revision is None):
            raise ValueError("Proposal parent and revision must be supplied together")
        if not self.change_summary.strip():
            raise ValueError("Change summary cannot be blank")
        return self


class AdoptShotPlanRequest(Closed):
    proposal_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    confirm: Literal[True]

    @model_validator(mode="before")
    @classmethod
    def explicit_confirmation(cls, value: object) -> object:
        if isinstance(value, dict) and value.get("confirm") is not True:
            raise ValueError("Adoption requires explicit human confirmation")
        return value


class ShotPlanAdoptionData(Closed):
    proposal_version_id: VersionId
    proposal_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    storyboard_version_id: VersionId
    storyboard_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    actor_id: StrictStr = Field(min_length=1, max_length=240)
    adopted_at: datetime


class ShotPlanProposalData(Closed):
    version_id: VersionId
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    version_number: StrictInt = Field(ge=1)
    head_revision: StrictInt = Field(ge=1)
    parent_version_id: VersionId | None
    content: ShotPlanContentV1
    author_actor_id: StrictStr = Field(min_length=1, max_length=240)
    created_at: datetime
    generation_status: Literal["UNAVAILABLE"] = "UNAVAILABLE"
    capability_losses: tuple[ShotPlanIssueV1, ...]
    adoption: ShotPlanAdoptionData | None


class ShotPlanPreparationData(Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    authority: ShotPlanCreativeAuthority
    script_content: EpisodeScriptContentV1
    production_brief_content: ProductionBriefContentV1
    script_stored_content: dict[str, object]
    production_brief_stored_content: dict[str, object]
    storyboard_base: ShotPlanStoryboardBase | None
    generation_status: Literal["UNAVAILABLE"] = "UNAVAILABLE"

    @model_validator(mode="after")
    def exact_stored_input_proofs(self) -> Self:
        if (
            len(canonical_content_bytes(self.script_stored_content)) > MAX_SCRIPT_BYTES
            or len(canonical_content_bytes(self.production_brief_stored_content))
            > MAX_SHOT_PLAN_BRIEF_PROOF_BYTES
            or len(canonical_content_bytes(self.production_brief_content.model_dump(mode="json")))
            > MAX_SHOT_PLAN_BRIEF_PROOF_BYTES
            or canonical_content_hash(self.script_stored_content)
            != self.authority.script.content_hash
            or canonical_content_hash(self.production_brief_stored_content)
            != self.authority.production_brief.content_hash
            or EpisodeScriptContentV1.model_validate(self.script_stored_content)
            != self.script_content
            or ProductionBriefContentV1.model_validate(self.production_brief_stored_content)
            != self.production_brief_content
        ):
            raise ValueError("Preparation inputs differ from their exact immutable proofs")
        return self


class ShotPlanProposalResponse(Closed):
    data: ShotPlanProposalData
    request_id: UUID


class ShotPlanPreparationResponse(Closed):
    data: ShotPlanPreparationData
    request_id: UUID


class ShotPlanMutationData(Closed):
    proposal: ShotPlanProposalData
    replayed: bool


class ShotPlanMutationResponse(Closed):
    data: ShotPlanMutationData
    request_id: UUID


class ShotPlanAdoptionStatusData(Closed):
    proposal_version_id: VersionId
    adoption: ShotPlanAdoptionData | None


class ShotPlanAdoptionStatusResponse(Closed):
    data: ShotPlanAdoptionStatusData
    request_id: UUID


class ShotPlanWriteStatusData(Closed):
    proposal: ShotPlanProposalData | None


class ShotPlanWriteStatusResponse(Closed):
    data: ShotPlanWriteStatusData
    request_id: UUID
