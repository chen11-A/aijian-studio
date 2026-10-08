"""EpisodeScript draft adapter over the one immutable artifact version store."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime

from pydantic import ValidationError

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_script_contracts import (
    MAX_SCRIPT_BYTES,
    CreateEpisodeScriptVersionRequest,
    EpisodeScriptContentV1,
    EpisodeScriptVersionData,
)
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)

_ARTIFACT_TYPE = "episode_script"


class EpisodeScriptNotFoundError(LookupError):
    pass


class EpisodeScriptConflictError(RuntimeError):
    pass


class EpisodeScriptInputError(ValueError):
    pass


class EpisodeScriptTooLargeError(ValueError):
    pass


class EpisodeScriptStorageError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("EpisodeScript clock must return an aware timestamp")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _legacy_request_hash(
    payload: CreateEpisodeScriptVersionRequest,
    *,
    project_id: str,
    episode_id: str,
    actor_id: str,
) -> str | None:
    """Reproduce the pre-delivery request hash only for an unchanged old input."""

    added_content_fields = {
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
    }
    if added_content_fields & payload.content.model_fields_set or any(
        "delivery" in block.model_fields_set
        for scene in payload.content.scenes
        for block in scene.blocks
    ):
        return None
    legacy_payload = payload.model_dump(mode="json")
    legacy_content = legacy_payload["content"]
    for field_name in added_content_fields:
        legacy_content.pop(field_name)
    for scene in legacy_content["scenes"]:
        for block in scene["blocks"]:
            block.pop("delivery")
    return canonical_content_hash(
        {
            "project_id": project_id,
            "episode_id": episode_id,
            "actor_id": actor_id,
            "payload": legacy_payload,
        }
    )


class EpisodeScriptStore:
    def __init__(
        self,
        repository: StudioRepository,
        *,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self._repository = repository
        self._clock = clock

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self._repository.database_path, timeout=5, isolation_level=None
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @staticmethod
    def _require_episode(
        connection: sqlite3.Connection, project_id: str, episode_id: str
    ) -> None:
        if connection.execute(
            "SELECT 1 FROM projects WHERE id = ?", (project_id,)
        ).fetchone() is None:
            raise ProjectNotFoundError("Project was not found")
        if connection.execute(
            "SELECT 1 FROM episodes WHERE project_id = ? AND id = ?",
            (project_id, episode_id),
        ).fetchone() is None:
            raise EpisodeNotFoundError("Episode was not found")

    @staticmethod
    def _require_project_artifact_version(
        connection: sqlite3.Connection,
        project_id: str,
        version_id: str | None,
        artifact_type: str,
    ) -> None:
        if version_id is None:
            return
        row = connection.execute(
            """
            SELECT 1 FROM artifact_versions AS version
            JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
            WHERE version.version_id = ? AND artifact.project_id = ?
              AND artifact.episode_id IS NULL
              AND artifact.artifact_type = ?
            """,
            (version_id, project_id, artifact_type),
        ).fetchone()
        if row is None:
            raise EpisodeScriptInputError(
                "Referenced upstream version must belong to this project and type"
            )

    @staticmethod
    def _require_source_acceptance(
        connection: sqlite3.Connection,
        project_id: str,
        version_id: str | None,
        acceptance_id: str | None,
    ) -> None:
        if version_id is None and acceptance_id is None:
            return
        if version_id is None or acceptance_id is None:
            raise EpisodeScriptInputError("Accepted proposal reference is incomplete")
        row = connection.execute(
            """
            SELECT 1 FROM artifact_proposal_draft_acceptances AS acceptance
            JOIN artifact_versions AS version
              ON version.version_id = acceptance.draft_version_id
            JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
            WHERE acceptance.acceptance_id = ? AND acceptance.project_id = ?
              AND acceptance.draft_version_id = ?
              AND artifact.project_id = ? AND artifact.episode_id IS NULL
              AND artifact.artifact_type = 'source_extraction'
            """,
            (acceptance_id, project_id, version_id, project_id),
        ).fetchone()
        if row is None:
            raise EpisodeScriptInputError(
                "Accepted SourceExtraction proposal does not bind this version"
            )

    @staticmethod
    def _version_data(
        record: ArtifactVersionRecord, *, project_id: str, episode_id: str
    ) -> EpisodeScriptVersionData:
        version = record.version
        try:
            content = EpisodeScriptContentV1.model_validate(version.content)
            expected_dependencies = tuple(
                (version_id, "derived_from", "blocking")
                for version_id in (
                    content.production_brief_version_id,
                    content.story_bible_version_id,
                    content.source_extraction_version_id,
                )
                if version_id is not None
            )
            actual_dependencies = tuple(
                (item.upstream_version_id, item.relationship, item.impact)
                for item in record.dependencies
            )
            if (
                version.schema_version != "1.0.0"
                or content.project_id != project_id
                or content.episode_id != episode_id
                or version.content_hash != canonical_content_hash(version.content)
                or len(canonical_content_bytes(version.content)) > MAX_SCRIPT_BYTES
                or record.source_spans
                or actual_dependencies != expected_dependencies
            ):
                raise ValueError("EpisodeScript persisted version is inconsistent")
            return EpisodeScriptVersionData(
                version_id=version.id,
                project_id=project_id,
                episode_id=episode_id,
                version_number=version.version_number,
                head_revision=record.head.revision,
                parent_version_id=version.parent_version_id,
                content=version.content,
                stored_content=version.content,
                content_hash=version.content_hash,
                author_actor_id=version.author_actor_id,
                change_summary=version.change_summary,
                created_at=version.created_at,
            )
        except (TypeError, ValueError, ValidationError) as error:
            raise EpisodeScriptStorageError("EpisodeScript version failed readback") from error

    def _verified_version_data(
        self,
        record: ArtifactVersionRecord,
        *,
        project_id: str,
        episode_id: str,
        connection: sqlite3.Connection | None = None,
    ) -> EpisodeScriptVersionData:
        data = self._version_data(record, project_id=project_id, episode_id=episode_id)
        owns_connection = connection is None
        active = connection if connection is not None else self._open()
        try:
            self._require_source_acceptance(
                active,
                project_id,
                data.content.source_extraction_version_id,
                data.content.source_proposal_acceptance_id,
            )
        except EpisodeScriptInputError as error:
            raise EpisodeScriptStorageError("EpisodeScript proposal binding is invalid") from error
        finally:
            if owns_connection:
                active.close()
        return data

    def get_latest(self, *, project_id: str, episode_id: str) -> EpisodeScriptVersionData:
        self._repository.get_episode(project_id, episode_id)
        try:
            record = self._repository.get_latest_artifact(
                project_id, _ARTIFACT_TYPE, episode_id=episode_id
            )
        except ArtifactNotFoundError as error:
            raise EpisodeScriptNotFoundError("EpisodeScript was not found") from error
        except ArtifactConflictError as error:
            raise EpisodeScriptStorageError("EpisodeScript latest version is invalid") from error
        return self._verified_version_data(
            record, project_id=project_id, episode_id=episode_id
        )

    def get_version(
        self, *, project_id: str, episode_id: str, version_id: str
    ) -> EpisodeScriptVersionData:
        self._repository.get_episode(project_id, episode_id)
        try:
            record = self._repository.get_artifact_version(
                project_id, _ARTIFACT_TYPE, version_id, episode_id=episode_id
            )
        except ArtifactNotFoundError as error:
            raise EpisodeScriptNotFoundError("EpisodeScript version was not found") from error
        except ArtifactConflictError as error:
            if str(error) == "Artifact version was not found":
                raise EpisodeScriptNotFoundError("EpisodeScript version was not found") from error
            raise EpisodeScriptStorageError("EpisodeScript version is invalid") from error
        return self._verified_version_data(
            record, project_id=project_id, episode_id=episode_id
        )

    def write(
        self,
        *,
        project_id: str,
        episode_id: str,
        payload: CreateEpisodeScriptVersionRequest,
        idempotency_key: str,
        actor_id: str,
    ) -> tuple[EpisodeScriptVersionData, bool]:
        if not idempotency_key.strip() or len(idempotency_key) > 240:
            raise EpisodeScriptInputError("Idempotency-Key is required and bounded")
        if not actor_id.strip() or len(actor_id) > 240:
            raise EpisodeScriptInputError("Trusted actor is required and bounded")
        content = payload.content
        if content.project_id != project_id or content.episode_id != episode_id:
            raise EpisodeScriptInputError("EpisodeScript content scope differs from the URL")
        content_json = content.model_dump(mode="json")
        key_hash = canonical_content_hash({"value": idempotency_key})
        request_hash = canonical_content_hash(
            {
                "project_id": project_id,
                "episode_id": episode_id,
                "actor_id": actor_id,
                "payload": payload.model_dump(mode="json"),
            }
        )
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            self._require_episode(connection, project_id, episode_id)
            receipt = connection.execute(
                """
                SELECT request_hash, artifact_id, version_id
                FROM episode_script_write_requests
                WHERE project_id = ? AND episode_id = ? AND idempotency_key_hash = ?
                """,
                (project_id, episode_id, key_hash),
            ).fetchone()
            if receipt is not None:
                legacy_request_hash = _legacy_request_hash(
                    payload,
                    project_id=project_id,
                    episode_id=episode_id,
                    actor_id=actor_id,
                )
                if str(receipt["request_hash"]) not in (request_hash, legacy_request_hash):
                    raise EpisodeScriptConflictError(
                        "Idempotency-Key was reused with different script input"
                    )
                try:
                    record = self._repository._get_artifact_version_in_connection(
                        connection,
                        project_id=project_id,
                        artifact_type=_ARTIFACT_TYPE,
                        version_id=str(receipt["version_id"]),
                        episode_id=episode_id,
                    )
                except ArtifactConflictError as error:
                    raise EpisodeScriptStorageError("EpisodeScript receipt is invalid") from error
                if record.version.artifact_id != str(receipt["artifact_id"]):
                    raise EpisodeScriptStorageError("EpisodeScript receipt changed scope")
                result = self._verified_version_data(
                    record,
                    project_id=project_id,
                    episode_id=episode_id,
                    connection=connection,
                )
                connection.commit()
                return result, True

            if len(canonical_content_bytes(content_json)) > MAX_SCRIPT_BYTES:
                raise EpisodeScriptTooLargeError("EpisodeScript exceeds the supported size")
            if any(
                block.kind == "DIALOGUE" and block.delivery is None
                for scene in content.scenes
                for block in scene.blocks
            ):
                raise EpisodeScriptInputError("New dialogue needs an explicit delivery")

            self._require_project_artifact_version(
                connection, project_id, content.production_brief_version_id, "production_brief"
            )
            self._require_project_artifact_version(
                connection, project_id, content.story_bible_version_id, "story_bible"
            )
            self._require_source_acceptance(
                connection,
                project_id,
                content.source_extraction_version_id,
                content.source_proposal_acceptance_id,
            )
            head = connection.execute(
                """
                SELECT artifact_heads.latest_version_id, artifact_heads.revision
                FROM artifact_heads
                JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
                WHERE artifacts.project_id = ? AND artifacts.episode_id = ?
                  AND artifacts.artifact_type = 'episode_script'
                """,
                (project_id, episode_id),
            ).fetchone()
            if head is None:
                if payload.parent_version_id is not None or payload.expected_revision is not None:
                    raise EpisodeScriptConflictError("Script has no parent version")
            elif (
                payload.parent_version_id != str(head["latest_version_id"])
                or payload.expected_revision != int(head["revision"])
            ):
                raise EpisodeScriptConflictError("Script head revision has changed")

            def validate_candidate(candidate: ArtifactVersionRecord) -> None:
                self._verified_version_data(
                    candidate,
                    project_id=project_id,
                    episode_id=episode_id,
                    connection=connection,
                )

            try:
                record = self._repository.create_artifact_version(
                    project_id=project_id,
                    artifact_type=_ARTIFACT_TYPE,
                    episode_id=episode_id,
                    schema_version="1.0.0",
                    content=content_json,
                    author_actor_type="human",
                    author_actor_id=actor_id,
                    change_summary=payload.change_summary,
                    parent_version_id=payload.parent_version_id,
                    expected_revision=payload.expected_revision,
                    dependencies=tuple(
                        ArtifactDependencyDraft(
                            upstream_version_id=version_id,
                            relationship="derived_from",
                            impact="blocking",
                        )
                        for version_id in (
                            content.production_brief_version_id,
                            content.story_bible_version_id,
                            content.source_extraction_version_id,
                        )
                        if version_id is not None
                    ),
                    record_validator=validate_candidate,
                    _transaction_connection=connection,
                    _manage_transaction=False,
                )
            except ArtifactConflictError as error:
                raise EpisodeScriptConflictError("EpisodeScript revision has changed") from error
            connection.execute(
                """
                INSERT INTO episode_script_write_requests (
                    project_id, episode_id, idempotency_key_hash, request_hash,
                    artifact_id, version_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    episode_id,
                    key_hash,
                    request_hash,
                    record.version.artifact_id,
                    record.version.id,
                    _timestamp(self._clock()),
                ),
            )
            result = self._verified_version_data(
                record, project_id=project_id, episode_id=episode_id, connection=connection
            )
            connection.commit()
            return result, False
        except sqlite3.DatabaseError as error:
            connection.rollback()
            raise EpisodeScriptStorageError("EpisodeScript write failed safely") from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
