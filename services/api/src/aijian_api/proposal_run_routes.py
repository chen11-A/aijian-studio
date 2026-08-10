"""Project-scoped read boundary for Agent/Skill proposal runs."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status

from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.contracts import (
    AGENT_RUN_ID_PATTERN,
    PROJECT_ID_PATTERN,
    CreatedProposalRunData,
    CreatedProposalRunResponse,
    CreateProposalRunCancellationRequest,
    CreateProposalRunRequest,
    ErrorResponse,
    ProposalRunCancellationData,
    ProposalRunCancellationResponse,
    ProposalRunData,
    ProposalRunResponse,
    ProposalRunTaskData,
)
from aijian_api.source_extract_run_factory import SourceExtractRunFactory
from aijian_api.task_ledger import LocalTaskLedger

type StoreProvider = Callable[[], AgentRunStore]
type RunFactoryProvider = Callable[[], SourceExtractRunFactory]
type LedgerProvider = Callable[[], LocalTaskLedger]
type ProjectIdPath = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
type AgentRunIdPath = Annotated[str, Path(pattern=AGENT_RUN_ID_PATTERN)]


def create_proposal_run_router(store_provider: StoreProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        404: {"description": "Proposal run not found", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/proposal-runs/{run_id}",
        operation_id="getProposalRun",
        response_model=ProposalRunResponse,
        responses=errors,
    )
    def get_proposal_run(
        request: Request,
        project_id: ProjectIdPath,
        run_id: AgentRunIdPath,
    ) -> ProposalRunResponse:
        persisted = store_provider().get(project_id, run_id)
        return ProposalRunResponse(
            data=ProposalRunData(
                project_id=project_id,
                run_id=persisted.agent_run.agent_run_id,
                agent_run=persisted.agent_run,
                skill_run=persisted.skill_run,
                context_manifest=persisted.context_manifest,
                agent_revision=persisted.agent_revision,
                skill_revision=persisted.skill_revision,
                created_at=persisted.created_at,
                updated_at=persisted.updated_at,
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    return router


def create_proposal_run_write_router(
    factory_provider: RunFactoryProvider,
    store_provider: StoreProvider,
    ledger_provider: LedgerProvider,
    cancellation_actor_id: str,
) -> APIRouter:
    """Create write routes only when the trusted Sidecar composition enables them."""

    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project not found", "model": ErrorResponse},
        409: {"description": "Run input or idempotency conflict", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.post(
        "/api/v1/projects/{project_id}/proposal-runs",
        operation_id="createProposalRun",
        response_model=CreatedProposalRunResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            200: {
                "description": "Existing idempotent proposal run returned",
                "model": CreatedProposalRunResponse,
            },
            **errors,
        },
    )
    def create_proposal_run(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        payload: CreateProposalRunRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=240),
        ],
    ) -> CreatedProposalRunResponse:
        result = factory_provider().create(
            project_id=project_id,
            payload=payload,
            idempotency_key=idempotency_key,
        )
        if result.replayed:
            response.status_code = status.HTTP_200_OK
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

    @router.post(
        "/api/v1/projects/{project_id}/proposal-runs/{run_id}/cancellations",
        operation_id="cancelProposalRun",
        response_model=ProposalRunCancellationResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            200: {
                "description": "Existing cancellation returned",
                "model": ProposalRunCancellationResponse,
            },
            **errors,
        },
    )
    def cancel_proposal_run(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        run_id: AgentRunIdPath,
        _payload: CreateProposalRunCancellationRequest,
        _idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=240),
        ],
    ) -> ProposalRunCancellationResponse:
        result = ledger_provider().cancel_local_proposal_run(
            project_id=project_id,
            agent_run_id=run_id,
            actor_id=cancellation_actor_id,
        )
        if result.already_cancelled:
            response.status_code = status.HTTP_200_OK
        persisted = store_provider().get(project_id, run_id)
        if persisted.agent_run.status != "CANCELLED" or persisted.skill_run.status != "CANCELLED":
            raise RuntimeError("cancelled proposal run state did not persist")
        cancellation_hash = canonical_sha256(
            {"project_id": project_id, "agent_run_id": run_id}
        ).removeprefix("sha256:")
        return ProposalRunCancellationResponse(
            data=ProposalRunCancellationData(
                cancellation_id=f"cnl_{cancellation_hash[:32]}",
                project_id=project_id,
                run_id=run_id,
                workflow_run_id=result.workflow_run_id,
                agent_run_status="CANCELLED",
                skill_run_status="CANCELLED",
                cancelled_tasks=result.cancelled_tasks,
                cancelled_attempts=result.cancelled_attempts,
                cancelled_nodes=result.cancelled_nodes,
                already_cancelled=result.already_cancelled,
                updated_at=persisted.updated_at,
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    return router
