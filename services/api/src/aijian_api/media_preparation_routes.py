"""Local preparation history, native write and GET-only exact attribution."""

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
from aijian_api.media_preparation_contracts import (
    CreateMediaPreparationRequest,
    MediaPreparationOperationResponse,
    MediaPreparationPageResponse,
    MediaPreparationResponse,
)
from aijian_api.media_preparation_store import (
    MediaPreparationConflict,
    MediaPreparationError,
    MediaPreparationStore,
)
from aijian_api.repository import EpisodeNotFoundError, ProjectNotFoundError

VersionId = Annotated[str, Path(pattern=VERSION_ID_PATTERN)]


def create_media_preparation_public_router(provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/media-preparations",
        operation_id="listMediaPreparations",
        response_model=MediaPreparationPageResponse,
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
            return MediaPreparationPageResponse(
                data=MediaPreparationStore(provider()).list(project_id, episode_id, cursor),
                request_id=_request_id(request),
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MEDIA_PREPARATION_READ_UNKNOWN",
                message="Exact preparation history could not be verified",
            )

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/media-preparations/{version_id}",
        operation_id="getMediaPreparation",
        response_model=MediaPreparationResponse,
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
            return MediaPreparationResponse(
                data=MediaPreparationStore(provider()).get(project_id, episode_id, version_id),
                request_id=_request_id(request),
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MEDIA_PREPARATION_READ_UNKNOWN",
                message="Exact preparation input could not be verified",
            )

    return router


def create_media_preparation_native_router(
    provider: RepositoryProvider, actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.post(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/media-preparations",
        response_model=MediaPreparationOperationResponse,
        status_code=201,
    )
    def save_input(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateMediaPreparationRequest,
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
        try:
            data = MediaPreparationStore(provider()).write(
                project_id, episode_id, idempotency_key, payload, actor.subject_id
            )
        except MediaPreparationConflict:
            return _error(
                request,
                status_code=409,
                code="MEDIA_PREPARATION_CONFLICT",
                message="Preparation CAS or original input differs",
            )
        except (MediaPreparationError, ValueError):
            return _error(
                request,
                status_code=422,
                code="MEDIA_PREPARATION_INPUT_REJECTED",
                message="Exact preparation input was rejected",
            )
        except (EpisodeNotFoundError, ProjectNotFoundError):
            return _error(
                request,
                status_code=404,
                code="MEDIA_PREPARATION_SCOPE_NOT_FOUND",
                message="Exact episode scope was not found",
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MEDIA_PREPARATION_WRITE_UNKNOWN",
                message="Write could not be attributed; query original input only",
            )
        # The transaction has committed. A response construction failure proves
        # neither rejection nor absence; preserve the original intent as UNKNOWN.
        try:
            return MediaPreparationOperationResponse(data=data, request_id=_request_id(request))
        except Exception:
            return _error(
                request,
                status_code=500,
                code="MEDIA_PREPARATION_WRITE_UNKNOWN",
                message="Saved input response could not be attributed; query original only",
            )

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/media-preparation-operations/{operation_id}",
        response_model=MediaPreparationOperationResponse,
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
            data = MediaPreparationStore(provider()).original_for_hash(
                project_id, episode_id, operation_id, payload_hash, actor.subject_id
            )
            return MediaPreparationOperationResponse(data=data, request_id=_request_id(request))
        except Exception:
            return _error(
                request,
                status_code=404,
                code="MEDIA_PREPARATION_OPERATION_UNKNOWN",
                message="Original full input is not attributable; do not resend",
            )

    return router
