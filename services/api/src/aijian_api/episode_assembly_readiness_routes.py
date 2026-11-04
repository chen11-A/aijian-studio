"""Exact-version, authenticated read-only assembly prerequisite observation."""

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse

from aijian_api.contracts import ErrorResponse
from aijian_api.episode_assembly_readiness_contracts import EpisodeAssemblyReadinessResponse
from aijian_api.episode_assembly_readiness_service import (
    EpisodeAssemblyReadinessError,
    EpisodeAssemblyReadinessService,
)
from aijian_api.episode_media_assembly_routes import (
    EpisodeId,
    ProjectId,
    RepositoryProvider,
    VersionId,
    _error,
    _request_id,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyError
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
)

_ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"description": description, "model": ErrorResponse}
    for code, description in (
        (401, "Sidecar authentication required"),
        (403, "Sidecar boundary rejected"),
        (404, "Exact scoped assembly was not found"),
        (409, "Expected immutable assembly hash differs"),
        (422, "Exact scope or content hash input rejected"),
        (503, "Readiness observation could not be verified within read limits"),
    )
}


def create_episode_assembly_readiness_router(
    repository_provider: RepositoryProvider,
) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}"
        "/media-assembly/versions/{version_id}/readiness",
        operation_id="getEpisodeAssemblyReadiness",
        response_model=EpisodeAssemblyReadinessResponse,
        responses=_ERRORS,
    )
    def inspect(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
        expected_content_hash: Annotated[str, Query(pattern=CONTENT_HASH_PATTERN)],
    ) -> EpisodeAssemblyReadinessResponse | JSONResponse:
        response.headers["Cache-Control"] = "no-store"
        try:
            data = EpisodeAssemblyReadinessService(repository_provider()).inspect(
                project_id, episode_id, version_id, expected_content_hash
            )
            return EpisodeAssemblyReadinessResponse(data=data, request_id=_request_id(request))
        except (ArtifactNotFoundError, ProjectNotFoundError, EpisodeNotFoundError):
            result = _error(
                request, "ASSEMBLY_VERSION_NOT_FOUND", "Exact assembly was not found", 404
            )
        except ArtifactConflictError as error:
            missing = str(error) == "Artifact version was not found"
            result = _error(
                request,
                "ASSEMBLY_VERSION_NOT_FOUND" if missing else "ASSEMBLY_READINESS_UNKNOWN",
                "Exact assembly was not found"
                if missing
                else "Saved assembly could not be verified",
                404 if missing else 503,
            )
        except EpisodeAssemblyReadinessError as error:
            result = _error(request, error.code, str(error), error.status)
        except (EpisodeMediaAssemblyError, sqlite3.Error, ValueError, RuntimeError):
            result = _error(
                request, "ASSEMBLY_READINESS_UNKNOWN", "Readiness could not be verified", 503
            )
        result.headers["Cache-Control"] = "no-store"
        return result

    return router
