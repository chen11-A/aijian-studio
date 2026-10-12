"""Immutable source-impact history; original-operation recovery stays native-only."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Request, Response

from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_script_confirmation_contracts import CreateEpisodeScriptConfirmationRequest
from aijian_api.episode_script_confirmation_routes import (
    ConfirmationId,
    EpisodeId,
    ProjectId,
    RepositoryProvider,
    _error,
    _request_id,
)
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN
from aijian_api.script_confirmation_impact_contracts import (
    REPORT_ID_PATTERN,
    ScriptConfirmationImpactLookupResponse,
    ScriptConfirmationImpactPageResponse,
    ScriptConfirmationImpactResponse,
    ScriptConfirmationOperationResponse,
)
from aijian_api.script_confirmation_impact_store import (
    ScriptConfirmationImpactNotFoundError,
    ScriptConfirmationImpactStore,
)

ReportId = Annotated[str, Path(pattern=REPORT_ID_PATTERN)]


def create_script_confirmation_impact_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/script-confirmation-impacts",
        operation_id="listScriptConfirmationImpacts",
        response_model=ScriptConfirmationImpactPageResponse,
    )
    def list_reports(
        request: Request,
        response: Response,
        project_id: ProjectId,
        cursor: Annotated[str | None, Query(pattern=REPORT_ID_PATTERN)] = None,
        limit: Annotated[int, Query(ge=1, le=50)] = 20,
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            data = ScriptConfirmationImpactStore(repository_provider()).list_page(
                project_id,
                cursor=cursor,
                limit=limit,
            )
            return ScriptConfirmationImpactPageResponse(data=data, request_id=_request_id(request))
        except ScriptConfirmationImpactNotFoundError:
            return _error(
                request,
                status_code=404,
                code="SCRIPT_IMPACT_NOT_FOUND",
                message="Exact project history or cursor was not found",
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="SCRIPT_IMPACT_READ_FAILED",
                message="Immutable confirmation history could not be verified",
            )

    @router.get(
        "/api/v1/projects/{project_id}/script-confirmation-impacts/{report_id}",
        operation_id="getScriptConfirmationImpact",
        response_model=ScriptConfirmationImpactResponse,
    )
    def get_report(
        request: Request, response: Response, project_id: ProjectId, report_id: ReportId
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            data = ScriptConfirmationImpactStore(repository_provider()).get(project_id, report_id)
            return ScriptConfirmationImpactResponse(data=data, request_id=_request_id(request))
        except ScriptConfirmationImpactNotFoundError:
            return _error(
                request,
                status_code=404,
                code="SCRIPT_IMPACT_NOT_FOUND",
                message="Exact project report was not found",
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="SCRIPT_IMPACT_READ_FAILED",
                message="Immutable confirmation impact could not be verified",
            )

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/script/confirmations/{confirmation_id}/impact",
        operation_id="getScriptConfirmationImpactCoverage",
        response_model=ScriptConfirmationImpactLookupResponse,
    )
    def get_coverage(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        confirmation_id: ConfirmationId,
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            data = ScriptConfirmationImpactStore(repository_provider()).lookup(
                project_id,
                episode_id,
                confirmation_id,
            )
            return ScriptConfirmationImpactLookupResponse(
                data=data, request_id=_request_id(request)
            )
        except ScriptConfirmationImpactNotFoundError:
            return _error(
                request,
                status_code=404,
                code="SCRIPT_IMPACT_NOT_FOUND",
                message="Exact scoped confirmation was not found",
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="SCRIPT_IMPACT_READ_FAILED",
                message="Confirmation impact coverage could not be verified",
            )

    return router


def create_script_confirmation_operation_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/script/confirmation-operations/{operation_id}",
        response_model=ScriptConfirmationOperationResponse,
    )
    def get_original(
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
        version_id: Annotated[str, Query(pattern=VERSION_ID_PATTERN)],
        expected_content_hash: Annotated[str, Query(pattern=CONTENT_HASH_PATTERN)],
        expected_head_revision: Annotated[int, Query(ge=1)],
    ) -> Any:
        response.headers["Cache-Control"] = "no-store"
        try:
            data = ScriptConfirmationImpactStore(repository_provider()).operation(
                project_id,
                episode_id,
                operation_id,
                CreateEpisodeScriptConfirmationRequest(
                    version_id=version_id,
                    expected_content_hash=expected_content_hash,
                    expected_head_revision=expected_head_revision,
                    confirm=True,
                ),
                trusted_actor.subject_id,
            )
            return ScriptConfirmationOperationResponse(data=data, request_id=_request_id(request))
        except ScriptConfirmationImpactNotFoundError:
            # Absence is UNKNOWN; this is not evidence of non-submission.
            return _error(
                request,
                status_code=404,
                code="SCRIPT_CONFIRMATION_OPERATION_UNKNOWN",
                message="Original operation is not yet attributable; do not resend",
            )
        except Exception:
            return _error(
                request,
                status_code=500,
                code="SCRIPT_CONFIRMATION_OPERATION_UNKNOWN",
                message="Original operation could not be verified; do not resend",
            )

    return router
