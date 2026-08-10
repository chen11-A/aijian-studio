"""Versioned public API contracts."""

import base64
import binascii
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from aijian_api.agent_skill_contracts import (
    AgentDefinitionV1,
    AgentRunV1,
    AttemptSnapshotV1,
    ContextManifestV1,
    DefinitionRefV1,
    SkillDefinitionV1,
    SkillRunV1,
)
from aijian_api.media_contracts import SequenceTimebaseData
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.story_bible import StoryBibleContentV1
from aijian_api.story_bible_drafts import StoryBibleContentDraftV1, StorySourceSpanDraftV1
from aijian_api.timeline import TimelineAssetV1, TimelineClipV1, TimelineVersionV1

PROJECT_ID_PATTERN = r"^prj_[0-9a-f]{32}$"
SOURCE_ID_PATTERN = r"^src_[0-9a-f]{32}$"
SOURCE_BLOCK_ID_PATTERN = r"^srcb_[0-9a-f]{32}$"
ARTIFACT_ID_PATTERN = r"^art_[0-9a-f]{32}$"
VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
FACT_ID_PATTERN = r"^fact_[0-9a-f]{32}$"
SOURCE_SPAN_ID_PATTERN = r"^spn_[0-9a-f]{32}$"
CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
MAX_STORY_BIBLE_SOURCE_SPANS = 20_000
MAX_STORY_BIBLE_RESPONSE_BYTES = 16 * 1024 * 1024
REPORT_ID_PATTERN = r"^rpt_[0-9a-f]{32}$"
CHALLENGE_ID_PATTERN = r"^chg_[0-9a-f]{32}$"
SUBMISSION_ID_PATTERN = r"^sub_[0-9a-f]{32}$"
SIGNOFF_ID_PATTERN = r"^sig_[0-9a-f]{32}$"
DECISION_ID_PATTERN = r"^dec_[0-9a-f]{32}$"
WORKFLOW_RUN_ID_PATTERN = r"^wfr_[0-9a-f]{32}$"
NODE_RUN_ID_PATTERN = r"^node_[0-9a-f]{32}$"
ATTEMPT_ID_PATTERN = r"^att_[0-9a-f]{32}$"
TASK_ID_PATTERN = r"^task_[0-9a-f]{32}$"
AGENT_RUN_ID_PATTERN = r"^agr_[0-9a-f]{32}$"


class HealthData(BaseModel):
    """Stable service identity returned by the health endpoint."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: Literal["aijian-api"] = "aijian-api"
    version: str


class HealthResponse(BaseModel):
    """Versioned health response envelope."""

    model_config = ConfigDict(extra="forbid")

    data: HealthData
    request_id: UUID


class ErrorBody(BaseModel):
    """Stable machine-readable error details."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    details: dict[str, str]
    retryable: bool


class ErrorResponse(BaseModel):
    """Error envelope shared by all HTTP boundaries."""

    model_config = ConfigDict(extra="forbid")

    error: ErrorBody
    request_id: UUID


class AgentCatalogData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    agents: tuple[AgentDefinitionV1, ...]


class AgentCatalogResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: AgentCatalogData
    request_id: UUID


class SkillCatalogData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    skills: tuple[SkillDefinitionV1, ...]


class SkillCatalogResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SkillCatalogData
    request_id: UUID


class ProposalRunData(BaseModel):
    """Safe read projection of persisted Agent/Skill run truth."""

    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    agent_run: AgentRunV1
    skill_run: SkillRunV1
    context_manifest: ContextManifestV1
    agent_revision: int = Field(strict=True, ge=1)
    skill_revision: int = Field(strict=True, ge=1)
    created_at: datetime
    updated_at: datetime


class ProposalRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ProposalRunData
    request_id: UUID


class CreateProposalRunRequest(BaseModel):
    """Exact immutable source coordinates for the first provider-free Skill."""

    model_config = ConfigDict(extra="forbid")

    agent_definition: DefinitionRefV1
    skill_definition: DefinitionRefV1
    source_manifest_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    source_document_id: str = Field(pattern=SOURCE_ID_PATTERN)
    source_block_id: str = Field(pattern=SOURCE_BLOCK_ID_PATTERN)
    start_byte: int = Field(strict=True, ge=0)
    end_byte: int = Field(strict=True, gt=0)


