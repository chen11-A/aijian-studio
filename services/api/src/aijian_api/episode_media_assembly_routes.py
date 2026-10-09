"""Episode media assembly draft version reads and authenticated CAS writes."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyVersionData,
)
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
)
from aijian_api.episode_script_contracts import VERSION_ID_PATTERN
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)

type RepositoryProvider = Callable[[], StudioRepository]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
EpisodeId = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
VersionId = Annotated[str, Path(pattern=VERSION_ID_PATTERN)]


class EpisodeMediaAssemblyVersionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: EpisodeMediaAssemblyVersionData
    request_id: UUID


_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Local write boundary rejected", "model": ErrorResponse},
    404: {"description": "Project, Episode, or selected version not found", "model": ErrorResponse},
    409: {"description": "Assembly revision, media, or script conflict", "model": ErrorResponse},
    422: {"description": "Assembly request input rejected", "model": ErrorResponse},
    503: {"description": "Assembly storage outcome is unknown", "model": ErrorResponse},
}


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _error(request: Request, code: str, message: str, status_code: int) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=_request_id(request),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def _store_error(request: Request, error: EpisodeMediaAssemblyError) -> JSONResponse:
    if error.code in {
        "ASSET_VERSION_NOT_FOUND",
        "SCRIPT_VERSION_NOT_FOUND",
        "SCRIPT_BLOCK_NOT_FOUND",
    }:
        status_code = 404
    elif error.code in {"EPISODE_SCOPE_CONFLICT", "INVALID_ACTOR"}:
        status_code = 422
    elif error.code in {"MEDIA_UNKNOWN_UNSAFE_PATH"}:
        status_code = 503
    else:
        status_code = 409
    return _error(request, error.code, str(error), status_code)


def create_episode_media_assembly_public_router(
    repository_provider: RepositoryProvider,
) -> APIRouter:
    router = APIRouter()
    path = "/api/v1/projects/{project_id}/episodes/{episode_id}/media-assembly"

    @router.get(
        path,
        operation_id="getEpisodeMediaAssembly",
        response_model=EpisodeMediaAssemblyVersionResponse,
        responses=_ERRORS,
    )
    def get_latest(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
    ) -> EpisodeMediaAssemblyVersionResponse | JSONResponse:
        try:
            data = EpisodeMediaAssemblyStore(repository_provider()).read_version(
                project_id, episode_id
            )
        except (ArtifactNotFoundError, EpisodeNotFoundError, ProjectNotFoundError):
            return _error(request, "ASSEMBLY_NOT_FOUND", "Episode assembly was not found", 404)
        except EpisodeMediaAssemblyError as error:
            return _store_error(request, error)
        except sqlite3.Error:
            return _error(
                request, "ASSEMBLY_READ_UNKNOWN", "Assembly read could not be confirmed", 503
            )
        response.headers["Cache-Control"] = "no-store"
        return EpisodeMediaAssemblyVersionResponse(data=data, request_id=_request_id(request))

    @router.get(
        path + "/versions/{version_id}",
        operation_id="getEpisodeMediaAssemblyVersion",
        response_model=EpisodeMediaAssemblyVersionResponse,
        responses=_ERRORS,
    )
    def get_version(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
    ) -> EpisodeMediaAssemblyVersionResponse | JSONResponse:
        try:
            data = EpisodeMediaAssemblyStore(repository_provider()).read_version(
                project_id,
                episode_id,
                version_id=version_id,
            )
        except (
            ArtifactConflictError,
            ArtifactNotFoundError,
            EpisodeNotFoundError,
            ProjectNotFoundError,
        ):
            return _error(
                request, "ASSEMBLY_VERSION_NOT_FOUND", "Assembly version was not found", 404
            )
        except EpisodeMediaAssemblyError as error:
            return _store_error(request, error)
        except sqlite3.Error:
            return _error(
                request, "ASSEMBLY_READ_UNKNOWN", "Assembly read could not be confirmed", 503
            )
        response.headers["Cache-Control"] = "no-store"
        return EpisodeMediaAssemblyVersionResponse(data=data, request_id=_request_id(request))

    return router


def create_episode_media_assembly_write_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.post(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/media-assembly/versions",
        operation_id="createEpisodeMediaAssemblyVersion",
        response_model=EpisodeMediaAssemblyVersionResponse,
        status_code=status.HTTP_201_CREATED,
        responses=_ERRORS,
    )
    def create_version(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateEpisodeMediaAssemblyVersionRequest,
    ) -> EpisodeMediaAssemblyVersionResponse | JSONResponse:
        if "writer" not in trusted_actor.roles:
            return _error(
                request, "ASSEMBLY_ACTOR_FORBIDDEN", "Local user cannot edit assembly", 403
            )
        try:
            data = EpisodeMediaAssemblyStore(repository_provider()).create_version(
                project_id,
                episode_id,
                payload,
                author_actor_id=trusted_actor.subject_id,
            )
        except (ProjectNotFoundError, EpisodeNotFoundError):
            return _error(request, "EPISODE_NOT_FOUND", "Project or Episode was not found", 404)
        except ArtifactConflictError:
            return _error(request, "ASSEMBLY_REVISION_CONFLICT", "Assembly head changed", 409)
        except EpisodeMediaAssemblyError as error:
            return _store_error(request, error)
        except sqlite3.Error:
            return _error(
                request, "ASSEMBLY_WRITE_UNKNOWN", "Assembly write outcome is unknown", 503
            )
        response.headers["Cache-Control"] = "no-store"
        return EpisodeMediaAssemblyVersionResponse(data=data, request_id=_request_id(request))

    return router
