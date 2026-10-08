"""Manual creative-library adapter over the one immutable artifact version store."""

from __future__ import annotations

import sqlite3

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.project_creative_library_contracts import (
    MAX_CREATIVE_LIBRARY_BYTES,
    CreateProjectCreativeLibraryVersionRequest,
    ProjectCreativeLibraryContentV1,
    ProjectCreativeLibraryVersionData,
)
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)

_ARTIFACT_TYPE = "project_creative_library"


class ProjectCreativeLibraryNotFoundError(LookupError):
    pass


class ProjectCreativeLibraryConflictError(RuntimeError):
    pass


class ProjectCreativeLibraryInputError(ValueError):
    pass


class ProjectCreativeLibraryTooLargeError(ValueError):
    pass


class ProjectCreativeLibraryStorageError(RuntimeError):
    pass


class ProjectCreativeLibraryStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self._repository.database_path, timeout=5, isolation_level=None
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @staticmethod
    def _version_data(
        record: ArtifactVersionRecord, *, project_id: str
    ) -> ProjectCreativeLibraryVersionData:
        version = record.version
        try:
            content = ProjectCreativeLibraryContentV1.model_validate(version.content)
            if (
                version.schema_version != "1.0.0"
                or content.project_id != project_id
                or content.episode_id is not None
                or record.source_spans
                or record.dependencies
                or version.content_hash != canonical_content_hash(version.content)
                or len(canonical_content_bytes(version.content)) > MAX_CREATIVE_LIBRARY_BYTES
            ):
                raise ValueError("Creative library persisted version is inconsistent")
            return ProjectCreativeLibraryVersionData(
                version_id=version.id,
                project_id=project_id,
                episode_id=None,
                version_number=version.version_number,
                head_revision=record.head.revision,
                parent_version_id=version.parent_version_id,
                content=content,
                stored_content=version.content,
                content_hash=version.content_hash,
                author_actor_id=version.author_actor_id,
                change_summary=version.change_summary,
                created_at=version.created_at,
            )
        except (TypeError, ValueError) as error:
            raise ProjectCreativeLibraryStorageError(
                "Creative library version failed readback"
            ) from error

    def get_latest(self, *, project_id: str) -> ProjectCreativeLibraryVersionData:
        try:
            record = self._repository.get_latest_artifact(
                project_id, _ARTIFACT_TYPE, episode_id=None
            )
        except ArtifactNotFoundError as error:
            raise ProjectCreativeLibraryNotFoundError(
                "Creative library draft was not found"
            ) from error
        except (ArtifactConflictError, sqlite3.DatabaseError, ValueError) as error:
            raise ProjectCreativeLibraryStorageError(
                "Creative library read failed safely"
            ) from error
        return self._version_data(record, project_id=project_id)

    def get_version(self, *, project_id: str, version_id: str) -> ProjectCreativeLibraryVersionData:
        try:
            record = self._repository.get_artifact_version(
                project_id, _ARTIFACT_TYPE, version_id, episode_id=None
            )
        except ArtifactNotFoundError as error:
            raise ProjectCreativeLibraryNotFoundError(
                "Creative library version was not found"
            ) from error
        except ArtifactConflictError as error:
            if str(error) == "Artifact version was not found":
                raise ProjectCreativeLibraryNotFoundError(
                    "Creative library version was not found"
                ) from error
            raise ProjectCreativeLibraryStorageError(
                "Creative library version is invalid"
            ) from error
        except (sqlite3.DatabaseError, ValueError) as error:
            raise ProjectCreativeLibraryStorageError(
                "Creative library version is invalid"
            ) from error
        return self._version_data(record, project_id=project_id)

    def write(
        self,
        *,
        project_id: str,
        payload: CreateProjectCreativeLibraryVersionRequest,
        idempotency_key: str,
        actor_id: str,
    ) -> tuple[ProjectCreativeLibraryVersionData, bool]:
        if not idempotency_key.strip() or len(idempotency_key) > 240:
            raise ProjectCreativeLibraryInputError("Idempotency-Key is required and bounded")
        if not actor_id.strip() or len(actor_id) > 240:
            raise ProjectCreativeLibraryInputError("Trusted actor is required and bounded")
        if payload.content.project_id != project_id or payload.content.episode_id is not None:
            raise ProjectCreativeLibraryInputError(
                "Creative library content scope differs from URL"
            )
        content = payload.content.model_dump(mode="json")
        if len(canonical_content_bytes(content)) > MAX_CREATIVE_LIBRARY_BYTES:
            raise ProjectCreativeLibraryTooLargeError("Creative library exceeds the supported size")
        key_hash = canonical_content_hash({"value": idempotency_key})
        request_hash = canonical_content_hash(
            {
                "project_id": project_id,
                "actor_id": actor_id,
                "payload": payload.model_dump(mode="json"),
            }
        )
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if (
                connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
                is None
            ):
                raise ProjectNotFoundError("Project was not found")
            receipt = connection.execute(
                """
                SELECT request_hash, artifact_id, version_id
                FROM project_creative_library_write_requests
                WHERE project_id = ? AND idempotency_key_hash = ?
                """,
                (project_id, key_hash),
            ).fetchone()
            if receipt is not None:
                if str(receipt["request_hash"]) != request_hash:
                    raise ProjectCreativeLibraryConflictError(
                        "Idempotency-Key was reused with different input"
                    )
                try:
                    record = self._repository._get_artifact_version_in_connection(
                        connection,
                        project_id=project_id,
                        artifact_type=_ARTIFACT_TYPE,
                        version_id=str(receipt["version_id"]),
                        episode_id=None,
                    )
                except ArtifactConflictError as error:
                    raise ProjectCreativeLibraryStorageError(
                        "Creative library receipt is invalid"
                    ) from error
                if record.version.artifact_id != str(receipt["artifact_id"]):
                    raise ProjectCreativeLibraryStorageError(
                        "Creative library receipt changed scope"
                    )
                result = self._version_data(record, project_id=project_id)
                connection.commit()
                return result, True
            head = connection.execute(
                """
                SELECT head.latest_version_id, head.revision FROM artifact_heads AS head
                JOIN artifacts AS artifact ON artifact.artifact_id = head.artifact_id
                WHERE artifact.project_id = ? AND artifact.episode_id IS NULL
                  AND artifact.artifact_type = ?
                """,
                (project_id, _ARTIFACT_TYPE),
            ).fetchone()
            if head is None:
                if payload.parent_version_id is not None or payload.expected_revision is not None:
                    raise ProjectCreativeLibraryConflictError(
                        "Creative library has no parent version"
                    )
            elif payload.parent_version_id != str(
                head["latest_version_id"]
            ) or payload.expected_revision != int(head["revision"]):
                raise ProjectCreativeLibraryConflictError(
                    "Creative library head revision has changed"
                )

            def validate_candidate(candidate: ArtifactVersionRecord) -> None:
                self._version_data(candidate, project_id=project_id)

            try:
                record = self._repository.create_artifact_version(
                    project_id=project_id,
                    artifact_type=_ARTIFACT_TYPE,
                    episode_id=None,
                    schema_version="1.0.0",
                    content=content,
                    author_actor_type="human",
                    author_actor_id=actor_id,
                    change_summary=payload.change_summary,
                    parent_version_id=payload.parent_version_id,
                    expected_revision=payload.expected_revision,
                    record_validator=validate_candidate,
                    _transaction_connection=connection,
                    _manage_transaction=False,
                )
            except ArtifactConflictError as error:
                raise ProjectCreativeLibraryConflictError(
                    "Creative library revision has changed"
                ) from error
            connection.execute(
                """
                INSERT INTO project_creative_library_write_requests (
                    project_id, idempotency_key_hash, request_hash,
                    artifact_id, version_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    key_hash,
                    request_hash,
                    record.version.artifact_id,
                    record.version.id,
                    record.version.created_at.isoformat(),
                ),
            )
            result = self._version_data(record, project_id=project_id)
            connection.commit()
            return result, False
        except sqlite3.DatabaseError as error:
            connection.rollback()
            raise ProjectCreativeLibraryStorageError(
                "Creative library write failed safely"
            ) from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
