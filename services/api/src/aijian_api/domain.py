"""Typed local-domain records shared by persistence and API composition."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

type ProjectStatus = Literal["active", "archived"]
type SourceBlockKind = Literal["chapter_heading", "paragraph"]
type ArtifactActorType = Literal["human", "agent", "system"]
type SourceSpanRole = Literal["supports", "contradicts", "context"]
type DependencyImpact = Literal["blocking", "advisory", "render_only"]
type ReviewAction = Literal["submit", "signoff", "decision"]
type GateDecisionValue = Literal["approved", "approved_with_waiver", "rejected"]


@dataclass(frozen=True, slots=True)
class Project:
    id: str
    name: str
    aspect_ratio: str
    target_duration_seconds: int
    source_language: str
    status: ProjectStatus
    revision: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class SourceBlock:
    id: str
    source_document_id: str
    project_id: str
    ordinal: int
    kind: SourceBlockKind
    chapter_index: int
    text: str
    normalized_start_byte: int
    normalized_end_byte: int
    content_sha256: str


@dataclass(frozen=True, slots=True)
class SourceDocumentSummary:
    id: str
    project_id: str
    filename: str
    media_type: str
    encoding: str
    byte_size: int
    raw_sha256: str
    imported_at: datetime
    chapter_count: int
    block_count: int


@dataclass(frozen=True, slots=True)
class SourceDocument:
    id: str
    project_id: str
    filename: str
    media_type: str
    encoding: str
    byte_size: int
    raw_sha256: str
    normalized_text: str
    imported_at: datetime
    chapter_count: int
    blocks: tuple[SourceBlock, ...]

    def summary(self) -> SourceDocumentSummary:
        return SourceDocumentSummary(
            id=self.id,
            project_id=self.project_id,
            filename=self.filename,
            media_type=self.media_type,
            encoding=self.encoding,
            byte_size=self.byte_size,
            raw_sha256=self.raw_sha256,
            imported_at=self.imported_at,
            chapter_count=self.chapter_count,
            block_count=len(self.blocks),
        )


@dataclass(frozen=True, slots=True)
class ArtifactSourceSpanDraft:
    fact_id: str
    source_document_id: str
    source_block_id: str
    role: SourceSpanRole
    start_byte: int
    end_byte: int
    claim: str


@dataclass(frozen=True, slots=True)
class ArtifactDependencyDraft:
    upstream_version_id: str
    relationship: str
    impact: DependencyImpact


@dataclass(frozen=True, slots=True)
class ArtifactVersion:
    id: str
    artifact_id: str
    version_number: int
    schema_version: str
    content: dict[str, object]
    content_hash: str
    author_actor_type: ArtifactActorType
    author_actor_id: str
    parent_version_id: str | None
    change_summary: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ArtifactHead:
    artifact_id: str
    latest_version_id: str
    review_version_id: str | None
    review_submission_id: str | None
    accepted_version_id: str | None
    revision: int
    review_evidence_revision: int
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ArtifactSourceSpan:
    id: str
    artifact_id: str
    version_id: str
    fact_id: str
    project_id: str
    source_document_id: str
    source_block_id: str
    role: SourceSpanRole
    start_byte: int
    end_byte: int
    claim: str
    quote_hash: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ArtifactDependency:
    id: str
    downstream_artifact_id: str
    downstream_version_id: str
    upstream_artifact_id: str
    upstream_version_id: str
    relationship: str
    impact: DependencyImpact
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ArtifactVersionRecord:
    version: ArtifactVersion
    head: ArtifactHead
    source_spans: tuple[ArtifactSourceSpan, ...]
    dependencies: tuple[ArtifactDependency, ...]


@dataclass(frozen=True, slots=True)
class TrustedReviewActor:
    subject_id: str
    roles: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class GateReadinessReport:
    id: str
    artifact_id: str
    version_id: str
    gate: str
    submission_id: str | None
    policy_code: str
    policy_version: str
    head_revision: int
    review_evidence_revision: int
    report: dict[str, object]
    report_hash: str
    expires_at: datetime
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ConfirmationChallenge:
    id: str
    artifact_id: str
    version_id: str
    gate: str
    action: ReviewAction
    action_payload_hash: str
    policy_snapshot_hash: str
    actor_id: str
    actor_roles: tuple[str, ...]
    readiness_report_id: str
    head_revision: int
    review_evidence_revision: int
    expires_at: datetime
    consumed_at: datetime | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PreparedReviewAction:
    report: GateReadinessReport
    challenge: ConfirmationChallenge
    confirmation_token: str


@dataclass(frozen=True, slots=True)
class ReviewSubmission:
    id: str
    artifact_id: str
    version_id: str
    gate: str
    readiness_report_id: str
    supersedes_submission_id: str | None
    submitted_by_actor_id: str
    submitted_at: datetime


@dataclass(frozen=True, slots=True)
class ReviewSubmissionResult:
    submission: ReviewSubmission
    head: ArtifactHead


@dataclass(frozen=True, slots=True)
class RoleSignoff:
    id: str
    artifact_id: str
    version_id: str
    submission_id: str
    gate: str
    role: str
    actor_id: str
    review_evidence_revision: int
    readiness_report_id: str
    self_review: bool
    supersedes_signoff_id: str | None
    signed_at: datetime


@dataclass(frozen=True, slots=True)
class ReviewSignoffResult:
    signoffs: tuple[RoleSignoff, ...]
    head: ArtifactHead


@dataclass(frozen=True, slots=True)
class GateDecision:
    id: str
    artifact_id: str
    version_id: str
    submission_id: str
    gate: str
    decision: GateDecisionValue
    readiness_report_id: str
    confirmation_challenge_id: str
    head_revision: int
    actor_id: str
    actor_role: str
    self_review: bool
    rationale: str
    decided_at: datetime


@dataclass(frozen=True, slots=True)
class GateDecisionResult:
    decision: GateDecision
    head: ArtifactHead
