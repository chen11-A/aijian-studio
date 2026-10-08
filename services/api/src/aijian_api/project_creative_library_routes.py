"""Project-shared manual creative-library drafts and immutable version reads."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status
from fastapi.responses import JSONResponse

from aijian_api.application_errors import PreconditionRequiredError
from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_contracts import PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import VERSION_ID_PATTERN
from aijian_api.project_creative_library_contracts import (
    CreateProjectCreativeLibraryVersionRequest,
    ProjectCreativeLibraryVersionCreatedData,
    ProjectCreativeLibraryVersionCreatedResponse,
    ProjectCreativeLibraryVersionResponse,
)
from aijian_api.project_creative_library_store import (
    ProjectCreativeLibraryConflictError,
    ProjectCreativeLibraryInputError,
    ProjectCreativeLibraryNotFoundError,
    ProjectCreativeLibraryStorageError,
    ProjectCreativeLibraryStore,
    ProjectCreativeLibraryTooLargeError,
)
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
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
    404: {"description": "Project or creative library version not found", "model": ErrorResponse},
    409: {"description": "Revision or idempotency conflict", "model": ErrorResponse},
    413: {"description": "Creative library content too large", "model": ErrorResponse},
    422: {"description": "Request or creative library input invalid", "model": ErrorResponse},
    428: {"description": "Idempotency-Key required", "model": ErrorResponse},
    500: {"description": "Creative library storage failed safely", "model": ErrorResponse},
}


def create_project_creative_library_public_router(
    repository_provider: RepositoryProvider,
) -> APIRouter:
    router = APIRouter()

    def store() -> ProjectCreativeLibraryStore:
        return ProjectCreativeLibraryStore(repository_provider())

    @router.get(
        "/api/v1/projects/{project_id}/creative-library",
        operation_id="getProjectCreativeLibrary",
        response_model=ProjectCreativeLibraryVersionResponse,
        responses=_ERRORS,
    )
    def get_latest(request: Request, response: Response, project_id: ProjectId) -> Any:
        try:
            data = store().get_latest(project_id=project_id)
        except ProjectCreativeLibraryNotFoundError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_NOT_FOUND",
                message="Creative library draft was not found",
                status_code=404,
            )
        except ProjectCreativeLibraryStorageError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_STORAGE_FAILED",
                message="Creative library read failed safely",
                status_code=500,
            )
        response.headers["ETag"] = f'"revision-{data.head_revision}"'
        return ProjectCreativeLibraryVersionResponse(data=data, request_id=_request_id(request))

    @router.get(
        "/api/v1/projects/{project_id}/creative-library/versions/{version_id}",
        operation_id="getProjectCreativeLibraryVersion",
        response_model=ProjectCreativeLibraryVersionResponse,
        responses=_ERRORS,
    )
    def get_version(
        request: Request,
        response: Response,
        project_id: ProjectId,
        version_id: VersionId,
    ) -> Any:
        try:
            data = store().get_version(project_id=project_id, version_id=version_id)
        except ProjectCreativeLibraryNotFoundError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_NOT_FOUND",
                message="Creative library version was not found",
                status_code=404,
            )
        except ProjectCreativeLibraryStorageError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_STORAGE_FAILED",
                message="Creative library read failed safely",
                status_code=500,
            )
        response.headers["ETag"] = f'"{data.content_hash}"'
        return ProjectCreativeLibraryVersionResponse(data=data, request_id=_request_id(request))

    return router


def create_project_creative_library_write_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter()

    def store() -> ProjectCreativeLibraryStore:
        return ProjectCreativeLibraryStore(repository_provider())

    @router.post(
        "/api/v1/projects/{project_id}/creative-library/versions",
        operation_id="createProjectCreativeLibraryVersion",
        response_model=ProjectCreativeLibraryVersionCreatedResponse,
        status_code=status.HTTP_201_CREATED,
        responses=_ERRORS,
    )
    def create_version(
        request: Request,
        response: Response,
        project_id: ProjectId,
        payload: CreateProjectCreativeLibraryVersionRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> Any:
        if idempotency_key is None or not idempotency_key.strip():
            raise PreconditionRequiredError("Idempotency-Key is required")
        try:
            data, replayed = store().write(
                project_id=project_id,
                payload=payload,
                idempotency_key=idempotency_key,
                actor_id=trusted_actor.subject_id,
            )
        except ProjectCreativeLibraryTooLargeError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_TOO_LARGE",
                message="Creative library draft is too large",
                status_code=413,
            )
        except ProjectCreativeLibraryInputError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_INPUT_REJECTED",
                message="Creative library draft input is invalid",
                status_code=422,
            )
        except ProjectCreativeLibraryConflictError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_CONFLICT",
                message="Creative library revision or request key conflicts",
                status_code=409,
            )
        except ProjectCreativeLibraryStorageError:
            return _error(
                request,
                code="CREATIVE_LIBRARY_STORAGE_FAILED",
                message="Creative library write failed safely",
                status_code=500,
            )
        response.headers["ETag"] = f'"revision-{data.head_revision}"'
        return ProjectCreativeLibraryVersionCreatedResponse(
            data=ProjectCreativeLibraryVersionCreatedData(version=data, replayed=replayed),
            request_id=_request_id(request),
        )

    return router
