"""Public typed StoryBible version reads and draft creation."""

import re
from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status

from aijian_api.application_errors import PreconditionFailedError, PreconditionRequiredError
from aijian_api.contracts import (
    ArtifactHeadData,
    CreateStoryBibleVersionRequest,
    ErrorResponse,
    StoryBibleData,
    StoryBibleResponse,
    StoryBibleVersionCreatedData,
    StoryBibleVersionCreatedResponse,
    StoryBibleVersionData,
)
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactSourceSpanDraft,
    ArtifactVersionRecord,
    TrustedReviewActor,
)
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    ArtifactNotFoundError,
    StudioRepository,
)
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.story_bible import StoryBibleContentV1
from aijian_api.story_bible_drafts import (
    ResolvedStoryBibleDraft,
    StoryBibleDraftInvalidError,
    resolve_story_bible_draft,
)
from aijian_api.story_bible_validation import validate_story_bible_aggregate

type RepositoryProvider = Callable[[], StudioRepository]


_SHARED_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    422: {"description": "Request validation failed", "model": ErrorResponse},
}


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _story_bible_data(record: ArtifactVersionRecord) -> StoryBibleData:
    return StoryBibleData(
        head=ArtifactHeadData.model_validate(record.head),
        latest_version=_story_bible_version_data(record),
    )


def _story_bible_version_data(record: ArtifactVersionRecord) -> StoryBibleVersionData:
    version = record.version
    return StoryBibleVersionData(
        id=version.id,
        artifact_id=version.artifact_id,
        version_number=version.version_number,
        schema_version="1.0.0",
        content=StoryBibleContentV1.model_validate(version.content),
        content_hash=version.content_hash,
        parent_version_id=version.parent_version_id,
        change_summary=version.change_summary,
        created_at=version.created_at,
    )


def _expected_revision(if_match: str | None) -> int:
    if if_match is None:
        raise PreconditionRequiredError("If-Match is required")
    matched = re.fullmatch(r'"revision-([1-9][0-9]*)"', if_match)
    if matched is None:
        raise PreconditionFailedError("If-Match does not contain a valid artifact revision")
    return int(matched.group(1))


def create_story_bible_public_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
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

    @router.post(
        "/api/v1/projects/{project_id}/story-bible/versions",
        operation_id="createStoryBibleVersion",
        response_model=StoryBibleVersionCreatedResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            **_SHARED_ERRORS,
            404: {"description": "Project or parent artifact not found", "model": ErrorResponse},
            409: {
                "description": "Accepted source dependency is unavailable",
                "model": ErrorResponse,
            },
            412: {"description": "Artifact revision changed", "model": ErrorResponse},
            428: {"description": "If-Match is required for a revision", "model": ErrorResponse},
        },
    )
    def create_story_bible_version(
        request: Request,
        response: Response,
        project_id: str,
        payload: CreateStoryBibleVersionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> StoryBibleVersionCreatedResponse:
        repository = repository_provider()
        expected_revision = (
            _expected_revision(if_match) if payload.parent_version_id is not None else None
        )
        source_version_id = payload.content.source_scope.source_manifest_version_id
        try:
            source_record = repository.get_artifact_version(
                project_id,
                "source_manifest",
                source_version_id,
            )
        except ArtifactConflictError as error:
            raise ArtifactDependencyInvalidError(
                "StoryBible source version is unavailable"
            ) from error
        if source_record.head.accepted_version_id != source_version_id:
            raise ArtifactDependencyInvalidError("StoryBible source version is not accepted")
        source_manifest = SourceManifestContentV1.model_validate(source_record.version.content)
        previous_content = None
        if payload.parent_version_id is not None:
            try:
                parent_record = repository.get_artifact_version(
                    project_id,
                    "story_bible",
                    payload.parent_version_id,
                )
            except ArtifactConflictError as error:
                raise ArtifactNotFoundError("story_bible") from error
            previous_content = StoryBibleContentV1.model_validate(parent_record.version.content)

        resolved_holder: list[ResolvedStoryBibleDraft] = []

        def resolve_content(
            id_factory: Callable[[str], str],
        ) -> tuple[dict[str, object], tuple[ArtifactSourceSpanDraft, ...]]:
            try:
                resolved = resolve_story_bible_draft(
                    payload.content,
                    tuple(payload.source_spans),
                    id_factory=id_factory,
                    previous_content=previous_content,
                )
                validate_story_bible_aggregate(
                    resolved.content,
                    source_manifest_version_id=source_version_id,
                    source_manifest=source_manifest,
                    source_spans=resolved.source_spans,
                )
            except ValueError as error:
                raise StoryBibleDraftInvalidError("StoryBible draft is invalid") from error
            resolved_holder.append(resolved)
            return resolved.content.model_dump(mode="json"), resolved.source_spans

        record = repository.create_artifact_version(
            project_id=project_id,
            artifact_type="story_bible",
            schema_version="1.0.0",
            content=None,
            author_actor_type="human",
            author_actor_id=trusted_actor.subject_id,
            change_summary=payload.change_summary,
            parent_version_id=payload.parent_version_id,
            expected_revision=expected_revision,
            dependencies=(
                ArtifactDependencyDraft(
                    upstream_version_id=source_version_id,
                    relationship="derived_from",
                    impact="blocking",
                ),
            ),
            required_accepted_upstream_version_id=source_version_id,
            content_resolver=resolve_content,
        )
        resolved = resolved_holder[0]
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return StoryBibleVersionCreatedResponse(
            data=StoryBibleVersionCreatedData(
                head=ArtifactHeadData.model_validate(record.head),
                version=_story_bible_version_data(record),
                id_map=resolved.id_map,
            ),
            request_id=_request_id(request),
        )

    return router
