"""Read-only invalidation ledger HTTP route."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Query, Request

from aijian_api.artifact_invalidation_ledger import (
    InvalidationLedgerError,
    InvalidationOperationNotFoundError,
)
from aijian_api.artifacts import canonical_content_bytes
from aijian_api.contracts import PROJECT_ID_PATTERN, ErrorResponse
from aijian_api.domain import InvalidationOperationRecord
from aijian_api.invalidation_contracts import (
    OPERATION_ID_PATTERN,
    InvalidationOperationData,
    InvalidationOperationPageData,
    InvalidationOperationPageResponse,
    InvalidationOperationResponse,
    InvalidationOperationSummaryData,
    InvalidationReasonPathData,
)
from aijian_api.repository import StudioRepository

MAX_REPORT_BYTES = 4 * 1024 * 1024
MAX_PATHS = 10000
type RepositoryProvider = Callable[[], StudioRepository]


class InvalidationReportTooLargeError(RuntimeError):
    """The validated report exceeds the response-size contract."""


class InvalidationReportCorruptError(RuntimeError):
    """The detail read encountered a corrupt stored ledger record."""


def create_invalidation_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project or invalidation operation not found", "model": ErrorResponse},
        413: {"description": "Invalidation report is too large", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
        500: {"description": "Invalidation ledger is corrupt", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/invalidation-operations",
        operation_id="listInvalidationOperations",
        response_model=InvalidationOperationPageResponse,
        responses=errors,
    )
    def list_invalidation_operations(
        request: Request,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
        limit: int = Query(default=20, ge=1, le=100),
        cursor: str | None = Query(default=None, pattern=OPERATION_ID_PATTERN),
    ) -> InvalidationOperationPageResponse:
        try:
            page = repository_provider().list_invalidation_operation_page(
                project_id, limit=limit, cursor=cursor
            )
            return InvalidationOperationPageResponse(
                data=InvalidationOperationPageData(
                    items=[
                        InvalidationOperationSummaryData(
                            operation_id=item.id,
                            project_id=item.project_id,
                            changed_artifact_id=item.changed_artifact_id,
                            old_accepted_version_id=item.old_accepted_version_id,
                            new_accepted_version_id=item.new_accepted_version_id,
                            gate_decision_id=item.gate_decision_id,
                            assessment_hash=item.assessment_hash,
                            created_at=item.created_at,
                            reason_path_count=item.reason_path_count,
                        )
                        for item in page.items
                    ],
                    next_cursor=page.next_cursor,
                ),
                request_id=cast(UUID, request.state.request_id),
            )
        except InvalidationOperationNotFoundError:
            raise
        except InvalidationLedgerError as error:
            raise InvalidationReportCorruptError("invalid invalidation ledger record") from error
        except (TypeError, ValueError, KeyError) as error:
            raise InvalidationReportCorruptError("invalid invalidation ledger record") from error

    @router.get(
        "/api/v1/projects/{project_id}/invalidation-operations/{operation_id}",
        operation_id="getInvalidationOperation",
        response_model=InvalidationOperationResponse,
        responses=errors,
    )
    def get_invalidation_operation(
        request: Request,
        project_id: str = Path(pattern=PROJECT_ID_PATTERN),
        operation_id: str = Path(pattern=OPERATION_ID_PATTERN),
    ) -> InvalidationOperationResponse:
        try:
            record = repository_provider().get_invalidation_operation(project_id, operation_id)
            if record.project_id != project_id or record.id != operation_id:
                raise InvalidationLedgerError("invalidation operation identity is inconsistent")
            response = InvalidationOperationResponse(
                data=_operation_data(record),
                request_id=cast(UUID, request.state.request_id),
            )
            report_bytes = canonical_content_bytes(response.data.model_dump(mode="json"))
            if len(report_bytes) > MAX_REPORT_BYTES:
                raise InvalidationReportTooLargeError
            return response
        except InvalidationReportTooLargeError:
            raise
        except InvalidationOperationNotFoundError:
            raise
        except InvalidationLedgerError as error:
            raise InvalidationReportCorruptError("invalid invalidation ledger record") from error
        except (TypeError, ValueError, KeyError) as error:
            raise InvalidationReportCorruptError("invalid invalidation ledger record") from error

    return router


def _operation_data(record: InvalidationOperationRecord) -> InvalidationOperationData:
    if len(record.paths) > MAX_PATHS:
        raise InvalidationReportTooLargeError
    return InvalidationOperationData(
        operation_id=record.id,
        project_id=record.project_id,
        changed_artifact_id=record.changed_artifact_id,
        old_accepted_version_id=record.old_accepted_version_id,
        new_accepted_version_id=record.new_accepted_version_id,
        gate_decision_id=record.gate_decision_id,
        assessment_hash=record.assessment_hash,
        created_at=record.created_at,
        paths=[
            InvalidationReasonPathData(
                path_id=path.id,
                operation_id=path.operation_id,
                project_id=path.project_id,
                affected_artifact_id=path.affected_artifact_id,
                affected_version_id=path.affected_version_id,
                classification=path.classification,
                aggregate_impact=path.aggregate_impact,
                dependency_ids=list(path.dependency_ids),
                relationships=list(path.relationships),
                edge_impacts=list(path.edge_impacts),
                effective_impact=path.effective_impact,
                ordinal=path.ordinal,
                created_at=path.created_at,
            )
            for path in record.paths
        ],
    )
