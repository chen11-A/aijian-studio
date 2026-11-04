"""G5 review DTOs; existing G1/G2 wire schemas remain unchanged."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.contracts import (
    ARTIFACT_ID_PATTERN,
    CHALLENGE_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    DECISION_ID_PATTERN,
    REPORT_ID_PATTERN,
    SIGNOFF_ID_PATTERN,
    SUBMISSION_ID_PATTERN,
    VERSION_ID_PATTERN,
    ArtifactHeadData,
)


class VisualGateReadinessReportData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=REPORT_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    gate: Literal["G5"]
    submission_id: str | None = Field(default=None, pattern=SUBMISSION_ID_PATTERN)
    policy_code: str
    policy_version: str
    head_revision: int = Field(ge=1)
    review_evidence_revision: int = Field(ge=0)
    report: dict[str, object]
    report_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    expires_at: datetime
    created_at: datetime


class VisualConfirmationChallengeData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=CHALLENGE_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    gate: Literal["G5"]
    action: Literal["submit", "signoff", "decision"]
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    head_revision: int = Field(ge=1)
    review_evidence_revision: int = Field(ge=0)
    expires_at: datetime
    consumed_at: datetime | None
    created_at: datetime


class VisualPreparedReviewActionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report: VisualGateReadinessReportData
    challenge: VisualConfirmationChallengeData
    confirmation_token: str


class VisualPreparedReviewActionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: VisualPreparedReviewActionData
    request_id: UUID


class VisualReviewSubmissionData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SUBMISSION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    gate: Literal["G5"]
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    supersedes_submission_id: str | None = Field(default=None, pattern=SUBMISSION_ID_PATTERN)
    submitted_by_actor_id: str
    submitted_at: datetime


class VisualReviewSubmissionResultData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission: VisualReviewSubmissionData
    head: ArtifactHeadData


class VisualReviewSubmissionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: VisualReviewSubmissionResultData
    request_id: UUID


class VisualRoleSignoffData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SIGNOFF_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    submission_id: str = Field(pattern=SUBMISSION_ID_PATTERN)
    gate: Literal["G5"]
    role: str
    actor_id: str
    review_evidence_revision: int = Field(ge=0)
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    self_review: bool
    supersedes_signoff_id: str | None = Field(default=None, pattern=SIGNOFF_ID_PATTERN)
    signed_at: datetime


class VisualReviewSignoffResultData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signoffs: list[VisualRoleSignoffData]
    head: ArtifactHeadData


class VisualReviewSignoffResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: VisualReviewSignoffResultData
    request_id: UUID


class VisualGateDecisionData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=DECISION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    submission_id: str = Field(pattern=SUBMISSION_ID_PATTERN)
    gate: Literal["G5"]
    decision: Literal["approved", "rejected"]
    readiness_report_id: str = Field(pattern=REPORT_ID_PATTERN)
    actor_id: str
    actor_role: str
    self_review: bool
    rationale: str
    decided_at: datetime


class VisualGateDecisionResultData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: VisualGateDecisionData
    head: ArtifactHeadData


class VisualGateDecisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: VisualGateDecisionResultData
    request_id: UUID


class VisualReviewOperationData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str = Field(pattern=r"^prj_[0-9a-f]{32}$")
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    challenge: VisualConfirmationChallengeData
    action_payload_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    actor_id: str
    actor_roles: list[str]
    policy_snapshot_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    report: VisualGateReadinessReportData
    terminal_no_write: bool
    state: Literal["NOT_CONSUMED", "COMPLETED"]
    result_revision: int | None = Field(ge=1)
    head: ArtifactHeadData
    submission: VisualReviewSubmissionData | None
    signoffs: list[VisualRoleSignoffData]
    decision: VisualGateDecisionData | None


class VisualReviewOperationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: VisualReviewOperationData
    request_id: UUID


class VisualReviewStateData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str = Field(pattern=r"^prj_[0-9a-f]{32}$")
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    head: ArtifactHeadData
    signoffs: list[VisualRoleSignoffData]
    reports: list[VisualGateReadinessReportData]


class VisualReviewStateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: VisualReviewStateData
    request_id: UUID
