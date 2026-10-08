"""Project-scoped GET for a previously queued remote SourceExtraction run."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse

from aijian_api.contracts import (
    AGENT_RUN_ID_PATTERN,
    PROJECT_ID_PATTERN,
    ErrorBody,
    ErrorResponse,
)
from aijian_api.remote_settlement_contracts import RemoteSettlementVerifier
from aijian_api.remote_source_extract_operation_contracts import (
    RemoteSourceExtractOperationResponse,
)
from aijian_api.remote_source_extract_operation_query import (
    RemoteSourceExtractOperationInconsistentError,
    RemoteSourceExtractOperationNotFoundError,
    read_remote_source_extract_operation,
)
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]


def _error(request: Request, *, status: int, code: str, message: str) -> JSONResponse:
    envelope = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=cast(UUID, request.state.request_id),
    )
    return JSONResponse(status_code=status, content=envelope.model_dump(mode="json"))


def create_remote_source_extract_operation_router(
    repository_provider: RepositoryProvider,
    *,
    settlement_verifier: RemoteSettlementVerifier | None = None,
) -> APIRouter:
    """Register only readback; a GET cannot authorize or repeat remote dispatch."""
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        404: {"description": "Remote SourceExtraction operation not found", "model": ErrorResponse},
        409: {"description": "Persisted operation truth is inconsistent", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/remote-source-extract-runs/{run_id}/operation",
        operation_id="getRemoteSourceExtractOperation",
        response_model=RemoteSourceExtractOperationResponse,
        responses=errors,
    )
    def get_remote_source_extract_operation(
        request: Request,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
        run_id: str = Path(pattern=AGENT_RUN_ID_PATTERN),
    ) -> RemoteSourceExtractOperationResponse | JSONResponse:
        try:
            data = read_remote_source_extract_operation(
                repository_provider(),
                project_id=project_id,
                run_id=run_id,
                settlement_verifier=settlement_verifier,
            )
        except RemoteSourceExtractOperationNotFoundError:
            return _error(
                request,
                status=404,
                code="REMOTE_SOURCE_EXTRACT_OPERATION_NOT_FOUND",
                message="The requested remote operation was not found",
            )
        except RemoteSourceExtractOperationInconsistentError:
            return _error(
                request,
                status=409,
                code="REMOTE_SOURCE_EXTRACT_OPERATION_INCONSISTENT",
                message="The stored remote operation is inconsistent",
            )
        return RemoteSourceExtractOperationResponse(
            data=data, request_id=cast(UUID, request.state.request_id)
        )

    return router
