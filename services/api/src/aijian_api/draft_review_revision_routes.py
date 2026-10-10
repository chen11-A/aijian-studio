"""Authenticated, bounded manual revision evidence endpoints."""

from collections.abc import Callable
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.draft_export_routes import EpisodeId, OperationId, ProjectId
from aijian_api.draft_export_runtime import DraftExportRuntime
from aijian_api.draft_review_revision_contracts import (
    CANDIDATE_ID_PATTERN,
    PLAN_ID_PATTERN,
    ApproveDraftReviewRevisionPlanRequest,
    AttachDraftReviewRevisionCandidateRequest,
    CreateDraftReviewRevisionPlanRequest,
    DraftReviewRevisionData,
    DraftReviewRevisionResponse,
    DraftReviewRevisionScopeData,
    DraftReviewRevisionScopeResponse,
    RecheckDraftReviewRevisionCandidateRequest,
)
from aijian_api.draft_review_revision_store import DraftReviewRevisionStore
from aijian_api.draft_review_store import DraftReviewError
from aijian_api.repository import StudioRepository

PlanId = Annotated[str, Path(pattern=PLAN_ID_PATTERN)]
CandidateId = Annotated[str, Path(pattern=CANDIDATE_ID_PATTERN)]


def create_draft_review_revision_router(
    repository: Callable[[], StudioRepository],
    runtime: Callable[[], DraftExportRuntime],
    actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter()
    root = (
        "/api/v1/projects/{project_id}/episodes/{episode_id}"
        "/draft-exports/{operation_id}/revision-plans"
    )

    def reply(
        request: Request,
        action: Callable[
            [DraftReviewRevisionStore], DraftReviewRevisionData | DraftReviewRevisionScopeData
        ],
    ) -> JSONResponse:
        try:
            data = action(DraftReviewRevisionStore(repository(), runtime()))
            request_id = cast(UUID, request.state.request_id)
            if isinstance(data, DraftReviewRevisionScopeData):
                response = DraftReviewRevisionScopeResponse(
                    data=data, request_id=request_id
                ).model_dump(mode="json")
            else:
                response = DraftReviewRevisionResponse(data=data, request_id=request_id).model_dump(
                    mode="json"
                )
            return JSONResponse(content=response)
        except Exception as error:
            return JSONResponse(
                status_code=error.status if isinstance(error, DraftReviewError) else 503,
                content=ErrorResponse(
                    error=ErrorBody(
                        code=error.code
                        if isinstance(error, DraftReviewError)
                        else "DRAFT_REVISION_UNKNOWN",
                        message=(
                            "Manual revision result is unconfirmed; "
                            "read back the exact original output history"
                        ),
                        details={},
                        retryable=False,
                    ),
                    request_id=cast(UUID, request.state.request_id),
                ).model_dump(mode="json"),
            )

    @router.get(
        root,
        operation_id="listDraftReviewRevisionPlans",
        response_model=DraftReviewRevisionResponse,
    )
    def history(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, operation_id: OperationId
    ) -> JSONResponse:
        return reply(request, lambda store: store.list(project_id, episode_id, operation_id))

    @router.get(
        root + "/scope",
        operation_id="getDraftReviewRevisionScope",
        response_model=DraftReviewRevisionScopeResponse,
    )
    def scope(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, operation_id: OperationId
    ) -> JSONResponse:
        return reply(request, lambda store: store.scope(project_id, episode_id, operation_id))

    @router.post(
        root,
        operation_id="createDraftReviewRevisionPlan",
        response_model=DraftReviewRevisionResponse,
    )
    def create(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: OperationId,
        payload: CreateDraftReviewRevisionPlanRequest,
    ) -> JSONResponse:
        return reply(
            request,
            lambda store: store.create(
                project_id, episode_id, operation_id, payload, actor.subject_id
            ),
        )

    @router.post(
        root + "/{plan_id}/approvals",
        operation_id="approveDraftReviewRevisionPlan",
        response_model=DraftReviewRevisionResponse,
    )
    def approve(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: OperationId,
        plan_id: PlanId,
        payload: ApproveDraftReviewRevisionPlanRequest,
    ) -> JSONResponse:
        return reply(
            request,
            lambda store: store.approve(
                project_id, episode_id, operation_id, plan_id, payload, actor.subject_id
            ),
        )

    @router.post(
        root + "/{plan_id}/candidates",
        operation_id="attachDraftReviewRevisionCandidate",
        response_model=DraftReviewRevisionResponse,
    )
    def attach(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: OperationId,
        plan_id: PlanId,
        payload: AttachDraftReviewRevisionCandidateRequest,
    ) -> JSONResponse:
        return reply(
            request,
            lambda store: store.attach(
                project_id, episode_id, operation_id, plan_id, payload, actor.subject_id
            ),
        )

    @router.post(
        root + "/{plan_id}/candidates/{candidate_id}/rechecks",
        operation_id="recheckDraftReviewRevisionCandidate",
        response_model=DraftReviewRevisionResponse,
    )
    def recheck(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: OperationId,
        plan_id: PlanId,
        candidate_id: CandidateId,
        payload: RecheckDraftReviewRevisionCandidateRequest,
    ) -> JSONResponse:
        return reply(
            request,
            lambda store: store.recheck(
                project_id,
                episode_id,
                operation_id,
                plan_id,
                candidate_id,
                payload,
                actor.subject_id,
            ),
        )

    return router
