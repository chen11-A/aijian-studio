"""One-shot orchestration over the existing durable product export operation.

This module deliberately accepts only the persisted single-video render plan.
The synthetic MLT worker has no product assembly or rights claim and cannot be
substituted for the executor here. No call in this module retries an encoder.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Protocol

from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_claim import ProductExportClaimService
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest, ProductExportOperationData,
)
from aijian_api.product_export_render_plan import ProductExportRenderPlan
from aijian_api.product_export_store import ProductExportStore
from aijian_api.repository import StudioRepository


class ProductExportCoordinatorError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class SingleVideoExecutor(Protocol):
    """Place the requested MP4 at its claimed target before returning.

    The implementation must stop its process before propagating an exception.
    It must never invoke an MLT ENGINEERING_TEST task in this product path.
    """

    def __call__(
        self,
        operation: ProductExportOperationData,
        plan: ProductExportRenderPlan,
        request: ProductExportClaimRequest,
        output_root: Path,
        *,
        on_progress: Callable[[int], None],
        stop_requested: Callable[[], bool],
    ) -> None: ...


class ProductExportOperationCoordinator:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository
        self._claims = ProductExportClaimService(repository)
        self._store = ProductExportStore(repository)

    def get(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        """Read an old operation without starting any work."""
        return self._store.get(project_id, operation_id)

    def replay_existing(
        self, project_id: str, episode_id: str, request: ProductExportClaimRequest,
    ) -> ProductExportOperationData | None:
        """Match the claim's exact request identity before discovering tools."""
        return self._claims.replay_existing(project_id, episode_id, request)

    def request_cancel(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        """Persist the signal; only the active executor can stop its process."""
        return self._store.request_cancel(project_id, operation_id)

    def recover_interrupted_at_startup(self) -> int:
        """Call once before accepting work, with no other live export worker.

        Every unresolved CLAIMED or RUNNING operation becomes UNKNOWN. The
        caller must not schedule those operations again automatically.
        """
        return self._store.mark_interrupted_unknown()

    def _read_single_video_plan(
        self, project_id: str, operation_id: str,
    ) -> ProductExportRenderPlan:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            row = connection.execute(
                """SELECT render_plan_json, render_plan_hash, total_frames,
                          assembly_content_hash
                   FROM product_export_operations
                   WHERE project_id = ? AND operation_id = ?""",
                (project_id, operation_id),
            ).fetchone()
        if row is None:
            raise ProductExportCoordinatorError("CLAIM_MISSING", "Claim disappeared before execution")
        try:
            raw = json.loads(str(row["render_plan_json"]))
        except (TypeError, ValueError):
            raise ProductExportCoordinatorError("CLAIM_PLAN_CORRUPT", "Persisted render plan is invalid") from None
        if not isinstance(raw, dict) or raw.get("mode") != "SINGLE_VERIFIED_VIDEO":
            raise ProductExportCoordinatorError(
                "MLT_PLAN_NOT_SUPPORTED", "Only the claimed single-video plan may execute",
            )
        try:
            plan = ProductExportRenderPlan.model_validate(raw)
        except ValueError:
            raise ProductExportCoordinatorError("CLAIM_PLAN_CORRUPT", "Persisted render plan is invalid") from None
        if (
            plan.mode != "SINGLE_VERIFIED_VIDEO"
            or plan.content_hash != row["render_plan_hash"]
            or plan.total_frames != row["total_frames"]
            or plan.assembly_content_hash != row["assembly_content_hash"]
        ):
            raise ProductExportCoordinatorError(
                "CLAIM_PLAN_CONFLICT", "Persisted export plan differs from the claim",
            )
        return plan

    def submit_and_execute(
        self,
        project_id: str,
        episode_id: str,
        request: ProductExportClaimRequest,
        output_root: Path,
        toolchain: MediaToolchain,
        *,
        execute: SingleVideoExecutor,
    ) -> ProductExportOperationData:
        """Execute only a newly claimed operation, once, under schema 28.

        Same-key requests return the durable old receipt even when it is
        UNKNOWN. A caller-supplied executor is only allowed after the formal
        release gate, assembly, media, and rights claim have succeeded.
        """
        operation, existed = self.claim_only(
            project_id, episode_id, request, output_root, toolchain,
        )
        if existed:
            return operation
        return self.execute_claimed(
            operation, request, output_root, toolchain,
            execute=execute, stop_requested_externally=lambda: False,
        )

    def claim_only(
        self,
        project_id: str,
        episode_id: str,
        request: ProductExportClaimRequest,
        output_root: Path,
        toolchain: MediaToolchain,
    ) -> tuple[ProductExportOperationData, bool]:
        """Persist one claim or return its old receipt without scheduling it."""
        return self._claims.claim(
            project_id, episode_id, request, output_root, toolchain,
        )

    def mark_unstarted_unknown(self, project_id: str, operation_id: str) -> None:
        """Record a claimed job that could not acquire its only worker thread."""
        self._store.mark_unknown(project_id, operation_id, "WORKER_START_FAILED")

    def execute_claimed(
        self,
        operation: ProductExportOperationData,
        request: ProductExportClaimRequest,
        output_root: Path,
        toolchain: MediaToolchain,
        *,
        execute: SingleVideoExecutor,
        stop_requested_externally: Callable[[], bool],
    ) -> ProductExportOperationData:
        """Execute only the just-claimed operation held by this sidecar worker."""
        project_id = operation.project_id
        if (
            operation.status != "CLAIMED"
            or operation.operation_id != request.operation_id
            or operation.assembly != request.assembly
        ):
            raise ProductExportCoordinatorError(
                "CLAIM_IDENTITY_CONFLICT", "Worker was given a different or old claim",
            )
        try:
            plan = self._read_single_video_plan(project_id, request.operation_id)
            if (
                plan.toolchain_profile_id != toolchain.profile_id
                or plan.ffmpeg_sha256 != toolchain.ffmpeg_sha256
                or plan.ffprobe_sha256 != toolchain.ffprobe_sha256
            ):
                raise ProductExportCoordinatorError(
                    "CLAIM_TOOLCHAIN_CONFLICT", "Claimed toolchain differs before execution",
                )
            if stop_requested_externally():
                raise ProductExportCoordinatorError(
                    "SHUTDOWN_BEFORE_START", "Sidecar stopped before the export worker started",
                )
        except BaseException:
            self._store.mark_unknown(project_id, request.operation_id, "PRE_EXECUTION_REJECTED")
            raise
        try:
            running = self._store.mark_running(project_id, request.operation_id)
        except BaseException:
            # A different actor may have taken the claim. Never change a
            # RUNNING operation that this invocation did not acquire.
            current = self._store.get(project_id, request.operation_id)
            if current.status == "CLAIMED":
                if current.cancel_requested_at is not None:
                    self._store.mark_cancelled(project_id, request.operation_id)
                else:
                    self._store.mark_unknown(project_id, request.operation_id, "START_REJECTED")
            raise

        try:
            def on_progress(frames: int) -> None:
                self._store.record_progress(project_id, request.operation_id, frames)

            def stop_requested() -> bool:
                if stop_requested_externally():
                    return True
                current = self._store.get(project_id, request.operation_id)
                return (
                    current.status != "RUNNING"
                    or current.cancel_requested_at is not None
                )

            execute(
                running, plan, request, output_root,
                on_progress=on_progress, stop_requested=stop_requested,
            )
            self._store.mark_verifying(project_id, request.operation_id)
            return self._store.finalize_output(
                project_id, request.operation_id, output_root, toolchain,
            )
        except BaseException:
            # A process may have launched, produced bytes, or exited before
            # the receipt was committed. Persist uncertainty; never rerun it.
            self._store.mark_unknown(project_id, request.operation_id, "EXECUTION_INTERRUPTED")
            raise
