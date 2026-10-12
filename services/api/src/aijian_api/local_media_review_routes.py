"""Authenticated local self observation reads; native-only explicit writes."""

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
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN
from aijian_api.local_media_review_contracts import (
    OPERATION_ID_PATTERN,
    SEGMENT_ID_PATTERN,
    CreateLocalMediaReviewRequest,
    LocalMediaReviewKind,
    LocalMediaReviewOperationResponse,
    LocalMediaReviewPageResponse,
    LocalMediaReviewResponse,
    LocalMediaReviewStatusResponse,
    LocalMediaReviewTargetResponse,
)
from aijian_api.local_media_review_store import LocalMediaReviewError, LocalMediaReviewStore
from aijian_api.repository import ArtifactConflictError, EpisodeNotFoundError, ProjectNotFoundError

VersionId = Annotated[str, Path(pattern=VERSION_ID_PATTERN)]
ROOT = "/api/v1/projects/{project_id}/episodes/{episode_id}"


def _failure(request: Request, error: Exception) -> Any:
    if isinstance(error, LocalMediaReviewError):
        result = _error(request, status_code=error.status, code=error.code, message=str(error))
    elif (
        isinstance(error, (ProjectNotFoundError, EpisodeNotFoundError))
        or isinstance(error, ArtifactConflictError)
        and str(error) == "Artifact version was not found"
    ):
        result = _error(
            request,
            status_code=404,
            code="LOCAL_MEDIA_REVIEW_NOT_FOUND",
            message="Exact local review scope or version was not found",
        )
    else:
        result = _error(
            request,
            status_code=503,
            code="LOCAL_MEDIA_REVIEW_READ_UNKNOWN",
            message="Exact local self observation could not be verified",
        )
    result.headers["Cache-Control"] = "no-store"
    return result


def create_local_media_review_public_router(provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        ROOT + "/media-assembly/versions/{version_id}/local-review-target",
        operation_id="getLocalMediaReviewTarget",
        response_model=LocalMediaReviewTargetResponse,
    )
    def target(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
        expected_content_hash: Annotated[str, Query(pattern=CONTENT_HASH_PATTERN)],
        segment_kind: LocalMediaReviewKind,
        segment_id: Annotated[str, Query(pattern=SEGMENT_ID_PATTERN)],
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            return LocalMediaReviewTargetResponse(
                data=LocalMediaReviewStore(provider()).target(
                    project_id,
                    episode_id,
                    version_id,
                    expected_content_hash,
                    segment_kind,
                    segment_id,
                ),
                request_id=_request_id(request),
            )
        except Exception as error:
            return _failure(request, error)

    @router.get(
        ROOT + "/local-media-reviews",
        operation_id="listLocalMediaReviews",
        response_model=LocalMediaReviewPageResponse,
    )
    def list_records(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        cursor: Annotated[str | None, Query(pattern=VERSION_ID_PATTERN)] = None,
        limit: Annotated[int, Query(ge=1, le=20)] = 20,
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            return LocalMediaReviewPageResponse(
                data=LocalMediaReviewStore(provider()).list(project_id, episode_id, cursor, limit),
                request_id=_request_id(request),
            )
        except Exception as error:
            return _failure(request, error)

    @router.get(
        ROOT + "/local-media-reviews/versions/{version_id}",
        operation_id="getLocalMediaReview",
        response_model=LocalMediaReviewResponse,
    )
    def get_record(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            return LocalMediaReviewResponse(
                data=LocalMediaReviewStore(provider()).get(project_id, episode_id, version_id),
                request_id=_request_id(request),
            )
        except Exception as error:
            return _failure(request, error)

    @router.get(
        ROOT + "/local-media-reviews/versions/{version_id}/status",
        operation_id="getLocalMediaReviewStatus",
        response_model=LocalMediaReviewStatusResponse,
    )
    def status(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        version_id: VersionId,
        expected_content_hash: Annotated[str, Query(pattern=CONTENT_HASH_PATTERN)],
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            return LocalMediaReviewStatusResponse(
                data=LocalMediaReviewStore(provider()).status(
                    project_id, episode_id, version_id, expected_content_hash
                ),
                request_id=_request_id(request),
            )
        except Exception as error:
            return _failure(request, error)

    return router


def create_local_media_review_native_router(
    provider: RepositoryProvider, actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.post(
        ROOT + "/local-media-reviews",
        response_model=LocalMediaReviewOperationResponse,
        status_code=201,
    )
    def save(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: CreateLocalMediaReviewRequest,
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
        if actor.subject_id != "local-user" or "writer" not in actor.roles:
            return _error(
                request,
                status_code=403,
                code="LOCAL_MEDIA_REVIEW_ACTOR_FORBIDDEN",
                message="Trusted local writer role is required",
            )
        try:
            data = LocalMediaReviewStore(provider()).write(
                project_id, episode_id, idempotency_key, payload, actor.subject_id
            )
        except LocalMediaReviewError as error:
            # Only pre-commit domain rejections reach this branch.
            return _error(request, status_code=error.status, code=error.code, message=str(error))
        except (EpisodeNotFoundError, ProjectNotFoundError):
            return _error(
                request,
                status_code=404,
                code="LOCAL_MEDIA_REVIEW_SCOPE_NOT_FOUND",
                message="Exact episode scope was not found",
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="LOCAL_MEDIA_REVIEW_WRITE_UNKNOWN",
                message="Write could not be attributed; query original only",
            )
        try:
            return LocalMediaReviewOperationResponse(data=data, request_id=_request_id(request))
        except Exception:
            return _error(
                request,
                status_code=500,
                code="LOCAL_MEDIA_REVIEW_WRITE_UNKNOWN",
                message="Saved response could not be attributed; query original only",
            )

    @router.get(
        ROOT + "/local-media-review-operations/{operation_id}",
        response_model=LocalMediaReviewOperationResponse,
    )
    def original(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        operation_id: Annotated[str, Path(pattern=OPERATION_ID_PATTERN)],
        payload_hash: Annotated[str, Query(pattern=CONTENT_HASH_PATTERN)],
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        if actor.subject_id != "local-user" or "writer" not in actor.roles:
            return _error(
                request,
                status_code=403,
                code="LOCAL_MEDIA_REVIEW_ACTOR_FORBIDDEN",
                message="Trusted local writer role is required",
            )
        try:
            return LocalMediaReviewOperationResponse(
                data=LocalMediaReviewStore(provider()).original(
                    project_id, episode_id, operation_id, payload_hash, actor.subject_id
                ),
                request_id=_request_id(request),
            )
        except Exception as error:
            return _failure(request, error)

    return router
