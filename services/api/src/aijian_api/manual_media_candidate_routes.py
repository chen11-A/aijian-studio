"""Local candidate history, native write and GET-only exact attribution."""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Path, Query, Request, Response

from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_script_confirmation_routes import (
    EpisodeId,
    ProjectId,
    RepositoryProvider,
    _error,
    _request_id,
)
from aijian_api.episode_script_contracts import VERSION_ID_PATTERN
from aijian_api.manual_media_candidate_contracts import (
    CreateManualMediaCandidateRequest,
    ManualMediaCandidateOperationResponse,
    ManualMediaCandidatePageResponse,
    ManualMediaCandidateResponse,
)
from aijian_api.manual_media_candidate_store import (
    ManualMediaCandidateConflict,
    ManualMediaCandidateError,
    ManualMediaCandidateStore,
)
from aijian_api.repository import EpisodeNotFoundError, ProjectNotFoundError

VersionId = Annotated[str, Path(pattern=VERSION_ID_PATTERN)]


def create_manual_media_candidate_public_router(provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/manual-media-candidates",
        operation_id="listManualMediaCandidates",
        response_model=ManualMediaCandidatePageResponse,
    )
    def list_inputs(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        cursor: Annotated[str | None, Query(pattern=VERSION_ID_PATTERN)] = None,
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            return ManualMediaCandidatePageResponse(
                data=ManualMediaCandidateStore(provider()).list(project_id, episode_id, cursor),
                request_id=_request_id(request),
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MANUAL_MEDIA_CANDIDATE_READ_UNKNOWN",
                message="Exact candidate history could not be verified",
            )

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/manual-media-candidates/{version_id}",
        operation_id="getManualMediaCandidate",
        response_model=ManualMediaCandidateResponse,
    )
    def get_input(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            return ManualMediaCandidateResponse(
                data=ManualMediaCandidateStore(provider()).get(project_id, episode_id, version_id),
                request_id=_request_id(request),
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MANUAL_MEDIA_CANDIDATE_READ_UNKNOWN",
                message="Exact candidate input could not be verified",
            )

    return router


def create_manual_media_candidate_native_router(
    provider: RepositoryProvider, actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.post(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/manual-media-candidates",
        response_model=ManualMediaCandidateOperationResponse,
        status_code=201,
    )
    def save_input(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateManualMediaCandidateRequest,
        idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        if idempotency_key is None:
            return _error(
                request,
                status_code=428,
                code="PRECONDITION_REQUIRED",
                message="Original operation UUID is required",
            )
        if "writer" not in actor.roles:
            return _error(
                request,
                status_code=403,
                code="MANUAL_MEDIA_CANDIDATE_ACTOR_FORBIDDEN",
                message="Trusted writer role is required",
            )
        try:
            data = ManualMediaCandidateStore(provider()).write(
                project_id, episode_id, idempotency_key, payload, actor.subject_id
            )
        except ManualMediaCandidateConflict:
            return _error(
                request,
                status_code=409,
                code="MANUAL_MEDIA_CANDIDATE_CONFLICT",
                message="Candidate CAS or original input differs",
            )
        except (ManualMediaCandidateError, ValueError):
            return _error(
                request,
                status_code=422,
                code="MANUAL_MEDIA_CANDIDATE_INPUT_REJECTED",
                message="Exact candidate input was rejected",
            )
        except (EpisodeNotFoundError, ProjectNotFoundError):
            return _error(
                request,
                status_code=404,
                code="MANUAL_MEDIA_CANDIDATE_SCOPE_NOT_FOUND",
                message="Exact episode scope was not found",
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MANUAL_MEDIA_CANDIDATE_WRITE_UNKNOWN",
                message="Write could not be attributed; query original input only",
            )
        # The transaction has committed. A response construction failure proves
        # neither rejection nor absence; preserve the original intent as UNKNOWN.
        try:
            return ManualMediaCandidateOperationResponse(data=data, request_id=_request_id(request))
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MANUAL_MEDIA_CANDIDATE_WRITE_UNKNOWN",
                message="Saved input response could not be attributed; query original only",
            )

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/manual-media-candidate-operations/{operation_id}",
        response_model=ManualMediaCandidateOperationResponse,
    )
    def original(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: Annotated[
            str,
            Path(
                pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
            ),
        ],
        payload_hash: Annotated[str, Query(pattern=r"^sha256:[0-9a-f]{64}$")],
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            data = ManualMediaCandidateStore(provider()).original_for_hash(
                project_id, episode_id, operation_id, payload_hash, actor.subject_id
            )
            return ManualMediaCandidateOperationResponse(data=data, request_id=_request_id(request))
        except Exception:
            return _error(
                request,
                status_code=404,
                code="MANUAL_MEDIA_CANDIDATE_OPERATION_UNKNOWN",
                message="Original full input is not attributable; do not resend",
            )

    return router
