"""Authenticated human rights declarations for one immutable media version."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aijian_api.contracts import PROJECT_ID_PATTERN, ErrorBody, ErrorResponse
from aijian_api.domain import TrustedReviewActor
from aijian_api.media_asset_contracts import ASSET_ID_PATTERN, ASSET_VERSION_ID_PATTERN
from aijian_api.media_asset_rights_contracts import (
    RIGHTS_DECISION_ID_PATTERN,
    RIGHTS_OPERATION_ID_PATTERN,
    HumanRightsDecisionInput,
    RightsDecisionAuditData,
    RightsDecisionReadResult,
    RightsDecisionWriteReceipt,
)
from aijian_api.media_asset_rights_reader import read_latest_rights_decision
from aijian_api.media_asset_rights_store import MediaAssetRightsStore, RightsDecisionError
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
AssetId = Annotated[str, Path(pattern=ASSET_ID_PATTERN)]
VersionId = Annotated[str, Path(pattern=ASSET_VERSION_ID_PATTERN)]
DecisionId = Annotated[str, Path(pattern=RIGHTS_DECISION_ID_PATTERN)]
OperationId = Annotated[str, Path(pattern=RIGHTS_OPERATION_ID_PATTERN)]


class RightsDecisionWriteResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: RightsDecisionWriteReceipt
    request_id: UUID


class RightsDecisionReadResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: RightsDecisionReadResult
    request_id: UUID


class RightsDecisionHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: list[RightsDecisionAuditData]
    request_id: UUID


class RightsDecisionAuditResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: RightsDecisionAuditData
    request_id: UUID


_ERROR_STATUS = {
    "INVALID_INPUT": 422,
    "INVALID_ID": 422,
    "INVALID_ACTOR": 403,
    "VERSION_NOT_FOUND": 404,
    "OPERATION_NOT_FOUND": 404,
    "OPERATION_CONFLICT": 409,
    "REVISION_CONFLICT": 409,
    "HISTORY_LIMIT": 409,
    "CORRUPT_HISTORY": 409,
    "WRITE_UNKNOWN": 503,
}
_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {
        "description": "Local user identity or request boundary rejected",
        "model": ErrorResponse,
    },
    404: {"description": "Media version, decision, or operation not found", "model": ErrorResponse},
    409: {"description": "Rights revision, operation, or history conflict", "model": ErrorResponse},
    422: {"description": "Rights decision input is invalid", "model": ErrorResponse},
    503: {"description": "Rights write or read outcome is unknown", "model": ErrorResponse},
}


def _request_id(request: Request) -> UUID:
    return cast(UUID, request.state.request_id)


def _error(request: Request, code: str, message: str, status_code: int) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=_request_id(request),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def _store_error(request: Request, error: RightsDecisionError) -> JSONResponse:
    return _error(request, error.code, str(error), _ERROR_STATUS.get(error.code, 503))


def create_media_asset_rights_router(
    repository_provider: RepositoryProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    """Register only under the authenticated desktop sidecar branch."""
    router = APIRouter()
    prefix = (
        "/api/v1/projects/{project_id}/assets/{asset_id}/versions/{version_id}/rights-decisions"
    )

    def store() -> MediaAssetRightsStore:
        return MediaAssetRightsStore(repository_provider())

    def history(
        request: Request,
        project_id: str,
        asset_id: str,
        version_id: str,
    ) -> tuple[RightsDecisionAuditData, ...] | JSONResponse:
        try:
            return store().audit_history(project_id, asset_id, version_id)
        except RightsDecisionError as error:
            return _store_error(request, error)
        except sqlite3.Error:
            return _error(
                request, "RIGHTS_READ_UNKNOWN", "Rights history could not be confirmed", 503
            )

    @router.post(
        prefix,
        operation_id="recordHumanMediaRightsDecision",
        response_model=RightsDecisionWriteResponse,
        status_code=status.HTTP_201_CREATED,
        responses=_ERRORS,
    )
    def record_decision(
        request: Request,
        response: Response,
        project_id: ProjectId,
        asset_id: AssetId,
        version_id: VersionId,
        payload: HumanRightsDecisionInput,
    ) -> RightsDecisionWriteResponse | JSONResponse:
        if "writer" not in trusted_actor.roles:
            return _error(
                request, "RIGHTS_ACTOR_FORBIDDEN", "Local user cannot declare rights", 403
            )
        try:
            receipt = store().append_human_decision(
                project_id,
                asset_id,
                version_id,
                payload,
                actor_id=trusted_actor.subject_id,
            )
        except RightsDecisionError as error:
            return _store_error(request, error)
        response.status_code = status.HTTP_200_OK if receipt.replayed else status.HTTP_201_CREATED
        response.headers["Cache-Control"] = "no-store"
        return RightsDecisionWriteResponse(data=receipt, request_id=_request_id(request))

    @router.get(
        prefix + "/latest",
        operation_id="readLatestMediaRightsDecision",
        response_model=RightsDecisionReadResponse,
        responses=_ERRORS,
    )
    def latest_decision(
        request: Request,
        response: Response,
        project_id: ProjectId,
        asset_id: AssetId,
        version_id: VersionId,
        expected_revision: Annotated[int | None, Query(ge=0)] = None,
        expected_decision_id: Annotated[
            str | None, Query(pattern=RIGHTS_DECISION_ID_PATTERN)
        ] = None,
        expected_content_hash: Annotated[str | None, Query(pattern=r"^[0-9a-f]{64}$")] = None,
    ) -> RightsDecisionReadResponse:
        result = read_latest_rights_decision(
            repository_provider().database_path,
            project_id,
            asset_id,
            version_id,
            expected_revision=expected_revision,
            expected_decision_id=expected_decision_id,
            expected_content_hash=expected_content_hash,
        )
        response.headers["Cache-Control"] = "no-store"
        return RightsDecisionReadResponse(data=result, request_id=_request_id(request))

    @router.get(
        prefix + "/operations/{operation_id}",
        operation_id="readMediaRightsOperationReceipt",
        response_model=RightsDecisionWriteResponse,
        responses=_ERRORS,
    )
    def operation_receipt(
        request: Request,
        response: Response,
        project_id: ProjectId,
        asset_id: AssetId,
        version_id: VersionId,
        operation_id: OperationId,
    ) -> RightsDecisionWriteResponse | JSONResponse:
        try:
            receipt = store().get_operation_receipt(
                project_id,
                asset_id,
                version_id,
                operation_id,
            )
        except RightsDecisionError as error:
            return _store_error(request, error)
        except sqlite3.Error:
            return _error(
                request, "RIGHTS_READ_UNKNOWN", "Rights receipt could not be confirmed", 503
            )
        response.headers["Cache-Control"] = "no-store"
        return RightsDecisionWriteResponse(data=receipt, request_id=_request_id(request))

    @router.get(
        prefix,
        operation_id="listMediaRightsDecisionHistory",
        response_model=RightsDecisionHistoryResponse,
        responses=_ERRORS,
    )
    def list_decisions(
        request: Request,
        response: Response,
        project_id: ProjectId,
        asset_id: AssetId,
        version_id: VersionId,
    ) -> RightsDecisionHistoryResponse | JSONResponse:
        entries = history(request, project_id, asset_id, version_id)
        if isinstance(entries, JSONResponse):
            return entries
        response.headers["Cache-Control"] = "no-store"
        return RightsDecisionHistoryResponse(data=list(entries), request_id=_request_id(request))

    @router.get(
        prefix + "/{decision_id}",
        operation_id="readMediaRightsDecisionAudit",
        response_model=RightsDecisionAuditResponse,
        responses=_ERRORS,
    )
    def decision_audit(
        request: Request,
        response: Response,
        project_id: ProjectId,
        asset_id: AssetId,
        version_id: VersionId,
        decision_id: DecisionId,
    ) -> RightsDecisionAuditResponse | JSONResponse:
        entries = history(request, project_id, asset_id, version_id)
        if isinstance(entries, JSONResponse):
            return entries
        decision = next((entry for entry in entries if entry.decision_id == decision_id), None)
        if decision is None:
            return _error(request, "DECISION_NOT_FOUND", "Rights decision was not found", 404)
        response.headers["Cache-Control"] = "no-store"
        return RightsDecisionAuditResponse(data=decision, request_id=_request_id(request))

    return router
