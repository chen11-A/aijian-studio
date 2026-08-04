"""Public, project-scoped task queue reads."""

from collections.abc import Callable
from typing import cast
from uuid import UUID

from fastapi import APIRouter, Request

from aijian_api.contracts import (
    ErrorResponse,
    TaskAttemptData,
    TaskCostData,
    TaskLedgerData,
    TaskNodeData,
    TaskPresentationData,
    TaskQueueData,
    TaskQueueItemData,
    TaskQueueResponse,
    TaskQueueSummaryData,
)
from aijian_api.task_queue_presentation import task_presentation
from aijian_api.task_queue_read import TaskQueueReader, TaskQueueRecord

type TaskQueueReaderProvider = Callable[[], TaskQueueReader]


def create_task_queue_router(reader_provider: TaskQueueReaderProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/tasks",
        operation_id="listProjectTasks",
        response_model=TaskQueueResponse,
        responses={
            401: {"description": "Sidecar authentication required", "model": ErrorResponse},
            403: {"description": "Local request boundary rejected", "model": ErrorResponse},
            404: {"description": "Project not found", "model": ErrorResponse},
            422: {"description": "Request validation failed", "model": ErrorResponse},
        },
    )
    def list_project_tasks(request: Request, project_id: str) -> TaskQueueResponse:
        records = reader_provider().list_project_tasks(project_id)
        items = [_item(record) for record in records]
        return TaskQueueResponse(
            data=TaskQueueData(
                project_id=project_id,
                summary=TaskQueueSummaryData(
                    total=len(records),
                    attention=sum(record.is_attention for record in records),
                    active=sum(record.is_active for record in records),
                    completed=sum(record.is_completed for record in records),
                ),
                tasks=items,
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    return router


def _item(record: TaskQueueRecord) -> TaskQueueItemData:
    status_label, next_action = task_presentation(record)
    return TaskQueueItemData(
        node=TaskNodeData(
            workflow_run_id=record.workflow_run_id,
            node_run_id=record.node_run_id,
            node_key=record.node_key,
            node_type=record.node_type,
            status=record.node_status,  # type: ignore[arg-type]
            responsible_role=record.responsible_role,
            upstream_gate=record.upstream_gate,
            input_hash=record.input_hash,
            input_version_ids=list(record.input_version_ids),
            output_version_id=record.node_output_version_id,
            attempt_count=record.attempt_count,
            max_attempts=record.max_attempts,
            updated_at=record.node_updated_at,
        ),
        attempt=TaskAttemptData(
            attempt_id=record.attempt_id,
            number=record.attempt_number,
            execution_mode=record.execution_mode,  # type: ignore[arg-type]
            status=record.attempt_status,  # type: ignore[arg-type]
            provider_model=record.provider_model,
            provider_job_id=record.provider_job_id,
            retry_disposition=record.retry_disposition,  # type: ignore[arg-type]
            error_code=record.error_code,
            output_version_id=record.attempt_output_version_id,
            started_at=record.started_at,
            finished_at=record.finished_at,
            updated_at=record.attempt_updated_at,
        ),
        task=TaskLedgerData(
            task_id=record.task_id,
            kind=record.task_kind,
            status=record.task_status,  # type: ignore[arg-type]
            priority=record.priority,
            available_at=record.available_at,
            lease_generation=record.lease_generation,
            lease_expires_at=record.lease_expires_at,
            heartbeat_at=record.heartbeat_at,
            updated_at=record.task_updated_at,
        ),
        cost=TaskCostData(),
        presentation=TaskPresentationData(
            status_label=status_label,
            next_action_label=next_action,
            allowed_actions=["VIEW_DETAILS"],
        ),
    )
