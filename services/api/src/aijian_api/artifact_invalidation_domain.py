"""Pure-domain typed dependency invalidation for one accepted-head replacement."""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Literal

from aijian_api.domain import DependencyImpact

type InvalidationClassification = Literal["STALE", "INVALIDATE"]

_SUPPORTED_IMPACTS: frozenset[str] = frozenset({"blocking", "render_only", "advisory"})
_IMPACT_STRENGTH: dict[str, int] = {
    "blocking": 2,
    "render_only": 1,
    "advisory": 0,
}


class TypedDependencyInvalidationError(ValueError):
    """Closed typed-dependency assessment input is inconsistent."""


@dataclass(frozen=True, slots=True)
class ArtifactVersionIdentity:
    project_id: str
    artifact_id: str
    version_id: str


@dataclass(frozen=True, slots=True)
class AcceptedArtifactHead:
    project_id: str
    artifact_id: str
    accepted_version_id: str


@dataclass(frozen=True, slots=True)
class ExactVersionDependency:
    id: str
    project_id: str
    downstream_artifact_id: str
    downstream_version_id: str
    upstream_artifact_id: str
    upstream_version_id: str
    relationship: str
    impact: DependencyImpact


@dataclass(frozen=True, slots=True)
class AcceptedHeadReplacement:
    project_id: str
    artifact_id: str
    old_version_id: str
    new_version_id: str


@dataclass(frozen=True, slots=True)
class TypedDependencyInvalidationInput:
    project_id: str
    versions: tuple[ArtifactVersionIdentity, ...]
    accepted_heads: tuple[AcceptedArtifactHead, ...]
    dependencies: tuple[ExactVersionDependency, ...]
    head_change: AcceptedHeadReplacement


@dataclass(frozen=True, slots=True)
class InvalidationReasonPath:
    dependency_ids: tuple[str, ...]
    relationships: tuple[str, ...]
    edge_impacts: tuple[DependencyImpact, ...]
    effective_impact: DependencyImpact


@dataclass(frozen=True, slots=True)
class AffectedDownstreamVersion:
    version_id: str
    artifact_id: str
    classification: InvalidationClassification
    aggregate_impact: DependencyImpact
    reason_paths: tuple[InvalidationReasonPath, ...]


@dataclass(frozen=True, slots=True)
class TypedDependencyInvalidationResult:
    project_id: str
    changed_artifact_id: str
    old_version_id: str
    new_version_id: str
    affected: tuple[AffectedDownstreamVersion, ...]


def assess_typed_dependency_invalidation(
    assessment: TypedDependencyInvalidationInput,
) -> TypedDependencyInvalidationResult:
    """Assess descendants of one accepted-head replacement on a closed exact graph."""

    versions_by_id = _closed_version_index(assessment)
    accepted_by_artifact = _closed_head_index(assessment, versions_by_id)
    _validate_head_change(assessment, versions_by_id, accepted_by_artifact)
    dependents = _closed_dependency_index(assessment, versions_by_id)
    _reject_cycles(versions_by_id, assessment.dependencies)

    paths_by_version = _collect_simple_reason_paths(
        old_version_id=assessment.head_change.old_version_id,
        dependents=dependents,
    )
    return TypedDependencyInvalidationResult(
        project_id=assessment.project_id,
        changed_artifact_id=assessment.head_change.artifact_id,
        old_version_id=assessment.head_change.old_version_id,
        new_version_id=assessment.head_change.new_version_id,
        affected=_affected_versions(paths_by_version, versions_by_id, accepted_by_artifact),
    )


def _require_identity(value: str, *, field_name: str) -> str:
    if not value:
        raise TypedDependencyInvalidationError(f"inconsistent closed input: empty {field_name}")
    return value


def _require_project(project_id: str, expected_project_id: str) -> None:
    if project_id != expected_project_id:
        raise TypedDependencyInvalidationError("project identity mismatch")


def _closed_version_index(
    assessment: TypedDependencyInvalidationInput,
) -> dict[str, ArtifactVersionIdentity]:
    project_id = _require_identity(assessment.project_id, field_name="project_id")
    versions_by_id: dict[str, ArtifactVersionIdentity] = {}
    for identity in assessment.versions:
        _require_project(identity.project_id, project_id)
        version_id = _require_identity(identity.version_id, field_name="version_id")
        _require_identity(identity.artifact_id, field_name="artifact_id")
        existing = versions_by_id.get(version_id)
        if existing is not None:
            raise TypedDependencyInvalidationError("duplicate identity records")
        versions_by_id[version_id] = identity
    return versions_by_id


