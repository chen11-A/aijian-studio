"""Read and sidecar-only draft writes for immutable ProductionBrief versions."""

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status

from aijian_api.application_errors import PreconditionRequiredError
from aijian_api.artifacts import canonical_content_hash
from aijian_api.contracts import (
    ArtifactHeadData,
    CreateProductionBriefVersionRequest,
    ErrorResponse,
    ProductionBriefReadData,
    ProductionBriefResponse,
    ProductionBriefVersionCreatedResponse,
    ProductionBriefVersionData,
)
from aijian_api.domain import ArtifactVersionRecord, TrustedReviewActor
from aijian_api.production_brief import ProductionBriefContentV1
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    ArtifactNotFoundError,
    StudioRepository,
)

type RepositoryProvider = Callable[[], StudioRepository]


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _data(project_id: str, record: ArtifactVersionRecord) -> ProductionBriefReadData:
    version = record.version
    return ProductionBriefReadData(
        project_id=project_id,
        head=ArtifactHeadData.model_validate(record.head),
        version=ProductionBriefVersionData(
            id=version.id,
            artifact_id=version.artifact_id,
            version_number=version.version_number,
            schema_version="1.0.0",
            content=ProductionBriefContentV1.model_validate(version.content),
            content_hash=version.content_hash,
            parent_version_id=version.parent_version_id,
            change_summary=version.change_summary,
            created_at=version.created_at,
        ),
    )


def create_production_brief_public_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/production-brief",
        operation_id="getProductionBrief",
        response_model=ProductionBriefResponse,
        responses={404: {"description": "ProductionBrief not found", "model": ErrorResponse}},
    )
    def get_production_brief(
        request: Request, project_id: str, response: Response
    ) -> ProductionBriefResponse:
        record = repository_provider().get_latest_artifact(project_id, "production_brief")
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return ProductionBriefResponse(
            data=_data(project_id, record), request_id=_request_id(request)
        )

    @router.get(
        "/api/v1/projects/{project_id}/production-brief/versions/{version_id}",
        operation_id="getProductionBriefVersion",
        response_model=ProductionBriefResponse,
        responses={
            404: {"description": "ProductionBrief version not found", "model": ErrorResponse}
        },
    )
    def get_production_brief_version(
        request: Request, project_id: str, version_id: str, response: Response
    ) -> ProductionBriefResponse:
        try:
            record = repository_provider().get_artifact_version(
                project_id, "production_brief", version_id
            )
        except ArtifactConflictError as error:
            raise ArtifactNotFoundError("production_brief") from error
        response.headers["ETag"] = f'"{record.version.content_hash}"'
        return ProductionBriefResponse(
            data=_data(project_id, record), request_id=_request_id(request)
        )

    return router


def create_production_brief_write_router(
    repository_provider: RepositoryProvider, trusted_actor: TrustedReviewActor
) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.post(
        "/api/v1/projects/{project_id}/production-brief/versions",
        operation_id="createProductionBriefVersion",
        response_model=ProductionBriefVersionCreatedResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def create_production_brief_version(
        request: Request,
        response: Response,
        project_id: str,
        payload: CreateProductionBriefVersionRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> ProductionBriefVersionCreatedResponse:
        if idempotency_key is None or not idempotency_key.strip():
            raise PreconditionRequiredError("Idempotency-Key is required")
        canonical_payload: dict[str, Any] = {
            "content": payload.content.model_dump(mode="json"),
            "parent_version_id": payload.parent_version_id,
            "expected_revision": payload.expected_revision,
            "change_summary": payload.change_summary,
        }
        try:
            record = repository_provider().write_production_brief(
                project_id=project_id,
                content=payload.content.model_dump(mode="json"),
                author_actor_id=trusted_actor.subject_id,
                change_summary=payload.change_summary,
                idempotency_key_hash=canonical_content_hash({"key": idempotency_key}),
                request_hash=canonical_content_hash(canonical_payload),
                parent_version_id=payload.parent_version_id,
                expected_revision=payload.expected_revision,
            )
        except ArtifactConflictError as error:
            raise ArtifactDependencyInvalidError("ProductionBrief revision conflict") from error
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return ProductionBriefVersionCreatedResponse(
            data=_data(project_id, record), request_id=_request_id(request)
        )

    return router
