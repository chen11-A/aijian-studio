"""Durable trusted-main director reservation over real immutable workflow truth."""

from __future__ import annotations

import builtins
import json
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.official_director_contracts import (
    AdoptOfficialDirectorRequest,
    CompleteOfficialDirectorRequest,
    OfficialDirectorOperation,
    OfficialDirectorPreparedRequest,
    PrepareOfficialDirectorRequest,
    RejectOfficialDirectorRequest,
    ReserveOfficialDirectorRequest,
)
from aijian_api.official_director_prompt import build_prepared_request
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.shot_plan_validation import ShotPlanError
from aijian_api.task_ledger_models import timestamp, utc_now


class OfficialDirectorError(RuntimeError):
    def __init__(self, code: str, status: int = 409) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def input_version_ids(request: PrepareOfficialDirectorRequest) -> tuple[str, ...]:
    authority = request.authority
    versions: tuple[str, ...] = (authority.script.version_id, authority.production_brief.version_id)
    if authority.mode == "ADAPTED":
        versions += (authority.source_extraction.version_id,)
    return versions


def prepare_payload(payload: ReserveOfficialDirectorRequest) -> PrepareOfficialDirectorRequest:
    return PrepareOfficialDirectorRequest.model_validate(
        payload.model_dump(mode="json", include=set(PrepareOfficialDirectorRequest.model_fields))
    )


