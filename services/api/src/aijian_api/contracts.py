"""Versioned public API contracts."""

import base64
import binascii
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from aijian_api.source_manifest import SourceManifestContentV1

PROJECT_ID_PATTERN = r"^prj_[0-9a-f]{32}$"
SOURCE_ID_PATTERN = r"^src_[0-9a-f]{32}$"
SOURCE_BLOCK_ID_PATTERN = r"^srcb_[0-9a-f]{32}$"
ARTIFACT_ID_PATTERN = r"^art_[0-9a-f]{32}$"
VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
REPORT_ID_PATTERN = r"^rpt_[0-9a-f]{32}$"
CHALLENGE_ID_PATTERN = r"^chg_[0-9a-f]{32}$"
SUBMISSION_ID_PATTERN = r"^sub_[0-9a-f]{32}$"
SIGNOFF_ID_PATTERN = r"^sig_[0-9a-f]{32}$"
DECISION_ID_PATTERN = r"^dec_[0-9a-f]{32}$"


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

    head: ArtifactHeadData
    latest_version: SourceManifestVersionData


class SourceManifestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SourceManifestData
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
