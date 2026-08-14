"""Read-only event-time projections over the durable T04 invalidation ledger."""

from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from datetime import datetime

from aijian_api.artifact_invalidation import (
    IMPACT_RANK,
    ArtifactDependencyInvalidError,
    effective_path_impact,
    parse_impact,
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
from aijian_api.contracts import (
    ARTIFACT_ID_PATTERN,
    DECISION_ID_PATTERN,
    IMPACT_ID_PATTERN,
    OPERATION_ID_PATTERN,
    PROJECT_ID_PATTERN,
    VERSION_ID_PATTERN,
)
from aijian_api.domain import (
    InvalidationAffectedVersionReport,
    InvalidationImpactCounts,
    InvalidationOperation,
    InvalidationOperationReport,
    InvalidationOperationSummary,
    InvalidationPathImpact,
)

_OPERATION_ID_RE = re.compile(OPERATION_ID_PATTERN)
_PROJECT_ID_RE = re.compile(PROJECT_ID_PATTERN)
_ARTIFACT_ID_RE = re.compile(ARTIFACT_ID_PATTERN)
_VERSION_ID_RE = re.compile(VERSION_ID_PATTERN)
_DECISION_ID_RE = re.compile(DECISION_ID_PATTERN)
_IMPACT_ID_RE = re.compile(IMPACT_ID_PATTERN)
_HEAD_ADVANCING_DECISIONS = frozenset({"approved", "approved_with_waiver"})


class InvalidationLedgerCorruptError(RuntimeError):
    """Raised when durable invalidation ledger rows cannot be trusted for reporting."""


def build_operation_summary(
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> InvalidationOperationSummary:
    """Build a summary after structural path checks only.

    Prefer connection-scoped builders for report reads; this helper remains for
    pure projection once evidence has already been integrity-checked.
    """

    _validate_impacts_structure(operation, impacts)
    return _summary_from_validated(operation, impacts)


def build_operation_report(
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> InvalidationOperationReport:
    """Build a detail report after structural path checks only."""

    _validate_impacts_structure(operation, impacts)
    return _report_from_validated(operation, impacts)


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
            _validate_operation_evidence(connection, operation, impacts)
            summaries.append(_summary_from_validated(operation, impacts))
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
    except (TypeError, ValueError) as error:
        raise InvalidationLedgerCorruptError(
            "Invalidation ledger identity or timestamp data is corrupt"
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
        _validate_operation_evidence(connection, operation, impacts)
        return _report_from_validated(operation, impacts)
    except ProjectMissingError:
        raise
    except InvalidationNotFoundError:
        raise
    except ArtifactDependencyInvalidError as error:
        raise InvalidationLedgerCorruptError(
            "Invalidation ledger path impact data is corrupt"
        ) from error
    except (TypeError, ValueError) as error:
        raise InvalidationLedgerCorruptError(
            "Invalidation ledger identity or timestamp data is corrupt"
        ) from error


def _summary_from_validated(
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> InvalidationOperationSummary:
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


def _report_from_validated(
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> InvalidationOperationReport:
    summary = _summary_from_validated(operation, impacts)
    groups: dict[tuple[str, str], list[InvalidationPathImpact]] = defaultdict(list)
    for impact in impacts:
        groups[(impact.affected_artifact_id, impact.affected_version_id)].append(impact)

    affected_versions: list[InvalidationAffectedVersionReport] = []
    for artifact_id, version_id in sorted(groups):
        paths = tuple(sorted(groups[(artifact_id, version_id)], key=lambda item: item.path_ordinal))
        strongest = projected_effective_impact(paths)
        if strongest is None:
            raise InvalidationLedgerCorruptError("Invalidation affected version group has no paths")
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


def _validate_operation_evidence(
    connection: sqlite3.Connection,
    operation: InvalidationOperation,
    impacts: tuple[InvalidationPathImpact, ...],
) -> None:
    _validate_operation_identity(operation)
    _validate_operation_ownership(connection, operation)
    _validate_impacts_structure(operation, impacts)
    for impact in impacts:
        _validate_impact_identity(impact)
        _validate_affected_ownership(connection, operation=operation, impact=impact)
        _validate_dependency_path_chain(connection, operation=operation, impact=impact)


def _validate_operation_identity(operation: InvalidationOperation) -> None:
    if not _OPERATION_ID_RE.fullmatch(operation.id):
        raise InvalidationLedgerCorruptError("Invalidation operation identity is corrupt")
    if not _PROJECT_ID_RE.fullmatch(operation.project_id):
        raise InvalidationLedgerCorruptError("Invalidation operation project identity is corrupt")
    if not _ARTIFACT_ID_RE.fullmatch(operation.changed_artifact_id):
        raise InvalidationLedgerCorruptError("Invalidation changed artifact identity is corrupt")
    if not _VERSION_ID_RE.fullmatch(operation.old_accepted_version_id):
        raise InvalidationLedgerCorruptError("Invalidation old version identity is corrupt")
    if not _VERSION_ID_RE.fullmatch(operation.new_accepted_version_id):
        raise InvalidationLedgerCorruptError("Invalidation new version identity is corrupt")
    if not _DECISION_ID_RE.fullmatch(operation.gate_decision_id):
        raise InvalidationLedgerCorruptError("Invalidation gate decision identity is corrupt")
    if not isinstance(operation.created_at, datetime):
        raise InvalidationLedgerCorruptError("Invalidation operation timestamp is corrupt")
    if operation.created_at.tzinfo is None:
        raise InvalidationLedgerCorruptError("Invalidation operation timestamp is corrupt")


def _validate_impact_identity(impact: InvalidationPathImpact) -> None:
    if not _IMPACT_ID_RE.fullmatch(impact.id):
        raise InvalidationLedgerCorruptError("Invalidation path impact identity is corrupt")
    if not _OPERATION_ID_RE.fullmatch(impact.operation_id):
        raise InvalidationLedgerCorruptError(
            "Invalidation path impact operation identity is corrupt"
        )
    if not _PROJECT_ID_RE.fullmatch(impact.project_id):
        raise InvalidationLedgerCorruptError("Invalidation path impact project identity is corrupt")
    if not _ARTIFACT_ID_RE.fullmatch(impact.affected_artifact_id):
        raise InvalidationLedgerCorruptError("Invalidation affected artifact identity is corrupt")
    if not _VERSION_ID_RE.fullmatch(impact.affected_version_id):
        raise InvalidationLedgerCorruptError("Invalidation affected version identity is corrupt")


def _validate_operation_ownership(
    connection: sqlite3.Connection,
    operation: InvalidationOperation,
) -> None:
    artifact = connection.execute(
        """
        SELECT artifact_id, project_id
        FROM artifacts
        WHERE artifact_id = ?
        """,
        (operation.changed_artifact_id,),
    ).fetchone()
    if artifact is None:
        raise InvalidationLedgerCorruptError("Invalidation changed artifact is missing")
    if str(artifact["project_id"]) != operation.project_id:
        raise InvalidationLedgerCorruptError(
            "Invalidation changed artifact project ownership is corrupt"
        )

    for version_id, label in (
        (operation.old_accepted_version_id, "old accepted"),
        (operation.new_accepted_version_id, "new accepted"),
    ):
        _require_version_ownership(
            connection,
            project_id=operation.project_id,
            artifact_id=operation.changed_artifact_id,
            version_id=version_id,
            label=label,
        )

    decision = connection.execute(
        """
        SELECT decision_id, artifact_id, version_id, decision
        FROM gate_decisions
        WHERE decision_id = ?
        """,
        (operation.gate_decision_id,),
    ).fetchone()
    if decision is None:
        raise InvalidationLedgerCorruptError("Invalidation gate decision is missing")
    if str(decision["artifact_id"]) != operation.changed_artifact_id:
        raise InvalidationLedgerCorruptError(
            "Invalidation gate decision artifact ownership is corrupt"
        )
    if str(decision["version_id"]) != operation.new_accepted_version_id:
        raise InvalidationLedgerCorruptError(
            "Invalidation gate decision version ownership is corrupt"
        )
    if str(decision["decision"]) not in _HEAD_ADVANCING_DECISIONS:
        raise InvalidationLedgerCorruptError(
            "Invalidation gate decision is not head-advancing approval"
        )


def _validate_affected_ownership(
    connection: sqlite3.Connection,
    *,
    operation: InvalidationOperation,
    impact: InvalidationPathImpact,
) -> None:
    _require_version_ownership(
        connection,
        project_id=operation.project_id,
        artifact_id=impact.affected_artifact_id,
        version_id=impact.affected_version_id,
        label="affected",
    )


def _validate_dependency_path_chain(
    connection: sqlite3.Connection,
    *,
    operation: InvalidationOperation,
    impact: InvalidationPathImpact,
) -> None:
    expected_downstream_artifact_id = impact.affected_artifact_id
    expected_downstream_version_id = impact.affected_version_id

    for index, dependency_id in enumerate(impact.dependency_path):
        row = connection.execute(
            """
            SELECT
                dependency_id,
                downstream_artifact_id,
                downstream_version_id,
                upstream_artifact_id,
                upstream_version_id,
                relationship,
                impact
            FROM artifact_dependencies
            WHERE dependency_id = ?
            """,
            (dependency_id,),
        ).fetchone()
        if row is None:
            raise InvalidationLedgerCorruptError("Invalidation dependency path edge is missing")

        relationship = str(row["relationship"])
        edge_impact = parse_impact(str(row["impact"]))
        if relationship != impact.path_relationships[index]:
            raise InvalidationLedgerCorruptError(
                "Invalidation path relationship disagrees with dependency row"
            )
        if edge_impact != impact.path_impacts[index]:
            raise InvalidationLedgerCorruptError(
                "Invalidation path impact disagrees with dependency row"
            )

        downstream_artifact_id = str(row["downstream_artifact_id"])
        downstream_version_id = str(row["downstream_version_id"])
        upstream_artifact_id = str(row["upstream_artifact_id"])
        upstream_version_id = str(row["upstream_version_id"])

        if downstream_artifact_id != expected_downstream_artifact_id:
            raise InvalidationLedgerCorruptError(
                "Invalidation dependency path chain is discontinuous"
            )
        if downstream_version_id != expected_downstream_version_id:
            raise InvalidationLedgerCorruptError(
                "Invalidation dependency path chain is discontinuous"
            )

        _require_version_ownership(
            connection,
            project_id=operation.project_id,
            artifact_id=downstream_artifact_id,
            version_id=downstream_version_id,
            label="path downstream",
        )
        _require_version_ownership(
            connection,
            project_id=operation.project_id,
            artifact_id=upstream_artifact_id,
            version_id=upstream_version_id,
            label="path upstream",
        )

        expected_downstream_artifact_id = upstream_artifact_id
        expected_downstream_version_id = upstream_version_id

    if expected_downstream_artifact_id != operation.changed_artifact_id:
        raise InvalidationLedgerCorruptError(
            "Invalidation dependency path does not terminate at changed artifact"
        )
    if expected_downstream_version_id != operation.old_accepted_version_id:
        raise InvalidationLedgerCorruptError(
            "Invalidation dependency path does not terminate at old accepted version"
        )


def _require_version_ownership(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    artifact_id: str,
    version_id: str,
    label: str,
) -> None:
    row = connection.execute(
        """
        SELECT
            artifact_versions.version_id,
            artifact_versions.artifact_id,
            artifacts.project_id
        FROM artifact_versions
        JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
        WHERE artifact_versions.version_id = ?
        """,
        (version_id,),
    ).fetchone()
    if row is None:
        raise InvalidationLedgerCorruptError(f"Invalidation {label} version is missing")
    if str(row["artifact_id"]) != artifact_id:
        raise InvalidationLedgerCorruptError(f"Invalidation {label} version ownership is corrupt")
    if str(row["project_id"]) != project_id:
        raise InvalidationLedgerCorruptError(
            f"Invalidation {label} version project ownership is corrupt"
        )


def _validate_impacts_structure(
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
        if not (
            len(impact.dependency_path)
            == len(impact.path_relationships)
            == len(impact.path_impacts)
        ):
            raise InvalidationLedgerCorruptError("Invalidation path arrays are inconsistent")
        if not impact.dependency_path:
            raise InvalidationLedgerCorruptError("Invalidation path is empty")
        recomputed = effective_path_impact(impact.path_impacts)
        if recomputed != impact.effective_impact:
            raise InvalidationLedgerCorruptError(
                "Invalidation effective impact does not match path impacts"
            )
    if seen_ordinals != set(range(len(impacts))):
        raise InvalidationLedgerCorruptError(
            "Invalidation path ordinals are not contiguous from zero"
        )
    # Ordinals must match T04 deterministic path order, not only contiguity.
    ordered = sorted(
        impacts,
        key=lambda item: (
            item.dependency_path,
            item.affected_version_id,
            item.affected_artifact_id,
            -IMPACT_RANK[item.effective_impact],
        ),
    )
    if [item.path_ordinal for item in ordered] != list(range(len(impacts))):
        raise InvalidationLedgerCorruptError(
            "Invalidation path ordinals are not in deterministic order"
        )
