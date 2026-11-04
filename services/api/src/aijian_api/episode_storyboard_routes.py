"""Project and Episode scoped storyboard draft write and immutable version reads."""

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
from aijian_api.episode_script_contracts import VERSION_ID_PATTERN
from aijian_api.episode_storyboard_contracts import (
    CreateEpisodeStoryboardVersionRequest,
    EpisodeStoryboardVersionCreatedData,
    EpisodeStoryboardVersionCreatedResponse,
    EpisodeStoryboardVersionResponse,
)
from aijian_api.episode_storyboard_store import (
    EpisodeStoryboardConflictError,
    EpisodeStoryboardInputError,
    EpisodeStoryboardNotFoundError,
    EpisodeStoryboardStorageError,
    EpisodeStoryboardStore,
    EpisodeStoryboardTooLargeError,
)
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
EpisodeId = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
VersionId = Annotated[str, Path(pattern=VERSION_ID_PATTERN)]


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _error(request: Request, *, code: str, message: str, status_code: int) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=_request_id(request),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Local request boundary rejected", "model": ErrorResponse},
    404: {
        "description": "Project, Episode, or storyboard version not found",
        "model": ErrorResponse,
    },
    409: {"description": "Revision or idempotency conflict", "model": ErrorResponse},
    413: {"description": "Storyboard content too large", "model": ErrorResponse},
    422: {"description": "Request or storyboard input invalid", "model": ErrorResponse},
    428: {"description": "Idempotency-Key required", "model": ErrorResponse},
    500: {"description": "Storyboard storage failed safely", "model": ErrorResponse},
}


def create_episode_storyboard_public_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    def store() -> EpisodeStoryboardStore:
        return EpisodeStoryboardStore(repository_provider())

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/storyboard",
        operation_id="getEpisodeStoryboard",
        response_model=EpisodeStoryboardVersionResponse,
        responses=_ERRORS,
    )
    def get_latest(
        request: Request, response: Response, project_id: ProjectId, episode_id: EpisodeId
    ) -> Any:
        try:
            data = store().get_latest(project_id=project_id, episode_id=episode_id)
        except EpisodeStoryboardNotFoundError:
            return _error(
                request,
                code="STORYBOARD_NOT_FOUND",
                message="Storyboard draft was not found",
                status_code=404,
            )
        except EpisodeStoryboardStorageError:
            return _error(
                request,
                code="STORYBOARD_STORAGE_FAILED",
                message="Storyboard read failed safely",
                status_code=500,
            )
        response.headers["ETag"] = f'"revision-{data.head_revision}"'
        return EpisodeStoryboardVersionResponse(data=data, request_id=_request_id(request))

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/storyboard/versions/{version_id}",
        operation_id="getEpisodeStoryboardVersion",
        response_model=EpisodeStoryboardVersionResponse,
        responses=_ERRORS,
    )
    def get_version(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
    ) -> Any:
        try:
            data = store().get_version(
                project_id=project_id, episode_id=episode_id, version_id=version_id
            )
        except EpisodeStoryboardNotFoundError:
            return _error(
                request,
                code="STORYBOARD_NOT_FOUND",
                message="Storyboard version was not found",
                status_code=404,
            )
        except EpisodeStoryboardStorageError:
            return _error(
                request,
                code="STORYBOARD_STORAGE_FAILED",
                message="Storyboard read failed safely",
                status_code=500,
            )
        response.headers["ETag"] = f'"{data.content_hash}"'
        return EpisodeStoryboardVersionResponse(data=data, request_id=_request_id(request))

    return router


def create_episode_storyboard_write_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter()

    def store() -> EpisodeStoryboardStore:
        return EpisodeStoryboardStore(repository_provider())

    @router.post(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/storyboard/versions",
        operation_id="createEpisodeStoryboardVersion",
        response_model=EpisodeStoryboardVersionCreatedResponse,
        status_code=status.HTTP_201_CREATED,
        responses=_ERRORS,
    )
    def create_version(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateEpisodeStoryboardVersionRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> Any:
        if idempotency_key is None or not idempotency_key.strip():
            raise PreconditionRequiredError("Idempotency-Key is required")
        try:
            data, replayed = store().write(
                project_id=project_id,
                episode_id=episode_id,
                payload=payload,
                idempotency_key=idempotency_key,
                actor_id=trusted_actor.subject_id,
            )
        except EpisodeStoryboardTooLargeError:
            return _error(
                request,
                code="STORYBOARD_TOO_LARGE",
                message="Storyboard draft is too large",
                status_code=413,
            )
        except EpisodeStoryboardInputError:
            return _error(
                request,
                code="STORYBOARD_INPUT_REJECTED",
                message="Storyboard draft input is invalid",
                status_code=422,
            )
        except EpisodeStoryboardConflictError:
            return _error(
                request,
                code="STORYBOARD_CONFLICT",
                message="Storyboard revision or request key conflicts",
                status_code=409,
            )
        except EpisodeStoryboardStorageError:
            return _error(
                request,
                code="STORYBOARD_STORAGE_FAILED",
                message="Storyboard write failed safely",
                status_code=500,
            )
        response.headers["ETag"] = f'"revision-{data.head_revision}"'
        return EpisodeStoryboardVersionCreatedResponse(
            data=EpisodeStoryboardVersionCreatedData(version=data, replayed=replayed),
            request_id=_request_id(request),
        )

    return router
