"""Sidecar-scoped manual director proposal routes; there is no model-completion API."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response
from fastapi.responses import JSONResponse

from aijian_api.application_errors import PreconditionRequiredError
from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import VERSION_ID_PATTERN
from aijian_api.repository import StudioRepository
from aijian_api.shot_plan_contracts import (
    AdoptShotPlanRequest,
    CreateHumanShotPlanRequest,
    ShotPlanAdoptionStatusData,
    ShotPlanAdoptionStatusResponse,
    ShotPlanMutationData,
    ShotPlanMutationResponse,
    ShotPlanPreparationResponse,
    ShotPlanProposalResponse,
    ShotPlanWriteStatusData,
    ShotPlanWriteStatusResponse,
)
from aijian_api.shot_plan_proposal_store import ShotPlanProposalStore
from aijian_api.shot_plan_validation import ShotPlanError

type RepositoryProvider = Callable[[], StudioRepository]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
EpisodeId = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
VersionId = Annotated[str, Path(pattern=VERSION_ID_PATTERN)]
OPERATION_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
OperationId = Annotated[str, Path(pattern=OPERATION_ID_PATTERN, min_length=36, max_length=36)]
ROOT = "/api/v1/projects/{project_id}/episodes/{episode_id}/shot-plan-proposals"
_ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"description": "Manual shot plan request rejected safely", "model": ErrorResponse}
    for code in (401, 403, 404, 409, 413, 422, 428, 500)
}


def request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def failure(request: Request, error: ShotPlanError) -> JSONResponse:
    envelope = ErrorResponse(
        error=ErrorBody(
            code=error.code,
            message="Manual director plan could not be applied safely",
            details={},
            retryable=False,
        ),
        request_id=request_id(request),
    )
    return JSONResponse(status_code=error.status, content=envelope.model_dump(mode="json"))


def create_shot_plan_public_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        ROOT + "/preparation",
        operation_id="prepareHumanShotPlan",
        response_model=ShotPlanPreparationResponse,
        responses=_ERRORS,
    )
    def prepare(request: Request, project_id: ProjectId, episode_id: EpisodeId) -> Any:
        try:
            data = ShotPlanProposalStore(repository_provider()).prepare(project_id, episode_id)
            return ShotPlanPreparationResponse(data=data, request_id=request_id(request))
        except ShotPlanError as error:
            return failure(request, error)

    @router.get(
        ROOT,
        operation_id="getShotPlanProposal",
        response_model=ShotPlanProposalResponse,
        responses=_ERRORS,
    )
    def latest(request: Request, project_id: ProjectId, episode_id: EpisodeId) -> Any:
        try:
            data = ShotPlanProposalStore(repository_provider()).get_latest(project_id, episode_id)
            return ShotPlanProposalResponse(data=data, request_id=request_id(request))
        except ShotPlanError as error:
            return failure(request, error)

    @router.get(
        ROOT + "/versions/{version_id}",
        operation_id="getShotPlanProposalVersion",
        response_model=ShotPlanProposalResponse,
        responses=_ERRORS,
    )
    def exact(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, version_id: VersionId
    ) -> Any:
        try:
            data = ShotPlanProposalStore(repository_provider()).get_version(
                project_id,
                episode_id,
                version_id,
            )
            return ShotPlanProposalResponse(data=data, request_id=request_id(request))
        except ShotPlanError as error:
            return failure(request, error)

    @router.get(
        ROOT + "/human-operations/{operation_id}",
        operation_id="getHumanShotPlanWriteStatus",
        response_model=ShotPlanWriteStatusResponse,
        responses=_ERRORS,
    )
    def write_status(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, operation_id: OperationId
    ) -> Any:
        try:
            data = ShotPlanProposalStore(repository_provider()).get_write_status(
                project_id,
                episode_id,
                operation_id,
            )
            return ShotPlanWriteStatusResponse(
                data=ShotPlanWriteStatusData(proposal=data),
                request_id=request_id(request),
            )
        except ShotPlanError as error:
            return failure(request, error)

    @router.get(
        ROOT + "/versions/{version_id}/adoption",
        operation_id="getShotPlanAdoptionStatus",
        response_model=ShotPlanAdoptionStatusResponse,
        responses=_ERRORS,
    )
    def adoption_status(
        request: Request, project_id: ProjectId, episode_id: EpisodeId, version_id: VersionId
    ) -> Any:
        try:
            data = ShotPlanProposalStore(repository_provider()).get_version(
                project_id,
                episode_id,
                version_id,
            )
            return ShotPlanAdoptionStatusResponse(
                data=ShotPlanAdoptionStatusData(
                    proposal_version_id=version_id,
                    adoption=data.adoption,
                ),
                request_id=request_id(request),
            )
        except ShotPlanError as error:
            return failure(request, error)

    return router


def create_shot_plan_write_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter()

    @router.post(
        ROOT + "/human",
        operation_id="createHumanShotPlanProposal",
        response_model=ShotPlanMutationResponse,
        status_code=201,
        responses=_ERRORS,
    )
    def create(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateHumanShotPlanRequest,
        idempotency_key: str | None = Header(
            default=None,
            alias="Idempotency-Key",
            pattern=OPERATION_ID_PATTERN,
            min_length=36,
            max_length=36,
        ),
    ) -> Any:
        if idempotency_key is None or not idempotency_key.strip():
            raise PreconditionRequiredError("Idempotency-Key is required")
        try:
            data, replayed = ShotPlanProposalStore(repository_provider()).write(
                project_id,
                episode_id,
                payload,
                idempotency_key,
                trusted_actor.subject_id,
            )
            response.headers["ETag"] = f'"{data.content_hash}"'
            return ShotPlanMutationResponse(
                data=ShotPlanMutationData(proposal=data, replayed=replayed),
                request_id=request_id(request),
            )
        except ShotPlanError as error:
            return failure(request, error)

    @router.post(
        ROOT + "/versions/{version_id}/adopt",
        operation_id="adoptHumanShotPlanProposal",
        response_model=ShotPlanMutationResponse,
        responses=_ERRORS,
    )
    def adopt(
        request: Request,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
        payload: AdoptShotPlanRequest,
        idempotency_key: str | None = Header(
            default=None,
            alias="Idempotency-Key",
            pattern=OPERATION_ID_PATTERN,
            min_length=36,
            max_length=36,
        ),
    ) -> Any:
        if idempotency_key is None or not idempotency_key.strip():
            raise PreconditionRequiredError("Idempotency-Key is required")
        try:
            data, replayed = ShotPlanProposalStore(repository_provider()).adopt(
                project_id,
                episode_id,
                version_id,
                payload,
                idempotency_key,
                trusted_actor.subject_id,
            )
            return ShotPlanMutationResponse(
                data=ShotPlanMutationData(proposal=data, replayed=replayed),
                request_id=request_id(request),
            )
        except ShotPlanError as error:
            return failure(request, error)

    return router