def _closed_head_index(
    assessment: TypedDependencyInvalidationInput,
    versions_by_id: dict[str, ArtifactVersionIdentity],
) -> dict[str, AcceptedArtifactHead]:
    accepted_by_artifact: dict[str, AcceptedArtifactHead] = {}
    for accepted in assessment.accepted_heads:
        _require_project(accepted.project_id, assessment.project_id)
        artifact_id = _require_identity(accepted.artifact_id, field_name="artifact_id")
        accepted_version_id = _require_identity(
            accepted.accepted_version_id,
            field_name="accepted_version_id",
        )
        if artifact_id in accepted_by_artifact:
            raise TypedDependencyInvalidationError("duplicate identity records")
        identity = versions_by_id.get(accepted_version_id)
        if identity is None:
            raise TypedDependencyInvalidationError("missing version referenced by an accepted head")
        if identity.artifact_id != artifact_id:
            raise TypedDependencyInvalidationError(
                "accepted head version belongs to a different artifact"
            )
        accepted_by_artifact[artifact_id] = accepted
    return accepted_by_artifact


def _validate_head_change(
    assessment: TypedDependencyInvalidationInput,
    versions_by_id: dict[str, ArtifactVersionIdentity],
    accepted_by_artifact: dict[str, AcceptedArtifactHead],
) -> None:
    change = assessment.head_change
    _require_project(change.project_id, assessment.project_id)
    artifact_id = _require_identity(change.artifact_id, field_name="artifact_id")
    old_version_id = _require_identity(change.old_version_id, field_name="old_version_id")
    new_version_id = _require_identity(change.new_version_id, field_name="new_version_id")
    if old_version_id == new_version_id:
        raise TypedDependencyInvalidationError("old and new version IDs are equal")
    for version_id in (old_version_id, new_version_id):
        identity = versions_by_id.get(version_id)
        if identity is None:
            raise TypedDependencyInvalidationError(
                "missing version referenced by a head-change record"
            )
        if identity.artifact_id != artifact_id or identity.project_id != change.project_id:
            raise TypedDependencyInvalidationError(
                "head-change versions do not belong to the declared changed artifact and project"
            )
    accepted = accepted_by_artifact.get(artifact_id)
    if accepted is None:
        raise TypedDependencyInvalidationError(
            "current accepted head does not equal the change's new version"
        )
    if accepted.accepted_version_id != new_version_id:
        raise TypedDependencyInvalidationError(
            "current accepted head does not equal the change's new version"
        )


def _closed_dependency_index(
    assessment: TypedDependencyInvalidationInput,
    versions_by_id: dict[str, ArtifactVersionIdentity],
) -> dict[str, tuple[ExactVersionDependency, ...]]:
    dependents: dict[str, list[ExactVersionDependency]] = defaultdict(list)
    seen_ids: dict[str, ExactVersionDependency] = {}
    for edge in assessment.dependencies:
        _require_project(edge.project_id, assessment.project_id)
        dependency_id = _require_identity(edge.id, field_name="dependency_id")
        _require_identity(edge.relationship, field_name="relationship")
        if edge.impact not in _SUPPORTED_IMPACTS:
            raise TypedDependencyInvalidationError("unsupported dependency impact")
        existing = seen_ids.get(dependency_id)
        if existing is not None:
            if existing != edge:
                raise TypedDependencyInvalidationError(
                    "duplicate dependency IDs with inconsistent data"
                )
            raise TypedDependencyInvalidationError("duplicate identity records")
        seen_ids[dependency_id] = edge
        for version_id, artifact_id, role in (
            (edge.downstream_version_id, edge.downstream_artifact_id, "downstream"),
            (edge.upstream_version_id, edge.upstream_artifact_id, "upstream"),
        ):
            _require_identity(version_id, field_name=f"{role}_version_id")
            _require_identity(artifact_id, field_name=f"{role}_artifact_id")
            identity = versions_by_id.get(version_id)
            if identity is None:
                raise TypedDependencyInvalidationError(
                    "missing version referenced by a dependency endpoint"
                )
            if identity.artifact_id != artifact_id:
                raise TypedDependencyInvalidationError(
                    "dependency artifact identity disagrees with its version identity"
                )
        dependents[edge.upstream_version_id].append(edge)
    return {
        upstream_version_id: tuple(
            sorted(edges, key=lambda item: (item.id, item.relationship, item.impact))
        )
        for upstream_version_id, edges in dependents.items()
    }


