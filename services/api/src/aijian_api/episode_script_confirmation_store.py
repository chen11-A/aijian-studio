"""One human confirmation receipt for an exact existing EpisodeScript version."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_script_confirmation_contracts import (
    CreateEpisodeScriptConfirmationRequest,
    EpisodeScriptConfirmationData,
    EpisodeScriptConfirmationStatusData,
)
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.repository import (
    ArtifactConflictError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)


class EpisodeScriptConfirmationNotFoundError(LookupError):
    pass


class EpisodeScriptConfirmationConflictError(RuntimeError):
    pass


class EpisodeScriptConfirmationInputError(ValueError):
    pass


class EpisodeScriptConfirmationStorageError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _new_id() -> str:
    return f"esc_{uuid4().hex}"


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("EpisodeScript confirmation clock must be aware")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class EpisodeScriptConfirmationStore:
    def __init__(
        self,
        repository: StudioRepository,
        *,
        clock: Callable[[], datetime] = _now,
        id_factory: Callable[[], str] = _new_id,
    ) -> None:
        self._repository = repository
        self._clock = clock
        self._id_factory = id_factory

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self._repository.database_path, timeout=5, isolation_level=None
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @staticmethod
    def _head(
        connection: sqlite3.Connection, project_id: str, episode_id: str
    ) -> sqlite3.Row:
        try:
            EpisodeScriptStore._require_episode(connection, project_id, episode_id)
        except (ProjectNotFoundError, EpisodeNotFoundError) as error:
            raise EpisodeScriptConfirmationNotFoundError("Episode was not found") from error
        row = connection.execute(
            """
            SELECT artifact.artifact_id, head.latest_version_id, head.revision,
                   version.content_hash
            FROM artifacts AS artifact
            JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
            JOIN artifact_versions AS version
              ON version.artifact_id = artifact.artifact_id
             AND version.version_id = head.latest_version_id
            WHERE artifact.project_id = ? AND artifact.episode_id = ?
              AND artifact.artifact_type = 'episode_script'
            """,
            (project_id, episode_id),
        ).fetchone()
        if row is None:
            raise EpisodeScriptConfirmationNotFoundError("Script draft was not found")
        return row

    @staticmethod
    def _receipt(
        connection: sqlite3.Connection,
        project_id: str,
        episode_id: str,
        confirmation_id: str | None,
    ) -> sqlite3.Row | None:
        if confirmation_id is None:
            return connection.execute(
                """
                SELECT receipt.*, version.content_hash AS version_content_hash
                FROM episode_script_confirmations AS receipt
                JOIN artifact_versions AS version
                  ON version.artifact_id = receipt.artifact_id
                 AND version.version_id = receipt.version_id
                WHERE receipt.project_id = ? AND receipt.episode_id = ?
                ORDER BY receipt.rowid DESC LIMIT 1
                """,
                (project_id, episode_id),
            ).fetchone()
        row = connection.execute(
            """
            SELECT receipt.*, version.content_hash AS version_content_hash
            FROM episode_script_confirmations AS receipt
            JOIN artifact_versions AS version
              ON version.artifact_id = receipt.artifact_id
             AND version.version_id = receipt.version_id
            WHERE receipt.project_id = ? AND receipt.episode_id = ?
              AND receipt.confirmation_id = ?
            """,
            (project_id, episode_id, confirmation_id),
        ).fetchone()
        if row is None:
            raise EpisodeScriptConfirmationNotFoundError("Confirmation was not found")
        return row

    @staticmethod
    def _status_from_rows(
        project_id: str,
        episode_id: str,
        head: sqlite3.Row,
        receipt: sqlite3.Row | None,
    ) -> EpisodeScriptConfirmationStatusData:
        confirmation = None
        if receipt is not None:
            if (
                str(receipt["artifact_id"]) != str(head["artifact_id"])
                or str(receipt["content_hash"]) != str(receipt["version_content_hash"])
            ):
                raise EpisodeScriptConfirmationStorageError(
                    "Confirmation no longer binds its script version"
                )
            try:
                confirmation = EpisodeScriptConfirmationData(
                    confirmation_id=str(receipt["confirmation_id"]),
                    project_id=str(receipt["project_id"]),
                    episode_id=str(receipt["episode_id"]),
                    artifact_id=str(receipt["artifact_id"]),
                    version_id=str(receipt["version_id"]),
                    content_hash=str(receipt["content_hash"]),
                    head_revision=int(receipt["head_revision"]),
                    actor_id=str(receipt["actor_id"]),
                    confirmed_at=datetime.fromisoformat(
                        str(receipt["confirmed_at"]).replace("Z", "+00:00")
                    ),
                )
            except (TypeError, ValueError) as error:
                raise EpisodeScriptConfirmationStorageError(
                    "Confirmation receipt failed readback"
                ) from error
        return EpisodeScriptConfirmationStatusData(
            project_id=project_id,
            episode_id=episode_id,
            latest_version_id=str(head["latest_version_id"]),
            latest_head_revision=int(head["revision"]),
            confirmation=confirmation,
            current=(
                confirmation is not None
                and confirmation.version_id == str(head["latest_version_id"])
                and confirmation.head_revision == int(head["revision"])
                and confirmation.content_hash == str(head["content_hash"])
            ),
        )

    def _status_in_connection(
        self,
        connection: sqlite3.Connection,
        *,
        project_id: str,
        episode_id: str,
        confirmation_id: str | None = None,
    ) -> EpisodeScriptConfirmationStatusData:
        head = self._head(connection, project_id, episode_id)
        receipt = self._receipt(connection, project_id, episode_id, confirmation_id)
        return self._status_from_rows(project_id, episode_id, head, receipt)

    def get_status(
        self, *, project_id: str, episode_id: str, confirmation_id: str | None = None
    ) -> EpisodeScriptConfirmationStatusData:
        connection = self._open()
        try:
            connection.execute("BEGIN")
            status = self._status_in_connection(
                connection,
                project_id=project_id,
                episode_id=episode_id,
                confirmation_id=confirmation_id,
            )
            connection.commit()
            return status
        except sqlite3.DatabaseError as error:
            connection.rollback()
            raise EpisodeScriptConfirmationStorageError(
                "Script confirmation read failed safely"
            ) from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def confirm(
        self,
        *,
        project_id: str,
        episode_id: str,
        payload: CreateEpisodeScriptConfirmationRequest,
        idempotency_key: str,
        actor_id: str,
    ) -> tuple[EpisodeScriptConfirmationStatusData, bool]:
        if not idempotency_key.strip() or len(idempotency_key) > 240:
            raise EpisodeScriptConfirmationInputError("Idempotency-Key is required")
        if not actor_id.strip() or len(actor_id) > 240:
            raise EpisodeScriptConfirmationInputError("Trusted human actor is required")
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
            head = self._head(connection, project_id, episode_id)
            prior = connection.execute(
                """
                SELECT confirmation_id, request_hash
                FROM episode_script_confirmations
                WHERE project_id = ? AND episode_id = ? AND idempotency_key_hash = ?
                """,
                (project_id, episode_id, key_hash),
            ).fetchone()
            if prior is not None:
                if str(prior["request_hash"]) != request_hash:
                    raise EpisodeScriptConfirmationConflictError(
                        "Idempotency-Key was reused with different confirmation input"
                    )
                status = self._status_in_connection(
                    connection,
                    project_id=project_id,
                    episode_id=episode_id,
                    confirmation_id=str(prior["confirmation_id"]),
                )
                connection.commit()
                return status, True

            if (
                payload.version_id != str(head["latest_version_id"])
                or payload.expected_content_hash != str(head["content_hash"])
                or payload.expected_head_revision != int(head["revision"])
            ):
                raise EpisodeScriptConfirmationConflictError(
                    "Script version or head changed before confirmation"
                )
            try:
                record = self._repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type="episode_script",
                    version_id=payload.version_id,
                    episode_id=episode_id,
                )
            except ArtifactConflictError as error:
                raise EpisodeScriptConfirmationStorageError(
                    "Current script version is invalid"
                ) from error
            content = EpisodeScriptStore(self._repository)._verified_version_data(
                record,
                project_id=project_id,
                episode_id=episode_id,
                connection=connection,
            ).content
            if (
                not content.scenes
                or any(not scene.blocks for scene in content.scenes)
                or any(
                    block.kind == "DIALOGUE" and block.delivery is None
                    for scene in content.scenes
                    for block in scene.blocks
                )
                or not any(
                    (
                        content.production_brief_version_id,
                        content.story_bible_version_id,
                        content.source_extraction_version_id,
                    )
                )
            ):
                raise EpisodeScriptConfirmationInputError(
                    "A confirmed script needs scenes, blocks, and an upstream version"
                )
            confirmation_id = self._id_factory()
            cursor = connection.execute(
                """
                INSERT INTO episode_script_confirmations (
                    confirmation_id, project_id, episode_id, artifact_id, version_id,
                    content_hash, head_revision, actor_id, idempotency_key_hash,
                    request_hash, confirmed_at
                )
                SELECT ?, ?, ?, artifact.artifact_id, version.version_id,
                       version.content_hash, head.revision, ?, ?, ?, ?
                FROM artifacts AS artifact
                JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
                JOIN artifact_versions AS version
                  ON version.artifact_id = artifact.artifact_id
                 AND version.version_id = head.latest_version_id
                WHERE artifact.project_id = ? AND artifact.episode_id = ?
                  AND artifact.artifact_type = 'episode_script'
                  AND head.latest_version_id = ? AND head.revision = ?
                  AND version.content_hash = ?
                """,
                (
                    confirmation_id,
                    project_id,
                    episode_id,
                    actor_id,
                    key_hash,
                    request_hash,
                    _timestamp(self._clock()),
                    project_id,
                    episode_id,
                    payload.version_id,
                    payload.expected_head_revision,
                    payload.expected_content_hash,
                ),
            )
            if cursor.rowcount != 1:
                raise EpisodeScriptConfirmationConflictError(
                    "Script head changed before confirmation insert"
                )
            status = self._status_in_connection(
                connection,
                project_id=project_id,
                episode_id=episode_id,
                confirmation_id=confirmation_id,
            )
            if not status.current:
                raise EpisodeScriptConfirmationStorageError(
                    "New confirmation did not bind the current script"
                )
            connection.commit()
            return status, False
        except sqlite3.DatabaseError as error:
            connection.rollback()
            raise EpisodeScriptConfirmationStorageError(
                "Script confirmation failed safely"
            ) from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
