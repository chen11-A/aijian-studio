"""Durable, separate operation ledger for synthetic local encoder QA."""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime

from pydantic import TypeAdapter

from aijian_api.artifacts import canonical_content_hash
from aijian_api.engineering_test_export_contracts import (
    ENGINEERING_MEDIA_MAX_BYTES,
    ENGINEERING_OPERATION_ID_PATTERN,
    EngineeringProgressPhase,
    EngineeringStatus,
    EngineeringTestExportData,
    EngineeringTestExportOutput,
    EngineeringTestExportRequest,
)
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_output_verify import VerifiedProductOutput
from aijian_api.repository import StudioRepository

_OPERATION = re.compile(ENGINEERING_OPERATION_ID_PATTERN)


class EngineeringTestExportError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def _id(operation_id: str) -> None:
    if _OPERATION.fullmatch(operation_id) is None:
        raise EngineeringTestExportError("INVALID_ID", "Engineering operation ID is invalid")


def _data(connection: sqlite3.Connection, operation_id: str) -> EngineeringTestExportData:
    row = connection.execute(
        "SELECT * FROM engineering_test_export_operations WHERE operation_id = ?",
        (operation_id,),
    ).fetchone()
    if row is None:
        raise EngineeringTestExportError("NOT_FOUND", "Engineering export operation was not found")
    output = None
    if row["status"] == "SUCCEEDED":
        receipt = connection.execute(
            "SELECT * FROM engineering_test_export_outputs WHERE operation_id = ?",
            (operation_id,),
        ).fetchone()
        if receipt is None:
            raise EngineeringTestExportError(
                "CORRUPT_RECEIPT", "Engineering success has no receipt"
            )
        output = EngineeringTestExportOutput(
            sha256=str(receipt["sha256"]),
            byte_size=receipt["byte_size"],
            probe_hash=str(receipt["probe_hash"]),
            verified_at=str(receipt["verified_at"]),
            media_url=f"/api/v1/engineering-test/exports/{operation_id}/media",
        )
    return EngineeringTestExportData(
        operation_id=str(row["operation_id"]),
        status=TypeAdapter(EngineeringStatus).validate_python(row["status"]),
        progress_phase=TypeAdapter(EngineeringProgressPhase).validate_python(row["progress_phase"]),
        progress_frames=row["progress_frames"],
        cancel_requested_at=row["cancel_requested_at"],
        unknown_reason=row["unknown_reason"],
        output=output,
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


class EngineeringTestExportStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def get(self, operation_id: str) -> EngineeringTestExportData:
        _id(operation_id)
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            result = _data(connection, operation_id)
            connection.commit()
            return result

    def claim(
        self,
        request: EngineeringTestExportRequest,
        toolchain: MediaToolchain,
    ) -> tuple[EngineeringTestExportData, bool]:
        """Caller must verify the pinned synthetic fixture before this insert."""
        request_hash = canonical_content_hash(request.model_dump(mode="json"))
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    """SELECT request_hash FROM engineering_test_export_operations
                       WHERE operation_id = ?""",
                    (request.operation_id,),
                ).fetchone()
                if row is not None:
                    if row["request_hash"] != request_hash:
                        raise EngineeringTestExportError(
                            "OPERATION_CONFLICT",
                            "Operation ID was reused with different input",
                        )
                    result = _data(connection, request.operation_id)
                    connection.commit()
                    return result, True
                stamp = _now()
                connection.execute(
                    """INSERT INTO engineering_test_export_operations (
                         operation_id, scope, request_hash, fixture_id, fixture_sha256,
                         toolchain_profile_id, ffmpeg_sha256, ffprobe_sha256,
                         output_relative_path, status, progress_phase, progress_frames,
                         created_at, updated_at
                       ) VALUES (?, 'ENGINEERING_TEST', ?, ?, ?, ?, ?, ?, ?,
                                 'CLAIMED', 'QUEUED', 0, ?, ?)""",
                    (
                        request.operation_id,
                        request_hash,
                        request.fixture_id,
                        request.fixture_sha256,
                        toolchain.profile_id,
                        toolchain.ffmpeg_sha256,
                        toolchain.ffprobe_sha256,
                        f"{request.operation_id}.mp4",
                        stamp,
                        stamp,
                    ),
                )
                result = _data(connection, request.operation_id)
                connection.commit()
                return result, False
            except BaseException:
                connection.rollback()
                raise

    def request_cancel(self, operation_id: str) -> EngineeringTestExportData:
        _id(operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = _data(connection, operation_id)
                if (
                    current.status not in {"SUCCEEDED", "CANCELLED"}
                    and current.cancel_requested_at is None
                ):
                    stamp = _now()
                    connection.execute(
                        """UPDATE engineering_test_export_operations
                           SET cancel_requested_at = ?, updated_at = ?
                           WHERE operation_id = ?""",
                        (stamp, stamp, operation_id),
                    )
                result = _data(connection, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def start(self, operation_id: str) -> EngineeringTestExportData:
        _id(operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                stamp = _now()
                changed = connection.execute(
                    """UPDATE engineering_test_export_operations
                       SET status = 'RUNNING', progress_phase = 'ENCODING',
                           started_at = ?, updated_at = ?
                       WHERE operation_id = ? AND status = 'CLAIMED'
                         AND cancel_requested_at IS NULL""",
                    (stamp, stamp, operation_id),
                ).rowcount
                if changed != 1:
                    raise EngineeringTestExportError(
                        "NOT_STARTABLE", "Engineering export is not queued"
                    )
                result = _data(connection, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def progress(self, operation_id: str, frames: int) -> EngineeringTestExportData:
        _id(operation_id)
        if isinstance(frames, bool) or not isinstance(frames, int) or not 0 <= frames <= 64:
            raise EngineeringTestExportError("INVALID_PROGRESS", "Engineering progress is invalid")
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                stamp = _now()
                changed = connection.execute(
                    """UPDATE engineering_test_export_operations
                       SET progress_frames = ?, updated_at = ?
                       WHERE operation_id = ? AND status = 'RUNNING'
                         AND progress_phase = 'ENCODING' AND cancel_requested_at IS NULL
                         AND progress_frames <= ?""",
                    (frames, stamp, operation_id, frames),
                ).rowcount
                if changed != 1:
                    raise EngineeringTestExportError(
                        "PROGRESS_CONFLICT", "Engineering progress is stale"
                    )
                result = _data(connection, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def verifying(self, operation_id: str) -> EngineeringTestExportData:
        _id(operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                changed = connection.execute(
                    """UPDATE engineering_test_export_operations
                       SET progress_phase = 'VERIFYING', progress_frames = 64,
                           updated_at = ?
                       WHERE operation_id = ? AND status = 'RUNNING'
                         AND progress_phase = 'ENCODING' AND cancel_requested_at IS NULL""",
                    (_now(), operation_id),
                ).rowcount
                if changed != 1:
                    raise EngineeringTestExportError(
                        "NOT_VERIFYING", "Engineering export cannot verify"
                    )
                result = _data(connection, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def unknown(self, operation_id: str, reason: str) -> EngineeringTestExportData:
        _id(operation_id)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,79}", reason):
            raise EngineeringTestExportError("INVALID_REASON", "Unknown reason is invalid")
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = _data(connection, operation_id)
                if current.status == "UNKNOWN":
                    connection.commit()
                    return current
                if current.status not in {"CLAIMED", "RUNNING"}:
                    raise EngineeringTestExportError(
                        "TERMINAL", "Terminal operation cannot become unknown"
                    )
                stamp = _now()
                connection.execute(
                    """UPDATE engineering_test_export_operations
                       SET status = 'UNKNOWN', unknown_reason = ?,
                           finished_at = ?, updated_at = ? WHERE operation_id = ?""",
                    (reason, stamp, stamp, operation_id),
                )
                result = _data(connection, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def cancelled(self, operation_id: str) -> EngineeringTestExportData:
        _id(operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = _data(connection, operation_id)
                if current.status == "CANCELLED":
                    connection.commit()
                    return current
                if (
                    current.status not in {"CLAIMED", "RUNNING"}
                    or current.cancel_requested_at is None
                ):
                    raise EngineeringTestExportError(
                        "NOT_CANCELLABLE", "Engineering export cannot be cancelled"
                    )
                stamp = _now()
                connection.execute(
                    """UPDATE engineering_test_export_operations
                       SET status = 'CANCELLED', finished_at = ?, updated_at = ?
                       WHERE operation_id = ?""",
                    (stamp, stamp, operation_id),
                )
                result = _data(connection, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def succeed(
        self, operation_id: str, verified: VerifiedProductOutput
    ) -> EngineeringTestExportData:
        _id(operation_id)
        if not 0 < verified.byte_size <= ENGINEERING_MEDIA_MAX_BYTES:
            raise EngineeringTestExportError("OUTPUT_SIZE", "Engineering output is too large")
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = connection.execute(
                    """SELECT status, progress_phase, cancel_requested_at,
                              output_relative_path FROM engineering_test_export_operations
                       WHERE operation_id = ?""",
                    (operation_id,),
                ).fetchone()
                if (
                    current is None
                    or current["status"] != "RUNNING"
                    or current["progress_phase"] != "VERIFYING"
                    or current["cancel_requested_at"] is not None
                    or not verified.absolute_path.endswith(
                        "/" + str(current["output_relative_path"])
                    )
                    and not verified.absolute_path.endswith(
                        "\\" + str(current["output_relative_path"])
                    )
                ):
                    raise EngineeringTestExportError(
                        "OUTPUT_CONFLICT", "Engineering output is not bound to this operation"
                    )
                connection.execute(
                    """INSERT INTO engineering_test_export_outputs (
                         operation_id, scope, relative_path, sha256, byte_size,
                         probe_json, probe_hash, verified_at
                       ) VALUES (?, 'ENGINEERING_TEST', ?, ?, ?, ?, ?, ?)""",
                    (
                        operation_id,
                        str(current["output_relative_path"]),
                        verified.sha256,
                        verified.byte_size,
                        verified.probe_json,
                        verified.probe_hash,
                        verified.verified_at,
                    ),
                )
                stamp = _now()
                connection.execute(
                    """UPDATE engineering_test_export_operations
                       SET status = 'SUCCEEDED', finished_at = ?, updated_at = ?
                       WHERE operation_id = ?""",
                    (stamp, stamp, operation_id),
                )
                result = _data(connection, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def recover_interrupted(self) -> int:
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                stamp = _now()
                changed = connection.execute(
                    """UPDATE engineering_test_export_operations
                       SET status = 'UNKNOWN', unknown_reason = 'PROCESS_INTERRUPTED',
                           finished_at = ?, updated_at = ?
                       WHERE status IN ('CLAIMED', 'RUNNING')""",
                    (stamp, stamp),
                ).rowcount
                connection.commit()
                return changed
            except BaseException:
                connection.rollback()
                raise
