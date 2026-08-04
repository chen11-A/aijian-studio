"""Public SourceManifest reads and Electron-main-only G1 review actions."""

import re
from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response

from aijian_api.application_errors import (
    PreconditionFailedError,
    PreconditionRequiredError,
)
from aijian_api.contracts import (
    ArtifactHeadData,
    ConfirmationChallengeData,
    ConfirmationRequest,
    EmptyActionRequest,
    ErrorResponse,
    GateDecisionData,
    GateDecisionRequest,
    GateDecisionResponse,
    GateDecisionResultData,
    GateReadinessReportData,
    PreparedReviewActionData,
    PreparedReviewActionResponse,
    PrepareGateDecisionRequest,
    ReviewSignoffResponse,
    ReviewSignoffResultData,
    ReviewSubmissionData,
    ReviewSubmissionResponse,
    ReviewSubmissionResultData,
    RoleSignoffData,
    SourceManifestData,
    SourceManifestResponse,
    SourceManifestVersionData,
)
from aijian_api.domain import (
    ArtifactVersionRecord,
    PreparedReviewAction,
    ReviewSignoffResult,
    ReviewSubmissionResult,
    TrustedReviewActor,
)
from aijian_api.repository import StudioRepository
from aijian_api.source_manifest import SourceManifestContentV1

type RepositoryProvider = Callable[[], StudioRepository]


_SHARED_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    422: {"description": "Request validation failed", "model": ErrorResponse},
}
_ARTIFACT_ACTION_ERRORS: dict[int | str, dict[str, Any]] = {
    **_SHARED_ERRORS,
    404: {"description": "Project or artifact not found", "model": ErrorResponse},
    409: {"description": "Gate or review action rejected", "model": ErrorResponse},
    412: {"description": "Artifact revision changed", "model": ErrorResponse},
    428: {"description": "If-Match is required", "model": ErrorResponse},
}


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _source_manifest_version_data(record: ArtifactVersionRecord) -> SourceManifestVersionData:
    version = record.version
    return SourceManifestVersionData(
        id=version.id,
        artifact_id=version.artifact_id,
        version_number=version.version_number,
        schema_version="1.0.0",
        content=SourceManifestContentV1.model_validate(version.content),
        content_hash=version.content_hash,
        parent_version_id=version.parent_version_id,
        change_summary=version.change_summary,
        created_at=version.created_at,
    )


def _source_manifest_data(
    project_id: str,
    repository: StudioRepository,
    record: ArtifactVersionRecord,
) -> SourceManifestData:
    def version_for(version_id: str | None) -> SourceManifestVersionData | None:
        if version_id is None:
            return None
        if version_id == record.version.id:
            return _source_manifest_version_data(record)
        historical = repository.get_artifact_version(project_id, "source_manifest", version_id)
        return _source_manifest_version_data(historical)

    return SourceManifestData(
        project_id=project_id,
        head=ArtifactHeadData.model_validate(record.head),
        latest_version=_source_manifest_version_data(record),
        review_version=version_for(record.head.review_version_id),
        accepted_version=version_for(record.head.accepted_version_id),
    )


def _expected_revision(if_match: str | None) -> int:
    if if_match is None:
        raise PreconditionRequiredError("If-Match is required")
    matched = re.fullmatch(r'"revision-([1-9][0-9]*)"', if_match)
    if matched is None:
        raise PreconditionFailedError("If-Match does not contain a valid artifact revision")
    return int(matched.group(1))


def _set_revision_etag(response: Response, revision: int) -> None:
    response.headers["ETag"] = f'"revision-{revision}"'


def _prepared_review_data(prepared: PreparedReviewAction) -> PreparedReviewActionData:
    return PreparedReviewActionData(
        report=GateReadinessReportData.model_validate(prepared.report),
        challenge=ConfirmationChallengeData.model_validate(prepared.challenge),
        confirmation_token=prepared.confirmation_token,
    )


def _submission_result_data(result: ReviewSubmissionResult) -> ReviewSubmissionResultData:
    return ReviewSubmissionResultData(
        submission=ReviewSubmissionData.model_validate(result.submission),
        head=ArtifactHeadData.model_validate(result.head),
    )


def _signoff_result_data(result: ReviewSignoffResult) -> ReviewSignoffResultData:
    return ReviewSignoffResultData(
        signoffs=[RoleSignoffData.model_validate(signoff) for signoff in result.signoffs],
        head=ArtifactHeadData.model_validate(result.head),
    )


def create_source_manifest_public_router(
    repository_provider: RepositoryProvider,
) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/source-manifest",
        operation_id="getSourceManifest",
        response_model=SourceManifestResponse,
        responses={
            **_SHARED_ERRORS,
            404: {"description": "Project or SourceManifest not found", "model": ErrorResponse},
        },
    )
    def get_source_manifest(
        request: Request,
        response: Response,
        project_id: str,
    ) -> SourceManifestResponse:
        repository = repository_provider()
        record = repository.get_latest_artifact(project_id, "source_manifest")
        _set_revision_etag(response, record.head.revision)
        return SourceManifestResponse(
            data=_source_manifest_data(project_id, repository, record),
            request_id=_request_id(request),
        )

    return router


