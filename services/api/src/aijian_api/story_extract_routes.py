"""Minimal typed API for starting and inspecting story.extract tasks."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request, status

from aijian_api.contracts import (
    NODE_RUN_ID_PATTERN,
    ErrorResponse,
    StartStoryExtractRequest,
    StoryExtractTaskData,
    StoryExtractTaskResponse,
)
from aijian_api.story_extract import StoryExtractService, StoryExtractTask

type StoryExtractServiceProvider = Callable[[], StoryExtractService]


_SHARED_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    422: {"description": "Request validation failed", "model": ErrorResponse},
}


def create_story_extract_router(service_provider: StoryExtractServiceProvider) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/api/v1/projects/{project_id}/story-extract",
        operation_id="startStoryExtract",
        response_model=StoryExtractTaskResponse,
        status_code=status.HTTP_202_ACCEPTED,
        responses={
            **_SHARED_ERRORS,
            404: {"description": "Project not found", "model": ErrorResponse},
            409: {
                "description": "Accepted non-stale G1 SourceManifest is required",
                "model": ErrorResponse,
            },
        },
    )
    def start_story_extract(
        request: Request,
        project_id: str,
        payload: StartStoryExtractRequest,
    ) -> StoryExtractTaskResponse:
        task = service_provider().start(
            project_id,
            source_manifest_version_id=payload.source_manifest_version_id,
        )
        return StoryExtractTaskResponse(
            data=_task_data(task),
            request_id=cast(UUID, request.state.request_id),
        )

    @router.get(
        "/api/v1/projects/{project_id}/story-extract/{node_run_id}",
        operation_id="getStoryExtractTask",
        response_model=StoryExtractTaskResponse,
        responses={
            **_SHARED_ERRORS,
            404: {"description": "Project or story.extract task not found", "model": ErrorResponse},
        },
    )
    def get_story_extract_task(
        request: Request,
        project_id: str,
        node_run_id: Annotated[str, Path(pattern=NODE_RUN_ID_PATTERN)],
    ) -> StoryExtractTaskResponse:
        task = service_provider().inspect(project_id, node_run_id)
        return StoryExtractTaskResponse(
            data=_task_data(task),
            request_id=cast(UUID, request.state.request_id),
        )

    return router


def _task_data(task: StoryExtractTask) -> StoryExtractTaskData:
    return StoryExtractTaskData.model_validate(
        {
            "project_id": task.project_id,
            "workflow_run_id": task.workflow_run_id,
            "node_run_id": task.node_run_id,
            "attempt_id": task.attempt_id,
            "task_id": task.task_id,
            "node_status": task.node_status,
            "attempt_status": task.attempt_status,
            "retry_disposition": task.retry_disposition,
            "error_code": task.error_code,
            "output_version_id": task.output_version_id,
            "source_manifest_version_id": task.source_manifest_version_id,
            "producer_attempt_id": task.producer_attempt_id,
        }
    )
