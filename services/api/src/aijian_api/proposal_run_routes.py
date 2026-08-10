"""Project-scoped read boundary for Agent/Skill proposal runs."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request

from aijian_api.agent_run_store import AgentRunStore
from aijian_api.contracts import (
    AGENT_RUN_ID_PATTERN,
    PROJECT_ID_PATTERN,
    ErrorResponse,
    ProposalRunData,
    ProposalRunResponse,
)

type StoreProvider = Callable[[], AgentRunStore]
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