class OfficialDirectorStore:
    def __init__(
        self,
        repository: StudioRepository,
        *,
        clock: Callable[[], datetime] = utc_now,
        transaction_hook: Callable[[str], None] | None = None,
    ) -> None:
        self.repository = repository
        self.clock = clock
        self.hook = transaction_hook

    @contextmanager
    def connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.repository.database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            if not write:
                connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except OfficialDirectorError:
            connection.rollback()
            raise
        except ShotPlanError as error:
            connection.rollback()
            code = error.code.replace("SHOT_PLAN_", "OFFICIAL_DIRECTOR_")
            raise OfficialDirectorError(code, error.status) from error
        except ArtifactConflictError as error:
            connection.rollback()
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_CONFLICT") from error
        except (sqlite3.DatabaseError, ValueError, TypeError, KeyError, RuntimeError) as error:
            connection.rollback()
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_STORAGE_FAILED", 500) from error
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
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_SCOPE_NOT_FOUND", 404)

    def checkpoint(self, phase: str) -> None:
        if self.hook is not None:
            self.hook(phase)

    def prepare(
        self, project: str, episode: str, payload: PrepareOfficialDirectorRequest
    ) -> OfficialDirectorPreparedRequest:
        payload = PrepareOfficialDirectorRequest.model_validate(payload.model_dump(mode="json"))
        with self.connection() as connection:
            self.require_scope(connection, project, episode)
            return build_prepared_request(self.repository, connection, project, episode, payload)

    def read_in_connection(
        self, connection: sqlite3.Connection, project: str, episode: str, operation: str
    ) -> OfficialDirectorOperation:
        from aijian_api.official_director_query import read_operation

        return read_operation(self, connection, project, episode, operation)

    def get(self, project: str, episode: str, operation: str) -> OfficialDirectorOperation:
        with self.connection() as connection:
            self.require_scope(connection, project, episode)
            return self.read_in_connection(connection, project, episode, operation)

    def list(self, project: str, episode: str) -> list[OfficialDirectorOperation]:
        return self.list_page(project, episode)[0]

    def list_page(
        self, project: str, episode: str
    ) -> tuple[builtins.list[OfficialDirectorOperation], bool]:
        with self.connection() as connection:
            self.require_scope(connection, project, episode)
            rows = connection.execute(
                "SELECT operation_id FROM official_director_operations "
                "WHERE project_id = ? AND episode_id = ? "
                "ORDER BY CASE WHEN status = 'REMOTE_UNKNOWN' THEN 0 ELSE 1 END, "
                "created_at DESC, operation_id DESC LIMIT 21",
                (project, episode),
            ).fetchall()
            operations: list[OfficialDirectorOperation] = []
            serialized_bytes = 2
            for row in rows[:20]:
                operation = self.read_in_connection(
                    connection, project, episode, row["operation_id"]
                )
                operation_bytes = (
                    len(canonical_content_bytes(operation.model_dump(mode="json"))) + 1
                )
                if operations and serialized_bytes + operation_bytes > 12 * 1024 * 1024:
                    break
                operations.append(operation)
                serialized_bytes += operation_bytes
            return operations, len(operations) < len(rows)

    def reserve(
        self, project: str, episode: str, payload: ReserveOfficialDirectorRequest
    ) -> tuple[OfficialDirectorOperation, bool]:
        from aijian_api.official_director_task import reserve_task

        payload = ReserveOfficialDirectorRequest.model_validate(payload.model_dump(mode="json"))
        with self.connection(write=True) as connection:
            self.require_scope(connection, project, episode)
            prior = connection.execute(
                "SELECT project_id, episode_id FROM official_director_operations "
                "WHERE operation_id = ?",
                (payload.operation_id,),
            ).fetchone()
            if prior is not None:
                if prior["project_id"] != project or prior["episode_id"] != episode:
                    raise OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT")
                old = self.read_in_connection(connection, project, episode, payload.operation_id)
                fields = set(ReserveOfficialDirectorRequest.model_fields)
                if old.request.model_dump(mode="json", include=fields) != payload.model_dump(
                    mode="json"
                ):
                    raise OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT")
                return old, True
            prepared = build_prepared_request(
                self.repository, connection, project, episode, prepare_payload(payload)
            )
            if prepared.request_hash != payload.request_hash:
                raise OfficialDirectorError("OFFICIAL_DIRECTOR_PROMPT_MISMATCH", 422)
            if connection.execute(
                "SELECT 1 FROM official_director_operations WHERE project_id = ? "
                "AND episode_id = ? AND status = 'REMOTE_UNKNOWN'",
                (project, episode),
            ).fetchone():
                raise OfficialDirectorError("OFFICIAL_DIRECTOR_UNRESOLVED_OPERATION")
            now_text = timestamp(self.clock())
            task = reserve_task(
                connection,
                project,
                payload.operation_id,
                payload.profile_id,
                payload.model,
                prepared.request_hash,
                now_text,
                input_version_ids(prepared),
            )
            self.checkpoint("task_reserved")
            request_json = prepared.model_dump(mode="json")
            connection.execute(
                """INSERT INTO official_director_operations(operation_id, project_id, episode_id,
                    request_json, request_hash, status, created_at, task_id, attempt_id,
                    validation_issues_json)
                VALUES (?, ?, ?, ?, ?, 'REMOTE_UNKNOWN', ?, ?, ?, '[]')""",
                (
                    payload.operation_id,
                    project,
                    episode,
                    json.dumps(request_json, ensure_ascii=False, sort_keys=True),
                    canonical_content_hash(request_json),
                    now_text,
                    task.task_id,
                    task.attempt_id,
                ),
            )
            self.checkpoint("operation_reserved")
            return self.read_in_connection(
                connection, project, episode, payload.operation_id
            ), False

    def complete(
        self, project: str, episode: str, payload: CompleteOfficialDirectorRequest
    ) -> tuple[OfficialDirectorOperation, bool]:
        from aijian_api.official_director_completion import complete_director

        return complete_director(self, project, episode, payload)

    def not_sent(
        self, project: str, episode: str, operation: str, code: str
    ) -> tuple[OfficialDirectorOperation, bool]:
        from aijian_api.official_director_task import settle_task

        with self.connection(write=True) as connection:
            previous = self.read_in_connection(connection, project, episode, operation)
            if previous.status == "NOT_SENT" and previous.error_code == code:
                return previous, True
            if previous.status != "REMOTE_UNKNOWN":
                raise OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT")
            now_text = timestamp(self.clock())
            settle_task(
                connection,
                previous.task_id,
                previous.attempt_id,
                None,
                None,
                code,
                "NOT_SUBMITTED",
                now_text,
            )
            connection.execute(
                "UPDATE official_director_operations SET status = 'NOT_SENT', error_code = ? "
                "WHERE operation_id = ?",
                (code, operation),
            )
            self.checkpoint("not_sent_recorded")
            return self.read_in_connection(connection, project, episode, operation), False

    def adopt(
        self,
        project: str,
        episode: str,
        operation: str,
        payload: AdoptOfficialDirectorRequest,
        actor: str,
    ) -> tuple[OfficialDirectorOperation, bool]:
        from aijian_api.official_director_adoption import adopt_director

        return adopt_director(self, project, episode, operation, payload, actor)

    def reject(
        self,
        project: str,
        episode: str,
        operation: str,
        payload: RejectOfficialDirectorRequest,
        actor: str,
    ) -> tuple[OfficialDirectorOperation, bool]:
        from aijian_api.official_director_adoption import reject_director

        return reject_director(self, project, episode, operation, payload, actor)
