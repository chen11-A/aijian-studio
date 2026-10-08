"""Durable trusted-main official text ledger over immutable artifact storage."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.official_text_contracts import (
    CompleteOfficialTextRequest,
    OfficialTextAdoption,
    OfficialTextOperation,
    OfficialTextProposal,
    OfficialTextScriptBase,
    ReserveOfficialTextRequest,
)
from aijian_api.repository import ArtifactConflictError, StudioRepository


class OfficialTextError(RuntimeError):
    def __init__(self, code: str, status: int = 409) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class OfficialTextStore:
    def __init__(self, repository: StudioRepository) -> None:
        self.repository = repository

    @contextmanager
    def connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.repository.database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except sqlite3.DatabaseError as error:
            connection.rollback()
            raise OfficialTextError("OFFICIAL_TEXT_STORAGE_FAILED", 500) from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def require_scope(connection: sqlite3.Connection, project: str, episode: str) -> None:
        if (
            connection.execute(
                "SELECT 1 FROM episodes WHERE project_id = ? AND id = ?", (project, episode)
            ).fetchone()
            is None
        ):
            raise OfficialTextError("OFFICIAL_TEXT_SCOPE_NOT_FOUND", 404)

    def script_base(
        self,
        connection: sqlite3.Connection,
        project: str,
        episode: str,
        expected: OfficialTextScriptBase | None,
    ) -> ArtifactVersionRecord | None:
        row = connection.execute(
            """SELECT h.latest_version_id, h.revision FROM artifacts a
            JOIN artifact_heads h ON h.artifact_id = a.artifact_id
            WHERE a.project_id = ? AND a.episode_id = ? AND a.artifact_type = 'episode_script'""",
            (project, episode),
        ).fetchone()
        if row is None:
            if expected is not None:
                raise OfficialTextError("OFFICIAL_TEXT_SCRIPT_CHANGED")
            return None
        if (
            expected is None
            or expected.version_id != row["latest_version_id"]
            or expected.head_revision != row["revision"]
        ):
            raise OfficialTextError("OFFICIAL_TEXT_SCRIPT_CHANGED")
        record = self.repository._get_artifact_version_in_connection(
            connection,
            project_id=project,
            artifact_type="episode_script",
            version_id=expected.version_id,
            episode_id=episode,
        )
        if record.version.content_hash != expected.content_hash:
            raise OfficialTextError("OFFICIAL_TEXT_SCRIPT_CHANGED")
        EpisodeScriptStore(self.repository)._verified_version_data(
            record, project_id=project, episode_id=episode, connection=connection
        )
        return record

    def read_in_connection(
        self,
        connection: sqlite3.Connection,
        project: str,
        episode: str,
        operation_id: str,
    ) -> OfficialTextOperation:
        row = connection.execute(
            "SELECT * FROM official_text_operations "
            "WHERE operation_id = ? AND project_id = ? AND episode_id = ?",
            (operation_id, project, episode),
        ).fetchone()
        if row is None:
            raise OfficialTextError("OFFICIAL_TEXT_NOT_FOUND", 404)
        try:
            request_json = json.loads(row["request_json"])
            request = ReserveOfficialTextRequest.model_validate(request_json)
            if (
                request.operation_id != operation_id
                or canonical_content_hash(request_json) != row["request_hash"]
            ):
                raise ValueError("Request identity changed")
            proposal = None
            if row["proposal_version_id"] is not None:
                record = self.repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project,
                    episode_id=episode,
                    artifact_type="official_text_proposal",
                    version_id=row["proposal_version_id"],
                )
                content = record.version.content
                result = CompleteOfficialTextRequest.model_validate(content["result"])
                expected_content = {
                    "schema_version": "1.0.0",
                    "project_id": project,
                    "episode_id": episode,
                    "request": request_json,
                    "result": result.model_dump(mode="json"),
                }
                if (
                    content != expected_content
                    or canonical_content_hash(content) != record.version.content_hash
                ):
                    raise ValueError("Proposal integrity changed")
                self.match_completion(request, result)
                proposal = OfficialTextProposal(
                    version_id=record.version.id,
                    content_hash=record.version.content_hash,
                    result=result,
                )
            adoption = None
            adopted = connection.execute(
                "SELECT * FROM official_text_adoptions WHERE operation_id = ?", (operation_id,)
            ).fetchone()
            if adopted is not None:
                script = self.repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project,
                    episode_id=episode,
                    artifact_type="episode_script",
                    version_id=adopted["script_version_id"],
                )
                if (
                    proposal is None
                    or adopted["proposal_version_id"] != proposal.version_id
                    or adopted["proposal_content_hash"] != proposal.content_hash
                    or script.version.content_hash != adopted["script_content_hash"]
                    or canonical_content_hash(script.version.content)
                    != adopted["script_content_hash"]
                    or script.version.parent_version_id
                    != (request.base.version_id if request.base else None)
                ):
                    raise ValueError("Adoption integrity changed")
                adoption = OfficialTextAdoption(
                    script_version_id=script.version.id,
                    script_content_hash=script.version.content_hash,
                    actor_id=adopted["actor_id"],
                    adopted_at=adopted["adopted_at"],
                )
            if (row["status"] == "COMPLETED") != (proposal is not None):
                raise ValueError("Completion state changed")
            return OfficialTextOperation(
                project_id=project,
                episode_id=episode,
                request=request,
                status=row["status"],
                error_code=row["error_code"],
                created_at=row["created_at"],
                proposal=proposal,
                adoption=adoption,
            )
        except (ValueError, KeyError, TypeError, ArtifactConflictError) as error:
            raise OfficialTextError("OFFICIAL_TEXT_STORAGE_FAILED", 500) from error

    @staticmethod
    def match_completion(
        request: ReserveOfficialTextRequest, result: CompleteOfficialTextRequest
    ) -> None:
        if (request.operation_id, request.profile_id, request.model, request.request_hash) != (
            result.operation_id,
            result.profile_id,
            result.model,
            result.request_hash,
        ):
            raise OfficialTextError("OFFICIAL_TEXT_COMPLETION_MISMATCH", 422)

    def get(self, project: str, episode: str, operation_id: str) -> OfficialTextOperation:
        with self.connection() as connection:
            self.require_scope(connection, project, episode)
            return self.read_in_connection(connection, project, episode, operation_id)

    def list(self, project: str, episode: str) -> list[OfficialTextOperation]:
        with self.connection() as connection:
            self.require_scope(connection, project, episode)
            rows = connection.execute(
                "SELECT operation_id FROM official_text_operations "
                "WHERE project_id = ? AND episode_id = ? "
                "ORDER BY created_at DESC, operation_id DESC LIMIT 10",
                (project, episode),
            ).fetchall()
            return [
                self.read_in_connection(connection, project, episode, row["operation_id"])
                for row in rows
            ]

    def reserve(
        self, project: str, episode: str, payload: ReserveOfficialTextRequest
    ) -> tuple[OfficialTextOperation, bool]:
        with self.connection(write=True) as connection:
            self.require_scope(connection, project, episode)
            prior = connection.execute(
                "SELECT project_id, episode_id FROM official_text_operations "
                "WHERE operation_id = ?",
                (payload.operation_id,),
            ).fetchone()
            if prior is not None:
                if prior["project_id"] != project or prior["episode_id"] != episode:
                    raise OfficialTextError("OFFICIAL_TEXT_OPERATION_CONFLICT")
                old = self.read_in_connection(connection, project, episode, payload.operation_id)
                if old.request != payload:
                    raise OfficialTextError("OFFICIAL_TEXT_OPERATION_CONFLICT")
                return old, True
            self.script_base(connection, project, episode, payload.base)
            if connection.execute(
                "SELECT 1 FROM official_text_operations "
                "WHERE project_id = ? AND episode_id = ? AND status = 'REMOTE_UNKNOWN'",
                (project, episode),
            ).fetchone():
                raise OfficialTextError("OFFICIAL_TEXT_UNRESOLVED_OPERATION")
            request = payload.model_dump(mode="json")
            connection.execute(
                """INSERT INTO official_text_operations(operation_id, project_id, episode_id,
                    request_json, request_hash, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'REMOTE_UNKNOWN', ?)""",
                (
                    payload.operation_id,
                    project,
                    episode,
                    json.dumps(request, ensure_ascii=False, sort_keys=True),
                    canonical_content_hash(request),
                    timestamp(),
                ),
            )
            return self.read_in_connection(
                connection, project, episode, payload.operation_id
            ), False

    def complete(
        self, project: str, episode: str, payload: CompleteOfficialTextRequest
    ) -> tuple[OfficialTextOperation, bool]:
        with self.connection(write=True) as connection:
            operation = self.read_in_connection(connection, project, episode, payload.operation_id)
            self.match_completion(operation.request, payload)
            if operation.proposal:
                if operation.proposal.result != payload:
                    raise OfficialTextError("OFFICIAL_TEXT_OPERATION_CONFLICT")
                return operation, True
            if operation.status != "REMOTE_UNKNOWN":
                raise OfficialTextError("OFFICIAL_TEXT_OPERATION_CONFLICT")
            head = connection.execute(
                """SELECT h.latest_version_id, h.revision FROM artifacts a
                JOIN artifact_heads h ON h.artifact_id = a.artifact_id
                WHERE a.project_id = ? AND a.episode_id = ?
                AND a.artifact_type = 'official_text_proposal'""",
                (project, episode),
            ).fetchone()
            record = self.repository.create_artifact_version(
                project_id=project,
                episode_id=episode,
                artifact_type="official_text_proposal",
                schema_version="1.0.0",
                content={
                    "schema_version": "1.0.0",
                    "project_id": project,
                    "episode_id": episode,
                    "request": operation.request.model_dump(mode="json"),
                    "result": payload.model_dump(mode="json"),
                },
                author_actor_type="agent",
                author_actor_id=f"chatgpt-official:{payload.profile_id}",
                change_summary="Official ChatGPT text awaiting explicit script adoption",
                parent_version_id=head["latest_version_id"] if head else None,
                expected_revision=head["revision"] if head else None,
                dependencies=(
                    ArtifactDependencyDraft(
                        upstream_version_id=operation.request.base.version_id,
                        relationship="derived_from",
                        impact="blocking",
                    ),
                )
                if operation.request.base
                else (),
                _transaction_connection=connection,
                _manage_transaction=False,
            )
            connection.execute(
                "UPDATE official_text_operations SET status = 'COMPLETED', proposal_version_id = ? "
                "WHERE operation_id = ?",
                (record.version.id, payload.operation_id),
            )
            return self.read_in_connection(
                connection, project, episode, payload.operation_id
            ), False

    def not_sent(
        self, project: str, episode: str, operation_id: str, code: str
    ) -> tuple[OfficialTextOperation, bool]:
        with self.connection(write=True) as connection:
            operation = self.read_in_connection(connection, project, episode, operation_id)
            if operation.status == "NOT_SENT" and operation.error_code == code:
                return operation, True
            if operation.status != "REMOTE_UNKNOWN":
                raise OfficialTextError("OFFICIAL_TEXT_OPERATION_CONFLICT")
            connection.execute(
                "UPDATE official_text_operations SET status = 'NOT_SENT', error_code = ? "
                "WHERE operation_id = ?",
                (code, operation_id),
            )
            return self.read_in_connection(connection, project, episode, operation_id), False
