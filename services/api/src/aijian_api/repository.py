"""Crash-safe SQLite persistence for local project and source truth."""

import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import uuid4

from aijian_api.domain import (
    Project,
    ProjectStatus,
    SourceBlock,
    SourceBlockKind,
    SourceDocument,
    SourceDocumentSummary,
)
from aijian_api.ingestion import ParsedSource

SCHEMA_VERSION = 1


class ProjectNotFoundError(LookupError):
    pass


class SourceAlreadyImportedError(RuntimeError):
    pass


class SchemaTooNewError(RuntimeError):
    pass


def _default_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class StudioRepository:
    def __init__(
        self,
        database_path: Path,
        *,
        id_factory: Callable[[str], str] = _default_id,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._database_path = database_path
        self._id_factory = id_factory
        self._clock = clock
        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._open()
        try:
            yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if version > SCHEMA_VERSION:
                raise SchemaTooNewError("Workspace schema is newer than this application")
            connection.execute("PRAGMA journal_mode = WAL")
            if version == 0:
                connection.executescript(
                    """
                    CREATE TABLE projects (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        aspect_ratio TEXT NOT NULL,
                        target_duration_seconds INTEGER NOT NULL,
                        source_language TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
                        revision INTEGER NOT NULL CHECK (revision >= 1),
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE source_documents (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        filename TEXT NOT NULL,
                        media_type TEXT NOT NULL,
                        encoding TEXT NOT NULL,
                        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
                        raw_sha256 TEXT NOT NULL,
                        normalized_text TEXT NOT NULL,
                        imported_at TEXT NOT NULL,
                        chapter_count INTEGER NOT NULL CHECK (chapter_count >= 1),
                        UNIQUE (project_id, raw_sha256)
                    );

                    CREATE TABLE source_blocks (
                        id TEXT PRIMARY KEY,
                        source_document_id TEXT NOT NULL
                            REFERENCES source_documents(id) ON DELETE CASCADE,
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                        kind TEXT NOT NULL CHECK (kind IN ('chapter_heading', 'paragraph')),
                        chapter_index INTEGER NOT NULL CHECK (chapter_index >= 1),
                        text TEXT NOT NULL,
                        normalized_start_byte INTEGER NOT NULL CHECK (normalized_start_byte >= 0),
                        normalized_end_byte INTEGER NOT NULL
                            CHECK (normalized_end_byte >= normalized_start_byte),
                        content_sha256 TEXT NOT NULL,
                        UNIQUE (source_document_id, ordinal)
                    );

                    CREATE INDEX source_documents_project
                        ON source_documents(project_id, imported_at DESC);
                    CREATE INDEX source_blocks_document
                        ON source_blocks(source_document_id, ordinal);
                    PRAGMA user_version = 1;
                    """
                )
                connection.commit()

    def create_project(
        self,
        *,
        name: str,
        aspect_ratio: str,
        target_duration_seconds: int,
        source_language: str,
    ) -> Project:
        now = self._clock()
        project = Project(
            id=self._id_factory("prj"),
            name=name,
            aspect_ratio=aspect_ratio,
            target_duration_seconds=target_duration_seconds,
            source_language=source_language,
            status="active",
            revision=1,
            created_at=now,
            updated_at=now,
        )
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO projects (
                    id, name, aspect_ratio, target_duration_seconds, source_language,
                    status, revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project.id,
                    project.name,
                    project.aspect_ratio,
                    project.target_duration_seconds,
                    project.source_language,
                    project.status,
                    project.revision,
                    _timestamp(project.created_at),
                    _timestamp(project.updated_at),
                ),
            )
            connection.commit()
        return project

    def list_projects(self) -> list[Project]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC, id ASC"
            ).fetchall()
        return [self._project_from_row(row) for row in rows]

    def get_project(self, project_id: str) -> Project:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
        if row is None:
            raise ProjectNotFoundError("Project was not found")
        return self._project_from_row(row)

    def import_source(self, project_id: str, source: ParsedSource) -> SourceDocument:
        document_id = self._id_factory("src")
        imported_at = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                project = connection.execute(
                    "SELECT id FROM projects WHERE id = ?", (project_id,)
                ).fetchone()
                if project is None:
                    raise ProjectNotFoundError("Project was not found")
                duplicate = connection.execute(
                    "SELECT id FROM source_documents WHERE project_id = ? AND raw_sha256 = ?",
                    (project_id, source.raw_sha256),
                ).fetchone()
                if duplicate is not None:
                    raise SourceAlreadyImportedError("Source has already been imported")

                connection.execute(
                    """
                    INSERT INTO source_documents (
                        id, project_id, filename, media_type, encoding, byte_size, raw_sha256,
                        normalized_text, imported_at, chapter_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        project_id,
                        source.filename,
                        source.media_type,
                        source.encoding,
                        source.byte_size,
                        source.raw_sha256,
                        source.normalized_text,
                        _timestamp(imported_at),
                        source.chapter_count,
                    ),
                )
                blocks: list[SourceBlock] = []
                for draft in source.blocks:
                    block = SourceBlock(
                        id=self._id_factory("srcb"),
                        source_document_id=document_id,
                        project_id=project_id,
                        ordinal=draft.ordinal,
                        kind=draft.kind,
                        chapter_index=draft.chapter_index,
                        text=draft.text,
                        normalized_start_byte=draft.normalized_start_byte,
                        normalized_end_byte=draft.normalized_end_byte,
                        content_sha256=draft.content_sha256,
                    )
                    connection.execute(
                        """
                        INSERT INTO source_blocks (
                            id, source_document_id, project_id, ordinal, kind, chapter_index,
                            text, normalized_start_byte, normalized_end_byte, content_sha256
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            block.id,
                            block.source_document_id,
                            block.project_id,
                            block.ordinal,
                            block.kind,
                            block.chapter_index,
                            block.text,
                            block.normalized_start_byte,
                            block.normalized_end_byte,
                            block.content_sha256,
                        ),
                    )
                    blocks.append(block)
                connection.execute(
                    "UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?",
                    (_timestamp(imported_at), project_id),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return SourceDocument(
            id=document_id,
            project_id=project_id,
            filename=source.filename,
            media_type=source.media_type,
            encoding=source.encoding,
            byte_size=source.byte_size,
            raw_sha256=source.raw_sha256,
            normalized_text=source.normalized_text,
            imported_at=imported_at,
            chapter_count=source.chapter_count,
            blocks=tuple(blocks),
        )

    def list_sources(self, project_id: str) -> list[SourceDocumentSummary]:
        self.get_project(project_id)
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT source_documents.*, COUNT(source_blocks.id) AS block_count
                FROM source_documents
                LEFT JOIN source_blocks ON source_blocks.source_document_id = source_documents.id
                WHERE source_documents.project_id = ?
                GROUP BY source_documents.id
                ORDER BY imported_at DESC, source_documents.id ASC
                """,
                (project_id,),
            ).fetchall()
        return [self._source_summary_from_row(row) for row in rows]

    def get_source(self, project_id: str, source_id: str) -> SourceDocument:
        with self._connection() as connection:
            document = connection.execute(
                "SELECT * FROM source_documents WHERE project_id = ? AND id = ?",
                (project_id, source_id),
            ).fetchone()
            if document is None:
                raise ProjectNotFoundError("Source document was not found")
            block_rows = connection.execute(
                "SELECT * FROM source_blocks WHERE source_document_id = ? ORDER BY ordinal ASC",
                (source_id,),
            ).fetchall()
        blocks = tuple(self._source_block_from_row(row) for row in block_rows)
        return SourceDocument(
            id=str(document["id"]),
            project_id=str(document["project_id"]),
            filename=str(document["filename"]),
            media_type=str(document["media_type"]),
            encoding=str(document["encoding"]),
            byte_size=int(document["byte_size"]),
            raw_sha256=str(document["raw_sha256"]),
            normalized_text=str(document["normalized_text"]),
            imported_at=_datetime(str(document["imported_at"])),
            chapter_count=int(document["chapter_count"]),
            blocks=blocks,
        )

    @staticmethod
    def _project_from_row(row: sqlite3.Row) -> Project:
        return Project(
            id=str(row["id"]),
            name=str(row["name"]),
            aspect_ratio=str(row["aspect_ratio"]),
            target_duration_seconds=int(row["target_duration_seconds"]),
            source_language=str(row["source_language"]),
            status=cast(ProjectStatus, row["status"]),
            revision=int(row["revision"]),
            created_at=_datetime(str(row["created_at"])),
            updated_at=_datetime(str(row["updated_at"])),
        )

    @staticmethod
    def _source_summary_from_row(row: sqlite3.Row) -> SourceDocumentSummary:
        return SourceDocumentSummary(
            id=str(row["id"]),
            project_id=str(row["project_id"]),
            filename=str(row["filename"]),
            media_type=str(row["media_type"]),
            encoding=str(row["encoding"]),
            byte_size=int(row["byte_size"]),
            raw_sha256=str(row["raw_sha256"]),
            imported_at=_datetime(str(row["imported_at"])),
            chapter_count=int(row["chapter_count"]),
            block_count=int(row["block_count"]),
        )

    @staticmethod
    def _source_block_from_row(row: sqlite3.Row) -> SourceBlock:
        return SourceBlock(
            id=str(row["id"]),
            source_document_id=str(row["source_document_id"]),
            project_id=str(row["project_id"]),
            ordinal=int(row["ordinal"]),
            kind=cast(SourceBlockKind, row["kind"]),
            chapter_index=int(row["chapter_index"]),
            text=str(row["text"]),
            normalized_start_byte=int(row["normalized_start_byte"]),
            normalized_end_byte=int(row["normalized_end_byte"]),
            content_sha256=str(row["content_sha256"]),
        )