class ProposalRunTaskData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_run_id: str = Field(pattern=WORKFLOW_RUN_ID_PATTERN)
    node_run_id: str = Field(pattern=NODE_RUN_ID_PATTERN)
    attempt_id: str = Field(pattern=ATTEMPT_ID_PATTERN)
    task_id: str = Field(pattern=TASK_ID_PATTERN)


class CreatedProposalRunData(ProposalRunData):
    model_config = ConfigDict(extra="forbid")

    task: ProposalRunTaskData
    attempt: AttemptSnapshotV1


class CreatedProposalRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: CreatedProposalRunData
    request_id: UUID


class CreateProposalRunCancellationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProposalRunCancellationData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cancellation_id: str = Field(pattern=r"^cnl_[0-9a-f]{32}$")
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    workflow_run_id: str = Field(pattern=WORKFLOW_RUN_ID_PATTERN)
    agent_run_status: Literal["CANCELLED"]
    skill_run_status: Literal["CANCELLED"]
    cancelled_tasks: int = Field(strict=True, ge=0)
    cancelled_attempts: int = Field(strict=True, ge=0)
    cancelled_nodes: int = Field(strict=True, ge=0)
    already_cancelled: bool
    updated_at: datetime


class ProposalRunCancellationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ProposalRunCancellationData
    request_id: UUID


class CreateTimelineRequest(BaseModel):
    """Create the first immutable editing timeline for a project."""

    model_config = ConfigDict(extra="forbid")

    timeline_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")
    sequence_timebase: SequenceTimebaseData
    width: Literal[1080] = 1080
    height: Literal[1920] = 1920
    assets: tuple[TimelineAssetV1, ...] = Field(min_length=1, max_length=10_000)
    clips: tuple[TimelineClipV1, ...] = Field(min_length=1, max_length=10_000)


class TrimTimelineClipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clip_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")
    new_source_in_frame: int = Field(strict=True, ge=0)
    new_duration_frames: int = Field(strict=True, gt=0)
    expected_revision: int = Field(strict=True, ge=1)


class ReorderTimelineClipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clip_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")
    new_index: int = Field(strict=True, ge=0)
    expected_revision: int = Field(strict=True, ge=1)


class ReplaceTimelineClipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clip_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")
    replacement_asset_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")
    replacement_source_in_frame: int = Field(strict=True, ge=0)
    expected_revision: int = Field(strict=True, ge=1)


class TimelineData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    created_at: datetime
    total_duration_frames: int = Field(strict=True, gt=0)
    timeline: TimelineVersionV1


class TimelineResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: TimelineData
    request_id: UUID


class TaskNodeData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_run_id: str = Field(pattern=WORKFLOW_RUN_ID_PATTERN)
    node_run_id: str = Field(pattern=NODE_RUN_ID_PATTERN)
    node_key: str
    node_type: str
    status: Literal[
        "BLOCKED",
        "PENDING",
        "RUNNING",
        "RECONCILIATION_REQUIRED",
        "NEEDS_REVIEW",
        "SUCCEEDED",
        "FAILED",
        "CANCEL_REQUESTED",
        "CANCELLED",
        "SUPERSEDED",
    ]
    responsible_role: str
    upstream_gate: str | None
    input_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    input_version_ids: list[str]
    output_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    attempt_count: int = Field(ge=0)
    max_attempts: int = Field(ge=1)
    updated_at: datetime


class TaskAttemptData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attempt_id: str = Field(pattern=ATTEMPT_ID_PATTERN)
    number: int = Field(ge=1)
    execution_mode: Literal["local", "remote"]
    status: Literal[
        "READY",
        "LEASED",
        "RUNNING",
        "SUBMIT_INTENT",
        "SUBMITTING",
        "WAITING_REMOTE",
        "REMOTE_UNKNOWN",
        "SUCCEEDED",
        "FAILED",
        "CANCEL_REQUESTED",
        "CANCELLED",
        "NOT_SUBMITTED",
    ]
    provider_model: str | None
    provider_job_id: str | None
    retry_disposition: (
        Literal[
            "SAFE_LOCAL_RETRY",
            "PROVIDER_CONFIRMED_NOT_ACCEPTED",
            "NON_RETRYABLE",
            "REMOTE_UNKNOWN",
        ]
        | None
    )
    error_code: str | None
    output_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    started_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime


class TaskLedgerData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(pattern=TASK_ID_PATTERN)
    kind: str
    status: Literal["READY", "LEASED", "COMPLETED", "CANCELLED"]
    priority: int = Field(ge=0, le=100)
    available_at: datetime
    lease_generation: int = Field(ge=0)
    lease_expires_at: datetime | None
    heartbeat_at: datetime | None
    updated_at: datetime


