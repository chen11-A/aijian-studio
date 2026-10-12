"""Settings use one project revision; receipts remain exact after later edits."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from aijian_api.contracts import PROJECT_ID_PATTERN, ErrorBody, ErrorResponse
from aijian_api.project_settings_contracts import (
    PROJECT_SETTINGS_OPERATION_ID_PATTERN,
    ProjectSettingsBoundaryV1,
    ProjectSettingsReceiptResponseV1,
    ProjectSettingsResponseV1,
    UpdateProjectSettingsRequestV1,
)
from aijian_api.project_settings_store import (
    ProjectSettingsStore,
    SettingsConflictError,
    SettingsReceiptNotFoundError,
    SettingsStorageError,
)
from aijian_api.repository import ProjectNotFoundError, StudioRepository

ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
OperationId = Annotated[str, Path(pattern=PROJECT_SETTINGS_OPERATION_ID_PATTERN)]


def create_project_settings_router(
    repository_provider: Callable[[], StudioRepository],
) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 500)
    }

    def failure(request: Request, error: Exception) -> JSONResponse:
        status, code = (
            (404, "PROJECT_NOT_FOUND")
            if isinstance(error, ProjectNotFoundError)
            else (404, "PROJECT_SETTINGS_RECEIPT_NOT_FOUND")
            if isinstance(error, SettingsReceiptNotFoundError)
            else (409, "PROJECT_SETTINGS_CONFLICT")
            if isinstance(error, SettingsConflictError)
            else (500, "PROJECT_SETTINGS_STORAGE_ERROR")
        )
        return JSONResponse(
            status_code=status,
            content=ErrorResponse(
                error=ErrorBody(
                    code=code,
                    message="Project settings could not be verified",
                    details={},
                    retryable=False,
                ),
                request_id=cast(UUID, request.state.request_id),
            ).model_dump(mode="json"),
        )

    @router.get(
        "/api/v1/projects/{project_id}/settings",
        operation_id="getProjectSettings",
        response_model=ProjectSettingsResponseV1,
        responses=errors,
    )
    def read(request: Request, project_id: ProjectId) -> ProjectSettingsResponseV1 | JSONResponse:
        try:
            return ProjectSettingsResponseV1(
                data=ProjectSettingsStore(repository_provider()).read(project_id),
                boundary=ProjectSettingsBoundaryV1(),
                request_id=cast(UUID, request.state.request_id),
            )
        except (ProjectNotFoundError, SettingsStorageError) as error:
            return failure(request, error)

    @router.get(
        "/api/v1/projects/{project_id}/settings/operations/{operation_id}",
        operation_id="getProjectSettingsReceipt",
        response_model=ProjectSettingsReceiptResponseV1,
        responses=errors,
    )
    def receipt(
        request: Request, project_id: ProjectId, operation_id: OperationId
    ) -> ProjectSettingsReceiptResponseV1 | JSONResponse:
        try:
            return ProjectSettingsReceiptResponseV1(
                data=ProjectSettingsStore(repository_provider()).receipt(project_id, operation_id),
                boundary=ProjectSettingsBoundaryV1(),
                request_id=cast(UUID, request.state.request_id),
            )
        except (ProjectNotFoundError, SettingsReceiptNotFoundError, SettingsStorageError) as error:
            return failure(request, error)

    @router.post(
        "/api/v1/projects/{project_id}/settings",
        operation_id="updateProjectSettings",
        response_model=ProjectSettingsReceiptResponseV1,
        responses=errors,
    )
    def write(
        request: Request, project_id: ProjectId, payload: UpdateProjectSettingsRequestV1
    ) -> ProjectSettingsReceiptResponseV1 | JSONResponse:
        try:
            return ProjectSettingsReceiptResponseV1(
                data=ProjectSettingsStore(repository_provider()).write(project_id, payload),
                boundary=ProjectSettingsBoundaryV1(),
                request_id=cast(UUID, request.state.request_id),
            )
        except (ProjectNotFoundError, SettingsConflictError, SettingsStorageError) as error:
            return failure(request, error)

    return router
