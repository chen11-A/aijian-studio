"""Read-only event-time projections over the durable T04 invalidation ledger."""

from __future__ import annotations

import sqlite3
from collections import defaultdict

from aijian_api.artifact_invalidation import (
    ArtifactDependencyInvalidError,
    effective_path_impact,
)
from aijian_api.artifact_invalidation_ledger import (
    InvalidationNotFoundError,
    ProjectMissingError,
    get_operation_on_connection,
    is_general_stale,
    list_operations_on_connection,
    list_path_impacts_on_connection,
    projected_effective_impact,
)
from aijian_api.domain import (
    InvalidationAffectedVersionReport,
    InvalidationImpactCounts,
    InvalidationOperation,
    InvalidationOperationReport,
    InvalidationOperationSummary,
    InvalidationPathImpact,
)


class InvalidationLedgerCorruptError(RuntimeError):
    """Raised when durable invalidation ledger rows cannot be trusted for reporting."""


def build_operation_summary(
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> InvalidationOperationSummary:
    _validate_impacts_for_operation(operation, impacts)
    impact_counts = _count_impacts(impacts)
    affected_keys = {
        (impact.affected_artifact_id, impact.affected_version_id) for impact in impacts
    }
    return InvalidationOperationSummary(
        operation_id=operation.id,
        project_id=operation.project_id,
        changed_artifact_id=operation.changed_artifact_id,
        old_accepted_version_id=operation.old_accepted_version_id,
        new_accepted_version_id=operation.new_accepted_version_id,
        gate_decision_id=operation.gate_decision_id,
        created_at=operation.created_at,
        affected_version_count=len(affected_keys),
        independent_path_count=len(impacts),
        impact_counts=impact_counts,
        strongest_effective_impact=projected_effective_impact(impacts),
    )


def build_operation_report(
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> InvalidationOperationReport:
    summary = build_operation_summary(operation, impacts)
    groups: dict[tuple[str, str], list[InvalidationPathImpact]] = defaultdict(list)
    for impact in impacts:
        groups[(impact.affected_artifact_id, impact.affected_version_id)].append(impact)

    affected_versions: list[InvalidationAffectedVersionReport] = []
    for artifact_id, version_id in sorted(groups):
        paths = tuple(sorted(groups[(artifact_id, version_id)], key=lambda item: item.path_ordinal))
        strongest = projected_effective_impact(paths)
        if strongest is None:
            raise InvalidationLedgerCorruptError(
                "Invalidation affected version group has no paths"
            )
        general_blocked = strongest == "blocking"
        affected_versions.append(
            InvalidationAffectedVersionReport(
                affected_artifact_id=artifact_id,
                affected_version_id=version_id,
                strongest_effective_impact=strongest,
                general_stale=is_general_stale(paths),
                general_blocked=general_blocked,
                render_blocked=strongest in {"blocking", "render_only"},
                paths=paths,
            )
        )
    return InvalidationOperationReport(
        operation=summary,
        affected_versions=tuple(affected_versions),
    )


def list_operation_summaries_on_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
) -> tuple[InvalidationOperationSummary, ...]:
    try:
        operations = list_operations_on_connection(connection, project_id=project_id)
        summaries: list[InvalidationOperationSummary] = []
        for operation in operations:
            impacts = list_path_impacts_on_connection(
                connection,
                project_id=project_id,
                operation_id=operation.id,
            )
            summaries.append(build_operation_summary(operation, impacts))
        return tuple(summaries)
    except ProjectMissingError:
        raise
    except InvalidationNotFoundError as error:
        raise InvalidationLedgerCorruptError(
            "Invalidation ledger operation and path impacts are inconsistent"
        ) from error
    except ArtifactDependencyInvalidError as error:
        raise InvalidationLedgerCorruptError(
            "Invalidation ledger path impact data is corrupt"
        ) from error


def get_operation_report_on_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    operation_id: str,
) -> InvalidationOperationReport:
    try:
        operation = get_operation_on_connection(
            connection,
            project_id=project_id,
            operation_id=operation_id,
        )
        impacts = list_path_impacts_on_connection(
            connection,
            project_id=project_id,
            operation_id=operation_id,
        )
        return build_operation_report(operation, impacts)
    except ProjectMissingError:
        raise
    except InvalidationNotFoundError:
        raise
    except ArtifactDependencyInvalidError as error:
        raise InvalidationLedgerCorruptError(
            "Invalidation ledger path impact data is corrupt"
        ) from error


def _count_impacts(impacts: tuple[InvalidationPathImpact, ...]) -> InvalidationImpactCounts:
    blocking = 0
    render_only = 0
    advisory = 0
    for impact in impacts:
        if impact.effective_impact == "blocking":
            blocking += 1
        elif impact.effective_impact == "render_only":
            render_only += 1
        elif impact.effective_impact == "advisory":
            advisory += 1
        else:
            raise InvalidationLedgerCorruptError("Invalidation effective impact is impossible")
    return InvalidationImpactCounts(
        blocking=blocking,
        render_only=render_only,
        advisory=advisory,
    )


def _validate_impacts_for_operation(
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> None:
    seen_ordinals: set[int] = set()
    for impact in impacts:
        if impact.operation_id != operation.id:
            raise InvalidationLedgerCorruptError(
                "Invalidation path impact operation identity is inconsistent"
            )
        if impact.project_id != operation.project_id:
            raise InvalidationLedgerCorruptError(
                "Invalidation path impact project identity is inconsistent"
            )
        if impact.path_ordinal < 0:
            raise InvalidationLedgerCorruptError("Invalidation path ordinal is invalid")
        if impact.path_ordinal in seen_ordinals:
            raise InvalidationLedgerCorruptError("Invalidation path ordinal is duplicated")
        seen_ordinals.add(impact.path_ordinal)
        recomputed = effective_path_impact(impact.path_impacts)
        if recomputed != impact.effective_impact:
            raise InvalidationLedgerCorruptError(
                "Invalidation effective impact does not match path impacts"
            )
