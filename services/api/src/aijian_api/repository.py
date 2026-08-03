"""Crash-safe SQLite persistence for local project, source, and artifact truth."""

import hashlib
import json
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import uuid4

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import (
    ArtifactActorType,
    ArtifactDependency,
    ArtifactDependencyDraft,
    ArtifactHead,
    ArtifactSourceSpan,
    ArtifactSourceSpanDraft,
    ArtifactVersion,
    ArtifactVersionRecord,
    DependencyImpact,
    Project,
    ProjectStatus,
    SourceBlock,
    SourceBlockKind,
    SourceDocument,
    SourceDocumentSummary,
    SourceSpanRole,
)
from aijian_api.ingestion import ParsedSource

SCHEMA_VERSION = 2

type MigrationHook = Callable[[int, int], None]


_MIGRATION_1 = (
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
    )
    """,
    """
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
    )
    """,
    """
    CREATE TABLE source_blocks (
        id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
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
    )
    """,
    "CREATE INDEX source_documents_project ON source_documents(project_id, imported_at DESC)",
    "CREATE INDEX source_blocks_document ON source_blocks(source_document_id, ordinal)",
)


_MIGRATION_2 = (
    "CREATE UNIQUE INDEX source_documents_project_id ON source_documents(project_id, id)",
    """
    CREATE UNIQUE INDEX source_blocks_project_document_id
    ON source_blocks(project_id, source_document_id, id)
    """,
    """
    CREATE TABLE artifacts (
        artifact_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        artifact_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, artifact_type)
    )
    """,
    """
    CREATE TABLE artifact_versions (
        version_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL CHECK (version_number >= 1),
        schema_version TEXT NOT NULL,
        content_json TEXT NOT NULL,
        content_hash TEXT NOT NULL
            CHECK (length(content_hash) = 71 AND content_hash LIKE 'sha256:%'),
        author_actor_type TEXT NOT NULL
            CHECK (author_actor_type IN ('human', 'agent', 'system')),
        author_actor_id TEXT NOT NULL,
        parent_version_id TEXT,
        change_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, version_number),
        UNIQUE (artifact_id, version_id),
        FOREIGN KEY (artifact_id, parent_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE artifact_heads (
        artifact_id TEXT PRIMARY KEY REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        latest_version_id TEXT NOT NULL,
        review_version_id TEXT,
        review_submission_id TEXT,
        accepted_version_id TEXT,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (artifact_id, latest_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (artifact_id, review_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (artifact_id, accepted_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
            DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE artifact_source_spans (
        span_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_block_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('supports', 'contradicts', 'context')),
        start_byte INTEGER NOT NULL CHECK (start_byte >= 0),
        end_byte INTEGER NOT NULL CHECK (end_byte > start_byte),
        claim TEXT NOT NULL,
        quote_hash TEXT NOT NULL
            CHECK (length(quote_hash) = 71 AND quote_hash LIKE 'sha256:%'),
        created_at TEXT NOT NULL,
        UNIQUE (version_id, fact_id, source_block_id, start_byte, end_byte, role),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, source_document_id)
            REFERENCES source_documents(project_id, id),
        FOREIGN KEY (project_id, source_document_id, source_block_id)
            REFERENCES source_blocks(project_id, source_document_id, id)
    )
    """,
    """
    CREATE TABLE artifact_dependencies (
        dependency_id TEXT PRIMARY KEY,
        downstream_artifact_id TEXT NOT NULL,
        downstream_version_id TEXT NOT NULL,
        upstream_artifact_id TEXT NOT NULL,
        upstream_version_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        impact TEXT NOT NULL CHECK (impact IN ('blocking', 'advisory', 'render_only')),
        created_at TEXT NOT NULL,
        CHECK (downstream_version_id <> upstream_version_id),
        UNIQUE (downstream_version_id, upstream_version_id, relationship),
        FOREIGN KEY (downstream_artifact_id, downstream_version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE,
        FOREIGN KEY (upstream_artifact_id, upstream_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
    )
    """,
    """
    CREATE TABLE gate_readiness_reports (
        report_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        submission_id TEXT,
        policy_code TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        head_revision INTEGER NOT NULL CHECK (head_revision >= 1),
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        report_json TEXT NOT NULL,
        report_hash TEXT NOT NULL
            CHECK (length(report_hash) = 71 AND report_hash LIKE 'sha256:%'),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, report_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE review_submissions (
        submission_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        supersedes_submission_id TEXT REFERENCES review_submissions(submission_id),
        submitted_by_actor_id TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        UNIQUE (version_id, gate),
        UNIQUE (artifact_id, submission_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE review_findings (
        finding_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        scope_type TEXT NOT NULL,
        scope_id TEXT,
        severity TEXT NOT NULL CHECK (severity IN ('blocking', 'major', 'minor', 'note')),
        expected_change TEXT NOT NULL,
        responsible_role TEXT NOT NULL,
        created_by_actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, finding_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE review_finding_events (
        event_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        previous_event_id TEXT REFERENCES review_finding_events(event_id),
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN ('open', 'resolved', 'disputed')),
        resolution_version_id TEXT,
        reason TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (finding_id, sequence),
        FOREIGN KEY (artifact_id, finding_id)
            REFERENCES review_findings(artifact_id, finding_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE role_signoffs (
        signoff_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        gate TEXT NOT NULL,
        role TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        self_review INTEGER NOT NULL CHECK (self_review IN (0, 1)),
        supersedes_signoff_id TEXT REFERENCES role_signoffs(signoff_id),
        signed_at TEXT NOT NULL,
        UNIQUE (version_id, gate, role, review_evidence_revision)
    )
    """,
    """
    CREATE TABLE gate_waivers (
        waiver_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        impact_scope_json TEXT NOT NULL,
        review_gate TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, waiver_id),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE gate_waiver_events (
        event_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        waiver_id TEXT NOT NULL,
        previous_event_id TEXT REFERENCES gate_waiver_events(event_id),
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL CHECK (event_type IN ('open', 'reviewed', 'closed')),
        reason TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (waiver_id, sequence),
        FOREIGN KEY (artifact_id, waiver_id)
            REFERENCES gate_waivers(artifact_id, waiver_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE gate_decisions (
        decision_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        submission_id TEXT NOT NULL REFERENCES review_submissions(submission_id),
        gate TEXT NOT NULL,
        decision TEXT NOT NULL
            CHECK (decision IN ('approved', 'approved_with_waiver', 'rejected')),
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        self_review INTEGER NOT NULL CHECK (self_review IN (0, 1)),
        rationale TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        UNIQUE (version_id, gate),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE confirmation_challenges (
        challenge_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
        version_id TEXT NOT NULL REFERENCES artifact_versions(version_id) ON DELETE CASCADE,
        gate TEXT NOT NULL,
        action TEXT NOT NULL,
        readiness_report_id TEXT NOT NULL REFERENCES gate_readiness_reports(report_id),
        challenge_hash TEXT NOT NULL UNIQUE,
        head_revision INTEGER NOT NULL CHECK (head_revision >= 1),
        review_evidence_revision INTEGER NOT NULL CHECK (review_evidence_revision >= 0),
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TRIGGER artifact_dependencies_no_cycle
    BEFORE INSERT ON artifact_dependencies
    BEGIN
        SELECT CASE WHEN EXISTS (
            WITH RECURSIVE upstream(version_id) AS (
                SELECT NEW.upstream_version_id
                UNION
                SELECT dependency.upstream_version_id
                FROM artifact_dependencies AS dependency
                JOIN upstream ON dependency.downstream_version_id = upstream.version_id
            )
            SELECT 1 FROM upstream WHERE version_id = NEW.downstream_version_id
        ) THEN RAISE(ABORT, 'artifact dependency cycle') END;
    END
    """,
)


_IMMUTABLE_V2_TABLES = (
    "artifact_versions",
    "artifact_source_spans",
    "artifact_dependencies",
    "gate_readiness_reports",
    "review_submissions",
    "review_findings",
    "review_finding_events",
    "role_signoffs",
    "gate_decisions",
    "gate_waivers",
    "gate_waiver_events",
)


_IMMUTABILITY_TRIGGERS = tuple(
    f"""
    CREATE TRIGGER {table}_immutable_update
    BEFORE UPDATE ON {table}
    BEGIN
        SELECT RAISE(ABORT, '{table} rows are immutable');
    END
    """
    for table in _IMMUTABLE_V2_TABLES
) + tuple(
    f"""
    CREATE TRIGGER {table}_immutable_delete
    BEFORE DELETE ON {table}
    BEGIN
        SELECT RAISE(ABORT, '{table} rows are immutable');
    END
    """
    for table in _IMMUTABLE_V2_TABLES
)


_MIGRATIONS = {1: _MIGRATION_1, 2: _MIGRATION_2 + _IMMUTABILITY_TRIGGERS}


class ProjectNotFoundError(LookupError):
    pass


class SourceAlreadyImportedError(RuntimeError):
    pass


class SchemaTooNewError(RuntimeError):
    pass


class ArtifactConflictError(RuntimeError):
    pass


class SourceSpanInvalidError(ValueError):
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
        migration_hook: MigrationHook | None = None,
    ) -> None:
        self._database_path = database_path
        self._id_factory = id_factory
        self._clock = clock
        self._migration_hook = migration_hook
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
            while version < SCHEMA_VERSION:
                next_version = version + 1
                statements = _MIGRATIONS[next_version]
                connection.execute("BEGIN IMMEDIATE")
                try:
                    for step, statement in enumerate(statements):
                        connection.execute(statement)
                        if self._migration_hook is not None:
                            self._migration_hook(next_version, step)
                    foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
                    if foreign_key_errors:
                        raise RuntimeError("Migration produced invalid foreign keys")
                    connection.execute(f"PRAGMA user_version = {next_version}")
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
                version = next_version

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

    def create_artifact_version(
        self,
        *,
        project_id: str,
        artifact_type: str,
        schema_version: str,
        content: dict[str, object],
        author_actor_type: ArtifactActorType,
        author_actor_id: str,
        change_summary: str,
        parent_version_id: str | None = None,
        expected_revision: int | None = None,
        source_spans: tuple[ArtifactSourceSpanDraft, ...] = (),
        dependencies: tuple[ArtifactDependencyDraft, ...] = (),
    ) -> ArtifactVersionRecord:
        """Append an immutable artifact version and conditionally move its latest head."""

        content_bytes = canonical_content_bytes(content)
        content_json = content_bytes.decode("utf-8")
        content_hash = canonical_content_hash(content)
        created_at = self._clock()
        version_id = self._id_factory("ver")

        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                project = connection.execute(
                    "SELECT id FROM projects WHERE id = ?", (project_id,)
                ).fetchone()
                if project is None:
                    raise ProjectNotFoundError("Project was not found")

                artifact_row = connection.execute(
                    "SELECT * FROM artifacts WHERE project_id = ? AND artifact_type = ?",
                    (project_id, artifact_type),
                ).fetchone()
                if artifact_row is None:
                    if expected_revision is not None or parent_version_id is not None:
                        raise ArtifactConflictError("Artifact does not have the expected head")
                    artifact_id = self._id_factory("art")
                    version_number = 1
                    connection.execute(
                        "INSERT INTO artifacts VALUES (?, ?, ?, ?)",
                        (artifact_id, project_id, artifact_type, _timestamp(created_at)),
                    )
                else:
                    artifact_id = str(artifact_row["artifact_id"])
                    head_row = connection.execute(
                        "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
                    ).fetchone()
                    if (
                        head_row is None
                        or expected_revision is None
                        or int(head_row["revision"]) != expected_revision
                    ):
                        raise ArtifactConflictError("Artifact head revision has changed")
                    if parent_version_id is None:
                        raise ArtifactConflictError("A revision must identify its parent version")
                    parent = connection.execute(
                        """
                        SELECT version_number FROM artifact_versions
                        WHERE artifact_id = ? AND version_id = ?
                        """,
                        (artifact_id, parent_version_id),
                    ).fetchone()
                    if parent is None:
                        raise ArtifactConflictError(
                            "Parent version does not belong to the artifact"
                        )
                    version_number = int(
                        connection.execute(
                            """
                            SELECT COALESCE(MAX(version_number), 0) + 1
                            FROM artifact_versions WHERE artifact_id = ?
                            """,
                            (artifact_id,),
                        ).fetchone()[0]
                    )

                version = ArtifactVersion(
                    id=version_id,
                    artifact_id=artifact_id,
                    version_number=version_number,
                    schema_version=schema_version,
                    content=content,
                    content_hash=content_hash,
                    author_actor_type=author_actor_type,
                    author_actor_id=author_actor_id,
                    parent_version_id=parent_version_id,
                    change_summary=change_summary,
                    created_at=created_at,
                )
                connection.execute(
                    """
                    INSERT INTO artifact_versions (
                        version_id, artifact_id, version_number, schema_version, content_json,
                        content_hash, author_actor_type, author_actor_id, parent_version_id,
                        change_summary, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        version.id,
                        version.artifact_id,
                        version.version_number,
                        version.schema_version,
                        content_json,
                        version.content_hash,
                        version.author_actor_type,
                        version.author_actor_id,
                        version.parent_version_id,
                        version.change_summary,
                        _timestamp(version.created_at),
                    ),
                )

                persisted_spans = tuple(
                    self._insert_source_span(
                        connection,
                        project_id=project_id,
                        artifact_id=artifact_id,
                        version_id=version.id,
                        draft=draft,
                        created_at=created_at,
                    )
                    for draft in source_spans
                )
                persisted_dependencies = tuple(
                    self._insert_dependency(
                        connection,
                        project_id=project_id,
                        downstream_artifact_id=artifact_id,
                        downstream_version_id=version.id,
                        draft=draft,
                        created_at=created_at,
                    )
                    for draft in dependencies
                )

                if artifact_row is None:
                    connection.execute(
                        """
                        INSERT INTO artifact_heads (
                            artifact_id, latest_version_id, review_version_id,
                            review_submission_id, accepted_version_id, revision,
                            review_evidence_revision, updated_at
                        ) VALUES (?, ?, NULL, NULL, NULL, 1, 0, ?)
                        """,
                        (artifact_id, version.id, _timestamp(created_at)),
                    )
                else:
                    updated = connection.execute(
                        """
                        UPDATE artifact_heads
                        SET latest_version_id = ?, revision = revision + 1, updated_at = ?
                        WHERE artifact_id = ? AND revision = ?
                        """,
                        (
                            version.id,
                            _timestamp(created_at),
                            artifact_id,
                            expected_revision,
                        ),
                    )
                    if updated.rowcount != 1:
                        raise ArtifactConflictError("Artifact head revision has changed")

                head_row = connection.execute(
                    "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
                ).fetchone()
                if head_row is None:
                    raise RuntimeError("Artifact head was not persisted")
                head = self._artifact_head_from_row(head_row)
                connection.commit()
            except sqlite3.IntegrityError as error:
                connection.rollback()
                raise ArtifactConflictError("Artifact transaction violated an invariant") from error
            except Exception:
                connection.rollback()
                raise

        return ArtifactVersionRecord(
            version=version,
            head=head,
            source_spans=persisted_spans,
            dependencies=persisted_dependencies,
        )

    def get_artifact_head(self, project_id: str, artifact_type: str) -> ArtifactHead:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT artifact_heads.*
                FROM artifact_heads
                JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
                WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                """,
                (project_id, artifact_type),
            ).fetchone()
        if row is None:
            raise ArtifactConflictError("Artifact was not found")
        return self._artifact_head_from_row(row)

    def get_artifact_version(
        self,
        project_id: str,
        artifact_type: str,
        version_id: str,
    ) -> ArtifactVersionRecord:
        with self._connection() as connection:
            version_row = connection.execute(
                """
                SELECT artifact_versions.*
                FROM artifact_versions
                JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
                WHERE artifacts.project_id = ? AND artifacts.artifact_type = ?
                    AND artifact_versions.version_id = ?
                """,
                (project_id, artifact_type, version_id),
            ).fetchone()
            if version_row is None:
                raise ArtifactConflictError("Artifact version was not found")
            artifact_id = str(version_row["artifact_id"])
            head_row = connection.execute(
                "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact_id,)
            ).fetchone()
            span_rows = connection.execute(
                """
                SELECT * FROM artifact_source_spans
                WHERE version_id = ? ORDER BY fact_id, start_byte, span_id
                """,
                (version_id,),
            ).fetchall()
            dependency_rows = connection.execute(
                """
                SELECT * FROM artifact_dependencies
                WHERE downstream_version_id = ? ORDER BY dependency_id
                """,
                (version_id,),
            ).fetchall()
        if head_row is None:
            raise RuntimeError("Artifact head is missing")
        return ArtifactVersionRecord(
            version=self._artifact_version_from_row(version_row),
            head=self._artifact_head_from_row(head_row),
            source_spans=tuple(self._artifact_source_span_from_row(row) for row in span_rows),
            dependencies=tuple(self._artifact_dependency_from_row(row) for row in dependency_rows),
        )

    def _insert_source_span(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        artifact_id: str,
        version_id: str,
        draft: ArtifactSourceSpanDraft,
        created_at: datetime,
    ) -> ArtifactSourceSpan:
        source_row = connection.execute(
            """
            SELECT source_documents.normalized_text,
                source_blocks.normalized_start_byte, source_blocks.normalized_end_byte
            FROM source_documents
            JOIN source_blocks ON source_blocks.source_document_id = source_documents.id
            WHERE source_documents.project_id = ? AND source_documents.id = ?
                AND source_blocks.project_id = ? AND source_blocks.id = ?
            """,
            (
                project_id,
                draft.source_document_id,
                project_id,
                draft.source_block_id,
            ),
        ).fetchone()
        if source_row is None:
            raise SourceSpanInvalidError("Source span does not belong to the project")
        block_start = int(source_row["normalized_start_byte"])
        block_end = int(source_row["normalized_end_byte"])
        if not (block_start <= draft.start_byte < draft.end_byte <= block_end):
            raise SourceSpanInvalidError("Source span falls outside its source block")
        normalized_bytes = str(source_row["normalized_text"]).encode("utf-8")
        quote_bytes = normalized_bytes[draft.start_byte : draft.end_byte]
        try:
            quote_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise SourceSpanInvalidError(
                "Source span is not aligned to UTF-8 boundaries"
            ) from error
        quote_hash = f"sha256:{hashlib.sha256(quote_bytes).hexdigest()}"
        span = ArtifactSourceSpan(
            id=self._id_factory("spn"),
            artifact_id=artifact_id,
            version_id=version_id,
            fact_id=draft.fact_id,
            project_id=project_id,
            source_document_id=draft.source_document_id,
            source_block_id=draft.source_block_id,
            role=draft.role,
            start_byte=draft.start_byte,
            end_byte=draft.end_byte,
            claim=draft.claim,
            quote_hash=quote_hash,
            created_at=created_at,
        )
        connection.execute(
            """
            INSERT INTO artifact_source_spans VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                span.id,
                span.artifact_id,
                span.version_id,
                span.fact_id,
                span.project_id,
                span.source_document_id,
                span.source_block_id,
                span.role,
                span.start_byte,
                span.end_byte,
                span.claim,
                span.quote_hash,
                _timestamp(span.created_at),
            ),
        )
        return span

    def _insert_dependency(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        downstream_artifact_id: str,
        downstream_version_id: str,
        draft: ArtifactDependencyDraft,
        created_at: datetime,
    ) -> ArtifactDependency:
        upstream = connection.execute(
            """
            SELECT artifact_versions.artifact_id
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifact_versions.version_id = ? AND artifacts.project_id = ?
            """,
            (draft.upstream_version_id, project_id),
        ).fetchone()
        if upstream is None:
            raise ArtifactConflictError("Dependency version does not belong to the project")
        dependency = ArtifactDependency(
            id=self._id_factory("dep"),
            downstream_artifact_id=downstream_artifact_id,
            downstream_version_id=downstream_version_id,
            upstream_artifact_id=str(upstream["artifact_id"]),
            upstream_version_id=draft.upstream_version_id,
            relationship=draft.relationship,
            impact=draft.impact,
            created_at=created_at,
        )
        connection.execute(
            """
            INSERT INTO artifact_dependencies VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dependency.id,
                dependency.downstream_artifact_id,
                dependency.downstream_version_id,
                dependency.upstream_artifact_id,
                dependency.upstream_version_id,
                dependency.relationship,
                dependency.impact,
                _timestamp(dependency.created_at),
            ),
        )
        return dependency

    @staticmethod
    def _artifact_version_from_row(row: sqlite3.Row) -> ArtifactVersion:
        return ArtifactVersion(
            id=str(row["version_id"]),
            artifact_id=str(row["artifact_id"]),
            version_number=int(row["version_number"]),
            schema_version=str(row["schema_version"]),
            content=cast(dict[str, object], json.loads(str(row["content_json"]))),
            content_hash=str(row["content_hash"]),
            author_actor_type=cast(ArtifactActorType, row["author_actor_type"]),
            author_actor_id=str(row["author_actor_id"]),
            parent_version_id=(
                str(row["parent_version_id"]) if row["parent_version_id"] is not None else None
            ),
            change_summary=str(row["change_summary"]),
            created_at=_datetime(str(row["created_at"])),
        )

    @staticmethod
    def _artifact_head_from_row(row: sqlite3.Row) -> ArtifactHead:
        return ArtifactHead(
            artifact_id=str(row["artifact_id"]),
            latest_version_id=str(row["latest_version_id"]),
            review_version_id=(
                str(row["review_version_id"]) if row["review_version_id"] is not None else None
            ),
            review_submission_id=(
                str(row["review_submission_id"])
                if row["review_submission_id"] is not None
                else None
            ),
            accepted_version_id=(
                str(row["accepted_version_id"]) if row["accepted_version_id"] is not None else None
            ),
            revision=int(row["revision"]),
            review_evidence_revision=int(row["review_evidence_revision"]),
            updated_at=_datetime(str(row["updated_at"])),
        )

    @staticmethod
    def _artifact_source_span_from_row(row: sqlite3.Row) -> ArtifactSourceSpan:
        return ArtifactSourceSpan(
            id=str(row["span_id"]),
            artifact_id=str(row["artifact_id"]),
            version_id=str(row["version_id"]),
            fact_id=str(row["fact_id"]),
            project_id=str(row["project_id"]),
            source_document_id=str(row["source_document_id"]),
            source_block_id=str(row["source_block_id"]),
            role=cast(SourceSpanRole, row["role"]),
            start_byte=int(row["start_byte"]),
            end_byte=int(row["end_byte"]),
            claim=str(row["claim"]),
            quote_hash=str(row["quote_hash"]),
            created_at=_datetime(str(row["created_at"])),
        )

    @staticmethod
    def _artifact_dependency_from_row(row: sqlite3.Row) -> ArtifactDependency:
        return ArtifactDependency(
            id=str(row["dependency_id"]),
            downstream_artifact_id=str(row["downstream_artifact_id"]),
            downstream_version_id=str(row["downstream_version_id"]),
            upstream_artifact_id=str(row["upstream_artifact_id"]),
            upstream_version_id=str(row["upstream_version_id"]),
            relationship=str(row["relationship"]),
            impact=cast(DependencyImpact, row["impact"]),
            created_at=_datetime(str(row["created_at"])),
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
