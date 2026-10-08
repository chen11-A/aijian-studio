"""Authenticated read-only readiness route for a future product MP4 export."""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Path, Request

from aijian_api.contracts import ErrorResponse
from aijian_api.product_timeline_export import ProductTimelineExportPreflightService
from aijian_api.product_timeline_export_contracts import (
    EPISODE_ID_PATTERN,
    PROJECT_ID_PATTERN,
    ProductExportPreflightRequest,
    ProductExportPreflightResponse,
)

ServiceProvider = Callable[[], ProductTimelineExportPreflightService]

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    422: {"description": "Invalid product export preflight request", "model": ErrorResponse},
}


def create_product_timeline_export_router(service_provider: ServiceProvider) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/product-exports/preflight",
        operation_id="preflightProductTimelineExport",
        response_model=ProductExportPreflightResponse,
        responses=_ERRORS,
    )
    def preflight_product_export(
        request: Request,
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
        episode_id: Annotated[str, Path(pattern=EPISODE_ID_PATTERN)],
        payload: ProductExportPreflightRequest,
    ) -> ProductExportPreflightResponse:
        return ProductExportPreflightResponse(
            data=service_provider().preflight(project_id, episode_id, payload),
            request_id=request.state.request_id,
        )

    return router
