"""Authenticated routes for development-only timeline evidence exports."""

from collections.abc import Callable
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Request, Response, status

from aijian_api.contracts import ErrorResponse
from aijian_api.development_timeline_export import (
    CreateDevelopmentTimelineExportRequest,
    DevelopmentTimelineExportResponse,
    DevelopmentTimelineExportService,
)

ServiceProvider = Callable[[], DevelopmentTimelineExportService]

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    404: {"description": "Project, timeline, or export receipt not found", "model": ErrorResponse},
    409: {"description": "Timeline or export operation conflict", "model": ErrorResponse},
    422: {"description": "Development export request rejected", "model": ErrorResponse},
    503: {"description": "Development export result is unknown", "model": ErrorResponse},
}


def create_development_timeline_export_router(service_provider: ServiceProvider) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/api/v1/projects/{project_id}/development-exports",
        operation_id="createDevelopmentTimelineExport",
        response_model=DevelopmentTimelineExportResponse,
        status_code=status.HTTP_201_CREATED,
        responses=_ERRORS,
    )
    def create_export(
        request: Request,
        response: Response,
        project_id: str,
        payload: CreateDevelopmentTimelineExportRequest,
    ) -> DevelopmentTimelineExportResponse:
        data, replayed = service_provider().create(project_id, payload)
        response.status_code = status.HTTP_200_OK if replayed else status.HTTP_201_CREATED
        return DevelopmentTimelineExportResponse(
            data=data,
            request_id=request.state.request_id,
        )

    @router.get(
        "/api/v1/projects/{project_id}/development-exports/{operation_id}",
        operation_id="getDevelopmentTimelineExport",
        response_model=DevelopmentTimelineExportResponse,
        responses=_ERRORS,
    )
    def get_export(
        request: Request,
        project_id: str,
        operation_id: UUID,
    ) -> DevelopmentTimelineExportResponse:
        return DevelopmentTimelineExportResponse(
            data=service_provider().get(project_id, operation_id),
            request_id=request.state.request_id,
        )

    return router
