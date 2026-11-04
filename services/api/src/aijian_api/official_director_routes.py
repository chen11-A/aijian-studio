"""Scoped proposal reads and trusted desktop-only persistence/adoption."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.official_director_contracts import (
    OPERATION_PATTERN,
    AdoptOfficialDirectorRequest,
    CompleteOfficialDirectorRequest,
    OfficialDirectorListResponse,
    OfficialDirectorMutationData,
    OfficialDirectorMutationResponse,
    OfficialDirectorNotSentRequest,
    OfficialDirectorOperation,
    OfficialDirectorOperationResponse,
    OfficialDirectorPreparationData,
    OfficialDirectorPreparationResponse,
    PrepareOfficialDirectorRequest,
    RejectOfficialDirectorRequest,
    ReserveOfficialDirectorRequest,
)
from aijian_api.official_director_store import OfficialDirectorError, OfficialDirectorStore
from aijian_api.repository import StudioRepository

Project = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
Episode = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
Operation = Annotated[str, Path(pattern=OPERATION_PATTERN)]
_ROOT = "/api/v1/projects/{project_id}/episodes/{episode_id}/official-director"


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _error(request: Request, error: OfficialDirectorError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content=ErrorResponse(
            error=ErrorBody(
                code=error.code,
                message="Official director operation could not be completed safely",
                details={},
                retryable=False,
            ),
            request_id=_request_id(request),
        ).model_dump(mode="json"),
    )


def create_official_director_public_router(provider: Callable[[], StudioRepository]) -> APIRouter:
    router = APIRouter()

    @router.get(
        _ROOT,
        operation_id="listOfficialDirectorOperations",
        response_model=OfficialDirectorListResponse,
    )
    def list_operations(request: Request, project_id: Project, episode_id: Episode) -> Any:
        try:
            operations, has_more = OfficialDirectorStore(provider()).list_page(
                project_id, episode_id
            )
            return OfficialDirectorListResponse(
                data=operations,
                has_more=has_more,
                request_id=_request_id(request),
            )
        except OfficialDirectorError as error:
            return _error(request, error)

    @router.get(
        _ROOT + "/{operation_id}",
        operation_id="getOfficialDirectorOperation",
        response_model=OfficialDirectorOperationResponse,
    )
    def get_operation(
        request: Request, project_id: Project, episode_id: Episode, operation_id: Operation
    ) -> Any:
        try:
            return OfficialDirectorOperationResponse(
                data=OfficialDirectorStore(provider()).get(project_id, episode_id, operation_id),
                request_id=_request_id(request),
            )
        except OfficialDirectorError as error:
            return _error(request, error)

    return router


def create_official_director_write_router(
    provider: Callable[[], StudioRepository], actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter()

    def mutation(
        request: Request, action: Callable[[], tuple[OfficialDirectorOperation, bool]]
    ) -> Any:
        try:
            operation, replayed = action()
            return OfficialDirectorMutationResponse(
                data=OfficialDirectorMutationData(operation=operation, replayed=replayed),
                request_id=_request_id(request),
            )
        except OfficialDirectorError as error:
            return _error(request, error)

    @router.post(
        _ROOT + "/preparation",
        operation_id="prepareOfficialDirectorOperation",
        response_model=OfficialDirectorPreparationResponse,
    )
    def prepare(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        payload: PrepareOfficialDirectorRequest,
    ) -> Any:
        try:
            prepared = OfficialDirectorStore(provider()).prepare(project_id, episode_id, payload)
            return OfficialDirectorPreparationResponse(
                data=OfficialDirectorPreparationData(request=prepared),
                request_id=_request_id(request),
            )
        except OfficialDirectorError as error:
            return _error(request, error)

    @router.post(
        _ROOT,
        operation_id="reserveOfficialDirectorOperation",
        response_model=OfficialDirectorMutationResponse,
    )
    def reserve(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        payload: ReserveOfficialDirectorRequest,
    ) -> Any:
        return mutation(
            request,
            lambda: OfficialDirectorStore(provider()).reserve(project_id, episode_id, payload),
        )

    @router.post(
        _ROOT + "/{operation_id}/completion",
        operation_id="completeOfficialDirectorOperation",
        response_model=OfficialDirectorMutationResponse,
    )
    def complete(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        operation_id: Operation,
        payload: CompleteOfficialDirectorRequest,
    ) -> Any:
        if payload.operation_id != operation_id:
            return _error(
                request, OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT", 422)
            )
        return mutation(
            request,
            lambda: OfficialDirectorStore(provider()).complete(project_id, episode_id, payload),
        )

    @router.post(
        _ROOT + "/{operation_id}/not-sent",
        operation_id="recordOfficialDirectorNotSent",
        response_model=OfficialDirectorMutationResponse,
    )
    def not_sent(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        operation_id: Operation,
        payload: OfficialDirectorNotSentRequest,
    ) -> Any:
        return mutation(
            request,
            lambda: OfficialDirectorStore(provider()).not_sent(
                project_id, episode_id, operation_id, payload.code
            ),
        )

    @router.post(
        _ROOT + "/{operation_id}/adoption",
        operation_id="adoptOfficialDirectorProposal",
        response_model=OfficialDirectorMutationResponse,
    )
    def adopt(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        operation_id: Operation,
        payload: AdoptOfficialDirectorRequest,
    ) -> Any:
        return mutation(
            request,
            lambda: OfficialDirectorStore(provider()).adopt(
                project_id,
                episode_id,
                operation_id,
                payload,
                actor.subject_id,
            ),
        )

    @router.post(
        _ROOT + "/{operation_id}/rejection",
        operation_id="rejectOfficialDirectorProposal",
        response_model=OfficialDirectorMutationResponse,
    )
    def reject(
        request: Request,
        project_id: Project,
        episode_id: Episode,
        operation_id: Operation,
        payload: RejectOfficialDirectorRequest,
    ) -> Any:
        return mutation(
            request,
            lambda: OfficialDirectorStore(provider()).reject(
                project_id, episode_id, operation_id, payload, actor.subject_id
            ),
        )

    return router
