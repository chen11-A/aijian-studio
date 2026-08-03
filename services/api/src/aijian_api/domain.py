"""Typed local-domain records shared by persistence and API composition."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

type ProjectStatus = Literal["active", "archived"]
type SourceBlockKind = Literal["chapter_heading", "paragraph"]


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
