"""Public project-scoped entry point for the deterministic preview workflow."""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Request

from aijian_api.contracts import ErrorResponse, TimelineResponse
from aijian_api.fake_timeline_workflow import start_fake_timeline_workflow
from aijian_api.repository import StudioRepository
from aijian_api.timeline_routes import timeline_response

type RepositoryProvider = Callable[[], StudioRepository]


def create_fake_timeline_workflow_router(
    repository_provider: RepositoryProvider,
) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project not found", "model": ErrorResponse},
        409: {"description": "Workflow precondition failed", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.post(
        "/api/v1/projects/{project_id}/workflows/fake-timeline",
        operation_id="startFakeTimelineWorkflow",
        response_model=TimelineResponse,
        deprecated=True,
        responses=errors,
    )
    def start(request: Request, project_id: str) -> TimelineResponse:
        record = start_fake_timeline_workflow(repository_provider(), project_id)
        return timeline_response(project_id, record, request)

    return router