class TaskCostData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["NOT_RECORDED"] = "NOT_RECORDED"
    currency: str | None = None
    reserved: str | None = None
    accrued: str | None = None
    billed: str | None = None
    budget_limit: str | None = None
    retry_increment_limit: str | None = None


class TaskPresentationData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status_label: str
    next_action_label: str
    allowed_actions: list[Literal["VIEW_DETAILS"]]


class TaskQueueItemData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node: TaskNodeData
    attempt: TaskAttemptData
    task: TaskLedgerData
    cost: TaskCostData
    presentation: TaskPresentationData


class TaskQueueSummaryData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int = Field(ge=0)
    attention: int = Field(ge=0)
    active: int = Field(ge=0)
    completed: int = Field(ge=0)


class TaskQueueData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    summary: TaskQueueSummaryData
    tasks: list[TaskQueueItemData]


class TaskQueueResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: TaskQueueData
    request_id: UUID


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    aspect_ratio: Literal["9:16"] = "9:16"
    target_duration_seconds: int = Field(default=90, ge=30, le=180)
    source_language: Literal["zh-CN"] = "zh-CN"

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def reject_control_characters(cls, value: str) -> str:
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Project name contains unsupported control characters")
        return value


class ProjectData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=PROJECT_ID_PATTERN)
    name: str
    aspect_ratio: Literal["9:16"]
    target_duration_seconds: int
    source_language: Literal["zh-CN"]
    status: Literal["active", "archived"]
    revision: int
    created_at: datetime
    updated_at: datetime


class ProjectResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ProjectData
    request_id: UUID


class ProjectListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[ProjectData]
    request_id: UUID


class ImportTextSourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    media_type: Literal["text/plain"] = "text/plain"
    content_base64: str = Field(min_length=4)

    @field_validator("content_base64")
    @classmethod
    def validate_base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Source content must be valid Base64") from error
        return value

    def decoded_content(self) -> bytes:
        return base64.b64decode(self.content_base64, validate=True)


class SourceBlockData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SOURCE_BLOCK_ID_PATTERN)
    ordinal: int
    kind: Literal["chapter_heading", "paragraph"]
    chapter_index: int
    text: str
    normalized_start_byte: int
    normalized_end_byte: int
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SourceDocumentSummaryData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SOURCE_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    filename: str
    media_type: Literal["text/plain"]
    encoding: Literal["utf-8"]
    byte_size: int
    raw_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    imported_at: datetime
    chapter_count: int
    block_count: int


class SourceDocumentData(SourceDocumentSummaryData):
    model_config = ConfigDict(extra="forbid")

    blocks: list[SourceBlockData]


class SourceDocumentListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[SourceDocumentSummaryData]
    request_id: UUID


class SourceDocumentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SourceDocumentData
    request_id: UUID


class ArtifactHeadData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    latest_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    review_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    review_submission_id: str | None
    accepted_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    revision: int = Field(ge=1)
    review_evidence_revision: int = Field(ge=0)
    updated_at: datetime


class SourceManifestVersionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=VERSION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_number: int = Field(ge=1)
    schema_version: Literal["1.0.0"]
    content: SourceManifestContentV1
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    parent_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    change_summary: str
    created_at: datetime


class SourceManifestData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    head: ArtifactHeadData
    latest_version: SourceManifestVersionData
    review_version: SourceManifestVersionData | None
    accepted_version: SourceManifestVersionData | None


class SourceManifestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SourceManifestData
    request_id: UUID


class StorySourceSpanData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=SOURCE_SPAN_ID_PATTERN)
    fact_id: str = Field(pattern=FACT_ID_PATTERN)
    source_document_id: str = Field(pattern=SOURCE_ID_PATTERN)
    source_block_id: str = Field(pattern=SOURCE_BLOCK_ID_PATTERN)
    role: Literal["supports", "contradicts", "context"]
    start_byte: int = Field(ge=0)
    end_byte: int = Field(gt=0)
    claim: str = Field(min_length=1, max_length=1000)
    quote_hash: str = Field(pattern=CONTENT_HASH_PATTERN)


class StoryBibleVersionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=VERSION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_number: int = Field(ge=1)
    schema_version: Literal["1.0.0"]
    content: StoryBibleContentV1
    source_spans: list[StorySourceSpanData] = Field(max_length=MAX_STORY_BIBLE_SOURCE_SPANS)
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    parent_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    change_summary: str
    created_at: datetime


