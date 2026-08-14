"""Electron-main-only trusted G2 StoryBible review actions."""

import re
from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response

from aijian_api.application_errors import (
    PreconditionFailedError,
    PreconditionRequiredError,
)
from aijian_api.contracts import (
    PROJECT_ID_PATTERN,
    VERSION_ID_PATTERN,
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
)
from aijian_api.domain import (
    PreparedReviewAction,
    ReviewSignoffResult,
    ReviewSubmissionResult,
    TrustedReviewActor,
)
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]
type ProjectIdPath = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
type VersionIdPath = Annotated[str, Path(pattern=VERSION_ID_PATTERN)]

G2_SIGNOFF_ROLES = ("writer", "continuity_reviewer", "producer")
G2_DECISION_ROLE = "producer"

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


def create_story_bible_internal_router(
    repository_provider: RepositoryProvider,
    trusted_review_actor: TrustedReviewActor,
) -> APIRouter:
    """Create authenticated G2 routes used only by the Electron main process."""

    router = APIRouter(include_in_schema=False)

    @router.post(
        "/api/v1/internal/projects/{project_id}/story-bible/versions/{version_id}:prepare-submit",
        response_model=PreparedReviewActionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def prepare_submit(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        version_id: VersionIdPath,
        _payload: EmptyActionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> PreparedReviewActionResponse:
        revision = _expected_revision(if_match)
        prepared = repository_provider().prepare_review_action(
            project_id=project_id,
            artifact_type="story_bible",
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
        "/api/v1/internal/projects/{project_id}/story-bible/versions/{version_id}:submit",
        response_model=ReviewSubmissionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def submit(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        version_id: VersionIdPath,
        payload: ConfirmationRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> ReviewSubmissionResponse:
        result = repository_provider().submit_artifact_review(
            project_id=project_id,
            artifact_type="story_bible",
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
        "/api/v1/internal/projects/{project_id}/story-bible/versions/{version_id}:prepare-signoff",
        response_model=PreparedReviewActionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def prepare_signoff(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        version_id: VersionIdPath,
        _payload: EmptyActionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> PreparedReviewActionResponse:
        revision = _expected_revision(if_match)
        prepared = repository_provider().prepare_review_action(
            project_id=project_id,
            artifact_type="story_bible",
            version_id=version_id,
            action="signoff",
            action_payload={"roles": list(G2_SIGNOFF_ROLES)},
            actor=trusted_review_actor,
            expected_revision=revision,
        )
        _set_revision_etag(response, revision)
        return PreparedReviewActionResponse(
            data=_prepared_review_data(prepared), request_id=_request_id(request)
        )

    @router.post(
        "/api/v1/internal/projects/{project_id}/story-bible/versions/{version_id}/signoffs",
        response_model=ReviewSignoffResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def signoff(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        version_id: VersionIdPath,
        payload: ConfirmationRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> ReviewSignoffResponse:
        result = repository_provider().signoff_artifact_review(
            project_id=project_id,
            artifact_type="story_bible",
            version_id=version_id,
            roles=G2_SIGNOFF_ROLES,
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
        "/api/v1/internal/projects/{project_id}/story-bible/versions/{version_id}:prepare-decision",
        response_model=PreparedReviewActionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def prepare_decision(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        version_id: VersionIdPath,
        payload: PrepareGateDecisionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> PreparedReviewActionResponse:
        revision = _expected_revision(if_match)
        prepared = repository_provider().prepare_review_action(
            project_id=project_id,
            artifact_type="story_bible",
            version_id=version_id,
            action="decision",
            action_payload={
                "decision": payload.decision,
                "rationale": payload.rationale,
                "actor_role": G2_DECISION_ROLE,
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
        "/api/v1/internal/projects/{project_id}/story-bible/versions/{version_id}/decisions",
        response_model=GateDecisionResponse,
        responses=_ARTIFACT_ACTION_ERRORS,
    )
    def decide(
        request: Request,
        response: Response,
        project_id: ProjectIdPath,
        version_id: VersionIdPath,
        payload: GateDecisionRequest,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> GateDecisionResponse:
        result = repository_provider().decide_artifact_gate(
            project_id=project_id,
            artifact_type="story_bible",
            version_id=version_id,
            decision=payload.decision,
            rationale=payload.rationale,
            expected_revision=_expected_revision(if_match),
            challenge_id=payload.challenge_id,
            confirmation_token=payload.confirmation_token,
            actor=trusted_review_actor,
            actor_role=G2_DECISION_ROLE,
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
