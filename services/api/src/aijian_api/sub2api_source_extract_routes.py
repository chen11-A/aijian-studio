"""Historical Sub2API readback. New queue and approval writes are retired."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status
from fastapi.responses import JSONResponse

from aijian_api.contracts import (
    AGENT_RUN_ID_PATTERN,
    PROJECT_ID_PATTERN,
    CreatedProposalRunResponse,
    ErrorBody,
    ErrorResponse,
)
from aijian_api.sub2api_source_extract_contracts import (
    CreateSub2APICallApprovalRequest,
    CreateSub2APISourceExtractRunRequest,
    Sub2APICallApprovalData,
    Sub2APICallApprovalResponse,
    Sub2APISourceExtractRunResponse,
)
from aijian_api.sub2api_source_extract_run_factory import Sub2APISourceExtractRunFactory
from aijian_api.sub2api_source_extract_store import (
    Sub2APISourceExtractConflictError,
    Sub2APISourceExtractNotFoundError,
    Sub2APISourceExtractStore,
)

type FactoryProvider = Callable[[], Sub2APISourceExtractRunFactory]
type StoreProvider = Callable[[], Sub2APISourceExtractStore]
type AvailabilityProvider = Callable[[], str]
type ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
type AgentRunId = Annotated[str, Path(pattern=AGENT_RUN_ID_PATTERN)]


def _error(request: Request, *, code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(
            error=ErrorBody(code=code, message=message, details={}, retryable=False),
            request_id=cast(UUID, request.state.request_id),
        ).model_dump(mode="json"),
    )


def _retired(request: Request) -> JSONResponse:
    return _error(
        request,
        status_code=410,
        code="SUB2API_DISPATCH_RETIRED",
        message="Sub2API dispatch is retired; text calls use the signed-in GPT or Grok account",
    )


def create_sub2api_source_extract_router(
    *,
    factory_provider: FactoryProvider,
    store_provider: StoreProvider,
    availability_provider: AvailabilityProvider,
    trusted_actor_id: str,
) -> APIRouter:
    """Register only behind Sidecar authentication with a server supplied actor."""
    if not trusted_actor_id.strip():
        raise ValueError("trusted Sub2API approval actor is required")
    # New runs and approvals are refused below. These providers stay in the
    # signature so existing registration and historical GET reads keep working.
    del factory_provider, availability_provider
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request rejected", "model": ErrorResponse},
        404: {"description": "Project, run, or approval not found", "model": ErrorResponse},
        409: {"description": "Frozen scope or approval conflict", "model": ErrorResponse},
        410: {"description": "Sub2API dispatch retired", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
        428: {"description": "Idempotency-Key required", "model": ErrorResponse},
    }

    @router.post(
        "/api/v1/projects/{project_id}/sub2api-source-extract-runs",
        operation_id="createSub2APISourceExtractRun",
        response_model=CreatedProposalRunResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            200: {"description": "Idempotent run replay", "model": CreatedProposalRunResponse},
            **errors,
        },
    )
    def create_run(
        request: Request,
        response: Response,
        project_id: ProjectId,
        payload: CreateSub2APISourceExtractRunRequest,
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> CreatedProposalRunResponse | JSONResponse:
        del project_id, payload, response
        if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 240:
            return _error(
                request,
                status_code=428,
                code="IDEMPOTENCY_KEY_REQUIRED",
                message="One bounded Idempotency-Key is required",
            )
        return _retired(request)

    @router.get(
        "/api/v1/projects/{project_id}/sub2api-source-extract-runs/{run_id}/operation",
        operation_id="getSub2APISourceExtractOperation",
        response_model=Sub2APISourceExtractRunResponse,
        responses=errors,
    )
    def get_operation(
        request: Request, project_id: ProjectId, run_id: AgentRunId
    ) -> Sub2APISourceExtractRunResponse | JSONResponse:
        try:
            data = store_provider().read_operation(project_id=project_id, run_id=run_id)
        except Sub2APISourceExtractNotFoundError:
            return _error(
                request,
                status_code=404,
                code="SUB2API_RUN_NOT_FOUND",
                message="The requested Sub2API run was not found",
            )
        except Sub2APISourceExtractConflictError:
            return _error(
                request,
                status_code=409,
                code="SUB2API_OPERATION_INCONSISTENT",
                message="The stored Sub2API operation is inconsistent",
            )
        return Sub2APISourceExtractRunResponse(
            data=data, request_id=cast(UUID, request.state.request_id)
        )

    @router.post(
        "/api/v1/projects/{project_id}/sub2api-source-extract-runs/{run_id}/approval",
        operation_id="approveSub2APISourceExtractCall",
        response_model=Sub2APICallApprovalResponse,
        responses=errors,
    )
    def approve_call(
        request: Request,
        project_id: ProjectId,
        run_id: AgentRunId,
        payload: CreateSub2APICallApprovalRequest,
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> Sub2APICallApprovalResponse | JSONResponse:
        del project_id, run_id, payload
        if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 240:
            return _error(
                request,
                status_code=428,
                code="IDEMPOTENCY_KEY_REQUIRED",
                message="One bounded Idempotency-Key is required",
            )
        return _retired(request)

    @router.get(
        "/api/v1/projects/{project_id}/sub2api-source-extract-runs/{run_id}/approval",
        operation_id="getSub2APISourceExtractApproval",
        response_model=Sub2APICallApprovalResponse,
        responses=errors,
    )
    def get_approval(
        request: Request, project_id: ProjectId, run_id: AgentRunId
    ) -> Sub2APICallApprovalResponse | JSONResponse:
        try:
            data: Sub2APICallApprovalData = store_provider().read_approval(
                project_id=project_id, run_id=run_id
            )
        except Sub2APISourceExtractNotFoundError:
            return _error(
                request,
                status_code=404,
                code="SUB2API_APPROVAL_NOT_FOUND",
                message="No Sub2API approval exists for this run",
            )
        except Sub2APISourceExtractConflictError:
            return _error(
                request,
                status_code=409,
                code="SUB2API_OPERATION_INCONSISTENT",
                message="The stored Sub2API approval is inconsistent",
            )
        return Sub2APICallApprovalResponse(
            data=data, request_id=cast(UUID, request.state.request_id)
        )

    return router