class StoryBibleVersionSummaryData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=VERSION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_number: int = Field(ge=1)
    schema_version: Literal["1.0.0"]
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    parent_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    change_summary: str
    created_at: datetime


class StoryBibleIndexData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    head: ArtifactHeadData
    latest_version: StoryBibleVersionSummaryData
    review_version: StoryBibleVersionSummaryData | None
    accepted_version: StoryBibleVersionSummaryData | None


class StoryBibleIndexResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: StoryBibleIndexData
    request_id: UUID


class StoryBibleVersionReadData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    head: ArtifactHeadData
    version: StoryBibleVersionData


class StoryBibleVersionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: StoryBibleVersionReadData
    request_id: UUID


class CreateStoryBibleVersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: StoryBibleContentDraftV1
    source_spans: list[StorySourceSpanDraftV1] = Field(max_length=MAX_STORY_BIBLE_SOURCE_SPANS)
    parent_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    change_summary: str = Field(min_length=1, max_length=1000)

    @field_validator("change_summary", mode="before")
    @classmethod
    def normalize_change_summary(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class StoryBibleVersionCreatedData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    head: ArtifactHeadData
    version: StoryBibleVersionData
    id_map: dict[str, str]


class StoryBibleVersionCreatedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: StoryBibleVersionCreatedData
    request_id: UUID


class EmptyActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConfirmationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    challenge_id: str = Field(pattern=CHALLENGE_ID_PATTERN)
    confirmation_token: str = Field(min_length=20, max_length=256)


class PrepareGateDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approved"]
    rationale: str = Field(min_length=1, max_length=1000)
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)

    @field_validator("rationale", mode="before")
    @classmethod
    def normalize_rationale(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class GateDecisionRequest(ConfirmationRequest):
    decision: Literal["approved"]
    rationale: str = Field(min_length=1, max_length=1000)

    @field_validator("rationale", mode="before")
    @classmethod
    def normalize_rationale(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class GateReadinessReportData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=REPORT_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    gate: Literal["G1", "G2"]
    submission_id: str | None = Field(default=None, pattern=SUBMISSION_ID_PATTERN)
    policy_code: str
    policy_version: str
    head_revision: int = Field(ge=1)
    review_evidence_revision: int = Field(ge=0)
    report: dict[str, object]
    report_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    expires_at: datetime
    created_at: datetime


class ConfirmationChallengeData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=CHALLENGE_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    gate: Literal["G1", "G2"]
    action: Literal["submit", "signoff", "decision"]
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    head_revision: int = Field(ge=1)
    review_evidence_revision: int = Field(ge=0)
    expires_at: datetime
    consumed_at: datetime | None
    created_at: datetime


class PreparedReviewActionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report: GateReadinessReportData
    challenge: ConfirmationChallengeData
    confirmation_token: str


class PreparedReviewActionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: PreparedReviewActionData
    request_id: UUID


class ReviewSubmissionData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SUBMISSION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    gate: Literal["G1", "G2"]
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    supersedes_submission_id: str | None = Field(default=None, pattern=SUBMISSION_ID_PATTERN)
    submitted_by_actor_id: str
    submitted_at: datetime


class ReviewSubmissionResultData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission: ReviewSubmissionData
    head: ArtifactHeadData


class ReviewSubmissionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ReviewSubmissionResultData
    request_id: UUID


class RoleSignoffData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SIGNOFF_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    submission_id: str = Field(pattern=SUBMISSION_ID_PATTERN)
    gate: Literal["G1", "G2"]
    role: str
    actor_id: str
    review_evidence_revision: int = Field(ge=0)
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    self_review: bool
    supersedes_signoff_id: str | None = Field(default=None, pattern=SIGNOFF_ID_PATTERN)
    signed_at: datetime


class ReviewSignoffResultData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signoffs: list[RoleSignoffData]
    head: ArtifactHeadData


class ReviewSignoffResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ReviewSignoffResultData
    request_id: UUID


class GateDecisionData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=DECISION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    submission_id: str = Field(pattern=SUBMISSION_ID_PATTERN)
    gate: Literal["G1", "G2"]
    decision: Literal["approved", "approved_with_waiver", "rejected"]
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    actor_id: str
    actor_role: str
    self_review: bool
    rationale: str
    decided_at: datetime


class GateDecisionResultData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: GateDecisionData
    head: ArtifactHeadData


class GateDecisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: GateDecisionResultData
    request_id: UUID
