"""Count failed and unresolved actual video submissions across task keys.

No money or provider authorization is represented here. PENDING is durable before
transport entry; a crash or uncertain response never frees that reservation.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

from aijian_api.repository import StudioRepository

_DIGEST = re.compile(r"[0-9a-f]{64}\Z")


class GenerationFailureError(ValueError):
    """A fixed, safe decision code (never original input or transport errors)."""


@dataclass(frozen=True, slots=True)
class FailurePolicy:
    revision: int
    failure_limit: int


@dataclass(frozen=True, slots=True)
class FailureReservation:
    attempt_id: str
    input_sha256: str


class GenerationFailureStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._database = repository.database_path

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._database, timeout=5, isolation_level=None)
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _project(connection: sqlite3.Connection, project_id: str) -> None:
        if not connection.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
            raise GenerationFailureError("PROJECT_NOT_FOUND")

    def policy(self, project_id: str) -> FailurePolicy | None:
        with self._transaction() as connection:
            self._project(connection, project_id)
            row = connection.execute(
                "SELECT revision,failure_limit FROM generation_failure_policy WHERE project_id=?",
                (project_id,),
            ).fetchone()
            return None if row is None else FailurePolicy(int(row[0]), int(row[1]))

    def configure(
        self, project_id: str, *, expected_revision: int, failure_limit: int
    ) -> FailurePolicy:
        if type(failure_limit) is not int or not 0 <= failure_limit <= 1000:
            raise GenerationFailureError("INVALID_FAILURE_LIMIT")
        if type(expected_revision) is not int or not 0 <= expected_revision <= 2**53 - 2:
            raise GenerationFailureError("INVALID_POLICY_REVISION")
        with self._transaction() as connection:
            self._project(connection, project_id)
            row = connection.execute(
                "SELECT revision FROM generation_failure_policy WHERE project_id=?", (project_id,)
            ).fetchone()
            current = 0 if row is None else int(row[0])
            if current != expected_revision:
                raise GenerationFailureError("POLICY_CHANGED")
            revision = current + 1
            connection.execute(
                "INSERT INTO generation_failure_policy VALUES(?,?,?) "
                "ON CONFLICT(project_id) DO UPDATE SET "
                "revision=excluded.revision,failure_limit=excluded.failure_limit",
                (project_id, revision, failure_limit),
            )
            return FailurePolicy(revision, failure_limit)

    def reserve(
        self, project_id: str, *, input_sha256: str, attempt_key: str
    ) -> FailureReservation:
        if not _DIGEST.fullmatch(input_sha256) or not attempt_key or len(attempt_key) > 512:
            raise GenerationFailureError("INVALID_DISPATCH_IDENTITY")
        key = hashlib.sha256(attempt_key.encode()).hexdigest()
        with self._transaction() as connection:
            self._project(connection, project_id)
            policy = connection.execute(
                "SELECT revision,failure_limit FROM generation_failure_policy WHERE project_id=?",
                (project_id,),
            ).fetchone()
            if policy is None:
                raise GenerationFailureError("UNCONFIGURED")
            if connection.execute(
                "SELECT 1 FROM generation_failure_attempt "
                "WHERE project_id=? AND attempt_key_sha256=?",
                (project_id, key),
            ).fetchone():
                raise GenerationFailureError("ATTEMPT_ALREADY_RESERVED")
            used = connection.execute(
                "SELECT COUNT(*) FROM generation_failure_attempt "
                "WHERE project_id=? AND input_sha256=? AND status!='SUCCEEDED'",
                (project_id, input_sha256),
            ).fetchone()
            if used is None or int(used[0]) >= int(policy[1]):
                raise GenerationFailureError("INPUT_FAILURE_LIMIT")
            identifier = uuid4().hex
            connection.execute(
                "INSERT INTO generation_failure_attempt VALUES(?,?,?,?,?,'PENDING')",
                (identifier, project_id, input_sha256, key, int(policy[0])),
            )
            return FailureReservation(identifier, input_sha256)

    def discard_before_transport(self, project_id: str, reservation: FailureReservation) -> None:
        """Only the synchronous pre-send gate can prove this hold never entered HTTP.

        An UNKNOWN or terminal attempt is never eligible, including after restart.
        The original task ledger still retains the canceled task/idempotency key.
        """
        with self._transaction() as connection:
            result = connection.execute(
                "DELETE FROM generation_failure_attempt WHERE id=? AND project_id=? "
                "AND input_sha256=? AND status='PENDING'",
                (reservation.attempt_id, project_id, reservation.input_sha256),
            )
            if result.rowcount != 1:
                raise GenerationFailureError("ATTEMPT_NOT_UNSUBMITTED")

    def settle(
        self,
        project_id: str,
        reservation: FailureReservation,
        status: Literal["UNKNOWN", "FAILED", "SUCCEEDED"],
    ) -> None:
        if status not in {"UNKNOWN", "FAILED", "SUCCEEDED"}:
            raise GenerationFailureError("INVALID_ATTEMPT_STATUS")
        with self._transaction() as connection:
            # Terminal evidence cannot be overwritten by an old callback.
            result = connection.execute(
                "UPDATE generation_failure_attempt SET status=? "
                "WHERE id=? AND project_id=? AND input_sha256=? "
                "AND status IN ('PENDING','UNKNOWN')",
                (status, reservation.attempt_id, project_id, reservation.input_sha256),
            )
            if result.rowcount != 1:
                raise GenerationFailureError("ATTEMPT_NOT_PENDING")
