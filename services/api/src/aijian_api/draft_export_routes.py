"""Authenticated native-only draft export API, independent from formal release."""

from collections.abc import Callable
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.draft_export_contracts import (
    DRAFT_OPERATION_PATTERN,
    CreateDraftExportRequest,
    DraftExportListData,
    DraftExportListResponse,
    DraftExportResponse,
)
from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyError
from aijian_api.media_toolchain import MediaToolchainError
from aijian_api.repository import ArtifactConflictError, ArtifactNotFoundError

ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
EpisodeId = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
OperationId = Annotated[str, Path(pattern=DRAFT_OPERATION_PATTERN)]


def _error(request: Request, error: Exception) -> JSONResponse:
    code = str(getattr(error, "code", "DRAFT_EXPORT_UNKNOWN"))
    status = 409
    if isinstance(error, MediaToolchainError):
        code, status = "DRAFT_TOOLCHAIN_UNAVAILABLE", 503
        message = (
            "A pinned local draft encoder pair is unavailable; "
            "the development toolchain must be configured"
        )
    elif code == "NOT_FOUND":
        code, status, message = "DRAFT_EXPORT_NOT_FOUND", 404, str(error)
    elif isinstance(error, ArtifactNotFoundError | ArtifactConflictError):
        code, status, message = (
            "ASSEMBLY_VERSION_NOT_FOUND",
            404,
            "The selected saved assembly was not found",
        )
    elif isinstance(error, DraftExportError | EpisodeMediaAssemblyError):
        message = str(error)
    else:
        status, message = (
            503,
            "Draft operation outcome is unknown; read its receipt before another attempt",
        )
    envelope = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=cast(UUID, request.state.request_id),
    )
    return JSONResponse(status_code=status, content=envelope.model_dump(mode="json"))


def create_draft_export_router(provider: Callable[[], DraftExportRuntime]) -> APIRouter:
    router = APIRouter()
    path = "/api/v1/projects/{project_id}/episodes/{episode_id}/draft-exports"

    @router.post(
        path, operation_id="createDraftExport", response_model=DraftExportResponse, status_code=202
    )
    def submit(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateDraftExportRequest,
    ) -> DraftExportResponse | JSONResponse:
        try:
            data = provider().submit(project_id, episode_id, payload)
            return DraftExportResponse(data=data, request_id=cast(UUID, request.state.request_id))
        except Exception as error:
            return _error(request, error)

    @router.get(path, operation_id="listDraftExports", response_model=DraftExportListResponse)
    def history(
        request: Request, project_id: ProjectId, episode_id: EpisodeId
    ) -> DraftExportListResponse | JSONResponse:
        try:
            return DraftExportListResponse(
                data=DraftExportListData(items=provider().list(project_id, episode_id)),
                request_id=cast(UUID, request.state.request_id),
            )
        except Exception as error:
            return _error(request, error)

    @router.get(
        path + "/{operation_id}", operation_id="getDraftExport", response_model=DraftExportResponse
    )
    def get(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, operation_id: OperationId
    ) -> DraftExportResponse | JSONResponse:
        try:
            return DraftExportResponse(
                data=provider().get(project_id, episode_id, operation_id),
                request_id=cast(UUID, request.state.request_id),
            )
        except Exception as error:
            return _error(request, error)

    @router.post(
        path + "/{operation_id}/cancellations",
        operation_id="cancelDraftExport",
        response_model=DraftExportResponse,
    )
    def cancel(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, operation_id: OperationId
    ) -> DraftExportResponse | JSONResponse:
        try:
            return DraftExportResponse(
                data=provider().cancel(project_id, episode_id, operation_id),
                request_id=cast(UUID, request.state.request_id),
            )
        except Exception as error:
            return _error(request, error)

    return router
