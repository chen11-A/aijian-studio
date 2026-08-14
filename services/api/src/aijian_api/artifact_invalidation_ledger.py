"""Append-only invalidation operation and path-impact ledger (T04).

Writes reverse-dependency path impacts when an accepted head is replaced.
Reuses T03 path-min algebra; never mutates descendant artifact truth.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from aijian_api.artifact_invalidation import (
    IMPACT_RANK,
    ArtifactDependencyInvalidError,
    _require_validated_accepted_version_id,
    effective_path_impact,
    parse_impact,
)
from aijian_api.domain import DependencyImpact, InvalidationOperation, InvalidationPathImpact

type IdFactory = Callable[[str], str]
type TransactionStep = Callable[[str, str], None]


@dataclass(frozen=True, slots=True)
class _PathImpactDraft:
    affected_artifact_id: str
    affected_version_id: str
    dependency_path: tuple[str, ...]
    path_relationships: tuple[str, ...]
    path_impacts: tuple[DependencyImpact, ...]
    effective_impact: DependencyImpact


def canonical_json_array(values: tuple[str, ...] | tuple[DependencyImpact, ...]) -> str:
    """Serialize ordered path arrays deterministically for storage and uniqueness."""

    return json.dumps(list(values), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def parse_json_string_array(value: str, *, field_name: str) -> tuple[str, ...]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise ArtifactDependencyInvalidError(f"Invalidation {field_name} is corrupt") from error
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise ArtifactDependencyInvalidError(f"Invalidation {field_name} is corrupt")
    return tuple(str(item) for item in parsed)


def parse_json_impact_array(value: str) -> tuple[DependencyImpact, ...]:
    items = parse_json_string_array(value, field_name="path_impacts_json")
    return tuple(parse_impact(item) for item in items)


def projected_effective_impact(
    impacts: tuple[InvalidationPathImpact, ...],
) -> DependencyImpact | None:
    """Strongest effective impact across independent paths for one affected version."""

    if not impacts:
        return None
    strongest = impacts[0].effective_impact
    for impact in impacts[1:]:
        if IMPACT_RANK[impact.effective_impact] > IMPACT_RANK[strongest]:
            strongest = impact.effective_impact
    return strongest


def is_general_stale(impacts: tuple[InvalidationPathImpact, ...]) -> bool:
    return any(impact.effective_impact == "blocking" for impact in impacts)


def record_accepted_head_replacement(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    changed_artifact_id: str,
    old_accepted_version_id: str | None,
    new_accepted_version_id: str,
    gate_decision_id: str,
    created_at: datetime,
    id_factory: IdFactory,
    transaction_step: TransactionStep | None = None,
) -> InvalidationOperation | None:
    """Persist one operation and all reverse path impacts for a head replacement.

    Returns None when the head move is not a replacement (NULL→version or same id).
    """

    if old_accepted_version_id is None:
        return None
    if old_accepted_version_id == new_accepted_version_id:
        return None

    _validate_changed_versions(
        connection,
        project_id=project_id,
        changed_artifact_id=changed_artifact_id,
        old_accepted_version_id=old_accepted_version_id,
        new_accepted_version_id=new_accepted_version_id,
    )

    drafts = _collect_reverse_path_impacts(
        connection,
        project_id=project_id,
        root_version_id=old_accepted_version_id,
        root_artifact_id=changed_artifact_id,
    )
    ordered = _sort_path_drafts(drafts)
    operation = InvalidationOperation(
        id=id_factory("invop"),
        project_id=project_id,
        changed_artifact_id=changed_artifact_id,
        old_accepted_version_id=old_accepted_version_id,
        new_accepted_version_id=new_accepted_version_id,
        gate_decision_id=gate_decision_id,
        created_at=created_at,
    )
    connection.execute(
        """
        INSERT INTO invalidation_operations (
            operation_id, project_id, changed_artifact_id,
            old_accepted_version_id, new_accepted_version_id,
            gate_decision_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            operation.id,
            operation.project_id,
            operation.changed_artifact_id,
            operation.old_accepted_version_id,
            operation.new_accepted_version_id,
            operation.gate_decision_id,
            _timestamp(operation.created_at),
        ),
    )
    if transaction_step is not None:
        transaction_step("decide_gate", "invalidation_operation_inserted")

    for ordinal, draft in enumerate(ordered):
        connection.execute(
            """
            INSERT INTO invalidation_path_impacts (
                impact_id, operation_id, project_id,
                affected_artifact_id, affected_version_id,
                dependency_path_json, path_relationships_json, path_impacts_json,
                effective_impact, path_ordinal
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                id_factory("invimp"),
                operation.id,
                project_id,
                draft.affected_artifact_id,
                draft.affected_version_id,
                canonical_json_array(draft.dependency_path),
                canonical_json_array(draft.path_relationships),
                canonical_json_array(draft.path_impacts),
                draft.effective_impact,
                ordinal,
            ),
        )
    if transaction_step is not None:
        transaction_step("decide_gate", "invalidation_impacts_persisted")
    return operation


def list_operations_on_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
) -> tuple[InvalidationOperation, ...]:
    _require_project(connection, project_id)
    rows = connection.execute(
        """
        SELECT *
        FROM invalidation_operations
        WHERE project_id = ?
        ORDER BY created_at ASC, operation_id ASC
        """,
        (project_id,),
    ).fetchall()
    return tuple(_operation_from_row(row) for row in rows)


def get_operation_on_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    operation_id: str,
) -> InvalidationOperation:
    _require_project(connection, project_id)
    row = connection.execute(
        """
        SELECT *
        FROM invalidation_operations
        WHERE operation_id = ? AND project_id = ?
        """,
        (operation_id, project_id),
    ).fetchone()
    if row is None:
        raise InvalidationNotFoundError("Invalidation operation was not found in the project")
    return _operation_from_row(row)


def list_path_impacts_on_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    operation_id: str,
) -> tuple[InvalidationPathImpact, ...]:
    get_operation_on_connection(
        connection,
        project_id=project_id,
        operation_id=operation_id,
    )
    rows = connection.execute(
        """
        SELECT *
        FROM invalidation_path_impacts
        WHERE operation_id = ? AND project_id = ?
        ORDER BY path_ordinal ASC
        """,
        (operation_id, project_id),
    ).fetchall()
    return tuple(_path_impact_from_row(row) for row in rows)


class InvalidationNotFoundError(LookupError):
    """Raised when an invalidation operation is missing or not in the project."""


def _collect_reverse_path_impacts(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    root_version_id: str,
    root_artifact_id: str,
) -> list[_PathImpactDraft]:
    # Structural integrity for every traversed artifact, including the replaced root.
    # NULL accepted heads are valid; non-NULL pointers must resolve in-project/in-artifact.
    _require_validated_accepted_version_id(
        connection,
        project_id=project_id,
        artifact_id=root_artifact_id,
    )
    drafts: list[_PathImpactDraft] = []
    _walk_reverse(
        connection,
        project_id=project_id,
        upstream_version_id=root_version_id,
        expected_upstream_artifact_id=root_artifact_id,
        path_dependency_ids=(),
        path_relationships=(),
        path_impacts=(),
        ancestors=(root_version_id,),
        drafts=drafts,
    )
    return drafts


def _walk_reverse(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    upstream_version_id: str,
    expected_upstream_artifact_id: str,
    path_dependency_ids: tuple[str, ...],
    path_relationships: tuple[str, ...],
    path_impacts: tuple[DependencyImpact, ...],
    ancestors: tuple[str, ...],
    drafts: list[_PathImpactDraft],
) -> None:
    dependency_rows = connection.execute(
        """
        SELECT *
        FROM artifact_dependencies
        WHERE upstream_version_id = ?
        ORDER BY dependency_id
        """,
        (upstream_version_id,),
    ).fetchall()
    for row in dependency_rows:
        dependency_id = str(row["dependency_id"])
        downstream_artifact_id = str(row["downstream_artifact_id"])
        downstream_version_id = str(row["downstream_version_id"])
        upstream_artifact_id = str(row["upstream_artifact_id"])
        edge_upstream_version_id = str(row["upstream_version_id"])
        relationship = str(row["relationship"])
        impact = parse_impact(str(row["impact"]))

        if edge_upstream_version_id != upstream_version_id:
            raise ArtifactDependencyInvalidError("Dependency ownership is corrupted")
        if upstream_artifact_id != expected_upstream_artifact_id:
            raise ArtifactDependencyInvalidError("Dependency ownership is corrupted")
        if downstream_version_id in ancestors:
            raise ArtifactDependencyInvalidError("Artifact dependency cycle detected")

        downstream = connection.execute(
            """
            SELECT
                artifact_versions.version_id,
                artifact_versions.artifact_id,
                artifacts.project_id
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifact_versions.version_id = ?
            """,
            (downstream_version_id,),
        ).fetchone()
        if downstream is None:
            raise ArtifactDependencyInvalidError("Dependency downstream version is missing")
        if str(downstream["artifact_id"]) != downstream_artifact_id:
            raise ArtifactDependencyInvalidError("Dependency ownership is corrupted")
        if str(downstream["project_id"]) != project_id:
            raise ArtifactDependencyInvalidError("Dependency crosses project boundaries")

        # Head validation is structural integrity only; historical/draft versions may
        # differ from the current accepted pointer and must still be recorded.
        _require_validated_accepted_version_id(
            connection,
            project_id=project_id,
            artifact_id=downstream_artifact_id,
        )

        # Path is ordered affected → replaced root (newest reverse edge first).
        next_path_ids = (dependency_id, *path_dependency_ids)
        next_relationships = (relationship, *path_relationships)
        next_impacts = (impact, *path_impacts)
        drafts.append(
            _PathImpactDraft(
                affected_artifact_id=downstream_artifact_id,
                affected_version_id=downstream_version_id,
                dependency_path=next_path_ids,
                path_relationships=next_relationships,
                path_impacts=next_impacts,
                effective_impact=effective_path_impact(next_impacts),
            )
        )
        _walk_reverse(
            connection,
            project_id=project_id,
            upstream_version_id=downstream_version_id,
            expected_upstream_artifact_id=downstream_artifact_id,
            path_dependency_ids=next_path_ids,
            path_relationships=next_relationships,
            path_impacts=next_impacts,
            ancestors=(*ancestors, downstream_version_id),
            drafts=drafts,
        )


def _sort_path_drafts(drafts: list[_PathImpactDraft]) -> tuple[_PathImpactDraft, ...]:
    return tuple(
        sorted(
            drafts,
            key=lambda draft: (
                draft.dependency_path,
                draft.affected_version_id,
                draft.affected_artifact_id,
                -IMPACT_RANK[draft.effective_impact],
            ),
        )
    )


def _validate_changed_versions(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    changed_artifact_id: str,
    old_accepted_version_id: str,
    new_accepted_version_id: str,
) -> None:
    for version_id, label in (
        (old_accepted_version_id, "old accepted"),
        (new_accepted_version_id, "new accepted"),
    ):
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
            raise ArtifactDependencyInvalidError(f"Invalidation {label} version is missing")
        if str(row["artifact_id"]) != changed_artifact_id:
            raise ArtifactDependencyInvalidError(
                "Invalidation changed artifact ownership is corrupted"
            )
        if str(row["project_id"]) != project_id:
            raise ArtifactDependencyInvalidError(
                "Invalidation changed artifact ownership is corrupted"
            )


def _require_project(connection: sqlite3.Connection, project_id: str) -> None:
    row = connection.execute(
        "SELECT id FROM projects WHERE id = ?",
        (project_id,),
    ).fetchone()
    if row is None:
        raise ProjectMissingError("Project was not found")


class ProjectMissingError(LookupError):
    """Raised when ledger reads target an unknown project."""


def _operation_from_row(row: sqlite3.Row) -> InvalidationOperation:
    return InvalidationOperation(
        id=str(row["operation_id"]),
        project_id=str(row["project_id"]),
        changed_artifact_id=str(row["changed_artifact_id"]),
        old_accepted_version_id=str(row["old_accepted_version_id"]),
        new_accepted_version_id=str(row["new_accepted_version_id"]),
        gate_decision_id=str(row["gate_decision_id"]),
        created_at=_datetime(str(row["created_at"])),
    )


def _path_impact_from_row(row: sqlite3.Row) -> InvalidationPathImpact:
    dependency_path = parse_json_string_array(
        str(row["dependency_path_json"]),
        field_name="dependency_path_json",
    )
    path_relationships = parse_json_string_array(
        str(row["path_relationships_json"]),
        field_name="path_relationships_json",
    )
    path_impacts = parse_json_impact_array(str(row["path_impacts_json"]))
    if not (len(dependency_path) == len(path_relationships) == len(path_impacts)):
        raise ArtifactDependencyInvalidError("Invalidation path arrays are inconsistent")
    if not dependency_path:
        raise ArtifactDependencyInvalidError("Invalidation path is empty")
    return InvalidationPathImpact(
        id=str(row["impact_id"]),
        operation_id=str(row["operation_id"]),
        project_id=str(row["project_id"]),
        affected_artifact_id=str(row["affected_artifact_id"]),
        affected_version_id=str(row["affected_version_id"]),
        dependency_path=dependency_path,
        path_relationships=path_relationships,
        path_impacts=path_impacts,
        effective_impact=parse_impact(str(row["effective_impact"])),
        path_ordinal=int(row["path_ordinal"]),
    )


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
