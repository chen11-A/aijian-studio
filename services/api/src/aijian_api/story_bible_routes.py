"""Public typed StoryBible reads."""

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Request, Response

from aijian_api.contracts import (
    ArtifactHeadData,
    ErrorResponse,
    StoryBibleData,
    StoryBibleResponse,
    StoryBibleVersionData,
)
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.repository import StudioRepository
from aijian_api.story_bible import StoryBibleContentV1

type RepositoryProvider = Callable[[], StudioRepository]


_SHARED_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    422: {"description": "Request validation failed", "model": ErrorResponse},
}


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _story_bible_data(record: ArtifactVersionRecord) -> StoryBibleData:
    version = record.version
    return StoryBibleData(
        head=ArtifactHeadData.model_validate(record.head),
        latest_version=StoryBibleVersionData(
            id=version.id,
            artifact_id=version.artifact_id,
            version_number=version.version_number,
            schema_version="1.0.0",
            content=StoryBibleContentV1.model_validate(version.content),
            content_hash=version.content_hash,
            parent_version_id=version.parent_version_id,
            change_summary=version.change_summary,
            created_at=version.created_at,
        ),
    )


def create_story_bible_public_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/story-bible",
        operation_id="getStoryBible",
        response_model=StoryBibleResponse,
        responses={
            **_SHARED_ERRORS,
            404: {"description": "Project or StoryBible not found", "model": ErrorResponse},
        },
    )
    def get_story_bible(
        request: Request,
        response: Response,
        project_id: str,
    ) -> StoryBibleResponse:
        record = repository_provider().get_latest_artifact(project_id, "story_bible")
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return StoryBibleResponse(
            data=_story_bible_data(record),
            request_id=_request_id(request),
        )

    return router
