"""Authenticated command surface for recoverable Fake Timeline runs."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response

from aijian_api.contracts import (
    CreateFakeTimelineRunRequest,
    ErrorResponse,
    FakeTimelineRunData,
    FakeTimelineRunResponse,
)
from aijian_api.fake_timeline_run import FakeTimelineRunFactory

FactoryProvider = Callable[[], FakeTimelineRunFactory]
_KEY_PATTERN = (
    r"^fake-timeline-run:create:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def create_fake_timeline_run_write_router(provider: FactoryProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project, source, or manifest not found", "model": ErrorResponse},
        409: {"description": "Run input or idempotency conflict", "model": ErrorResponse},
        503: {"description": "Development media runtime unavailable", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.post(
        "/api/v1/projects/{project_id}/fake-timeline-runs",
        operation_id="createFakeTimelineRun",
        response_model=FakeTimelineRunResponse,
        status_code=201,
        responses={200: {"model": FakeTimelineRunResponse}, **errors},
    )
    def create_run(
        request: Request,
        response: Response,
        project_id: str,
        payload: CreateFakeTimelineRunRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=240, pattern=_KEY_PATTERN),
        ],
    ) -> FakeTimelineRunResponse:
        receipt = provider().create(
            project_id=project_id,
            source_manifest_version_id=payload.source_manifest_version_id,
            source_document_id=payload.source_document_id,
            idempotency_key=idempotency_key,
        )
        response.status_code = 201 if receipt.created else 200
        return FakeTimelineRunResponse(
            data=FakeTimelineRunData(
                project_id=receipt.project_id,
                source_manifest_version_id=receipt.source_manifest_version_id,
                source_document_id=receipt.source_document_id,
                workflow_run_id=receipt.workflow_run_id,
                node_run_id=receipt.node_run_id,
                attempt_id=receipt.attempt_id,
                task_id=receipt.task_id,
                attempt_status=receipt.attempt_status,  # type: ignore[arg-type]
                task_status=receipt.task_status,  # type: ignore[arg-type]
                capability_losses=(
                    "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
                    "STATIC_FRAME_NO_MOTION_GENERATION",
                    "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
                ),
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    return router
