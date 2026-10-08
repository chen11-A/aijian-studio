"""Concrete managed single-video executor for the schema 28 export operation.

The public service delegates idempotency and state transitions to the durable
coordinator. New claims remain closed while no release toolchain is approved.
This module does not register a route or start a worker on its own.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest, ProductExportOperationData,
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
        self, repository: StudioRepository, toolchain: MediaToolchain,
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
            os.name != "nt" or operation.status != "RUNNING"
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
                "EXECUTION_IDENTITY_CONFLICT", "Running claim differs from its single-video plan",
            )
        selected = request.media_rights[0].media
        if (
            selected.asset_id != plan.source_asset_id
            or selected.asset_version_id != plan.source_version_id
            or selected.sha256 != plan.source_sha256
        ):
            raise ProductExportExecutionError(
                "SOURCE_IDENTITY_CONFLICT", "Claimed source differs from the render plan",
            )
        # Re-run the same root policy used by the claim. The filename is one
        # validated component, so both output paths stay in this directory.
        output_target_identity(output_root, request)
        workspace = self._repository.database_path.parent
        source = (
            workspace / "media-assets" / "blobs"
            / plan.source_sha256[:2] / plan.source_sha256
        )
        temporary = output_root / f".{operation.project_id}.{operation.operation_id}.partial.mp4"
        target = output_root / request.output_relative_path
        if (
            temporary.exists() or temporary.is_symlink()
            or target.exists() or target.is_symlink()
        ):
            raise ProductExportExecutionError(
                "OUTPUT_PATH_CONFLICT", "Export output or its operation temporary path already exists",
            )
        if stop_requested():
            raise ProductExportExecutionError("CANCEL_REQUESTED", "Export was cancelled before encoding")
        run_local_encoder(
            plan, source, temporary, self._toolchain,
            job_manager=self._job_manager,
            on_progress=on_progress,
            stop_requested=stop_requested,
        )
        if stop_requested():
            raise ProductExportExecutionError("CANCEL_REQUESTED", "Export was cancelled after encoding")
        # Windows os.rename refuses an existing destination. Both paths stay
        # in one managed directory; a crash before the DB receipt remains
        # UNKNOWN and must be reconciled without another encode.
        os.rename(temporary, target)


class ProductExportSingleVideoService:
    """Product-callable entrypoint using one sidecar-owned job manager."""

    def __init__(
        self, repository: StudioRepository, toolchain: MediaToolchain,
        output_root: Path, job_manager: ProductExportJobManager,
    ) -> None:
        self._coordinator = ProductExportOperationCoordinator(repository)
        self._toolchain = toolchain
        self._output_root = output_root
        self._executor = _SingleVideoExecutor(repository, toolchain, job_manager)

    def submit(
        self, project_id: str, episode_id: str, request: ProductExportClaimRequest,
    ) -> ProductExportOperationData:
        return self._coordinator.submit_and_execute(
            project_id, episode_id, request, self._output_root, self._toolchain,
            execute=self._executor,
        )

    def get(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        return self._coordinator.get(project_id, operation_id)

    def request_cancel(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        return self._coordinator.request_cancel(project_id, operation_id)
