"""One sidecar-owned product export service and its managed process lifetime."""

from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path

from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest,
    ProductExportOperationData,
)
from aijian_api.product_export_operation_coordinator import ProductExportOperationCoordinator
from aijian_api.product_export_single_video_service import (
    ProductExportExecutionError,
    ProductExportSingleVideoService,
)
from aijian_api.product_export_windows_job import ProductExportJobManager
from aijian_api.repository import StudioRepository


class ProductExportRuntime:
    """Defer tool discovery while preserving one job manager for this sidecar."""

    def __init__(
        self,
        repository: StudioRepository,
        job_manager: ProductExportJobManager,
        output_root: Path,
        toolchain_provider: Callable[[], MediaToolchain],
    ) -> None:
        self._repository = repository
        self._job_manager = job_manager
        self._output_root = output_root
        self._toolchain_provider = toolchain_provider
        self._reader = ProductExportOperationCoordinator(repository)
        self._guard = threading.Lock()
        self._service: ProductExportSingleVideoService | None = None
        self._closing = False

    def submit(
        self, project_id: str, episode_id: str, request: ProductExportClaimRequest,
    ) -> ProductExportOperationData:
        with self._guard:
            if self._closing:
                raise ProductExportExecutionError(
                    "SHUTTING_DOWN", "Product export service is no longer accepting work",
                )
            existing = self._reader.replay_existing(project_id, episode_id, request)
            if existing is not None:
                return existing
            if self._service is None:
                self._service = ProductExportSingleVideoService(
                    self._repository,
                    self._toolchain_provider(),
                    self._output_root,
                    self._job_manager,
                )
            service = self._service
        return service.submit(project_id, episode_id, request)

    def get(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        with self._guard:
            if self._closing:
                raise ProductExportExecutionError(
                    "SHUTTING_DOWN", "Product export service is no longer accepting work",
                )
            return self._reader.get(project_id, operation_id)

    def request_cancel(self, project_id: str, operation_id: str) -> ProductExportOperationData:
        with self._guard:
            if self._closing:
                raise ProductExportExecutionError(
                    "SHUTTING_DOWN", "Product export service is no longer accepting work",
                )
            return self._reader.request_cancel(project_id, operation_id)

    def stop_accepting(self) -> None:
        with self._guard:
            self._closing = True
            service = self._service
        if service is not None:
            service.stop_accepting()

    def join_workers(self, timeout_seconds: float = 10.0) -> None:
        with self._guard:
            service = self._service
        if service is not None:
            service.join_workers(timeout_seconds=timeout_seconds)