def _reject_cycles(
    versions_by_id: dict[str, ArtifactVersionIdentity],
    dependencies: tuple[ExactVersionDependency, ...],
) -> None:
    adjacency: dict[str, list[str]] = {version_id: [] for version_id in versions_by_id}
    indegree: dict[str, int] = {version_id: 0 for version_id in versions_by_id}
    for edge in dependencies:
        adjacency[edge.upstream_version_id].append(edge.downstream_version_id)
        indegree[edge.downstream_version_id] += 1
    ready = deque(version_id for version_id, degree in indegree.items() if degree == 0)
    seen = 0
    while ready:
        version_id = ready.popleft()
        seen += 1
        for downstream_version_id in adjacency[version_id]:
            indegree[downstream_version_id] -= 1
            if indegree[downstream_version_id] == 0:
                ready.append(downstream_version_id)
    if seen != len(versions_by_id):
        raise TypedDependencyInvalidationError("dependency cycle")


def _least_restrictive(impacts: tuple[DependencyImpact, ...]) -> DependencyImpact:
    weakest = impacts[0]
    weakest_strength = _IMPACT_STRENGTH[weakest]
    for impact in impacts[1:]:
        strength = _IMPACT_STRENGTH[impact]
        if strength < weakest_strength:
            weakest = impact
            weakest_strength = strength
    return weakest


def _strongest_impact(impacts: tuple[DependencyImpact, ...]) -> DependencyImpact:
    strongest = impacts[0]
    strongest_strength = _IMPACT_STRENGTH[strongest]
    for impact in impacts[1:]:
        strength = _IMPACT_STRENGTH[impact]
        if strength > strongest_strength:
            strongest = impact
            strongest_strength = strength
    return strongest


def _collect_simple_reason_paths(
    *,
    old_version_id: str,
    dependents: dict[str, tuple[ExactVersionDependency, ...]],
) -> dict[str, list[InvalidationReasonPath]]:
    paths_by_version: dict[str, list[InvalidationReasonPath]] = defaultdict(list)

    def walk(
        upstream_version_id: str,
        visited: frozenset[str],
        dependency_ids: tuple[str, ...],
        relationships: tuple[str, ...],
        edge_impacts: tuple[DependencyImpact, ...],
    ) -> None:
        for edge in dependents.get(upstream_version_id, ()):
            downstream_version_id = edge.downstream_version_id
            if downstream_version_id in visited:
                continue
            # Affected-to-root: newest edge is closest to the affected downstream.
            next_ids = (edge.id, *dependency_ids)
            next_relationships = (edge.relationship, *relationships)
            next_impacts = (edge.impact, *edge_impacts)
            paths_by_version[downstream_version_id].append(
                InvalidationReasonPath(
                    dependency_ids=next_ids,
                    relationships=next_relationships,
                    edge_impacts=next_impacts,
                    effective_impact=_least_restrictive(next_impacts),
                )
            )
            walk(
                downstream_version_id,
                visited | {downstream_version_id},
                next_ids,
                next_relationships,
                next_impacts,
            )

    walk(old_version_id, frozenset({old_version_id}), (), (), ())
    return paths_by_version


def _affected_versions(
    paths_by_version: dict[str, list[InvalidationReasonPath]],
    versions_by_id: dict[str, ArtifactVersionIdentity],
    accepted_by_artifact: dict[str, AcceptedArtifactHead],
) -> tuple[AffectedDownstreamVersion, ...]:
    affected: list[AffectedDownstreamVersion] = []
    for version_id, reason_paths in paths_by_version.items():
        identity = versions_by_id[version_id]
        ordered_paths = tuple(
            sorted(
                reason_paths,
                key=lambda path: (path.dependency_ids, path.relationships, path.edge_impacts),
            )
        )
        accepted = accepted_by_artifact.get(identity.artifact_id)
        classification: InvalidationClassification = (
            "STALE"
            if accepted is not None and accepted.accepted_version_id == version_id
            else "INVALIDATE"
        )
        affected.append(
            AffectedDownstreamVersion(
                version_id=version_id,
                artifact_id=identity.artifact_id,
                classification=classification,
                aggregate_impact=_strongest_impact(
                    tuple(path.effective_impact for path in ordered_paths)
                ),
                reason_paths=ordered_paths,
            )
        )
    return tuple(sorted(affected, key=lambda item: (item.artifact_id, item.version_id)))
