"""Project rename, archive, and reopen without deleting project data."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response
from fastapi.responses import JSONResponse

from aijian_api.contracts import (
    PROJECT_ID_PATTERN,
    ErrorBody,
    ErrorResponse,
    ProjectData,
    ProjectResponse,
)
from aijian_api.project_management import (
    ProjectManagementConflictError,
    ProjectPreconditionFailedError,
    update_project,
)
from aijian_api.project_management_contracts import UpdateProjectRequest
from aijian_api.repository import SQLITE_INTEGER_MAX, ProjectNotFoundError, StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]

_REVISION_ETAG = re.compile(r'^"revision-([1-9][0-9]*)"$')


def _error(request: Request, *, status: int, code: str, message: str) -> JSONResponse:
    envelope = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=cast(UUID, request.state.request_id),
    )
    return JSONResponse(status_code=status, content=envelope.model_dump(mode="json"))


def create_project_management_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project not found", "model": ErrorResponse},
        409: {"description": "Project metadata conflict", "model": ErrorResponse},
        412: {"description": "Project revision precondition failed", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
        428: {"description": "If-Match required", "model": ErrorResponse},
    }

    @router.patch(
        "/api/v1/projects/{project_id}",
        operation_id="updateProject",
        response_model=ProjectResponse,
        responses=errors,
        description=(
            "Changes persisted project name or active/archived status. Archiving does not "
            "cancel tasks, delete data, or revoke previously created artifacts."
        ),
    )
    def patch_project(
        request: Request,
        response: Response,
        payload: UpdateProjectRequest,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> ProjectResponse | JSONResponse:
        if if_match is None:
            return _error(
                request, status=428, code="PROJECT_PRECONDITION_REQUIRED",
                message="If-Match is required",
            )
        match = _REVISION_ETAG.fullmatch(if_match)
        if (
            len(request.headers.getlist("if-match")) != 1
            or match is None
            or len(match.group(1)) > 19
            or int(match.group(1)) > SQLITE_INTEGER_MAX
        ):
            return _error(
                request, status=412, code="PROJECT_PRECONDITION_FAILED",
                message="If-Match must contain one current project revision",
            )
        try:
            project = update_project(
                repository_provider(),
                project_id=project_id,
                payload=payload,
                expected_revision=int(match.group(1)),
            )
        except ProjectNotFoundError:
            return _error(
                request, status=404, code="PROJECT_NOT_FOUND",
                message="The requested project was not found",
            )
        except ProjectPreconditionFailedError:
            return _error(
                request, status=412, code="PROJECT_PRECONDITION_FAILED",
                message="The project revision has changed",
            )
        except ProjectManagementConflictError:
            return _error(
                request, status=409, code="PROJECT_CONFLICT",
                message="The stored project metadata is inconsistent",
            )
        response.headers["ETag"] = f'"revision-{project.revision}"'
        return ProjectResponse(
            data=ProjectData.model_validate(project),
            request_id=cast(UUID, request.state.request_id),
        )

    return router
