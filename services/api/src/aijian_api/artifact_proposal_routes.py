"""Project-scoped, read-only ArtifactProposal review boundary."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request

from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.contracts import (
    PROJECT_ID_PATTERN,
    PROPOSAL_ID_PATTERN,
    ArtifactProposalData,
    ArtifactProposalResponse,
    ErrorResponse,
)

type StoreProvider = Callable[[], ArtifactProposalStore]
type ProjectIdPath = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
type ProposalIdPath = Annotated[str, Path(pattern=PROPOSAL_ID_PATTERN)]


def create_artifact_proposal_router(store_provider: StoreProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Authentication required", "model": ErrorResponse},
        403: {"description": "Project access denied", "model": ErrorResponse},
        404: {"description": "Artifact proposal not found", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/proposals/{proposal_id}",
        operation_id="getArtifactProposal",
        response_model=ArtifactProposalResponse,
        responses=errors,
    )
    def get_artifact_proposal(
        request: Request,
        project_id: ProjectIdPath,
        proposal_id: ProposalIdPath,
    ) -> ArtifactProposalResponse:
        persisted = store_provider().get(project_id, proposal_id)
        return ArtifactProposalResponse(
            data=ArtifactProposalData(
                project_id=project_id,
                proposal_id=proposal_id,
                proposal=persisted.proposal,
                producer_attempt_id=persisted.producer_attempt_id,
                proposal_hash=persisted.proposal_hash,
                created_at=persisted.created_at,
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    return router
