"""Public typed StoryBible version reads and draft creation."""

import re
from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status
from pydantic import ValidationError

from aijian_api.application_errors import (
    PreconditionFailedError,
    PreconditionRequiredError,
    StoryBiblePayloadTooLargeError,
)
from aijian_api.contracts import (
    MAX_STORY_BIBLE_RESPONSE_BYTES,
    MAX_STORY_BIBLE_SOURCE_SPANS,
    VERSION_ID_PATTERN,
    ArtifactHeadData,
    CreateStoryBibleVersionRequest,
    ErrorResponse,
    StoryBibleIndexData,
    StoryBibleIndexResponse,
    StoryBibleVersionCreatedData,
    StoryBibleVersionCreatedResponse,
    StoryBibleVersionData,
    StoryBibleVersionReadData,
    StoryBibleVersionResponse,
    StoryBibleVersionSummaryData,
    StorySourceSpanData,
)
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactRoleIndex,
    ArtifactSourceSpanDraft,
    ArtifactVersionPayloadMetrics,
    ArtifactVersionRecord,
    ArtifactVersionSummary,
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


def _enforce_story_bible_response_size(
    payload: StoryBibleVersionResponse | StoryBibleVersionCreatedResponse,
) -> None:
    if len(payload.model_dump_json().encode("utf-8")) > MAX_STORY_BIBLE_RESPONSE_BYTES:
        raise StoryBiblePayloadTooLargeError


def _enforce_story_bible_preflight_size(metrics: ArtifactVersionPayloadMetrics) -> None:
    if (
        metrics.source_span_count > MAX_STORY_BIBLE_SOURCE_SPANS
        or metrics.minimum_materialized_json_bytes > MAX_STORY_BIBLE_RESPONSE_BYTES
    ):
        raise StoryBiblePayloadTooLargeError


def _story_bible_index_data(
    project_id: str,
    index: ArtifactRoleIndex,
) -> StoryBibleIndexData:
    summaries = {summary.id: summary for summary in index.versions}

    def version_for(version_id: str | None) -> StoryBibleVersionSummaryData | None:
        if version_id is None:
            return None
        return _story_bible_version_summary_data(summaries[version_id])

    return StoryBibleIndexData(
        project_id=project_id,
        head=ArtifactHeadData.model_validate(index.head),
        latest_version=_story_bible_version_summary_data(summaries[index.head.latest_version_id]),
        review_version=version_for(index.head.review_version_id),
        accepted_version=version_for(index.head.accepted_version_id),
    )


def _story_bible_version_summary_data(
    version: ArtifactVersionSummary,
) -> StoryBibleVersionSummaryData:
    return StoryBibleVersionSummaryData(
        id=version.id,
        artifact_id=version.artifact_id,
        version_number=version.version_number,
        schema_version="1.0.0",
        content_hash=version.content_hash,
        parent_version_id=version.parent_version_id,
        change_summary=version.change_summary,
        created_at=version.created_at,
    )


def _story_bible_version_data(record: ArtifactVersionRecord) -> StoryBibleVersionData:
    version = record.version
    return StoryBibleVersionData(
        id=version.id,
        artifact_id=version.artifact_id,
        version_number=version.version_number,
        schema_version="1.0.0",
        content=StoryBibleContentV1.model_validate(version.content),
        source_spans=[
            StorySourceSpanData(
                id=span.id,
                fact_id=span.fact_id,
                source_document_id=span.source_document_id,
                source_block_id=span.source_block_id,
                role=span.role,
                start_byte=span.start_byte,
                end_byte=span.end_byte,
                claim=span.claim,
                quote_hash=span.quote_hash,
            )
            for span in sorted(
                record.source_spans,
                key=lambda item: (item.fact_id, item.start_byte, item.id),
            )
        ],
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
        operation_id="getStoryBibleIndex",
        response_model=StoryBibleIndexResponse,
        responses={
            **_SHARED_ERRORS,
            404: {"description": "Project or StoryBible not found", "model": ErrorResponse},
        },
    )
    def get_story_bible(
        request: Request,
        response: Response,
        project_id: str,
    ) -> StoryBibleIndexResponse:
        repository = repository_provider()
        index = repository.get_artifact_role_index(project_id, "story_bible")
        response.headers["ETag"] = f'"revision-{index.head.revision}"'
        return StoryBibleIndexResponse(
            data=_story_bible_index_data(project_id, index),
            request_id=_request_id(request),
        )

    @router.get(
        "/api/v1/projects/{project_id}/story-bible/versions/{version_id}",
        operation_id="getStoryBibleVersion",
        response_model=StoryBibleVersionResponse,
        responses={
            **_SHARED_ERRORS,
            404: {"description": "Project or StoryBible version not found", "model": ErrorResponse},
            413: {"description": "StoryBible response too large", "model": ErrorResponse},
        },
    )
    def get_story_bible_version(
        request: Request,
        response: Response,
        project_id: str,
        version_id: Annotated[str, Path(pattern=VERSION_ID_PATTERN)],
    ) -> StoryBibleVersionResponse:
        repository = repository_provider()
        try:
            record = repository.get_artifact_version(
                project_id,
                "story_bible",
                version_id,
                payload_metrics_validator=_enforce_story_bible_preflight_size,
            )
        except ArtifactConflictError as error:
            raise ArtifactNotFoundError("story_bible") from error
        response.headers["ETag"] = f'"{record.version.content_hash}"'
        try:
            payload = StoryBibleVersionResponse(
                data=StoryBibleVersionReadData(
                    project_id=project_id,
                    head=ArtifactHeadData.model_validate(record.head),
                    version=_story_bible_version_data(record),
                ),
                request_id=_request_id(request),
            )
        except ValidationError as error:
            raise StoryBiblePayloadTooLargeError from error
        _enforce_story_bible_response_size(payload)
        return payload

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
            413: {"description": "StoryBible response too large", "model": ErrorResponse},
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
        request_id = _request_id(request)

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

        def validate_final_response(record: ArtifactVersionRecord) -> None:
            resolved = resolved_holder[0]
            try:
                payload = StoryBibleVersionCreatedResponse(
                    data=StoryBibleVersionCreatedData(
                        head=ArtifactHeadData.model_validate(record.head),
                        version=_story_bible_version_data(record),
                        id_map=resolved.id_map,
                    ),
                    request_id=request_id,
                )
            except ValidationError as error:
                raise StoryBiblePayloadTooLargeError from error
            _enforce_story_bible_response_size(payload)

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
            record_validator=validate_final_response,
        )
        resolved = resolved_holder[0]
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        created_response = StoryBibleVersionCreatedResponse(
            data=StoryBibleVersionCreatedData(
                head=ArtifactHeadData.model_validate(record.head),
                version=_story_bible_version_data(record),
                id_map=resolved.id_map,
            ),
            request_id=request_id,
        )
        _enforce_story_bible_response_size(created_response)
        return created_response

    return router