def create_source_manifest_internal_router(
    repository_provider: RepositoryProvider,
    trusted_review_actor: TrustedReviewActor,
) -> APIRouter:
    """Create authenticated G1 routes used only by the Electron main process."""

    router = APIRouter(include_in_schema=False)

    @router.post(
        "/api/v1/internal/projects/{project_id}/source-manifest/versions/"
        "{version_id}:prepare-submit",
        response_model=PreparedReviewActionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def prepare_submit(
        request: Request,
        response: Response,
        project_id: str,
        version_id: str,
        _payload: EmptyActionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> PreparedReviewActionResponse:
        revision = _expected_revision(if_match)
        prepared = repository_provider().prepare_review_action(
            project_id=project_id,
            artifact_type="source_manifest",
            version_id=version_id,
            action="submit",
            action_payload={},
            actor=trusted_review_actor,
            expected_revision=revision,
        )
        _set_revision_etag(response, revision)
        return PreparedReviewActionResponse(
            data=_prepared_review_data(prepared), request_id=_request_id(request)
        )

    @router.post(
        "/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}:submit",
        response_model=ReviewSubmissionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def submit(
        request: Request,
        response: Response,
        project_id: str,
        version_id: str,
        payload: ConfirmationRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> ReviewSubmissionResponse:
        result = repository_provider().submit_artifact_review(
            project_id=project_id,
            artifact_type="source_manifest",
            version_id=version_id,
            expected_revision=_expected_revision(if_match),
            challenge_id=payload.challenge_id,
            confirmation_token=payload.confirmation_token,
            actor=trusted_review_actor,
        )
        _set_revision_etag(response, result.head.revision)
        return ReviewSubmissionResponse(
            data=_submission_result_data(result), request_id=_request_id(request)
        )

    @router.post(
        "/api/v1/internal/projects/{project_id}/source-manifest/versions/"
        "{version_id}:prepare-signoff",
        response_model=PreparedReviewActionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def prepare_signoff(
        request: Request,
        response: Response,
        project_id: str,
        version_id: str,
        _payload: EmptyActionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> PreparedReviewActionResponse:
        revision = _expected_revision(if_match)
        prepared = repository_provider().prepare_review_action(
            project_id=project_id,
            artifact_type="source_manifest",
            version_id=version_id,
            action="signoff",
            action_payload={"roles": ["writer", "producer"]},
            actor=trusted_review_actor,
            expected_revision=revision,
        )
        _set_revision_etag(response, revision)
        return PreparedReviewActionResponse(
            data=_prepared_review_data(prepared), request_id=_request_id(request)
        )

    @router.post(
        "/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}/signoffs",
        response_model=ReviewSignoffResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def signoff(
        request: Request,
        response: Response,
        project_id: str,
        version_id: str,
        payload: ConfirmationRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> ReviewSignoffResponse:
        result = repository_provider().signoff_artifact_review(
            project_id=project_id,
            artifact_type="source_manifest",
            version_id=version_id,
            roles=("writer", "producer"),
            expected_revision=_expected_revision(if_match),
            challenge_id=payload.challenge_id,
            confirmation_token=payload.confirmation_token,
            actor=trusted_review_actor,
        )
        _set_revision_etag(response, result.head.revision)
        return ReviewSignoffResponse(
            data=_signoff_result_data(result), request_id=_request_id(request)
        )

    @router.post(
        "/api/v1/internal/projects/{project_id}/source-manifest/versions/"
        "{version_id}:prepare-decision",
        response_model=PreparedReviewActionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def prepare_decision(
        request: Request,
        response: Response,
        project_id: str,
        version_id: str,
        payload: PrepareGateDecisionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> PreparedReviewActionResponse:
        revision = _expected_revision(if_match)
        prepared = repository_provider().prepare_review_action(
            project_id=project_id,
            artifact_type="source_manifest",
            version_id=version_id,
            action="decision",
            action_payload={
                "decision": payload.decision,
                "rationale": payload.rationale,
                "actor_role": "producer",
            },
            actor=trusted_review_actor,
            readiness_report_id=payload.readiness_report_id,
            expected_revision=revision,
        )
        _set_revision_etag(response, revision)
        return PreparedReviewActionResponse(
            data=_prepared_review_data(prepared), request_id=_request_id(request)
        )

    @router.post(
        "/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}/decisions",
        response_model=GateDecisionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def decide(
        request: Request,
        response: Response,
        project_id: str,
        version_id: str,
        payload: GateDecisionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> GateDecisionResponse:
        result = repository_provider().decide_artifact_gate(
            project_id=project_id,
            artifact_type="source_manifest",
            version_id=version_id,
            decision=payload.decision,
            rationale=payload.rationale,
            expected_revision=_expected_revision(if_match),
            challenge_id=payload.challenge_id,
            confirmation_token=payload.confirmation_token,
            actor=trusted_review_actor,
            actor_role="producer",
        )
        _set_revision_etag(response, result.head.revision)
        return GateDecisionResponse(
            data=GateDecisionResultData(
                decision=GateDecisionData.model_validate(result.decision),
                head=ArtifactHeadData.model_validate(result.head),
            ),
            request_id=_request_id(request),
        )

    return router
