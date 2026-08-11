"""Project-scoped, read-only ArtifactProposal review boundary."""

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status

from aijian_api.artifact_proposal_acceptance import ArtifactProposalAcceptanceService
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.contracts import (
    PROJECT_ID_PATTERN,
    PROPOSAL_ID_PATTERN,
    ArtifactProposalData,
    ArtifactProposalDraftAcceptanceData,
    ArtifactProposalDraftAcceptanceResponse,
    ArtifactProposalResponse,
    CreateArtifactProposalDraftAcceptanceRequest,
    ErrorResponse,
)
from aijian_api.domain import TrustedReviewActor

type StoreProvider = Callable[[], ArtifactProposalStore]
type AcceptanceServiceProvider = Callable[[], ArtifactProposalAcceptanceService]
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


def create_artifact_proposal_write_router(
    service_provider: AcceptanceServiceProvider,
    actor: TrustedReviewActor,
) -> APIRouter:
    """Expose mutation only from the trusted Sidecar composition root."""

    router = APIRouter()

    @router.post(
        "/api/v1/projects/{project_id}/proposals/{proposal_id}/acceptances",
        operation_id="acceptArtifactProposalAsDraft",
        response_model=ArtifactProposalDraftAcceptanceResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            200: {
                "description": "Exact idempotent replay",
                "model": ArtifactProposalDraftAcceptanceResponse,
            },
            401: {"description": "Sidecar authentication required", "model": ErrorResponse},
            403: {"description": "Local request boundary rejected", "model": ErrorResponse},
            404: {"description": "Artifact proposal not found", "model": ErrorResponse},
            409: {"description": "Draft acceptance conflict", "model": ErrorResponse},
            422: {"description": "Request validation failed", "model": ErrorResponse},
        },
    )
    def accept_artifact_proposal_as_draft(
        request: Request,
        response: Response,
        payload: CreateArtifactProposalDraftAcceptanceRequest,
        project_id: ProjectIdPath,
        proposal_id: ProposalIdPath,
        idempotency_key: Annotated[
            str,
            Header(
                alias="Idempotency-Key",
                min_length=1,
                max_length=240,
                pattern=r".*\S.*",
            ),
        ],
    ) -> ArtifactProposalDraftAcceptanceResponse:
        acceptance = service_provider().accept_as_draft(
            project_id=project_id,
            proposal_id=proposal_id,
            idempotency_key=idempotency_key,
            actor=actor,
            parent_version_id=payload.parent_version_id,
            expected_head_revision=payload.expected_head_revision,
        )
        if acceptance.replayed:
            response.status_code = status.HTTP_200_OK
        return ArtifactProposalDraftAcceptanceResponse(
            data=ArtifactProposalDraftAcceptanceData.model_validate(acceptance),
            request_id=cast(UUID, request.state.request_id),
        )

    return router
