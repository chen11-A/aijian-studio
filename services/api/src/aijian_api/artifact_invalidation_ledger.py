"""Caller-transaction invalidation ledger persistence and closed-input recovery."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast

from aijian_api.artifact_invalidation_domain import (
    AcceptedArtifactHead,
    AcceptedHeadReplacement,
    AffectedDownstreamVersion,
    ArtifactVersionIdentity,
    ExactVersionDependency,
    InvalidationReasonPath,
    TypedDependencyInvalidationError,
    TypedDependencyInvalidationInput,
    TypedDependencyInvalidationResult,
    assess_typed_dependency_invalidation,
)
from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import (
    DependencyImpact,
    InvalidationClassification,
    InvalidationOperationRecord,
    InvalidationReasonPathRecord,
)

type TransactionHook = Callable[[str, str], None]
type IdFactory = Callable[[str], str]

_SUPPORTED_IMPACTS: frozenset[str] = frozenset({"blocking", "advisory", "render_only"})
_SUPPORTED_CLASSIFICATIONS: frozenset[str] = frozenset({"STALE", "INVALIDATE"})


class InvalidationLedgerError(RuntimeError):
    """Closed invalidation ledger input or stored record is inconsistent."""


def canonical_assessment_payload(
    result: TypedDependencyInvalidationResult,
) -> dict[str, object]:
    return {
        "affected": [
            {
                "aggregate_impact": item.aggregate_impact,
                "artifact_id": item.artifact_id,
                "classification": item.classification,
                "reason_paths": [
                    {
                        "dependency_ids": list(path.dependency_ids),
                        "edge_impacts": list(path.edge_impacts),
                        "effective_impact": path.effective_impact,
                        "relationships": list(path.relationships),
                    }
                    for path in item.reason_paths
                ],
                "version_id": item.version_id,
            }
            for item in result.affected
        ],
        "changed_artifact_id": result.changed_artifact_id,
        "new_version_id": result.new_version_id,
        "old_version_id": result.old_version_id,
        "project_id": result.project_id,
    }


def canonical_assessment_hash(result: TypedDependencyInvalidationResult) -> str:
    return canonical_content_hash(canonical_assessment_payload(result))


def record_accepted_head_replacement(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
    gate_decision_id: str,
    created_at: datetime,
    id_factory: IdFactory,
    transaction_hook: TransactionHook | None = None,
) -> InvalidationOperationRecord:
    try:
        assessment = load_closed_replacement_input(
            connection,
            project_id=project_id,
            changed_artifact_id=changed_artifact_id,
            old_version_id=old_version_id,
            new_version_id=new_version_id,
        )
        result = assess_typed_dependency_invalidation(assessment)
    except TypedDependencyInvalidationError as error:
        raise InvalidationLedgerError(str(error)) from error
    return _persist_invalidation_operation(
        connection,
        project_id=project_id,
        changed_artifact_id=changed_artifact_id,
        old_version_id=old_version_id,
        new_version_id=new_version_id,
        gate_decision_id=gate_decision_id,
        result=result,
        created_at=created_at,
        id_factory=id_factory,
        transaction_hook=transaction_hook,
    )


def _persist_invalidation_operation(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
    gate_decision_id: str,
    result: TypedDependencyInvalidationResult,
    created_at: datetime,
    id_factory: IdFactory,
    transaction_hook: TransactionHook | None = None,
) -> InvalidationOperationRecord:
    _validate_result_identity(
        result,
        project_id=project_id,
        changed_artifact_id=changed_artifact_id,
        old_version_id=old_version_id,
        new_version_id=new_version_id,
    )
    _validate_result_paths(result)
    assessment_hash = canonical_assessment_hash(result)
    existing = _select_operation_row(connection, gate_decision_id=gate_decision_id)
    if existing is not None:
        return _existing_or_conflict(
            connection,
            existing,
            project_id=project_id,
            changed_artifact_id=changed_artifact_id,
            old_version_id=old_version_id,
            new_version_id=new_version_id,
            gate_decision_id=gate_decision_id,
            assessment_hash=assessment_hash,
        )
    operation_id = id_factory("ivo")
    created_at_text = _timestamp(created_at)
    try:
        connection.execute(
            """
            INSERT INTO invalidation_operations (
                operation_id, project_id, changed_artifact_id, old_accepted_version_id,
                new_accepted_version_id, gate_decision_id, assessment_hash, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                operation_id,
                project_id,
                changed_artifact_id,
                old_version_id,
                new_version_id,
                gate_decision_id,
                assessment_hash,
                created_at_text,
            ),
        )
    except sqlite3.IntegrityError as error:
        raced = _select_operation_row(connection, gate_decision_id=gate_decision_id)
        if raced is None:
            raise InvalidationLedgerError(
                "invalidation ledger violated an invariant"
            ) from error
        return _existing_or_conflict(
            connection,
            raced,
            project_id=project_id,
            changed_artifact_id=changed_artifact_id,
            old_version_id=old_version_id,
            new_version_id=new_version_id,
            gate_decision_id=gate_decision_id,
            assessment_hash=assessment_hash,
        )
    _emit(transaction_hook, "operation_inserted")
    ordinal = 0
    try:
        for affected in result.affected:
            for path in affected.reason_paths:
                connection.execute(
                    """
                    INSERT INTO invalidation_reason_paths (
                        path_id, operation_id, project_id, affected_artifact_id,
                        affected_version_id, classification, aggregate_impact,
                        dependency_ids_json, relationships_json, edge_impacts_json,
                        effective_impact, ordinal, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        id_factory("ivp"),
                        operation_id,
                        project_id,
                        affected.artifact_id,
                        affected.version_id,
                        affected.classification,
                        affected.aggregate_impact,
                        _canonical_json(list(path.dependency_ids)),
                        _canonical_json(list(path.relationships)),
                        _canonical_json(list(path.edge_impacts)),
                        path.effective_impact,
                        ordinal,
                        created_at_text,
                    ),
                )
                _emit(transaction_hook, f"path_{ordinal}")
                ordinal += 1
    except sqlite3.IntegrityError as error:
        raced = _select_operation_row(connection, gate_decision_id=gate_decision_id)
        if raced is None:
            raise InvalidationLedgerError(
                "invalidation ledger violated an invariant"
            ) from error
        return _existing_or_conflict(
            connection,
            raced,
            project_id=project_id,
            changed_artifact_id=changed_artifact_id,
            old_version_id=old_version_id,
            new_version_id=new_version_id,
            gate_decision_id=gate_decision_id,
            assessment_hash=assessment_hash,
        )
    return get_invalidation_operation(connection, project_id, operation_id)


def list_invalidation_operations(
    connection: sqlite3.Connection,
    project_id: str,
) -> tuple[InvalidationOperationRecord, ...]:
    rows = connection.execute(
        """
        SELECT operation_id FROM invalidation_operations
        WHERE project_id = ?
        ORDER BY created_at ASC, operation_id ASC
        """,
        (project_id,),
    ).fetchall()
    return tuple(
        get_invalidation_operation(connection, project_id, str(_row_value(row, "operation_id")))
        for row in rows
    )


def get_invalidation_operation(
    connection: sqlite3.Connection,
    project_id: str,
    operation_id: str,
) -> InvalidationOperationRecord:
    row = connection.execute(
        """
        SELECT * FROM invalidation_operations
        WHERE project_id = ? AND operation_id = ?
        """,
        (project_id, operation_id),
    ).fetchone()
    if row is None:
        raise InvalidationLedgerError("Invalidation operation was not found")
    return _operation_from_row(connection, row)


def load_closed_replacement_input(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
) -> TypedDependencyInvalidationInput:
    if not project_id or not changed_artifact_id or not old_version_id or not new_version_id:
        raise InvalidationLedgerError("inconsistent closed input: empty identity")
    if old_version_id == new_version_id:
        raise InvalidationLedgerError("old and new version IDs are equal")
    versions = _load_project_versions(connection, project_id)
    versions_by_id = {identity.version_id: identity for identity in versions}
    _require_change_versions(
        versions_by_id,
        project_id=project_id,
        changed_artifact_id=changed_artifact_id,
        old_version_id=old_version_id,
        new_version_id=new_version_id,
    )
    accepted_heads = _load_accepted_heads_with_overlay(
        connection,
        project_id=project_id,
        changed_artifact_id=changed_artifact_id,
        old_version_id=old_version_id,
        new_version_id=new_version_id,
        versions_by_id=versions_by_id,
    )
    dependencies = _load_project_dependencies(connection, project_id, versions_by_id)
    return TypedDependencyInvalidationInput(
        project_id=project_id,
        versions=versions,
        accepted_heads=accepted_heads,
        dependencies=dependencies,
        head_change=AcceptedHeadReplacement(
            project_id=project_id,
            artifact_id=changed_artifact_id,
            old_version_id=old_version_id,
            new_version_id=new_version_id,
        ),
    )


def _load_project_versions(
    connection: sqlite3.Connection,
    project_id: str,
) -> tuple[ArtifactVersionIdentity, ...]:
    rows = connection.execute(
        """
        SELECT artifacts.project_id, artifacts.artifact_id, artifact_versions.version_id
        FROM artifact_versions
        JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
        WHERE artifacts.project_id = ?
        ORDER BY artifacts.artifact_id, artifact_versions.version_id
        """,
        (project_id,),
    ).fetchall()
    identities: list[ArtifactVersionIdentity] = []
    seen: set[str] = set()
    for row in rows:
        version_id = str(_row_value(row, "version_id"))
        if version_id in seen:
            raise InvalidationLedgerError("duplicate identity records")
        seen.add(version_id)
        row_project_id = str(_row_value(row, "project_id"))
        if row_project_id != project_id:
            raise InvalidationLedgerError("project identity mismatch")
        identities.append(
            ArtifactVersionIdentity(
                project_id=row_project_id,
                artifact_id=str(_row_value(row, "artifact_id")),
                version_id=version_id,
            )
        )
    return tuple(identities)


def _require_change_versions(
    versions_by_id: dict[str, ArtifactVersionIdentity],
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
) -> None:
    for version_id in (old_version_id, new_version_id):
        identity = versions_by_id.get(version_id)
        if identity is None:
            raise InvalidationLedgerError("missing version referenced by a head-change record")
        if identity.artifact_id != changed_artifact_id or identity.project_id != project_id:
            raise InvalidationLedgerError(
                "head-change versions do not belong to the declared changed artifact and project"
            )


def _load_accepted_heads_with_overlay(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
    versions_by_id: dict[str, ArtifactVersionIdentity],
) -> tuple[AcceptedArtifactHead, ...]:
    rows = connection.execute(
        """
        SELECT artifacts.project_id, artifacts.artifact_id, artifact_heads.accepted_version_id
        FROM artifact_heads
        JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
        WHERE artifacts.project_id = ?
        """,
        (project_id,),
    ).fetchall()
    current_accepted: str | None = None
    heads: list[AcceptedArtifactHead] = []
    seen_artifacts: set[str] = set()
    for row in rows:
        artifact_id = str(_row_value(row, "artifact_id"))
        if artifact_id in seen_artifacts:
            raise InvalidationLedgerError("duplicate identity records")
        seen_artifacts.add(artifact_id)
        accepted_version_id = _row_value(row, "accepted_version_id")
        if artifact_id == changed_artifact_id:
            current_accepted = (
                None if accepted_version_id is None else str(accepted_version_id)
            )
        if accepted_version_id is None:
            continue
        accepted = str(accepted_version_id)
        identity = versions_by_id.get(accepted)
        if identity is None:
            raise InvalidationLedgerError("missing version referenced by an accepted head")
        if identity.artifact_id != artifact_id:
            raise InvalidationLedgerError("accepted head version belongs to a different artifact")
        if artifact_id == changed_artifact_id:
            continue
        heads.append(
            AcceptedArtifactHead(
                project_id=project_id,
                artifact_id=artifact_id,
                accepted_version_id=accepted,
            )
        )
    if current_accepted != old_version_id:
        raise InvalidationLedgerError("inconsistent accepted-head overlay")
    overlay_identity = versions_by_id[new_version_id]
    if overlay_identity.artifact_id != changed_artifact_id:
        raise InvalidationLedgerError("inconsistent accepted-head overlay")
    heads.append(
        AcceptedArtifactHead(
            project_id=project_id,
            artifact_id=changed_artifact_id,
            accepted_version_id=new_version_id,
        )
    )
    return tuple(heads)


def _load_project_dependencies(
    connection: sqlite3.Connection,
    project_id: str,
    versions_by_id: dict[str, ArtifactVersionIdentity],
) -> tuple[ExactVersionDependency, ...]:
    rows = connection.execute(
        """
        SELECT
            dependency.dependency_id,
            dependency.downstream_artifact_id,
            dependency.downstream_version_id,
            dependency.upstream_artifact_id,
            dependency.upstream_version_id,
            dependency.relationship,
            dependency.impact,
            downstream.project_id AS downstream_project_id,
            upstream.project_id AS upstream_project_id
        FROM artifact_dependencies AS dependency
        LEFT JOIN artifacts AS downstream
          ON downstream.artifact_id = dependency.downstream_artifact_id
        LEFT JOIN artifacts AS upstream
          ON upstream.artifact_id = dependency.upstream_artifact_id
        WHERE downstream.project_id = ? OR upstream.project_id = ?
        ORDER BY dependency.dependency_id
        """,
        (project_id, project_id),
    ).fetchall()
    dependencies: list[ExactVersionDependency] = []
    for row in rows:
        downstream_project_id = _row_value(row, "downstream_project_id")
        upstream_project_id = _row_value(row, "upstream_project_id")
        if downstream_project_id is None or upstream_project_id is None:
            raise InvalidationLedgerError("missing version referenced by a dependency endpoint")
        if str(downstream_project_id) != project_id or str(upstream_project_id) != project_id:
            raise InvalidationLedgerError("cross-project dependency")
        downstream_version_id = str(_row_value(row, "downstream_version_id"))
        upstream_version_id = str(_row_value(row, "upstream_version_id"))
        downstream_artifact_id = str(_row_value(row, "downstream_artifact_id"))
        upstream_artifact_id = str(_row_value(row, "upstream_artifact_id"))
        for version_id, artifact_id in (
            (downstream_version_id, downstream_artifact_id),
            (upstream_version_id, upstream_artifact_id),
        ):
            identity = versions_by_id.get(version_id)
            if identity is None:
                raise InvalidationLedgerError(
                    "missing version referenced by a dependency endpoint"
                )
            if identity.artifact_id != artifact_id:
                raise InvalidationLedgerError(
                    "dependency artifact identity disagrees with its version identity"
                )
        impact = str(_row_value(row, "impact"))
        if impact not in _SUPPORTED_IMPACTS:
            raise InvalidationLedgerError("unsupported dependency impact")
        dependencies.append(
            ExactVersionDependency(
                id=str(_row_value(row, "dependency_id")),
                project_id=project_id,
                downstream_artifact_id=downstream_artifact_id,
                downstream_version_id=downstream_version_id,
                upstream_artifact_id=upstream_artifact_id,
                upstream_version_id=upstream_version_id,
                relationship=str(_row_value(row, "relationship")),
                impact=cast(DependencyImpact, impact),
            )
        )
    return tuple(dependencies)


def _validate_result_identity(
    result: TypedDependencyInvalidationResult,
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
) -> None:
    if (
        result.project_id != project_id
        or result.changed_artifact_id != changed_artifact_id
        or result.old_version_id != old_version_id
        or result.new_version_id != new_version_id
    ):
        raise InvalidationLedgerError("invalidation identity does not match assessment")


def _validate_result_paths(result: TypedDependencyInvalidationResult) -> None:
    for affected in result.affected:
        if affected.classification not in _SUPPORTED_CLASSIFICATIONS:
            raise InvalidationLedgerError("invalid path arrays/hash")
        if affected.aggregate_impact not in _SUPPORTED_IMPACTS:
            raise InvalidationLedgerError("invalid path arrays/hash")
        if not affected.version_id or not affected.artifact_id:
            raise InvalidationLedgerError("invalid path arrays/hash")
        for path in affected.reason_paths:
            lengths = {
                len(path.dependency_ids),
                len(path.relationships),
                len(path.edge_impacts),
            }
            if len(lengths) != 1 or 0 in lengths:
                raise InvalidationLedgerError("invalid path arrays/hash")
            if any(not item for item in path.dependency_ids) or any(
                not item for item in path.relationships
            ):
                raise InvalidationLedgerError("invalid path arrays/hash")
            if any(impact not in _SUPPORTED_IMPACTS for impact in path.edge_impacts):
                raise InvalidationLedgerError("invalid path arrays/hash")
            if path.effective_impact not in _SUPPORTED_IMPACTS:
                raise InvalidationLedgerError("invalid path arrays/hash")


def _existing_or_conflict(
    connection: sqlite3.Connection,
    row: sqlite3.Row | tuple[object, ...],
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
    gate_decision_id: str,
    assessment_hash: str,
) -> InvalidationOperationRecord:
    stored_project_id = str(_row_value(row, "project_id"))
    stored_artifact_id = str(_row_value(row, "changed_artifact_id"))
    stored_old = str(_row_value(row, "old_accepted_version_id"))
    stored_new = str(_row_value(row, "new_accepted_version_id"))
    stored_decision = str(_row_value(row, "gate_decision_id"))
    stored_hash = str(_row_value(row, "assessment_hash"))
    if (
        stored_project_id != project_id
        or stored_artifact_id != changed_artifact_id
        or stored_old != old_version_id
        or stored_new != new_version_id
        or stored_decision != gate_decision_id
        or stored_hash != assessment_hash
    ):
        raise InvalidationLedgerError(
            "invalidation identity drifted from the stored result"
        )
    return _operation_from_row(connection, row)


def _select_operation_row(
    connection: sqlite3.Connection,
    *,
    gate_decision_id: str,
) -> sqlite3.Row | tuple[object, ...] | None:
    row = connection.execute(
        "SELECT * FROM invalidation_operations WHERE gate_decision_id = ?",
        (gate_decision_id,),
    ).fetchone()
    return cast(sqlite3.Row | tuple[object, ...] | None, row)


def _require_stored_operation_ownership(
    connection: sqlite3.Connection,
    row: sqlite3.Row | tuple[object, ...],
) -> None:
    project_id = str(_row_value(row, "project_id"))
    changed_artifact_id = str(_row_value(row, "changed_artifact_id"))
    old_version_id = str(_row_value(row, "old_accepted_version_id"))
    new_version_id = str(_row_value(row, "new_accepted_version_id"))
    gate_decision_id = str(_row_value(row, "gate_decision_id"))
    owned = connection.execute(
        """
        SELECT 1
        FROM projects AS project
        JOIN artifacts AS artifact
          ON artifact.project_id = project.id
         AND artifact.artifact_id = ?
        JOIN artifact_versions AS old_version
          ON old_version.artifact_id = artifact.artifact_id
         AND old_version.version_id = ?
        JOIN artifact_versions AS new_version
          ON new_version.artifact_id = artifact.artifact_id
         AND new_version.version_id = ?
        JOIN gate_decisions AS decision
          ON decision.decision_id = ?
         AND decision.artifact_id = artifact.artifact_id
         AND decision.version_id = ?
         AND decision.decision IN ('approved', 'approved_with_waiver')
        WHERE project.id = ?
        """,
        (
            changed_artifact_id,
            old_version_id,
            new_version_id,
            gate_decision_id,
            new_version_id,
            project_id,
        ),
    ).fetchone()
    if owned is None:
        raise InvalidationLedgerError("invalidation operation ownership is inconsistent")


def _require_stored_path_ownership(
    connection: sqlite3.Connection,
    path: InvalidationReasonPathRecord,
    *,
    project_id: str,
) -> None:
    if path.project_id != project_id:
        raise InvalidationLedgerError("invalidation reason path ownership is inconsistent")
    owned = connection.execute(
        """
        SELECT 1
        FROM artifacts AS artifact
        JOIN artifact_versions AS version
          ON version.artifact_id = artifact.artifact_id
         AND version.version_id = ?
        WHERE artifact.artifact_id = ?
          AND artifact.project_id = ?
        """,
        (path.affected_version_id, path.affected_artifact_id, project_id),
    ).fetchone()
    if owned is None:
        raise InvalidationLedgerError("invalidation reason path ownership is inconsistent")


def _operation_from_row(
    connection: sqlite3.Connection,
    row: sqlite3.Row | tuple[object, ...],
) -> InvalidationOperationRecord:
    operation_id = str(_row_value(row, "operation_id"))
    project_id = str(_row_value(row, "project_id"))
    path_rows = connection.execute(
        """
        SELECT * FROM invalidation_reason_paths
        WHERE project_id = ? AND operation_id = ?
        ORDER BY ordinal ASC, path_id ASC
        """,
        (project_id, operation_id),
    ).fetchall()
    paths = tuple(_path_from_row(path_row) for path_row in path_rows)
    if [path.ordinal for path in paths] != list(range(len(paths))):
        raise InvalidationLedgerError("invalid path arrays/hash")
    _require_stored_operation_ownership(connection, row)
    for path in paths:
        _require_stored_path_ownership(connection, path, project_id=project_id)
    reconstructed = _result_from_operation(
        project_id=project_id,
        changed_artifact_id=str(_row_value(row, "changed_artifact_id")),
        old_version_id=str(_row_value(row, "old_accepted_version_id")),
        new_version_id=str(_row_value(row, "new_accepted_version_id")),
        paths=paths,
    )
    stored_hash = str(_row_value(row, "assessment_hash"))
    if canonical_assessment_hash(reconstructed) != stored_hash:
        raise InvalidationLedgerError("canonical assessment hash mismatch")
    return InvalidationOperationRecord(
        id=operation_id,
        project_id=project_id,
        changed_artifact_id=str(_row_value(row, "changed_artifact_id")),
        old_accepted_version_id=str(_row_value(row, "old_accepted_version_id")),
        new_accepted_version_id=str(_row_value(row, "new_accepted_version_id")),
        gate_decision_id=str(_row_value(row, "gate_decision_id")),
        assessment_hash=stored_hash,
        created_at=_datetime(str(_row_value(row, "created_at"))),
        paths=paths,
    )


def _path_from_row(row: sqlite3.Row | tuple[object, ...]) -> InvalidationReasonPathRecord:
    dependency_ids = _load_string_array(
        str(_row_value(row, "dependency_ids_json")), field_name="dependency_ids"
    )
    relationships = _load_string_array(
        str(_row_value(row, "relationships_json")), field_name="relationships"
    )
    raw_impacts = _load_string_array(
        str(_row_value(row, "edge_impacts_json")), field_name="edge_impacts"
    )
    if len({len(dependency_ids), len(relationships), len(raw_impacts)}) != 1:
        raise InvalidationLedgerError("invalid path arrays/hash")
    if any(impact not in _SUPPORTED_IMPACTS for impact in raw_impacts):
        raise InvalidationLedgerError("invalid path arrays/hash")
    classification = str(_row_value(row, "classification"))
    aggregate_impact = str(_row_value(row, "aggregate_impact"))
    effective_impact = str(_row_value(row, "effective_impact"))
    if classification not in _SUPPORTED_CLASSIFICATIONS:
        raise InvalidationLedgerError("invalid path arrays/hash")
    if aggregate_impact not in _SUPPORTED_IMPACTS or effective_impact not in _SUPPORTED_IMPACTS:
        raise InvalidationLedgerError("invalid path arrays/hash")
    return InvalidationReasonPathRecord(
        id=str(_row_value(row, "path_id")),
        operation_id=str(_row_value(row, "operation_id")),
        project_id=str(_row_value(row, "project_id")),
        affected_artifact_id=str(_row_value(row, "affected_artifact_id")),
        affected_version_id=str(_row_value(row, "affected_version_id")),
        classification=cast(InvalidationClassification, classification),
        aggregate_impact=cast(DependencyImpact, aggregate_impact),
        dependency_ids=dependency_ids,
        relationships=relationships,
        edge_impacts=tuple(cast(DependencyImpact, impact) for impact in raw_impacts),
        effective_impact=cast(DependencyImpact, effective_impact),
        ordinal=int(str(_row_value(row, "ordinal"))),
        created_at=_datetime(str(_row_value(row, "created_at"))),
    )


def _result_from_operation(
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
    paths: tuple[InvalidationReasonPathRecord, ...],
) -> TypedDependencyInvalidationResult:
    grouped: dict[tuple[str, str], list[InvalidationReasonPathRecord]] = {}
    for path in paths:
        key = (path.affected_artifact_id, path.affected_version_id)
        grouped.setdefault(key, []).append(path)
    affected: list[AffectedDownstreamVersion] = []
    for artifact_id, version_id in sorted(grouped):
        version_paths = grouped[(artifact_id, version_id)]
        classification = version_paths[0].classification
        aggregate_impact = version_paths[0].aggregate_impact
        if any(
            item.classification != classification or item.aggregate_impact != aggregate_impact
            for item in version_paths
        ):
            raise InvalidationLedgerError("invalid path arrays/hash")
        if any(item.project_id != project_id for item in version_paths):
            raise InvalidationLedgerError("invalidation identity does not match assessment")
        affected.append(
            AffectedDownstreamVersion(
                version_id=version_id,
                artifact_id=artifact_id,
                classification=classification,
                aggregate_impact=aggregate_impact,
                reason_paths=tuple(
                    InvalidationReasonPath(
                        dependency_ids=item.dependency_ids,
                        relationships=item.relationships,
                        edge_impacts=item.edge_impacts,
                        effective_impact=item.effective_impact,
                    )
                    for item in version_paths
                ),
            )
        )
    return TypedDependencyInvalidationResult(
        project_id=project_id,
        changed_artifact_id=changed_artifact_id,
        old_version_id=old_version_id,
        new_version_id=new_version_id,
        affected=tuple(affected),
    )


def _load_string_array(raw: str, *, field_name: str) -> tuple[str, ...]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise InvalidationLedgerError(f"corrupted {field_name}") from error
    if not isinstance(parsed, list) or not parsed:
        raise InvalidationLedgerError(f"corrupted {field_name}")
    if not all(isinstance(item, str) and item for item in parsed):
        raise InvalidationLedgerError(f"corrupted {field_name}")
    return tuple(cast(list[str], parsed))


def _canonical_json(value: object) -> str:
    return canonical_content_bytes(value).decode("utf-8")


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _emit(transaction_hook: TransactionHook | None, step: str) -> None:
    if transaction_hook is not None:
        transaction_hook("decide_gate", step)


def _row_value(row: sqlite3.Row | tuple[object, ...], column: str) -> object:
    if isinstance(row, sqlite3.Row):
        return row[column]
    raise InvalidationLedgerError("invalidation ledger connection must use sqlite3.Row")
