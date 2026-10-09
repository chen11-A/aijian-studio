"""Read and explicitly create human EpisodeScript version confirmations."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status
from fastapi.responses import JSONResponse

from aijian_api.application_errors import PreconditionRequiredError
from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_confirmation_contracts import (
    CONFIRMATION_ID_PATTERN,
    CreateEpisodeScriptConfirmationRequest,
    EpisodeScriptConfirmationCreatedData,
    EpisodeScriptConfirmationCreatedResponse,
    EpisodeScriptConfirmationStatusResponse,
)
from aijian_api.episode_script_confirmation_store import (
    EpisodeScriptConfirmationConflictError,
    EpisodeScriptConfirmationInputError,
    EpisodeScriptConfirmationNotFoundError,
    EpisodeScriptConfirmationStorageError,
    EpisodeScriptConfirmationStore,
)
from aijian_api.episode_script_store import EpisodeScriptStorageError
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
EpisodeId = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
ConfirmationId = Annotated[str, Path(pattern=CONFIRMATION_ID_PATTERN)]

_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Local request boundary rejected", "model": ErrorResponse},
    404: {"description": "Script or confirmation not found", "model": ErrorResponse},
    409: {"description": "Script head or idempotency conflict", "model": ErrorResponse},
    422: {"description": "Invalid confirmation input", "model": ErrorResponse},
    428: {"description": "Idempotency-Key required", "model": ErrorResponse},
    500: {"description": "Confirmation storage failed safely", "model": ErrorResponse},
}


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _error(request: Request, *, status_code: int, code: str, message: str) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=_request_id(request),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def create_episode_script_confirmation_public_router(
    repository_provider: RepositoryProvider,
) -> APIRouter:
    router = APIRouter()

    def read(
        request: Request,
        response: Response,
        project_id: str,
        episode_id: str,
        confirmation_id: str | None,
    ) -> Any:
        try:
            data = EpisodeScriptConfirmationStore(repository_provider()).get_status(
                project_id=project_id,
                episode_id=episode_id,
                confirmation_id=confirmation_id,
            )
        except EpisodeScriptConfirmationNotFoundError:
            return _error(
                request,
                status_code=404,
                code="SCRIPT_CONFIRMATION_NOT_FOUND",
                message="Script or confirmation was not found",
            )
        except (EpisodeScriptConfirmationStorageError, EpisodeScriptStorageError):
            return _error(
                request,
                status_code=500,
                code="SCRIPT_CONFIRMATION_STORAGE_FAILED",
                message="Confirmation read failed safely",
            )
        response.headers["ETag"] = f'"revision-{data.latest_head_revision}"'
        return EpisodeScriptConfirmationStatusResponse(data=data, request_id=_request_id(request))

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/script/confirmation",
        operation_id="getEpisodeScriptConfirmation",
        response_model=EpisodeScriptConfirmationStatusResponse,
        responses=_ERRORS,
    )
    def get_current(
        request: Request, response: Response, project_id: ProjectId, episode_id: EpisodeId
    ) -> Any:
        return read(request, response, project_id, episode_id, None)

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/script/confirmations/{confirmation_id}",
        operation_id="getEpisodeScriptConfirmationById",
        response_model=EpisodeScriptConfirmationStatusResponse,
        responses=_ERRORS,
    )
    def get_exact(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        confirmation_id: ConfirmationId,
    ) -> Any:
        return read(request, response, project_id, episode_id, confirmation_id)

    return router


def create_episode_script_confirmation_write_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.post(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/script/confirmations",
        operation_id="createEpisodeScriptConfirmation",
        response_model=EpisodeScriptConfirmationCreatedResponse,
        status_code=status.HTTP_201_CREATED,
        responses=_ERRORS,
    )
    def confirm(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateEpisodeScriptConfirmationRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> Any:
        if idempotency_key is None or not idempotency_key.strip():
            raise PreconditionRequiredError("Idempotency-Key is required")
        try:
            result, replayed = EpisodeScriptConfirmationStore(repository_provider()).confirm(
                project_id=project_id,
                episode_id=episode_id,
                payload=payload,
                idempotency_key=idempotency_key,
                actor_id=trusted_actor.subject_id,
            )
        except EpisodeScriptConfirmationNotFoundError:
            return _error(
                request,
                status_code=404,
                code="SCRIPT_NOT_FOUND",
                message="Script draft was not found",
            )
        except EpisodeScriptConfirmationConflictError:
            return _error(
                request,
                status_code=409,
                code="SCRIPT_CONFIRMATION_CONFLICT",
                message="Script version or confirmation key conflicts",
            )
        except EpisodeScriptConfirmationInputError:
            return _error(
                request,
                status_code=422,
                code="SCRIPT_CONFIRMATION_INPUT_REJECTED",
                message="Script is not ready for explicit confirmation",
            )
        except (EpisodeScriptConfirmationStorageError, EpisodeScriptStorageError):
            return _error(
                request,
                status_code=500,
                code="SCRIPT_CONFIRMATION_STORAGE_FAILED",
                message="Confirmation write failed safely",
            )
        response.headers["ETag"] = f'"revision-{result.latest_head_revision}"'
        return EpisodeScriptConfirmationCreatedResponse(
            data=EpisodeScriptConfirmationCreatedData(status=result, replayed=replayed),
            request_id=_request_id(request),
        )

    return router
