"""Authenticated read-only lookup for a durable Fake Timeline operation."""

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request

from aijian_api.contracts import (
    PROJECT_ID_PATTERN,
    ErrorResponse,
    FakeTimelineRunOperationData,
    FakeTimelineRunOperationResponse,
)
from aijian_api.fake_timeline_run_query import FakeTimelineRunOperationReader

type ReaderProvider = Callable[[], FakeTimelineRunOperationReader]

OPERATION_ID_PATTERN = (
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def create_fake_timeline_run_query_router(reader_provider: ReaderProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        404: {
            "description": "Project or Fake Timeline operation not found",
            "model": ErrorResponse,
        },
        409: {
            "description": "Fake Timeline operation truth is inconsistent",
            "model": ErrorResponse,
        },
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/fake-timeline-runs/operations/{operation_id}",
        operation_id="getFakeTimelineRunOperation",
        response_model=FakeTimelineRunOperationResponse,
        responses=errors,
    )
    def get_fake_timeline_run_operation(
        request: Request,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
        operation_id: str = Path(pattern=OPERATION_ID_PATTERN),
    ) -> FakeTimelineRunOperationResponse:
        operation = reader_provider().get(project_id, operation_id)
        return FakeTimelineRunOperationResponse(
            data=FakeTimelineRunOperationData(
                project_id=operation.project_id,
                operation_id=operation.operation_id,
                source_manifest_version_id=operation.source_manifest_version_id,
                source_document_id=operation.source_document_id,
                workflow_run_id=operation.workflow_run_id,
                node_run_id=operation.node_run_id,
                attempt_id=operation.attempt_id,
                task_id=operation.task_id,
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    return router
