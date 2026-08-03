"""Typed local-domain records shared by persistence and API composition."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

type ProjectStatus = Literal["active", "archived"]
type SourceBlockKind = Literal["chapter_heading", "paragraph"]
type ArtifactActorType = Literal["human", "agent", "system"]
type SourceSpanRole = Literal["supports", "contradicts", "context"]
type DependencyImpact = Literal["blocking", "advisory", "render_only"]


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
