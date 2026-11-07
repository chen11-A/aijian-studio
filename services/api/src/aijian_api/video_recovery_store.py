"""Exact local attempts, joined to the original durable failure reservation."""

from __future__ import annotations

import re
from dataclasses import dataclass

from aijian_api.generation_failure_store import (
    FailureReservation,
    GenerationFailureError,
    GenerationFailureStore,
)
from aijian_api.repository import StudioRepository

_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_ATTEMPT = re.compile(r"[0-9a-f]{32}\Z")
_REQUEST = re.compile(r"[A-Za-z0-9_-]{1,256}\Z")


@dataclass(frozen=True, slots=True)
class RecoverableVideo:
    reservation: FailureReservation
    status: str
    provider_request_id: str
    output_sha256: str | None
    output_bytes: int | None


class VideoRecoveryStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._failures = GenerationFailureStore(repository)

    def attach(
        self, project_id: str, reservation: FailureReservation, account: str, request_id: str
    ) -> None:
        if not _DIGEST.fullmatch(account) or not _REQUEST.fullmatch(request_id):
            raise GenerationFailureError("RECOVERY_IDENTITY_UNVERIFIABLE")
        with self._failures._transaction() as connection:
            row = connection.execute(
                "SELECT 1 FROM generation_failure_attempt WHERE id=? AND project_id=? "
                "AND input_sha256=? AND status='PENDING'",
                (reservation.attempt_id, project_id, reservation.input_sha256),
            ).fetchone()
            if row is None:
                raise GenerationFailureError("ATTEMPT_NOT_PENDING")
            connection.execute(
                "INSERT INTO generation_video_recovery "
                "(attempt_id,input_sha256,account_sha256,provider_request_id) VALUES(?,?,?,?)",
                (reservation.attempt_id, reservation.input_sha256, account, request_id),
            )

    def read(self, project_id: str, account: str, attempt_id: str) -> RecoverableVideo:
        if not _DIGEST.fullmatch(account) or not _ATTEMPT.fullmatch(attempt_id):
            raise GenerationFailureError("RECOVERY_NOT_FOUND")
        with self._failures._transaction() as connection:
            row = connection.execute(
                "SELECT a.input_sha256,a.status,r.provider_request_id,"
                "r.output_sha256,r.output_bytes "
                "FROM generation_failure_attempt a JOIN generation_video_recovery r "
                "ON r.attempt_id=a.id AND r.input_sha256=a.input_sha256 "
                "WHERE a.id=? AND a.project_id=? AND r.account_sha256=?",
                (attempt_id, project_id, account),
            ).fetchone()
        if row is None:
            raise GenerationFailureError("RECOVERY_NOT_FOUND")
        return RecoverableVideo(FailureReservation(attempt_id, str(row[0])), *row[1:])

    def list_ids(self, project_id: str, account: str) -> tuple[list[str], bool]:
        if not _DIGEST.fullmatch(account):
            raise GenerationFailureError("ACCOUNT_UNVERIFIABLE")
        with self._failures._transaction() as connection:
            self._failures._project(connection, project_id)
            rows = connection.execute(
                "SELECT a.id FROM generation_failure_attempt a JOIN generation_video_recovery r "
                "ON r.attempt_id=a.id AND r.input_sha256=a.input_sha256 "
                "WHERE a.project_id=? AND r.account_sha256=? "
                "AND (a.status IN ('PENDING','UNKNOWN') OR r.output_sha256 IS NOT NULL) "
                "ORDER BY a.rowid DESC LIMIT 101",
                (project_id, account),
            ).fetchall()
        return [str(row[0]) for row in rows[:100]], len(rows) > 100

    def complete(
        self, project_id: str, account: str, attempt_id: str, sha256: str, size: int
    ) -> None:
        if not _DIGEST.fullmatch(sha256) or size <= 0:
            raise GenerationFailureError("RECOVERY_OUTPUT_UNVERIFIABLE")
        with self._failures._transaction() as connection:
            row = connection.execute(
                "SELECT a.status,r.output_sha256,r.output_bytes FROM generation_failure_attempt a "
                "JOIN generation_video_recovery r ON r.attempt_id=a.id "
                "AND r.input_sha256=a.input_sha256 "
                "WHERE a.id=? AND a.project_id=? AND r.account_sha256=?",
                (attempt_id, project_id, account),
            ).fetchone()
            if row is None or row[0] not in {"PENDING", "UNKNOWN", "SUCCEEDED"}:
                raise GenerationFailureError("ATTEMPT_NOT_PENDING")
            if row[1] is not None and (row[1] != sha256 or row[2] != size):
                raise GenerationFailureError("RECOVERY_OUTPUT_CHANGED")
            connection.execute(
                "UPDATE generation_video_recovery SET output_sha256=?,output_bytes=? "
                "WHERE attempt_id=?",
                (sha256, size, attempt_id),
            )
            connection.execute(
                "UPDATE generation_failure_attempt SET status='SUCCEEDED' WHERE id=?",
                (attempt_id,),
            )
