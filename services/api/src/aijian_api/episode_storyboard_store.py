"""EpisodeStoryboard draft adapter over the one immutable artifact version store."""

from __future__ import annotations

import sqlite3

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_script_store import EpisodeScriptStorageError, EpisodeScriptStore
from aijian_api.episode_storyboard_contracts import (
    MAX_STORYBOARD_BYTES,
    CreateEpisodeStoryboardVersionRequest,
    EpisodeStoryboardContentV1,
    EpisodeStoryboardVersionData,
)
from aijian_api.project_creative_library_store import (
    ProjectCreativeLibraryStorageError,
    ProjectCreativeLibraryStore,
)
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)

_ARTIFACT_TYPE = "episode_storyboard"


class EpisodeStoryboardNotFoundError(LookupError):
    pass


class EpisodeStoryboardConflictError(RuntimeError):
    pass


class EpisodeStoryboardInputError(ValueError):
    pass


class EpisodeStoryboardTooLargeError(ValueError):
    pass


class EpisodeStoryboardStorageError(RuntimeError):
    pass


class EpisodeStoryboardStore:
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
    def _require_episode(connection: sqlite3.Connection, project_id: str, episode_id: str) -> None:
        if (
            connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
            is None
        ):
            raise ProjectNotFoundError("Project was not found")
        if (
            connection.execute(
                "SELECT 1 FROM episodes WHERE project_id = ? AND id = ?",
                (project_id, episode_id),
            ).fetchone()
            is None
        ):
            raise EpisodeNotFoundError("Episode was not found")

    def _require_references(
        self,
        connection: sqlite3.Connection,
        content: EpisodeStoryboardContentV1,
    ) -> None:
        """Resolve membership against exact immutable source versions, never latest."""
        try:
            if content.script_version_id is not None:
                record = self._repository._get_artifact_version_in_connection(
                    connection,
                    project_id=content.project_id,
                    episode_id=content.episode_id,
                    artifact_type="episode_script",
                    version_id=content.script_version_id,
                )
                script = (
                    EpisodeScriptStore(self._repository)
                    ._verified_version_data(
                        record,
                        project_id=content.project_id,
                        episode_id=content.episode_id,
                        connection=connection,
                    )
                    .content
                )
                scene_ids = {scene.scene_id for scene in script.scenes}
                if any(
                    shot.script_scene_id is not None and shot.script_scene_id not in scene_ids
                    for shot in content.shots
                ):
                    raise EpisodeStoryboardInputError("Scene is not in the pinned script version")
            if content.creative_library_version_id is not None:
                record = self._repository._get_artifact_version_in_connection(
                    connection,
                    project_id=content.project_id,
                    episode_id=None,
                    artifact_type="project_creative_library",
                    version_id=content.creative_library_version_id,
                )
                library = ProjectCreativeLibraryStore._version_data(
                    record, project_id=content.project_id
                ).content
                character_ids = {character.character_id for character in library.characters}
                location_ids = {location.scene_id for location in library.scenes}
                if any(
                    not set(shot.character_ids).issubset(character_ids)
                    or (shot.location_id is not None and shot.location_id not in location_ids)
                    for shot in content.shots
                ):
                    raise EpisodeStoryboardInputError(
                        "Character or location is not in the pinned library version"
                    )
        except ArtifactConflictError as error:
            raise EpisodeStoryboardInputError(
                "Pinned version must exist in the required project, episode and artifact type"
            ) from error
        except EpisodeStoryboardInputError:
            raise
        except (
            EpisodeScriptStorageError,
            ProjectCreativeLibraryStorageError,
            sqlite3.DatabaseError,
            TypeError,
            ValueError,
            RuntimeError,
        ) as error:
            raise EpisodeStoryboardStorageError(
                "Pinned source version failed integrity checks"
            ) from error

    @staticmethod
    def _version_data(
        record: ArtifactVersionRecord, *, project_id: str, episode_id: str
    ) -> EpisodeStoryboardVersionData:
        version = record.version
        try:
            content = EpisodeStoryboardContentV1.model_validate(version.content)
            expected_dependencies = tuple(
                (version_id, "derived_from", "blocking")
                for version_id in (
                    content.script_version_id,
                    content.creative_library_version_id,
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
                or len(canonical_content_bytes(version.content)) > MAX_STORYBOARD_BYTES
                or record.source_spans
                or sorted(actual_dependencies) != sorted(expected_dependencies)
            ):
                raise ValueError("EpisodeStoryboard persisted version is inconsistent")
            return EpisodeStoryboardVersionData(
                version_id=version.id,
                project_id=project_id,
                episode_id=episode_id,
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
            raise EpisodeStoryboardStorageError(
                "EpisodeStoryboard version failed readback"
            ) from error

    def _verified_version_data(
        self,
        record: ArtifactVersionRecord,
        *,
        project_id: str,
        episode_id: str,
        connection: sqlite3.Connection | None = None,
    ) -> EpisodeStoryboardVersionData:
        data = self._version_data(record, project_id=project_id, episode_id=episode_id)
        owns_connection = connection is None
        active = connection if connection is not None else self._open()
        try:
            self._require_references(active, data.content)
        except (EpisodeStoryboardInputError, sqlite3.DatabaseError, ValueError) as error:
            raise EpisodeStoryboardStorageError("Storyboard source binding is invalid") from error
        finally:
            if owns_connection:
                active.close()
        return data

    def get_latest(self, *, project_id: str, episode_id: str) -> EpisodeStoryboardVersionData:
        self._repository.get_episode(project_id, episode_id)
        try:
            record = self._repository.get_latest_artifact(
                project_id, _ARTIFACT_TYPE, episode_id=episode_id
            )
        except ArtifactNotFoundError as error:
            raise EpisodeStoryboardNotFoundError("EpisodeStoryboard was not found") from error
        except (ArtifactConflictError, sqlite3.DatabaseError, ValueError, RuntimeError) as error:
            raise EpisodeStoryboardStorageError(
                "EpisodeStoryboard latest version is invalid"
            ) from error
        return self._verified_version_data(record, project_id=project_id, episode_id=episode_id)

    def get_version(
        self, *, project_id: str, episode_id: str, version_id: str
    ) -> EpisodeStoryboardVersionData:
        self._repository.get_episode(project_id, episode_id)
        try:
            record = self._repository.get_artifact_version(
                project_id, _ARTIFACT_TYPE, version_id, episode_id=episode_id
            )
        except ArtifactNotFoundError as error:
            raise EpisodeStoryboardNotFoundError(
                "EpisodeStoryboard version was not found"
            ) from error
        except ArtifactConflictError as error:
            if str(error) == "Artifact version was not found":
                raise EpisodeStoryboardNotFoundError(
                    "EpisodeStoryboard version was not found"
                ) from error
            raise EpisodeStoryboardStorageError("EpisodeStoryboard version is invalid") from error
        except (sqlite3.DatabaseError, TypeError, ValueError, RuntimeError) as error:
            raise EpisodeStoryboardStorageError("EpisodeStoryboard version is invalid") from error
        return self._verified_version_data(record, project_id=project_id, episode_id=episode_id)

    def write(
        self,
        *,
        project_id: str,
        episode_id: str,
        payload: CreateEpisodeStoryboardVersionRequest,
        idempotency_key: str,
        actor_id: str,
    ) -> tuple[EpisodeStoryboardVersionData, bool]:
        if not idempotency_key.strip() or len(idempotency_key) > 240:
            raise EpisodeStoryboardInputError("Idempotency-Key is required and bounded")
        if not actor_id.strip() or len(actor_id) > 240:
            raise EpisodeStoryboardInputError("Trusted actor is required and bounded")
        content = payload.content
        if content.project_id != project_id or content.episode_id != episode_id:
            raise EpisodeStoryboardInputError(
                "EpisodeStoryboard content scope differs from the URL"
            )
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
                FROM episode_storyboard_write_requests
                WHERE project_id = ? AND episode_id = ? AND idempotency_key_hash = ?
                """,
                (project_id, episode_id, key_hash),
            ).fetchone()
            if receipt is not None:
                if str(receipt["request_hash"]) != request_hash:
                    raise EpisodeStoryboardConflictError(
                        "Idempotency-Key was reused with different storyboard input"
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
                    raise EpisodeStoryboardStorageError(
                        "EpisodeStoryboard receipt is invalid"
                    ) from error
                if record.version.artifact_id != str(receipt["artifact_id"]):
                    raise EpisodeStoryboardStorageError("EpisodeStoryboard receipt changed scope")
                result = self._verified_version_data(
                    record,
                    project_id=project_id,
                    episode_id=episode_id,
                    connection=connection,
                )
                connection.commit()
                return result, True

            if len(canonical_content_bytes(content_json)) > MAX_STORYBOARD_BYTES:
                raise EpisodeStoryboardTooLargeError("EpisodeStoryboard exceeds the supported size")
            self._require_references(connection, content)
            head = connection.execute(
                """
                SELECT artifact_heads.latest_version_id, artifact_heads.revision
                FROM artifact_heads
                JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
                WHERE artifacts.project_id = ? AND artifacts.episode_id = ?
                  AND artifacts.artifact_type = 'episode_storyboard'
                """,
                (project_id, episode_id),
            ).fetchone()
            if head is None:
                if payload.parent_version_id is not None or payload.expected_revision is not None:
                    raise EpisodeStoryboardConflictError("Storyboard has no parent version")
            elif payload.parent_version_id != str(
                head["latest_version_id"]
            ) or payload.expected_revision != int(head["revision"]):
                raise EpisodeStoryboardConflictError("Storyboard head revision has changed")

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
                            content.script_version_id,
                            content.creative_library_version_id,
                        )
                        if version_id is not None
                    ),
                    record_validator=validate_candidate,
                    _transaction_connection=connection,
                    _manage_transaction=False,
                )
            except ArtifactConflictError as error:
                raise EpisodeStoryboardConflictError(
                    "EpisodeStoryboard revision has changed"
                ) from error
            connection.execute(
                """
                INSERT INTO episode_storyboard_write_requests (
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
                    record.version.created_at.isoformat(),
                ),
            )
            result = self._verified_version_data(
                record, project_id=project_id, episode_id=episode_id, connection=connection
            )
            connection.commit()
            return result, False
        except sqlite3.DatabaseError as error:
            connection.rollback()
            raise EpisodeStoryboardStorageError("EpisodeStoryboard write failed safely") from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
