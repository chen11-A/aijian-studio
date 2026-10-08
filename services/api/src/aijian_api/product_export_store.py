"""Durable state transitions for locally claimed product export operations.

Only a separately verified claim may insert an operation. This module does not
silently start, retry, or re-encode one. A restarted process marks unfinished
operations UNKNOWN for explicit reconciliation.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from aijian_api.artifacts import canonical_content_hash
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest,
    ProductExportAssemblyAssertion,
    ProductExportOperationData,
    ProductExportOutputReceipt,
)
from aijian_api.product_export_output_verify import (
    output_target_identity, verify_product_output,
)
from aijian_api.product_export_render_plan import ProductExportRenderPlan
from aijian_api.repository import StudioRepository

_PROJECT = re.compile(r"prj_[0-9a-f]{32}\Z")
_OPERATION = re.compile(r"peop_[0-9a-f]{32}\Z")


class ProductExportStateError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def _identity(project_id: str, operation_id: str) -> None:
    if _PROJECT.fullmatch(project_id) is None or _OPERATION.fullmatch(operation_id) is None:
        raise ProductExportStateError("INVALID_ID", "Product export operation identity is invalid")


def _read_operation(
    connection: sqlite3.Connection, project_id: str, operation_id: str,
) -> ProductExportOperationData:
    row = connection.execute(
        """SELECT * FROM product_export_operations
           WHERE project_id = ? AND operation_id = ?""",
        (project_id, operation_id),
    ).fetchone()
    if row is None:
        raise ProductExportStateError("NOT_FOUND", "Product export operation was not found")
    output = None
    if row["status"] == "SUCCEEDED":
        receipt = connection.execute(
            """SELECT * FROM product_export_outputs
               WHERE project_id = ? AND operation_id = ?""",
            (project_id, operation_id),
        ).fetchone()
        if receipt is None:
            raise ProductExportStateError("CORRUPT_RECEIPT", "Successful export has no output receipt")
        output = ProductExportOutputReceipt(
            absolute_path=str(receipt["absolute_path"]),
            sha256=str(receipt["sha256"]),
            byte_size=receipt["byte_size"],
            probe_hash=str(receipt["probe_hash"]),
            verified_at=str(receipt["verified_at"]),
        )
    operation_data: dict[str, object] = {
        "project_id": str(row["project_id"]),
        "episode_id": str(row["episode_id"]),
        "operation_id": str(row["operation_id"]),
        "request_hash": str(row["request_hash"]),
        "assembly": ProductExportAssemblyAssertion(
            artifact_id=str(row["assembly_artifact_id"]),
            version_id=str(row["assembly_version_id"]),
            content_hash=str(row["assembly_content_hash"]),
            head_revision=row["assembly_head_revision"],
        ),
        "status": str(row["status"]),
        "progress_phase": str(row["progress_phase"]),
        "progress_frames": row["progress_frames"],
        "total_frames": row["total_frames"],
        "inputs_sealed_at": row["inputs_sealed_at"],
        "cancel_requested_at": row["cancel_requested_at"],
        "unknown_reason": row["unknown_reason"],
        "output": output,
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "reconciled_at": row["reconciled_at"],
    }
    return ProductExportOperationData.model_validate(operation_data)


class ProductExportStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def get(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        _identity(project_id, operation_id)
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            result = _read_operation(connection, project_id, operation_id)
            connection.commit()
            return result

    def request_cancel(
        self, project_id: str, operation_id: str,
    ) -> ProductExportOperationData:
        """Persist a cancellation signal; the worker separately stops the process."""
        _identity(project_id, operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = _read_operation(connection, project_id, operation_id)
                if current.status in {"SUCCEEDED", "CANCELLED"}:
                    connection.commit()
                    return current
                if current.cancel_requested_at is None:
                    stamp = _now()
                    connection.execute(
                        """UPDATE product_export_operations
                           SET cancel_requested_at = ?, updated_at = ?
                           WHERE project_id = ? AND operation_id = ?
                             AND cancel_requested_at IS NULL""",
                        (stamp, stamp, project_id, operation_id),
                    )
                result = _read_operation(connection, project_id, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def mark_running(
        self, project_id: str, operation_id: str,
    ) -> ProductExportOperationData:
        """One worker starts only while assembly and every rights head still match."""
        _identity(project_id, operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                claim = connection.execute(
                    """SELECT operation.assembly_artifact_id, operation.assembly_version_id,
                              operation.assembly_content_hash, operation.assembly_head_revision,
                              operation.media_input_count, operation.inputs_sealed_at,
                              head.latest_version_id, head.revision, version.content_hash
                       FROM product_export_operations AS operation
                       JOIN artifact_heads AS head
                         ON head.artifact_id = operation.assembly_artifact_id
                       JOIN artifact_versions AS version
                         ON version.artifact_id = operation.assembly_artifact_id
                        AND version.version_id = operation.assembly_version_id
                       WHERE operation.project_id = ? AND operation.operation_id = ?""",
                    (project_id, operation_id),
                ).fetchone()
                if (
                    claim is None or claim["inputs_sealed_at"] is None
                    or claim["latest_version_id"] != claim["assembly_version_id"]
                    or claim["revision"] != claim["assembly_head_revision"]
                    or claim["content_hash"] != claim["assembly_content_hash"]
                ):
                    raise ProductExportStateError("ASSEMBLY_CHANGED", "Selected assembly head changed before encoding")
                media_rows = connection.execute(
                    """SELECT media.asset_id, media.version_id, media.asset_sha256,
                              media.rights_decision_id, media.rights_revision,
                              media.rights_content_hash,
                              asset.deleted_at, version.sha256 AS current_sha256,
                              head.decision_id AS current_decision_id,
                              head.revision AS current_revision,
                              decision.decision, decision.asset_sha256 AS rights_asset_sha256,
                              decision.decision_content_hash AS current_rights_hash
                       FROM product_export_media_inputs AS media
                       LEFT JOIN media_assets AS asset
                         ON asset.project_id = media.project_id AND asset.id = media.asset_id
                       LEFT JOIN media_asset_versions AS version
                         ON version.project_id = media.project_id
                        AND version.asset_id = media.asset_id AND version.id = media.version_id
                       LEFT JOIN media_asset_rights_heads AS head
                         ON head.project_id = media.project_id
                        AND head.asset_id = media.asset_id AND head.version_id = media.version_id
                       LEFT JOIN media_asset_rights_decisions AS decision
                         ON decision.project_id = media.project_id
                        AND decision.asset_id = media.asset_id
                        AND decision.version_id = media.version_id
                        AND decision.id = head.decision_id AND decision.revision = head.revision
                       WHERE media.project_id = ? AND media.operation_id = ?
                       ORDER BY media.input_index""",
                    (project_id, operation_id),
                ).fetchall()
                if len(media_rows) != claim["media_input_count"] or any(
                    media["current_sha256"] != media["asset_sha256"]
                    or media["current_decision_id"] != media["rights_decision_id"]
                    or media["current_revision"] != media["rights_revision"]
                    or media["current_rights_hash"] != media["rights_content_hash"]
                    or media["rights_asset_sha256"] != media["asset_sha256"]
                    or media["decision"] != "CLEARED"
                    or media["deleted_at"] is not None
                    for media in media_rows
                ):
                    raise ProductExportStateError("MEDIA_OR_RIGHTS_CHANGED", "Selected media or rights changed before encoding")
                stamp = _now()
                changed = connection.execute(
                    """UPDATE product_export_operations
                       SET status = 'RUNNING', progress_phase = 'ENCODING',
                           started_at = ?, updated_at = ?
                       WHERE project_id = ? AND operation_id = ?
                         AND status = 'CLAIMED' AND cancel_requested_at IS NULL""",
                    (stamp, stamp, project_id, operation_id),
                ).rowcount
                if changed != 1:
                    raise ProductExportStateError(
                        "NOT_STARTABLE", "Product export is not queued or cancellation was requested",
                    )
                result = _read_operation(connection, project_id, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def record_progress(
        self, project_id: str, operation_id: str, completed_frames: int,
    ) -> ProductExportOperationData:
        _identity(project_id, operation_id)
        if isinstance(completed_frames, bool) or not isinstance(completed_frames, int):
            raise ProductExportStateError("INVALID_PROGRESS", "Completed frames must be an integer")
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                stamp = _now()
                changed = connection.execute(
                    """UPDATE product_export_operations
                       SET progress_frames = ?, updated_at = ?
                       WHERE project_id = ? AND operation_id = ?
                         AND status = 'RUNNING' AND progress_phase = 'ENCODING'
                         AND cancel_requested_at IS NULL
                         AND progress_frames <= ? AND total_frames >= ?""",
                    (completed_frames, stamp, project_id, operation_id,
                     completed_frames, completed_frames),
                ).rowcount
                if changed != 1:
                    raise ProductExportStateError(
                        "PROGRESS_CONFLICT", "Product export progress is stale or not running",
                    )
                result = _read_operation(connection, project_id, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def mark_verifying(
        self, project_id: str, operation_id: str,
    ) -> ProductExportOperationData:
        """Encoding exited; caller must still verify file bytes and media structure."""
        _identity(project_id, operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                stamp = _now()
                changed = connection.execute(
                    """UPDATE product_export_operations
                       SET progress_phase = 'VERIFYING', progress_frames = total_frames,
                           updated_at = ?
                       WHERE project_id = ? AND operation_id = ?
                         AND status = 'RUNNING' AND progress_phase = 'ENCODING'
                         AND cancel_requested_at IS NULL""",
                    (stamp, project_id, operation_id),
                ).rowcount
                if changed != 1:
                    raise ProductExportStateError("NOT_VERIFYING", "Product export cannot enter verification")
                result = _read_operation(connection, project_id, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def mark_unknown(
        self, project_id: str, operation_id: str, reason: str,
    ) -> ProductExportOperationData:
        """Keep a durable uncertainty receipt; never schedule a retry here."""
        _identity(project_id, operation_id)
        if not reason or len(reason) > 160 or not re.fullmatch(r"[A-Z][A-Z0-9_]*", reason):
            raise ProductExportStateError("INVALID_REASON", "Unknown reason code is invalid")
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = _read_operation(connection, project_id, operation_id)
                if current.status == "UNKNOWN":
                    connection.commit()
                    return current
                if current.status not in {"CLAIMED", "RUNNING"}:
                    raise ProductExportStateError("TERMINAL", "Terminal export cannot become unknown")
                stamp = _now()
                connection.execute(
                    """UPDATE product_export_operations
                       SET status = 'UNKNOWN', unknown_reason = ?,
                           finished_at = ?, updated_at = ?
                       WHERE project_id = ? AND operation_id = ?""",
                    (reason, stamp, stamp, project_id, operation_id),
                )
                result = _read_operation(connection, project_id, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def mark_cancelled(
        self, project_id: str, operation_id: str,
    ) -> ProductExportOperationData:
        """A worker records cancellation only after the encoder has stopped."""
        _identity(project_id, operation_id)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = _read_operation(connection, project_id, operation_id)
                if current.status == "CANCELLED":
                    connection.commit()
                    return current
                if current.status not in {"CLAIMED", "RUNNING", "UNKNOWN"}:
                    raise ProductExportStateError("TERMINAL", "Terminal export cannot be cancelled")
                if current.cancel_requested_at is None:
                    raise ProductExportStateError("NO_CANCEL_REQUEST", "Cancellation was not requested")
                if connection.execute(
                    """SELECT 1 FROM product_export_outputs
                       WHERE project_id = ? AND operation_id = ?""",
                    (project_id, operation_id),
                ).fetchone() is not None:
                    raise ProductExportStateError("OUTPUT_EXISTS", "Verified output must be reconciled")
                stamp = _now()
                connection.execute(
                    """UPDATE product_export_operations
                       SET status = 'CANCELLED', finished_at = COALESCE(finished_at, ?),
                           reconciled_at = CASE WHEN status = 'UNKNOWN' THEN ? ELSE NULL END,
                           updated_at = ?
                       WHERE project_id = ? AND operation_id = ?""",
                    (stamp, stamp, stamp, project_id, operation_id),
                )
                result = _read_operation(connection, project_id, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise

    def mark_interrupted_unknown(self) -> int:
        """At startup, preserve every unfinished claim as UNKNOWN without re-encoding."""
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                stamp = _now()
                changed = connection.execute(
                    """UPDATE product_export_operations
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

    def finalize_output(
        self, project_id: str, operation_id: str, output_root: Path,
        toolchain: MediaToolchain,
    ) -> ProductExportOperationData:
        """Verify actual bytes, then save receipt and success in one transaction."""
        _identity(project_id, operation_id)
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            row = connection.execute(
                """SELECT * FROM product_export_operations
                   WHERE project_id = ? AND operation_id = ?""",
                (project_id, operation_id),
            ).fetchone()
            if row is None:
                raise ProductExportStateError("NOT_FOUND", "Product export operation was not found")
            if row["status"] != "RUNNING" or row["progress_phase"] != "VERIFYING":
                raise ProductExportStateError("NOT_VERIFYING", "Product export is not ready for output verification")
            if row["cancel_requested_at"] is not None:
                raise ProductExportStateError("CANCEL_REQUESTED", "Product export cancellation was requested")
            try:
                request = ProductExportClaimRequest.model_validate_json(str(row["request_json"]))
                plan = ProductExportRenderPlan.model_validate_json(str(row["render_plan_json"]))
            except ValueError:
                raise ProductExportStateError("CORRUPT_CLAIM", "Persisted product export claim is invalid") from None
            if (
                canonical_content_hash({
                    "project_id": project_id, "episode_id": str(row["episode_id"]),
                    "request": request.model_dump(mode="json"),
                }) != str(row["request_hash"])
                or plan.content_hash != str(row["render_plan_hash"])
                or plan.total_frames != row["total_frames"]
                or plan.spec != request.spec
                or plan.assembly_content_hash != str(row["assembly_content_hash"])
                or plan.ffmpeg_sha256 != toolchain.ffmpeg_sha256
                or plan.ffprobe_sha256 != toolchain.ffprobe_sha256
                or plan.toolchain_profile_id != toolchain.profile_id
                or output_target_identity(output_root, request) != str(row["output_target_identity"])
            ):
                raise ProductExportStateError("CORRUPT_CLAIM", "Persisted product export identity differs from plan")
            connection.commit()
        verified = verify_product_output(
            output_root, request, plan.total_frames, toolchain,
            expect_audio=plan.has_audio,
        )
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                current = connection.execute(
                    """SELECT status, progress_phase, cancel_requested_at,
                              request_hash, render_plan_hash, output_target_identity
                       FROM product_export_operations
                       WHERE project_id = ? AND operation_id = ?""",
                    (project_id, operation_id),
                ).fetchone()
                if (
                    current is None or current["status"] != "RUNNING"
                    or current["progress_phase"] != "VERIFYING"
                    or current["cancel_requested_at"] is not None
                    or current["request_hash"] != row["request_hash"]
                    or current["render_plan_hash"] != row["render_plan_hash"]
                    or current["output_target_identity"] != row["output_target_identity"]
                ):
                    raise ProductExportStateError("CLAIM_CHANGED", "Product export state changed during output verification")
                connection.execute(
                    """INSERT INTO product_export_outputs (
                           project_id, operation_id, absolute_path, sha256, byte_size,
                           probe_json, probe_hash, verified_at
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (project_id, operation_id, verified.absolute_path, verified.sha256,
                     verified.byte_size, verified.probe_json, verified.probe_hash,
                     verified.verified_at),
                )
                stamp = _now()
                connection.execute(
                    """UPDATE product_export_operations
                       SET status = 'SUCCEEDED', finished_at = ?, updated_at = ?
                       WHERE project_id = ? AND operation_id = ?""",
                    (stamp, stamp, project_id, operation_id),
                )
                result = _read_operation(connection, project_id, operation_id)
                connection.commit()
                return result
            except BaseException:
                connection.rollback()
                raise
