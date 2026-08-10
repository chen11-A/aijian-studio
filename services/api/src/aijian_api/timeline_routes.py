"""Project-scoped API for immutable timeline creation and editing."""

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Request, Response, status

from aijian_api.contracts import (
    CreateTimelineRequest,
    ErrorResponse,
    ReorderTimelineClipRequest,
    ReplaceTimelineClipRequest,
    TimelineData,
    TimelineResponse,
    TrimTimelineClipRequest,
)
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.repository import ArtifactConflictError, ArtifactNotFoundError, StudioRepository
from aijian_api.timeline import TimelineVersionV1, reorder_clip, replace_clip, trim_clip

type RepositoryProvider = Callable[[], StudioRepository]


class TimelineAlreadyExistsError(RuntimeError):
    """The one timeline artifact for a project has already been created."""


class TimelineRevisionConflictError(RuntimeError):
    """An edit was based on a stale timeline revision."""


_SHARED_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    404: {"description": "Project or timeline not found", "model": ErrorResponse},
    409: {"description": "Timeline command rejected", "model": ErrorResponse},
    422: {"description": "Request validation failed", "model": ErrorResponse},
}


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def timeline_response(
    project_id: str,
    record: ArtifactVersionRecord,
    request: Request,
) -> TimelineResponse:
    timeline = TimelineVersionV1.model_validate(record.version.content)
    if timeline.revision != record.head.revision:
        raise RuntimeError("Persisted timeline revision does not match its artifact head")
    return TimelineResponse(
        data=TimelineData(
            project_id=project_id,
            version_id=record.version.id,
            content_hash=record.version.content_hash,
            created_at=record.version.created_at,
            total_duration_frames=timeline.total_duration_frames,
            timeline=timeline,
        ),
        request_id=_request_id(request),
    )


def _latest(repository: StudioRepository, project_id: str) -> ArtifactVersionRecord:
    return repository.get_latest_artifact(project_id, "timeline")


def _append(
    repository: StudioRepository,
    project_id: str,
    previous: ArtifactVersionRecord,
    timeline: TimelineVersionV1,
    summary: str,
) -> ArtifactVersionRecord:
    try:
        return repository.create_artifact_version(
            project_id=project_id,
            artifact_type="timeline",
            schema_version="1.0.0",
            content=timeline.model_dump(mode="python", exclude_computed_fields=True),
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary=summary,
            parent_version_id=previous.version.id,
            expected_revision=previous.head.revision,
        )
    except ArtifactConflictError as error:
        raise TimelineRevisionConflictError from error


def create_timeline_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/timeline",
        operation_id="getProjectTimeline",
        response_model=TimelineResponse,
        responses=_SHARED_ERRORS,
    )
    def get_timeline(request: Request, response: Response, project_id: str) -> TimelineResponse:
        record = _latest(repository_provider(), project_id)
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return timeline_response(project_id, record, request)

    @router.post(
        "/api/v1/projects/{project_id}/timeline",
        operation_id="createProjectTimeline",
        response_model=TimelineResponse,
        status_code=status.HTTP_201_CREATED,
        responses=_SHARED_ERRORS,
    )
    def create_timeline(
        request: Request,
        response: Response,
        project_id: str,
        payload: CreateTimelineRequest,
    ) -> TimelineResponse:
        repository = repository_provider()
        repository.get_project(project_id)
        try:
            _latest(repository, project_id)
        except ArtifactNotFoundError:
            pass
        else:
            raise TimelineAlreadyExistsError
        timeline = TimelineVersionV1(
            timeline_id=payload.timeline_id,
            revision=1,
            sequence_timebase=payload.sequence_timebase,
            width=payload.width,
            height=payload.height,
            assets=payload.assets,
            clips=payload.clips,
        )
        try:
            record = repository.create_artifact_version(
                project_id=project_id,
                artifact_type="timeline",
                schema_version="1.0.0",
                content=timeline.model_dump(mode="python", exclude_computed_fields=True),
                author_actor_type="system",
                author_actor_id="timeline-builder",
                change_summary="建立基础时间线",
            )
        except ArtifactConflictError as error:
            raise TimelineAlreadyExistsError from error
        response.headers["ETag"] = '"revision-1"'
        return timeline_response(project_id, record, request)

    @router.post(
        "/api/v1/projects/{project_id}/timeline/trim",
        operation_id="trimTimelineClip",
        response_model=TimelineResponse,
        responses=_SHARED_ERRORS,
    )
    def trim(
        request: Request,
        response: Response,
        project_id: str,
        payload: TrimTimelineClipRequest,
    ) -> TimelineResponse:
        repository = repository_provider()
        previous = _latest(repository, project_id)
        timeline = trim_clip(
            TimelineVersionV1.model_validate(previous.version.content),
            payload.clip_id,
            new_source_in_frame=payload.new_source_in_frame,
            new_duration_frames=payload.new_duration_frames,
            expected_revision=payload.expected_revision,
        )
        record = _append(repository, project_id, previous, timeline, "裁剪镜头")
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return timeline_response(project_id, record, request)

    @router.post(
        "/api/v1/projects/{project_id}/timeline/reorder",
        operation_id="reorderTimelineClip",
        response_model=TimelineResponse,
        responses=_SHARED_ERRORS,
    )
    def reorder(
        request: Request,
        response: Response,
        project_id: str,
        payload: ReorderTimelineClipRequest,
    ) -> TimelineResponse:
        repository = repository_provider()
        previous = _latest(repository, project_id)
        timeline = reorder_clip(
            TimelineVersionV1.model_validate(previous.version.content),
            payload.clip_id,
            new_index=payload.new_index,
            expected_revision=payload.expected_revision,
        )
        record = _append(repository, project_id, previous, timeline, "调整镜头顺序")
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return timeline_response(project_id, record, request)

    @router.post(
        "/api/v1/projects/{project_id}/timeline/replace",
        operation_id="replaceTimelineClip",
        response_model=TimelineResponse,
        responses=_SHARED_ERRORS,
    )
    def replace(
        request: Request,
        response: Response,
        project_id: str,
        payload: ReplaceTimelineClipRequest,
    ) -> TimelineResponse:
        repository = repository_provider()
        previous = _latest(repository, project_id)
        timeline = replace_clip(
            TimelineVersionV1.model_validate(previous.version.content),
            payload.clip_id,
            replacement_asset_id=payload.replacement_asset_id,
            replacement_source_in_frame=payload.replacement_source_in_frame,
            expected_revision=payload.expected_revision,
        )
        record = _append(repository, project_id, previous, timeline, "替换镜头素材")
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return timeline_response(project_id, record, request)

    return router
