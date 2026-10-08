"""Scoped proposal reads and trusted desktop-only persistence/adoption."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.official_text_adoption import adopt_text
from aijian_api.official_text_contracts import (
    OPERATION_PATTERN,
    AdoptOfficialTextRequest,
    CompleteOfficialTextRequest,
    OfficialTextListResponse,
    OfficialTextMutationData,
    OfficialTextMutationResponse,
    OfficialTextNotSentRequest,
    OfficialTextOperation,
    OfficialTextOperationResponse,
    ReserveOfficialTextRequest,
)
from aijian_api.official_text_store import OfficialTextError, OfficialTextStore
from aijian_api.repository import StudioRepository

Project = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
Episode = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
Operation = Annotated[str, Path(pattern=OPERATION_PATTERN)]
_ROOT = "/api/v1/projects/{project_id}/episodes/{episode_id}/official-text"


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _error(request: Request, error: OfficialTextError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content=ErrorResponse(
            error=ErrorBody(
                code=error.code,
                message="Official text operation could not be completed safely",
                details={},
                retryable=False,
            ),
            request_id=_request_id(request),
        ).model_dump(mode="json"),
    )


def create_official_text_public_router(provider: Callable[[], StudioRepository]) -> APIRouter:
    router = APIRouter()

    @router.get(
        _ROOT, operation_id="listOfficialTextOperations", response_model=OfficialTextListResponse
    )
    def list_operations(request: Request, project_id: Project, episode_id: Episode) -> Any:
        try:
            return OfficialTextListResponse(
                data=OfficialTextStore(provider()).list(project_id, episode_id),
                request_id=_request_id(request),
            )
        except OfficialTextError as error:
            return _error(request, error)

    @router.get(
        _ROOT + "/{operation_id}",
        operation_id="getOfficialTextOperation",
        response_model=OfficialTextOperationResponse,
    )
    def get_operation(
        request: Request, project_id: Project, episode_id: Episode, operation_id: Operation
    ) -> Any:
        try:
            return OfficialTextOperationResponse(
                data=OfficialTextStore(provider()).get(project_id, episode_id, operation_id),
                request_id=_request_id(request),
            )
        except OfficialTextError as error:
            return _error(request, error)

    return router


def create_official_text_write_router(
    provider: Callable[[], StudioRepository], actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter()

    def mutation(request: Request, action: Callable[[], tuple[OfficialTextOperation, bool]]) -> Any:
        try:
            operation, replayed = action()
            return OfficialTextMutationResponse(
                data=OfficialTextMutationData(operation=operation, replayed=replayed),
                request_id=_request_id(request),
            )
        except OfficialTextError as error:
            return _error(request, error)

    @router.post(
        _ROOT,
        operation_id="reserveOfficialTextOperation",
        response_model=OfficialTextMutationResponse,
    )
    def reserve(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        payload: ReserveOfficialTextRequest,
    ) -> Any:
        return mutation(
            request, lambda: OfficialTextStore(provider()).reserve(project_id, episode_id, payload)
        )

    @router.post(
        _ROOT + "/{operation_id}/completion",
        operation_id="completeOfficialTextOperation",
        response_model=OfficialTextMutationResponse,
    )
    def complete(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        operation_id: Operation,
        payload: CompleteOfficialTextRequest,
    ) -> Any:
        if payload.operation_id != operation_id:
            return _error(request, OfficialTextError("OFFICIAL_TEXT_OPERATION_CONFLICT", 422))
        return mutation(
            request, lambda: OfficialTextStore(provider()).complete(project_id, episode_id, payload)
        )

    @router.post(
        _ROOT + "/{operation_id}/not-sent",
        operation_id="recordOfficialTextNotSent",
        response_model=OfficialTextMutationResponse,
    )
    def not_sent(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        operation_id: Operation,
        payload: OfficialTextNotSentRequest,
    ) -> Any:
        return mutation(
            request,
            lambda: OfficialTextStore(provider()).not_sent(
                project_id, episode_id, operation_id, payload.code
            ),
        )

    @router.post(
        _ROOT + "/{operation_id}/adoption",
        operation_id="adoptOfficialTextProposal",
        response_model=OfficialTextMutationResponse,
    )
    def adopt(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        operation_id: Operation,
        payload: AdoptOfficialTextRequest,
    ) -> Any:
        return mutation(
            request,
            lambda: adopt_text(
                OfficialTextStore(provider()),
                project_id,
                episode_id,
                operation_id,
                payload,
                actor.subject_id,
            ),
        )

    return router
