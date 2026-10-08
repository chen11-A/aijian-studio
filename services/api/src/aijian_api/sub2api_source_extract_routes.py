"""Project-scoped queue, readback, and explicit one-call Sub2API approval."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status
from fastapi.responses import JSONResponse

from aijian_api.application_errors import (
    IdempotencyKeyReusedError,
    ProposalRunInputRejectedError,
)
from aijian_api.contracts import (
    AGENT_RUN_ID_PATTERN,
    PROJECT_ID_PATTERN,
    CreatedProposalRunData,
    CreatedProposalRunResponse,
    ErrorBody,
    ErrorResponse,
    ProposalRunTaskData,
)
from aijian_api.repository import ProjectNotFoundError
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


def _unavailable(request: Request, availability: AvailabilityProvider) -> JSONResponse | None:
    try:
        state = availability()
    except Exception:
        state = "UNAVAILABLE"
    if state in {"WAITING_FOR_EXPLICIT_APPROVAL", "EXECUTING"}:
        return None
    return _error(
        request,
        status_code=503,
        code="SUB2API_EXECUTION_UNAVAILABLE",
        message="Sub2API execution service is unavailable; no call was authorized",
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
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request rejected", "model": ErrorResponse},
        404: {"description": "Project, run, or approval not found", "model": ErrorResponse},
        409: {"description": "Frozen scope or approval conflict", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
        428: {"description": "Idempotency-Key required", "model": ErrorResponse},
        503: {"description": "Sub2API execution unavailable", "model": ErrorResponse},
    }

    @router.post(
        "/api/v1/projects/{project_id}/sub2api-source-extract-runs",
        operation_id="createSub2APISourceExtractRun",
        response_model=CreatedProposalRunResponse,
        status_code=status.HTTP_201_CREATED,
        responses={200: {"description": "Idempotent run replay", "model": CreatedProposalRunResponse}, **errors},
    )
    def create_run(
        request: Request,
        response: Response,
        project_id: ProjectId,
        payload: CreateSub2APISourceExtractRunRequest,
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> CreatedProposalRunResponse | JSONResponse:
        if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 240:
            return _error(
                request, status_code=428, code="IDEMPOTENCY_KEY_REQUIRED",
                message="One bounded Idempotency-Key is required",
            )
        unavailable = _unavailable(request, availability_provider)
        if unavailable is not None:
            return unavailable
        try:
            result = factory_provider().create(
                project_id=project_id, payload=payload, idempotency_key=idempotency_key
            )
        except ProjectNotFoundError:
            return _error(
                request, status_code=404, code="PROJECT_NOT_FOUND",
                message="The requested project was not found",
            )
        except IdempotencyKeyReusedError:
            return _error(
                request, status_code=409, code="SUB2API_QUEUE_CONFLICT",
                message="Idempotency-Key was reused with different run input",
            )
        except ProposalRunInputRejectedError:
            return _error(
                request, status_code=422, code="SUB2API_INPUT_REJECTED",
                message="Sub2API source or model selection is invalid",
            )
        except Sub2APISourceExtractConflictError:
            return _error(
                request, status_code=409, code="SUB2API_SCOPE_CONFLICT",
                message="Frozen Sub2API run scope conflicts with persisted state",
            )
        if result.replayed:
            response.status_code = 200
        persisted = result.persisted
        return CreatedProposalRunResponse(
            data=CreatedProposalRunData(
                project_id=project_id,
                run_id=persisted.agent_run.agent_run_id,
                agent_run=persisted.agent_run,
                skill_run=persisted.skill_run,
                context_manifest=persisted.context_manifest,
                agent_revision=persisted.agent_revision,
                skill_revision=persisted.skill_revision,
                created_at=persisted.created_at,
                updated_at=persisted.updated_at,
                task=ProposalRunTaskData(
                    workflow_run_id=result.task.workflow_run_id,
                    node_run_id=result.task.node_run_id,
                    attempt_id=result.task.attempt_id,
                    task_id=result.task.task_id,
                ),
                attempt=result.attempt,
            ),
            request_id=cast(UUID, request.state.request_id),
        )

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
                request, status_code=404, code="SUB2API_RUN_NOT_FOUND",
                message="The requested Sub2API run was not found",
            )
        except Sub2APISourceExtractConflictError:
            return _error(
                request, status_code=409, code="SUB2API_OPERATION_INCONSISTENT",
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
        if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 240:
            return _error(
                request, status_code=428, code="IDEMPOTENCY_KEY_REQUIRED",
                message="One bounded Idempotency-Key is required",
            )
        unavailable = _unavailable(request, availability_provider)
        if unavailable is not None:
            return unavailable
        store = store_provider()
        try:
            operation = store.read_operation(project_id=project_id, run_id=run_id)
            scope = operation.scope
            if (
                payload.task_id != scope.task_id
                or payload.attempt_id != scope.attempt_id
                or payload.expected_attempt_fingerprint != scope.attempt_fingerprint
            ):
                raise Sub2APISourceExtractConflictError("approval scope changed")
            store.issue_approval(
                project_id=project_id,
                task_id=payload.task_id,
                attempt_id=payload.attempt_id,
                expected_attempt_fingerprint=payload.expected_attempt_fingerprint,
                actor_id=trusted_actor_id,
                idempotency_key=idempotency_key,
            )
            data = store.read_approval(project_id=project_id, run_id=run_id)
        except Sub2APISourceExtractNotFoundError:
            return _error(
                request, status_code=404, code="SUB2API_RUN_NOT_FOUND",
                message="The requested Sub2API run was not found",
            )
        except Sub2APISourceExtractConflictError:
            return _error(
                request, status_code=409, code="SUB2API_APPROVAL_CONFLICT",
                message="The explicit one-call approval conflicts with current task state",
            )
        return Sub2APICallApprovalResponse(
            data=data, request_id=cast(UUID, request.state.request_id)
        )

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
                request, status_code=404, code="SUB2API_APPROVAL_NOT_FOUND",
                message="No Sub2API approval exists for this run",
            )
        except Sub2APISourceExtractConflictError:
            return _error(
                request, status_code=409, code="SUB2API_OPERATION_INCONSISTENT",
                message="The stored Sub2API approval is inconsistent",
            )
        return Sub2APICallApprovalResponse(
            data=data, request_id=cast(UUID, request.state.request_id)
        )

    return router
