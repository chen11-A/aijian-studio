"""Public, project-scoped invalidation impact report reads (T05A)."""

from collections.abc import Callable
from typing import cast
from uuid import UUID

from fastapi import APIRouter, Request

from aijian_api.contracts import (
    ErrorResponse,
    InvalidationAffectedVersionData,
    InvalidationImpactCountsData,
    InvalidationOperationDetailData,
    InvalidationOperationDetailResponse,
    InvalidationOperationListData,
    InvalidationOperationListResponse,
    InvalidationOperationSummaryData,
    InvalidationPathImpactData,
)
from aijian_api.domain import (
    InvalidationAffectedVersionReport,
    InvalidationOperationReport,
    InvalidationOperationSummary,
    InvalidationPathImpact,
)
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]


def create_invalidation_report_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()
    shared_errors: dict[int | str, dict[str, object]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project or invalidation operation not found", "model": ErrorResponse},
        409: {"description": "Invalidation ledger data is corrupt", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/invalidation-operations",
        operation_id="listProjectInvalidationOperations",
        response_model=InvalidationOperationListResponse,
        responses=shared_errors,
    )
    def list_project_invalidation_operations(
        request: Request,
        project_id: str,
    ) -> InvalidationOperationListResponse:
        summaries = repository_provider().list_invalidation_operation_summaries(project_id)
        return InvalidationOperationListResponse(
            data=InvalidationOperationListData(
                project_id=project_id,
                operations=[_summary_data(summary) for summary in summaries],
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    @router.get(
        "/api/v1/projects/{project_id}/invalidation-operations/{operation_id}",
        operation_id="getProjectInvalidationOperation",
        response_model=InvalidationOperationDetailResponse,
        responses=shared_errors,
    )
    def get_project_invalidation_operation(
        request: Request,
        project_id: str,
        operation_id: str,
    ) -> InvalidationOperationDetailResponse:
        report = repository_provider().get_invalidation_operation_report(
            project_id=project_id,
            operation_id=operation_id,
        )
        return InvalidationOperationDetailResponse(
            data=_detail_data(report),
            request_id=cast(UUID, request.state.request_id),
        )

    return router


def _summary_data(summary: InvalidationOperationSummary) -> InvalidationOperationSummaryData:
    return InvalidationOperationSummaryData(
        operation_id=summary.operation_id,
        project_id=summary.project_id,
        changed_artifact_id=summary.changed_artifact_id,
        old_accepted_version_id=summary.old_accepted_version_id,
        new_accepted_version_id=summary.new_accepted_version_id,
        gate_decision_id=summary.gate_decision_id,
        created_at=summary.created_at,
        affected_version_count=summary.affected_version_count,
        independent_path_count=summary.independent_path_count,
        impact_counts=InvalidationImpactCountsData(
            blocking=summary.impact_counts.blocking,
            render_only=summary.impact_counts.render_only,
            advisory=summary.impact_counts.advisory,
        ),
        strongest_effective_impact=summary.strongest_effective_impact,
    )


def _detail_data(report: InvalidationOperationReport) -> InvalidationOperationDetailData:
    return InvalidationOperationDetailData(
        operation=_summary_data(report.operation),
        affected_versions=[
            _affected_version_data(group) for group in report.affected_versions
        ],
    )


def _affected_version_data(
    group: InvalidationAffectedVersionReport,
) -> InvalidationAffectedVersionData:
    return InvalidationAffectedVersionData(
        affected_artifact_id=group.affected_artifact_id,
        affected_version_id=group.affected_version_id,
        strongest_effective_impact=group.strongest_effective_impact,
        general_stale=group.general_stale,
        general_blocked=group.general_blocked,
        render_blocked=group.render_blocked,
        paths=[_path_data(path) for path in group.paths],
    )


def _path_data(path: InvalidationPathImpact) -> InvalidationPathImpactData:
    return InvalidationPathImpactData(
        impact_id=path.id,
        path_ordinal=path.path_ordinal,
        dependency_path=list(path.dependency_path),
        path_relationships=list(path.path_relationships),
        path_impacts=list(path.path_impacts),
        effective_impact=path.effective_impact,
    )
