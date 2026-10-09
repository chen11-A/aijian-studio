"""Concrete managed single-video executor for the schema 28 export operation.

The public service delegates idempotency and state transitions to the durable
coordinator. New claims remain closed while no release toolchain is approved.
This module does not register a route or start a worker on its own.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path

from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest,
    ProductExportOperationData,
)
from aijian_api.product_export_encoder import run_local_encoder
from aijian_api.product_export_operation_coordinator import ProductExportOperationCoordinator
from aijian_api.product_export_output_verify import output_target_identity
from aijian_api.product_export_render_plan import ProductExportRenderPlan
from aijian_api.product_export_windows_job import ProductExportJobManager
from aijian_api.repository import StudioRepository


class ProductExportExecutionError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class _SingleVideoExecutor:
    def __init__(
        self,
        repository: StudioRepository,
        toolchain: MediaToolchain,
        job_manager: ProductExportJobManager,
    ) -> None:
        self._repository = repository
        self._toolchain = toolchain
        self._job_manager = job_manager

    def __call__(
        self,
        operation: ProductExportOperationData,
        plan: ProductExportRenderPlan,
        request: ProductExportClaimRequest,
        output_root: Path,
        *,
        on_progress: Callable[[int], None],
        stop_requested: Callable[[], bool],
    ) -> None:
        if (
            os.name != "nt"
            or operation.status != "RUNNING"
            or operation.operation_id != request.operation_id
            or operation.assembly != request.assembly
            or plan.mode != "SINGLE_VERIFIED_VIDEO"
            or plan.assembly_content_hash != operation.assembly.content_hash
            or plan.total_frames != operation.total_frames
            or plan.spec != request.spec
            or plan.ffmpeg_sha256 != self._toolchain.ffmpeg_sha256
            or plan.ffprobe_sha256 != self._toolchain.ffprobe_sha256
            or plan.toolchain_profile_id != self._toolchain.profile_id
            or len(request.media_rights) != 1
        ):
            raise ProductExportExecutionError(
                "EXECUTION_IDENTITY_CONFLICT",
                "Running claim differs from its single-video plan",
            )
        selected = request.media_rights[0].media
        if (
            selected.asset_id != plan.source_asset_id
            or selected.asset_version_id != plan.source_version_id
            or selected.sha256 != plan.source_sha256
        ):
            raise ProductExportExecutionError(
                "SOURCE_IDENTITY_CONFLICT",
                "Claimed source differs from the render plan",
            )
        # Re-run the same root policy used by the claim. The filename is one
        # validated component, so both output paths stay in this directory.
        output_target_identity(output_root, request)
        workspace = self._repository.database_path.parent
        source = workspace / "media-assets" / "blobs" / plan.source_sha256[:2] / plan.source_sha256
        temporary = output_root / f".{operation.project_id}.{operation.operation_id}.partial.mp4"
        target = output_root / request.output_relative_path
        try:
            temporary_io = managed_local_io_path(output_root, temporary)
            target_io = managed_local_io_path(output_root, target)
        except (OSError, ValueError):
            raise ProductExportExecutionError(
                "OUTPUT_PATH_UNSAFE",
                "Export output path is not a plain managed path",
            ) from None
        if (
            temporary_io.exists()
            or temporary_io.is_symlink()
            or target_io.exists()
            or target_io.is_symlink()
        ):
            raise ProductExportExecutionError(
                "OUTPUT_PATH_CONFLICT",
                "Export output or its operation temporary path already exists",
            )
        if stop_requested():
            raise ProductExportExecutionError(
                "CANCEL_REQUESTED", "Export was cancelled before encoding"
            )
        run_local_encoder(
            plan,
            source,
            temporary,
            self._toolchain,
            job_manager=self._job_manager,
            on_progress=on_progress,
            stop_requested=stop_requested,
        )
        if stop_requested():
            raise ProductExportExecutionError(
                "CANCEL_REQUESTED", "Export was cancelled after encoding"
            )
        # Windows os.rename refuses an existing destination. Both paths stay
        # in one managed directory; a crash before the DB receipt remains
        # UNKNOWN and must be reconciled without another encode.
        os.rename(temporary_io, target_io)


class ProductExportSingleVideoService:
    """Product-callable entrypoint using one sidecar-owned job manager."""

    def __init__(
        self,
        repository: StudioRepository,
        toolchain: MediaToolchain,
        output_root: Path,
        job_manager: ProductExportJobManager,
    ) -> None:
        self._coordinator = ProductExportOperationCoordinator(repository)
        self._toolchain = toolchain
        self._output_root = output_root
        self._executor = _SingleVideoExecutor(repository, toolchain, job_manager)
        self._lock = threading.RLock()
        self._stop_requested = threading.Event()
        self._accepting = True
        self._workers: dict[tuple[str, str], threading.Thread] = {}
        self._unresolved_failures: dict[tuple[str, str], BaseException] = {}

    def _run_claimed(
        self,
        operation: ProductExportOperationData,
        request: ProductExportClaimRequest,
    ) -> None:
        key = (operation.project_id, operation.operation_id)
        try:
            self._coordinator.execute_claimed(
                operation,
                request,
                self._output_root,
                self._toolchain,
                execute=self._executor,
                stop_requested_externally=self._stop_requested.is_set,
            )
        except BaseException as error:
            # The coordinator records UNKNOWN for an acquired claim. Preserve
            # the raw failure in sidecar logs; never schedule another attempt.
            logging.getLogger(__name__).exception(
                "Product export worker stopped without a success receipt: %s",
                key,
            )
            unresolved: BaseException | None
            try:
                current = self._coordinator.get(*key)
            except BaseException as readback_error:
                unresolved = readback_error
            else:
                unresolved = error if current.status in {"CLAIMED", "RUNNING"} else None
            if unresolved is not None:
                with self._lock:
                    self._unresolved_failures[key] = unresolved

    def submit(
        self,
        project_id: str,
        episode_id: str,
        request: ProductExportClaimRequest,
    ) -> ProductExportOperationData:
        """Return a durable queued or old receipt; only a new claim gets a worker."""
        with self._lock:
            self._workers = {
                key: worker for key, worker in self._workers.items() if worker.is_alive()
            }
            if not self._accepting:
                raise ProductExportExecutionError(
                    "SHUTTING_DOWN",
                    "Product export service is no longer accepting work",
                )
            operation, existed = self._coordinator.claim_only(
                project_id,
                episode_id,
                request,
                self._output_root,
                self._toolchain,
            )
            if existed:
                return operation
            key = (project_id, request.operation_id)
            worker = threading.Thread(
                target=self._run_claimed,
                args=(operation, request),
                name=f"product-export-{request.operation_id}",
                daemon=False,
            )
            self._workers[key] = worker
            try:
                worker.start()
            except BaseException:
                self._workers.pop(key, None)
                try:
                    self._coordinator.mark_unstarted_unknown(project_id, request.operation_id)
                except BaseException as receipt_error:
                    self._unresolved_failures[key] = receipt_error
                    raise ProductExportExecutionError(
                        "WORKER_START_UNKNOWN",
                        "Export worker did not start and its claim is unresolved",
                    ) from receipt_error
                raise
            return operation

    def stop_accepting(self) -> None:
        """Close submissions and signal every live encoder to stop."""
        with self._lock:
            self._accepting = False
            self._stop_requested.set()

    def join_workers(self, timeout_seconds: float = 10.0) -> None:
        """Wait after JobManager shutdown; retain UNKNOWN if a worker cannot stop."""
        if (
            isinstance(timeout_seconds, bool)
            or not isinstance(timeout_seconds, int | float)
            or not 0 < timeout_seconds <= 300.0
        ):
            raise ProductExportExecutionError(
                "INVALID_SHUTDOWN_TIMEOUT",
                "Product export worker timeout is invalid",
            )
        self.stop_accepting()
        deadline = time.monotonic() + timeout_seconds
        with self._lock:
            workers = tuple(self._workers.values())
        for worker in workers:
            if worker is threading.current_thread():
                raise ProductExportExecutionError(
                    "WORKER_JOIN_INVALID",
                    "Export worker cannot join itself",
                )
            worker.join(timeout=max(0.0, deadline - time.monotonic()))
        with self._lock:
            self._workers = {
                key: worker for key, worker in self._workers.items() if worker.is_alive()
            }
        if any(worker.is_alive() for worker in workers):
            raise ProductExportExecutionError(
                "WORKERS_NOT_STOPPED",
                "Product export workers did not stop cleanly",
            )
        if self._unresolved_failures:
            raise ProductExportExecutionError(
                "WORKER_RECEIPT_UNCERTAIN",
                "A stopped export worker lacks a terminal receipt",
            ) from next(iter(self._unresolved_failures.values()))

    def get(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        return self._coordinator.get(project_id, operation_id)

    def request_cancel(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        return self._coordinator.request_cancel(project_id, operation_id)
