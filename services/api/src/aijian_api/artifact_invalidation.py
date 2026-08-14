"""Read-only typed dependency assessment and consumption-mode algebra."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable

from aijian_api.domain import (
    ConsumptionMode,
    DependencyAssessment,
    DependencyImpact,
    DependencyMismatchCause,
)

IMPACT_RANK: dict[DependencyImpact, int] = {
    "advisory": 1,
    "render_only": 2,
    "blocking": 3,
}
_VALID_MODES = frozenset({"general", "render"})

type TransactionStep = Callable[[str, str], None]


class ArtifactDependencyInvalidError(RuntimeError):
    """Raised when dependency graph structure is invalid or consumption is refused."""


def parse_impact(value: str) -> DependencyImpact:
    if value == "blocking":
        return "blocking"
    if value == "advisory":
        return "advisory"
    if value == "render_only":
        return "render_only"
    raise ArtifactDependencyInvalidError("Dependency impact is invalid")


def impact_min(left: DependencyImpact, right: DependencyImpact) -> DependencyImpact:
    return left if IMPACT_RANK[left] <= IMPACT_RANK[right] else right


def effective_path_impact(impacts: tuple[DependencyImpact, ...]) -> DependencyImpact:
    if not impacts:
        raise ArtifactDependencyInvalidError("Dependency path impact is empty")
    effective: DependencyImpact = impacts[0]
    for impact in impacts[1:]:
        effective = impact_min(effective, impact)
    return effective


def is_consumable(mode: ConsumptionMode, causes: tuple[DependencyMismatchCause, ...]) -> bool:
    if mode == "general":
        return all(cause.effective_impact != "blocking" for cause in causes)
    return all(cause.effective_impact == "advisory" for cause in causes)


def is_stale(causes: tuple[DependencyMismatchCause, ...]) -> bool:
    return any(cause.effective_impact == "blocking" for cause in causes)


def sort_causes(
    causes: list[DependencyMismatchCause],
) -> tuple[DependencyMismatchCause, ...]:
    return tuple(
        sorted(
            causes,
            key=lambda cause: (
                cause.dependency_path,
                cause.pinned_upstream_version_id,
                cause.current_accepted_version_id or "",
                -IMPACT_RANK[cause.effective_impact],
            ),
        )
    )


def _require_validated_accepted_version_id(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    artifact_id: str,
) -> str | None:
    """Load an artifact head and fail closed on missing or corrupted accepted pointers.

    NULL accepted heads are valid (treated as mismatch by callers). Non-NULL accepted
    version IDs must resolve to a version owned by the same artifact and project.
    """

    head = connection.execute(
        """
        SELECT accepted_version_id
        FROM artifact_heads
        WHERE artifact_id = ?
        """,
        (artifact_id,),
    ).fetchone()
    if head is None:
        raise ArtifactDependencyInvalidError("Artifact head is missing")
    accepted_raw = head["accepted_version_id"]
    if accepted_raw is None:
        return None
    accepted_version_id = str(accepted_raw)
    owned = connection.execute(
        """
        SELECT
            artifact_versions.version_id,
            artifact_versions.artifact_id,
            artifacts.project_id
        FROM artifact_versions
        JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
        WHERE artifact_versions.version_id = ?
        """,
        (accepted_version_id,),
    ).fetchone()
    if owned is None:
        raise ArtifactDependencyInvalidError("Accepted version is missing")
    if str(owned["artifact_id"]) != artifact_id:
        raise ArtifactDependencyInvalidError("Accepted version ownership is corrupted")
    if str(owned["project_id"]) != project_id:
        raise ArtifactDependencyInvalidError("Accepted version ownership is corrupted")
    return accepted_version_id


def assess_dependencies_on_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    version_id: str,
    mode: ConsumptionMode,
    transaction_step: TransactionStep | None = None,
) -> DependencyAssessment:
    """Assess exact pinned upstream versions against current accepted heads.

    Walks the immutable pinned graph downstream-to-upstream inside the caller's
    SQLite snapshot. Continues through mismatched edges so transitive causes remain
    explainable. Structural corruption fails closed.
    """

    if mode not in _VALID_MODES:
        raise ArtifactDependencyInvalidError(f"Unsupported consumption mode: {mode}")

    target = connection.execute(
        """
        SELECT
            artifact_versions.version_id,
            artifact_versions.artifact_id,
            artifacts.project_id
        FROM artifact_versions
        JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
        WHERE artifact_versions.version_id = ? AND artifacts.project_id = ?
        """,
        (version_id, project_id),
    ).fetchone()
    if target is None:
        raise ArtifactDependencyInvalidError(
            "Artifact version was not found in the requested project"
        )
    artifact_id = str(target["artifact_id"])
    # Assessed target head must exist; validate accepted pointer if present.
    _require_validated_accepted_version_id(
        connection,
        project_id=project_id,
        artifact_id=artifact_id,
    )
    if transaction_step is not None:
        transaction_step("assess_artifact_dependencies", "target_selected")

    causes: list[DependencyMismatchCause] = []
    _walk_upstream(
        connection,
        project_id=project_id,
        version_id=version_id,
        expected_artifact_id=artifact_id,
        path_dependency_ids=(),
        path_relationships=(),
        path_impacts=(),
        ancestors=(version_id,),
        causes=causes,
    )
    ordered = sort_causes(causes)
    return DependencyAssessment(
        project_id=project_id,
        artifact_id=artifact_id,
        version_id=version_id,
        mode=mode,
        causes=ordered,
        stale=is_stale(ordered),
        consumable=is_consumable(mode, ordered),
    )


def require_accepted_consumable_on_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    version_id: str,
    mode: ConsumptionMode,
    transaction_step: TransactionStep | None = None,
) -> DependencyAssessment:
    """Require the target to be the current accepted head and consumable for mode."""

    target = connection.execute(
        """
        SELECT
            artifact_versions.version_id,
            artifact_versions.artifact_id
        FROM artifact_versions
        JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
        WHERE artifact_versions.version_id = ? AND artifacts.project_id = ?
        """,
        (version_id, project_id),
    ).fetchone()
    if target is None:
        raise ArtifactDependencyInvalidError(
            "Artifact version was not found in the requested project"
        )
    accepted_version_id = _require_validated_accepted_version_id(
        connection,
        project_id=project_id,
        artifact_id=str(target["artifact_id"]),
    )
    if accepted_version_id != version_id:
        raise ArtifactDependencyInvalidError(
            "Only the current accepted artifact version may be consumed"
        )
    if transaction_step is not None:
        transaction_step("require_accepted_artifact_consumable", "accepted_verified")
    assessment = assess_dependencies_on_connection(
        connection,
        project_id=project_id,
        version_id=version_id,
        mode=mode,
        transaction_step=transaction_step,
    )
    if not assessment.consumable:
        raise ArtifactDependencyInvalidError(
            "Accepted artifact version is not consumable for the selected mode"
        )
    return assessment


def _walk_upstream(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    version_id: str,
    expected_artifact_id: str,
    path_dependency_ids: tuple[str, ...],
    path_relationships: tuple[str, ...],
    path_impacts: tuple[DependencyImpact, ...],
    ancestors: tuple[str, ...],
    causes: list[DependencyMismatchCause],
) -> None:
    dependency_rows = connection.execute(
        """
        SELECT *
        FROM artifact_dependencies
        WHERE downstream_version_id = ?
        ORDER BY dependency_id
        """,
        (version_id,),
    ).fetchall()
    for row in dependency_rows:
        dependency_id = str(row["dependency_id"])
        downstream_artifact_id = str(row["downstream_artifact_id"])
        downstream_version_id = str(row["downstream_version_id"])
        upstream_artifact_id = str(row["upstream_artifact_id"])
        upstream_version_id = str(row["upstream_version_id"])
        relationship = str(row["relationship"])
        impact = parse_impact(str(row["impact"]))
        if downstream_version_id != version_id:
            raise ArtifactDependencyInvalidError("Dependency ownership is corrupted")
        if downstream_artifact_id != expected_artifact_id:
            raise ArtifactDependencyInvalidError("Dependency ownership is corrupted")
        if upstream_version_id in ancestors:
            raise ArtifactDependencyInvalidError("Artifact dependency cycle detected")

        upstream = connection.execute(
            """
            SELECT
                artifact_versions.version_id,
                artifact_versions.artifact_id,
                artifacts.project_id
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifact_versions.version_id = ?
            """,
            (upstream_version_id,),
        ).fetchone()
        if upstream is None:
            raise ArtifactDependencyInvalidError("Dependency upstream version is missing")
        if str(upstream["artifact_id"]) != upstream_artifact_id:
            raise ArtifactDependencyInvalidError("Dependency ownership is corrupted")
        if str(upstream["project_id"]) != project_id:
            raise ArtifactDependencyInvalidError(
                "Dependency crosses project boundaries"
            )

        current_accepted = _require_validated_accepted_version_id(
            connection,
            project_id=project_id,
            artifact_id=upstream_artifact_id,
        )
        next_path_ids = (*path_dependency_ids, dependency_id)
        next_relationships = (*path_relationships, relationship)
        next_impacts = (*path_impacts, impact)
        if current_accepted != upstream_version_id:
            causes.append(
                DependencyMismatchCause(
                    dependency_path=next_path_ids,
                    path_relationships=next_relationships,
                    path_impacts=next_impacts,
                    pinned_upstream_version_id=upstream_version_id,
                    current_accepted_version_id=current_accepted,
                    effective_impact=effective_path_impact(next_impacts),
                )
            )

        _walk_upstream(
            connection,
            project_id=project_id,
            version_id=upstream_version_id,
            expected_artifact_id=upstream_artifact_id,
            path_dependency_ids=next_path_ids,
            path_relationships=next_relationships,
            path_impacts=next_impacts,
            ancestors=(*ancestors, upstream_version_id),
            causes=causes,
        )
