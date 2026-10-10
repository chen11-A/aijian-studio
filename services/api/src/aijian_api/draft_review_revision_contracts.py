"""Bounded immutable manual revision evidence; never generation or release approval."""

from typing import Literal, Self
from uuid import UUID

from pydantic import Field, ValidationInfo, field_validator, model_validator

from aijian_api.draft_export_contracts import DRAFT_OPERATION_PATTERN
from aijian_api.draft_review_contracts import (
    NOTE_ID_PATTERN,
    CreateDraftReviewNoteRequest,
    DraftReviewIdentity,
    DraftReviewTarget,
    _Closed,
)
from aijian_api.episode_media_assembly_contracts import AssemblyMediaRefV1, AssemblyStoryboardRefV1
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN

PLAN_ID_PATTERN = r"^drp_[0-9a-f]{32}$"
APPROVAL_ID_PATTERN = r"^dra_[0-9a-f]{32}$"
CANDIDATE_ID_PATTERN = r"^drc_[0-9a-f]{32}$"
RECHECK_ID_PATTERN = r"^drk_[0-9a-f]{32}$"
SEGMENT_ID_PATTERN = r"^seg_[a-z0-9._-]{1,80}$"


class CreateDraftReviewRevisionPlanRequest(DraftReviewIdentity):
    plan_id: str = Field(pattern=PLAN_ID_PATTERN)
    note_ids: list[str] = Field(min_length=1, max_length=50)
    affected_segment_ids: list[str] = Field(min_length=1, max_length=100)
    instruction: str = Field(min_length=1, max_length=2000)

    @field_validator("instruction")
    @classmethod
    def meaningful(cls, value: str) -> str:
        return CreateDraftReviewNoteRequest.meaningful_text(value)

    @field_validator("note_ids", "affected_segment_ids")
    @classmethod
    def unique_ids(cls, value: list[str], info: ValidationInfo) -> list[str]:
        import re

        pattern = NOTE_ID_PATTERN if info.field_name == "note_ids" else SEGMENT_ID_PATTERN
        if len(value) != len(set(value)) or any(
            re.fullmatch(pattern, item) is None for item in value
        ):
            raise ValueError("Unique canonical ids required")
        return value


class ApproveDraftReviewRevisionPlanRequest(_Closed):
    approval_id: str = Field(pattern=APPROVAL_ID_PATTERN)
    expected_plan_hash: str = Field(pattern=CONTENT_HASH_PATTERN)


class AttachDraftReviewRevisionCandidateRequest(DraftReviewIdentity):
    candidate_id: str = Field(pattern=CANDIDATE_ID_PATTERN)
    expected_plan_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    approval_id: str = Field(pattern=APPROVAL_ID_PATTERN)
    candidate_operation_id: str = Field(pattern=DRAFT_OPERATION_PATTERN)
    change_summary: str = Field(min_length=1, max_length=2000)

    @field_validator("change_summary")
    @classmethod
    def meaningful(cls, value: str) -> str:
        return CreateDraftReviewNoteRequest.meaningful_text(value)


class RecheckDraftReviewRevisionCandidateRequest(_Closed):
    recheck_id: str = Field(pattern=RECHECK_ID_PATTERN)
    expected_candidate_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    outcome: Literal["NEEDS_MORE_WORK", "MANUALLY_CHECKED"]
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def meaningful(cls, value: str) -> str:
        return CreateDraftReviewNoteRequest.meaningful_text(value)


