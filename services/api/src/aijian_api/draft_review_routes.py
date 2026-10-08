"""Native authenticated manual-comment endpoints, separate from formal review."""

from collections.abc import Callable
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.draft_export_routes import EpisodeId, OperationId, ProjectId
from aijian_api.draft_export_runtime import DraftExportRuntime
from aijian_api.draft_review_contracts import (
    NOTE_ID_PATTERN,
    CreateDraftReviewNoteRequest,
    DraftReviewData,
    DraftReviewResponse,
    ResolveDraftReviewNoteRequest,
)
from aijian_api.draft_review_store import DraftReviewError, DraftReviewStore
from aijian_api.repository import StudioRepository

NoteId = Annotated[str, Path(pattern=NOTE_ID_PATTERN)]


def create_draft_review_router(
    repository: Callable[[], StudioRepository],
    runtime: Callable[[], DraftExportRuntime],
    actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter()
    root = (
        "/api/v1/projects/{project_id}/episodes/{episode_id}"
        "/draft-exports/{operation_id}/review-notes"
    )

    def reply(
        request: Request, action: Callable[[DraftReviewStore], DraftReviewData]
    ) -> JSONResponse:
        try:
            data = action(DraftReviewStore(repository(), runtime()))
            return JSONResponse(
                content=DraftReviewResponse(
                    data=data, request_id=cast(UUID, request.state.request_id)
                ).model_dump(mode="json")
            )
        except Exception as error:
            status = error.status if isinstance(error, DraftReviewError) else 503
            code = error.code if isinstance(error, DraftReviewError) else "DRAFT_REVIEW_UNKNOWN"
            return JSONResponse(
                status_code=status,
                content=ErrorResponse(
                    error=ErrorBody(
                        code=code,
                        message=(
                            "Manual note result is unconfirmed; reload its exact output history"
                        ),
                        details={},
                        retryable=False,
                    ),
                    request_id=cast(UUID, request.state.request_id),
                ).model_dump(mode="json"),
            )

    @router.get(root, operation_id="listDraftReviewNotes", response_model=DraftReviewResponse)
    def history(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, operation_id: OperationId
    ) -> JSONResponse:
        return reply(request, lambda store: store.list(project_id, episode_id, operation_id))

    @router.post(root, operation_id="createDraftReviewNote", response_model=DraftReviewResponse)
    def create(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: OperationId,
        payload: CreateDraftReviewNoteRequest,
    ) -> JSONResponse:
        return reply(
            request,
            lambda store: store.create(
                project_id, episode_id, operation_id, payload, actor.subject_id
            ),
        )

    @router.post(
        root + "/{note_id}/resolutions",
        operation_id="resolveDraftReviewNote",
        response_model=DraftReviewResponse,
    )
    def resolve(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: OperationId,
        note_id: NoteId,
        payload: ResolveDraftReviewNoteRequest,
    ) -> JSONResponse:
        return reply(
            request,
            lambda store: store.resolve(
                project_id, episode_id, operation_id, note_id, payload, actor.subject_id
            ),
        )

    return router