class DraftReviewRevisionSegment(_Closed):
    segment_id: str = Field(pattern=SEGMENT_ID_PATTERN)
    track_kind: Literal["VISUAL", "DIALOGUE", "BGM", "SFX", "SUBTITLE"]
    start_frame: int = Field(ge=0, lt=1_000_000)
    end_frame: int = Field(gt=0, le=1_000_000)
    segment_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    media: AssemblyMediaRefV1 | None
    storyboard_ref: AssemblyStoryboardRefV1 | None

    @model_validator(mode="after")
    def interval(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("Invalid half-open segment interval")
        return self


class DraftReviewRevisionNoteSnapshot(_Closed):
    note_id: str = Field(pattern=NOTE_ID_PATTERN)
    frame_index: int = Field(ge=0, lt=1_000_000)
    text: str = Field(min_length=1, max_length=2000)
    actor_id: str = Field(min_length=1, max_length=200)
    created_at: str


class DraftReviewRevisionPlan(_Closed):
    plan_id: str = Field(pattern=PLAN_ID_PATTERN)
    source: DraftReviewTarget
    notes: list[DraftReviewRevisionNoteSnapshot] = Field(min_length=1, max_length=50)
    affected_segments: list[DraftReviewRevisionSegment] = Field(min_length=1, max_length=100)
    instruction: str = Field(min_length=1, max_length=2000)
    actor_id: str = Field(min_length=1, max_length=200)
    created_at: str
    plan_hash: str = Field(pattern=CONTENT_HASH_PATTERN)


class DraftReviewRevisionApproval(_Closed):
    approval_id: str = Field(pattern=APPROVAL_ID_PATTERN)
    plan_id: str = Field(pattern=PLAN_ID_PATTERN)
    plan_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    assembly_version_number_at_approval: int = Field(gt=0)
    actor_id: str = Field(min_length=1, max_length=200)
    created_at: str


class DraftReviewRevisionComparison(_Closed):
    unchanged_segment_ids: list[str] = Field(max_length=3000)
    changed_segment_ids: list[str] = Field(max_length=3000)
    removed_segment_ids: list[str] = Field(max_length=3000)
    added_segment_ids: list[str] = Field(max_length=3000)
    out_of_scope_segment_ids: list[str] = Field(max_length=3000)
    sequence_settings_changed: bool


class DraftReviewRevisionCandidate(_Closed):
    candidate_id: str = Field(pattern=CANDIDATE_ID_PATTERN)
    plan_id: str = Field(pattern=PLAN_ID_PATTERN)
    plan_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    approval_id: str = Field(pattern=APPROVAL_ID_PATTERN)
    target: DraftReviewTarget
    segments: list[DraftReviewRevisionSegment] = Field(max_length=3000)
    comparison: DraftReviewRevisionComparison
    change_summary: str = Field(min_length=1, max_length=2000)
    actor_id: str = Field(min_length=1, max_length=200)
    created_at: str
    candidate_hash: str = Field(pattern=CONTENT_HASH_PATTERN)


class DraftReviewRevisionRecheck(_Closed):
    recheck_id: str = Field(pattern=RECHECK_ID_PATTERN)
    candidate_id: str = Field(pattern=CANDIDATE_ID_PATTERN)
    candidate_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    outcome: Literal["NEEDS_MORE_WORK", "MANUALLY_CHECKED"]
    reason: str = Field(min_length=1, max_length=2000)
    actor_id: str = Field(min_length=1, max_length=200)
    created_at: str


class DraftReviewRevisionCandidateEntry(_Closed):
    candidate: DraftReviewRevisionCandidate
    output_verified: bool
    recheck: DraftReviewRevisionRecheck | None


class DraftReviewRevisionPlanEntry(_Closed):
    plan: DraftReviewRevisionPlan
    approval: DraftReviewRevisionApproval | None
    candidates: list[DraftReviewRevisionCandidateEntry] = Field(max_length=50)


class DraftReviewRevisionData(_Closed):
    source: DraftReviewTarget
    output_verified: bool
    plans: list[DraftReviewRevisionPlanEntry] = Field(max_length=100)
    manual_review_only: Literal[True] = True

    @model_validator(mode="after")
    def bounded_candidates(self) -> Self:
        if sum(len(entry.candidates) for entry in self.plans) > 20:
            raise ValueError("At most twenty comparison candidates per source output")
        return self


class DraftReviewRevisionScopeData(_Closed):
    source: DraftReviewTarget
    output_verified: bool
    segments: list[DraftReviewRevisionSegment] = Field(max_length=3000)
    manual_review_only: Literal[True] = True


class DraftReviewRevisionResponse(_Closed):
    data: DraftReviewRevisionData
    request_id: UUID


class DraftReviewRevisionScopeResponse(_Closed):
    data: DraftReviewRevisionScopeData
    request_id: UUID
