"""Deterministic real-Gate invalidation golden acceptance fixture (T05C-A2)."""

from __future__ import annotations

import argparse
import sys
import tempfile
from collections import defaultdict
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_SRC = _REPO_ROOT / "services" / "api" / "src"
for _path in (_REPO_ROOT, _API_SRC):
    _path_text = str(_path)
    if _path_text not in sys.path:
        sys.path.insert(0, _path_text)

from aijian_api.domain import (  # noqa: E402
    ArtifactDependency,
    ArtifactDependencyDraft,
    ArtifactVersionRecord,
    GateDecisionResult,
    InvalidationOperation,
    InvalidationOperationReport,
    InvalidationPathImpact,
    Project,
    TrustedReviewActor,
)
from aijian_api.repository import StudioRepository  # noqa: E402

from scripts.invalidation_golden_oracle import (  # noqa: E402
    GoldenAffectedGroup,
    GoldenInvalidationMismatch,
    GoldenOperation,
    GoldenPathRecord,
    Impact,
    compare_golden_invalidation,
    serialize_golden_result,
)

FIXTURE_ID = "t05c-a2-real-gate-invalidation-golden"
SCHEMA_VERSION = "t05c-a2.v1"
PATH_DIRECTION = "affected_to_changed_root_v1"
CONTROL_LABEL = "control_v1"
HUMAN_LABEL = "human_v1"
ROOT_V1_LABEL = "root_v1"
ROOT_V2_LABEL = "root_v2"

LOCAL_ACTOR = TrustedReviewActor(
    subject_id="local-user",
    roles=("writer", "continuity_reviewer", "producer"),
)

_IMPACT_RANK: dict[str, int] = {
    "advisory": 0,
    "render_only": 1,
    "blocking": 2,
}

type Relationship = str


class GoldenFixtureError(RuntimeError):
    """Raised when the real-Gate golden fixture violates an invariant."""


@dataclass(frozen=True, slots=True)
class _FixedClock:
    value: datetime = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.value


@dataclass(frozen=True, slots=True)
class _DepEdge:
    dependency_id: str
    downstream_version_id: str
    upstream_version_id: str
    relationship: Relationship
    impact: Impact


@dataclass(frozen=True, slots=True)
class _HumanEvidence:
    version_id: str
    content_hash: str
    content: dict[str, object]
    accepted_version_id: str | None
    author_actor_type: str
    author_actor_id: str
    dependencies: tuple[tuple[str, str, str, str], ...]


def deterministic_id_factory() -> Any:
    counters: defaultdict[str, int] = defaultdict(int)

    def create_id(prefix: str) -> str:
        counters[prefix] += 1
        return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def expected_golden_operation() -> GoldenOperation:
    """Hard-coded label oracle from fixture design and deterministic creation order.

    Path ordinals follow durable dependency_path sort order for deps created as:
    direct, mid, mixed, mid_a, mid_b, diamond(mid_a then mid_b), human.
    """

    return GoldenOperation(
        affected_groups=(
            GoldenAffectedGroup(
                label="diamond_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=5,
                        path_labels=("diamond_v1", "mid_a_v1", ROOT_V1_LABEL),
                        relationship_sequence=("derived_from", "derived_from"),
                        impact_sequence=("blocking", "blocking"),
                        effective_impact="blocking",
                    ),
                    GoldenPathRecord(
                        path_ordinal=6,
                        path_labels=("diamond_v1", "mid_b_v1", ROOT_V1_LABEL),
                        relationship_sequence=("derived_from", "references"),
                        impact_sequence=("blocking", "advisory"),
                        effective_impact="advisory",
                    ),
                ),
                strongest_effective_impact="blocking",
                independent_path_count=2,
                general_stale=True,
                general_blocked=True,
                render_blocked=True,
            ),
            GoldenAffectedGroup(
                label="direct_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=0,
                        path_labels=("direct_v1", ROOT_V1_LABEL),
                        relationship_sequence=("derived_from",),
                        impact_sequence=("blocking",),
                        effective_impact="blocking",
                    ),
                ),
                strongest_effective_impact="blocking",
                independent_path_count=1,
                general_stale=True,
                general_blocked=True,
                render_blocked=True,
            ),
            GoldenAffectedGroup(
                label=HUMAN_LABEL,
                paths=(
                    GoldenPathRecord(
                        path_ordinal=7,
                        path_labels=(HUMAN_LABEL, ROOT_V1_LABEL),
                        relationship_sequence=("derived_from",),
                        impact_sequence=("blocking",),
                        effective_impact="blocking",
                    ),
                ),
                strongest_effective_impact="blocking",
                independent_path_count=1,
                general_stale=True,
                general_blocked=True,
                render_blocked=True,
            ),
            GoldenAffectedGroup(
                label="mid_a_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=3,
                        path_labels=("mid_a_v1", ROOT_V1_LABEL),
                        relationship_sequence=("derived_from",),
                        impact_sequence=("blocking",),
                        effective_impact="blocking",
                    ),
                ),
                strongest_effective_impact="blocking",
                independent_path_count=1,
                general_stale=True,
                general_blocked=True,
                render_blocked=True,
            ),
            GoldenAffectedGroup(
                label="mid_b_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=4,
                        path_labels=("mid_b_v1", ROOT_V1_LABEL),
                        relationship_sequence=("references",),
                        impact_sequence=("advisory",),
                        effective_impact="advisory",
                    ),
                ),
                strongest_effective_impact="advisory",
                independent_path_count=1,
                general_stale=False,
                general_blocked=False,
                render_blocked=False,
            ),
            GoldenAffectedGroup(
                label="mid_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=1,
                        path_labels=("mid_v1", ROOT_V1_LABEL),
                        relationship_sequence=("derived_from",),
                        impact_sequence=("blocking",),
                        effective_impact="blocking",
                    ),
                ),
                strongest_effective_impact="blocking",
                independent_path_count=1,
                general_stale=True,
                general_blocked=True,
                render_blocked=True,
            ),
            GoldenAffectedGroup(
                label="mixed_v1",
                paths=(
                    GoldenPathRecord(
                        path_ordinal=2,
                        path_labels=("mixed_v1", "mid_v1", ROOT_V1_LABEL),
                        relationship_sequence=("derived_from", "derived_from"),
                        impact_sequence=("render_only", "blocking"),
                        effective_impact="render_only",
                    ),
                ),
                strongest_effective_impact="render_only",
                independent_path_count=1,
                general_stale=False,
                general_blocked=False,
                render_blocked=True,
            ),
        ),
        human_authored_descendants_unchanged=True,
    )


def run_invalidation_golden() -> dict[str, Any]:
    """Run the hermetic real-Gate fixture and return a deterministic result mapping."""

    with tempfile.TemporaryDirectory(prefix="aijian-invalidation-golden-") as temp_dir:
        database = Path(temp_dir) / "workspace.db"
        repository = StudioRepository(
            database,
            id_factory=deterministic_id_factory(),
            clock=_FixedClock(),
            challenge_token_factory=lambda: "one-time-native-confirmation",
        )
        return _run_with_repository(repository)


def run_invalidation_golden_bytes() -> bytes:
    """Run the fixture and serialize the success envelope as UTF-8 JSON + LF."""

    return serialize_golden_result(run_invalidation_golden())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the T05C real-Gate invalidation golden fixture."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Write evidence bytes to this path instead of stdout.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        payload = run_invalidation_golden_bytes()
    except (GoldenFixtureError, GoldenInvalidationMismatch) as error:
        print(f"invalidation golden failed: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # pragma: no cover - defensive CLI boundary
        print(f"invalidation golden failed: {error}", file=sys.stderr)
        return 1

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(payload)
    else:
        sys.stdout.buffer.write(payload)
    return 0


def _run_with_repository(repository: StudioRepository) -> dict[str, Any]:
    project = repository.create_project(
        name="invalidation-golden",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )

    root_v1, _root_v1_decision = _approve_artifact(
        repository,
        project,
        "source_manifest",
        _create_version(
            repository,
            project,
            "source_manifest",
            content={"documents": [{"source_document_id": "src_golden_v1"}]},
            change_summary="root-v1",
        ),
        roles=("writer", "producer"),
    )

    # Unaccepted custom versions: DB gate trigger allows only source_manifest/story_bible.
    control = _create_version(
        repository,
        project,
        "golden_control",
        content={"title": "control", "body": "unaffected"},
        change_summary="control-v1",
    )
    direct = _create_version(
        repository,
        project,
        "golden_direct",
        content={"title": "direct"},
        change_summary="direct-v1",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    mid = _create_version(
        repository,
        project,
        "golden_mid",
        content={"title": "mid"},
        change_summary="mid-v1",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    mixed = _create_version(
        repository,
        project,
        "golden_mixed",
        content={"title": "mixed"},
        change_summary="mixed-v1",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=mid.version.id,
                relationship="derived_from",
                impact="render_only",
            ),
        ),
    )
    mid_a = _create_version(
        repository,
        project,
        "golden_mid_a",
        content={"title": "mid_a"},
        change_summary="mid_a-v1",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    mid_b = _create_version(
        repository,
        project,
        "golden_mid_b",
        content={"title": "mid_b"},
        change_summary="mid_b-v1",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    diamond = _create_version(
        repository,
        project,
        "golden_diamond",
        content={"title": "diamond"},
        change_summary="diamond-v1",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=mid_a.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ArtifactDependencyDraft(
                upstream_version_id=mid_b.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )

    human_content = _human_story_bible_content(root_v1.version.id)
    human_draft = _create_version(
        repository,
        project,
        "story_bible",
        content=human_content,
        change_summary="human-v1",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        required_accepted_upstream_version_id=root_v1.version.id,
    )
    human, _human_decision = _approve_artifact(
        repository,
        project,
        "story_bible",
        human_draft,
        roles=("writer", "continuity_reviewer", "producer"),
    )

    version_labels: dict[str, str] = {
        root_v1.version.id: ROOT_V1_LABEL,
        control.version.id: CONTROL_LABEL,
        direct.version.id: "direct_v1",
        mid.version.id: "mid_v1",
        mixed.version.id: "mixed_v1",
        mid_a.version.id: "mid_a_v1",
        mid_b.version.id: "mid_b_v1",
        diamond.version.id: "diamond_v1",
        human.version.id: HUMAN_LABEL,
    }
    edges = _collect_edges((control, direct, mid, mixed, mid_a, mid_b, diamond, human))
    human_before = _capture_human_evidence(repository, project, human)

    root_v2, root_v2_decision = _approve_artifact(
        repository,
        project,
        "source_manifest",
        _create_version(
            repository,
            project,
            "source_manifest",
            content={"documents": [{"source_document_id": "src_golden_v2"}]},
            change_summary="root-v2",
            parent=root_v1,
        ),
        roles=("writer", "producer"),
    )
    version_labels[root_v2.version.id] = ROOT_V2_LABEL

    human_after = _capture_human_evidence(
        repository,
        project,
        repository.get_artifact_version(project.id, "story_bible", human.version.id),
    )
    human_unchanged = human_before == human_after
    if not human_unchanged:
        raise GoldenFixtureError(
            "human-authored descendant changed after root replacement"
        )

    operations = repository.list_invalidation_operations(project.id)
    if len(operations) != 1:
        raise GoldenFixtureError(
            f"expected exactly one invalidation operation, got {len(operations)}"
        )
    operation = operations[0]
    if operation.old_accepted_version_id != root_v1.version.id:
        raise GoldenFixtureError("operation old_accepted_version_id is not root_v1")
    if operation.new_accepted_version_id != root_v2.version.id:
        raise GoldenFixtureError("operation new_accepted_version_id is not root_v2")
    if operation.gate_decision_id != root_v2_decision.decision.id:
        raise GoldenFixtureError(
            "operation gate_decision_id does not match the measured root v2 decision"
        )
    if root_v2_decision.decision.version_id != root_v2.version.id:
        raise GoldenFixtureError("measured gate decision does not target root_v2")

    ledger_impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    report = repository.get_invalidation_operation_report(
        project_id=project.id,
        operation_id=operation.id,
    )

    control_in_ledger = any(
        impact.affected_version_id == control.version.id for impact in ledger_impacts
    )
    control_in_report = any(
        group.affected_version_id == control.version.id
        for group in report.affected_versions
    )
    if control_in_ledger or control_in_report:
        raise GoldenFixtureError("unaffected control appeared in invalidation results")

    expected = expected_golden_operation()
    observed_ledger = normalize_ledger_operation(
        operation,
        ledger_impacts,
        version_labels=version_labels,
        edges=edges,
        human_authored_descendants_unchanged=human_unchanged,
    )
    observed_report = normalize_report_operation(
        report,
        version_labels=version_labels,
        edges=edges,
        human_authored_descendants_unchanged=human_unchanged,
    )

    ledger_result = compare_golden_invalidation(expected, observed_ledger)
    report_result = compare_golden_invalidation(expected, observed_report)

    path_count = sum(len(group.paths) for group in expected.affected_groups)
    return {
        "affected_group_count": len(expected.affected_groups),
        "control_absent": True,
        "fixture_id": FIXTURE_ID,
        "human_authored_descendants_unchanged": True,
        "independent_path_count": path_count,
        "ledger": ledger_result,
        "operation_count": 1,
        "path_direction": PATH_DIRECTION,
        "report": report_result,
        "schema_version": SCHEMA_VERSION,
    }


def normalize_ledger_operation(
    operation: InvalidationOperation,
    impacts: Sequence[InvalidationPathImpact],
    *,
    version_labels: Mapping[str, str],
    edges: Mapping[str, _DepEdge],
    human_authored_descendants_unchanged: bool,
) -> GoldenOperation:
    """Project durable ledger rows into the label-based golden operation shape."""

    del operation  # identity is asserted by the caller before comparison
    groups: dict[str, list[GoldenPathRecord]] = defaultdict(list)
    for impact in impacts:
        label = version_labels.get(impact.affected_version_id)
        if label is None:
            raise GoldenFixtureError(
                f"affected version {impact.affected_version_id!r} has no fixture label"
            )
        path = GoldenPathRecord(
            path_ordinal=impact.path_ordinal,
            path_labels=_path_labels_for_dependency_path(
                impact.dependency_path,
                version_labels=version_labels,
                edges=edges,
            ),
            relationship_sequence=tuple(impact.path_relationships),
            impact_sequence=tuple(impact.path_impacts),
            effective_impact=impact.effective_impact,
        )
        groups[label].append(path)

    return GoldenOperation(
        affected_groups=tuple(
            _group_from_paths(label, tuple(paths))
            for label, paths in sorted(groups.items(), key=lambda item: item[0])
        ),
        human_authored_descendants_unchanged=human_authored_descendants_unchanged,
    )


def normalize_report_operation(
    report: InvalidationOperationReport,
    *,
    version_labels: Mapping[str, str],
    edges: Mapping[str, _DepEdge],
    human_authored_descendants_unchanged: bool,
) -> GoldenOperation:
    """Project the public report into the label-based golden operation shape."""

    groups: list[GoldenAffectedGroup] = []
    for affected in report.affected_versions:
        label = version_labels.get(affected.affected_version_id)
        if label is None:
            raise GoldenFixtureError(
                f"report version {affected.affected_version_id!r} has no fixture label"
            )
        paths = tuple(
            GoldenPathRecord(
                path_ordinal=path.path_ordinal,
                path_labels=_path_labels_for_dependency_path(
                    path.dependency_path,
                    version_labels=version_labels,
                    edges=edges,
                ),
                relationship_sequence=tuple(path.path_relationships),
                impact_sequence=tuple(path.path_impacts),
                effective_impact=path.effective_impact,
            )
            for path in affected.paths
        )
        groups.append(
            GoldenAffectedGroup(
                label=label,
                paths=paths,
                strongest_effective_impact=affected.strongest_effective_impact,
                independent_path_count=len(paths),
                general_stale=affected.general_stale,
                general_blocked=affected.general_blocked,
                render_blocked=affected.render_blocked,
            )
        )
    return GoldenOperation(
        affected_groups=tuple(groups),
        human_authored_descendants_unchanged=human_authored_descendants_unchanged,
    )


def _group_from_paths(label: str, paths: tuple[GoldenPathRecord, ...]) -> GoldenAffectedGroup:
    if not paths:
        raise GoldenFixtureError(f"affected group {label!r} has no paths")
    strongest = max(paths, key=lambda path: _IMPACT_RANK[path.effective_impact]).effective_impact
    return GoldenAffectedGroup(
        label=label,
        paths=paths,
        strongest_effective_impact=strongest,
        independent_path_count=len(paths),
        general_stale=strongest == "blocking",
        general_blocked=strongest == "blocking",
        render_blocked=strongest in ("blocking", "render_only"),
    )


def _path_labels_for_dependency_path(
    dependency_path: Sequence[str],
    *,
    version_labels: Mapping[str, str],
    edges: Mapping[str, _DepEdge],
) -> tuple[str, ...]:
    if not dependency_path:
        raise GoldenFixtureError("dependency_path must be non-empty")
    try:
        first = edges[dependency_path[0]]
    except KeyError as error:
        raise GoldenFixtureError(
            f"dependency {dependency_path[0]!r} is outside the fixture graph"
        ) from error
    try:
        labels: list[str] = [version_labels[first.downstream_version_id]]
    except KeyError as error:
        raise GoldenFixtureError("dependency path endpoint lacks a fixture label") from error

    expected_downstream = first.downstream_version_id
    for dependency_id in dependency_path:
        try:
            edge = edges[dependency_id]
        except KeyError as error:
            raise GoldenFixtureError(
                f"dependency {dependency_id!r} is outside the fixture graph"
            ) from error
        if edge.downstream_version_id != expected_downstream:
            raise GoldenFixtureError(
                "dependency_path chain is not affected→…→root (broken endpoints)"
            )
        try:
            labels.append(version_labels[edge.upstream_version_id])
        except KeyError as error:
            raise GoldenFixtureError(
                "dependency path endpoint lacks a fixture label"
            ) from error
        expected_downstream = edge.upstream_version_id
    return tuple(labels)


def _collect_edges(records: Sequence[ArtifactVersionRecord]) -> dict[str, _DepEdge]:
    edges: dict[str, _DepEdge] = {}
    for record in records:
        for dependency in record.dependencies:
            edges[dependency.id] = _edge_from_dependency(dependency)
    return edges


def _edge_from_dependency(dependency: ArtifactDependency) -> _DepEdge:
    impact = dependency.impact
    if impact not in _IMPACT_RANK:
        raise GoldenFixtureError(f"unsupported dependency impact {impact!r}")
    return _DepEdge(
        dependency_id=dependency.id,
        downstream_version_id=dependency.downstream_version_id,
        upstream_version_id=dependency.upstream_version_id,
        relationship=dependency.relationship,
        impact=impact,
    )


def _capture_human_evidence(
    repository: StudioRepository,
    project: Project,
    record: ArtifactVersionRecord,
) -> _HumanEvidence:
    head = repository.get_artifact_head(project.id, "story_bible")
    dependencies = tuple(
        sorted(
            (
                dependency.id,
                dependency.upstream_version_id,
                dependency.relationship,
                dependency.impact,
            )
            for dependency in record.dependencies
        )
    )
    return _HumanEvidence(
        version_id=record.version.id,
        content_hash=record.version.content_hash,
        content=deepcopy(record.version.content),
        accepted_version_id=head.accepted_version_id,
        author_actor_type=record.version.author_actor_type,
        author_actor_id=record.version.author_actor_id,
        dependencies=dependencies,
    )


def _create_version(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    *,
    content: dict[str, object],
    change_summary: str,
    dependencies: tuple[ArtifactDependencyDraft, ...] = (),
    parent: ArtifactVersionRecord | None = None,
    required_accepted_upstream_version_id: str | None = None,
) -> ArtifactVersionRecord:
    parent_version_id: str | None = None
    expected_revision: int | None = None
    if parent is not None:
        head = repository.get_artifact_head(project.id, artifact_type)
        parent_version_id = parent.version.id
        expected_revision = head.revision
    return repository.create_artifact_version(
        project_id=project.id,
        artifact_type=artifact_type,
        schema_version="1.0.0",
        content=content,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary=change_summary,
        dependencies=dependencies,
        parent_version_id=parent_version_id,
        expected_revision=expected_revision,
        required_accepted_upstream_version_id=required_accepted_upstream_version_id,
    )


def _approve_artifact(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    artifact: ArtifactVersionRecord,
    *,
    roles: tuple[str, ...],
) -> tuple[ArtifactVersionRecord, GateDecisionResult]:
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=artifact.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        expected_revision=artifact.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    rationale = "golden fixture acceptance"
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": rationale,
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    decided = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        decision="approved",
        rationale=rationale,
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    accepted_version_id = decided.head.accepted_version_id or artifact.version.id
    accepted = repository.get_artifact_version(
        project.id, artifact_type, accepted_version_id
    )
    return accepted, decided



def _human_story_bible_content(source_manifest_version_id: str) -> dict[str, object]:
    """Minimal readiness-valid StoryBible payload pinned to the fixture root version."""

    character_id = "ent_" + ("1" * 32)
    location_id = "ent_" + ("2" * 32)
    prop_id = "ent_" + ("3" * 32)
    first_event_id = "fact_" + ("1" * 32)
    second_event_id = "fact_" + ("2" * 32)
    rejected_fact_id = "fact_" + ("3" * 32)

    def fact_base(fact_id: str, **overrides: object) -> dict[str, object]:
        value: dict[str, object] = {
            "fact_id": fact_id,
            "importance": "core",
            "origin": "source_explicit_assertion",
            "canon_status": "confirmed",
            "extraction_confidence_bps": None,
            "canon_certainty": "certain",
            "viewpoint_entity_id": None,
            "source_reliability": "reliable",
            "decision_reason": None,
            "impact_scope": [],
            "supersedes_fact_ids": [],
            "derived_from_fact_ids": [],
        }
        value.update(overrides)
        return value

    return {
        "title": "雾城来信",
        "logline": "林岚循着无名信追查旧车站被掩埋的秘密。",
        "source_scope": {
            "source_manifest_version_id": source_manifest_version_id,
            "scope_type": "full_work",
            "documents": [
                {
                    "source_document_id": "src_" + ("1" * 32),
                    "raw_sha256": "a" * 64,
                    "source_block_ids": ["srcb_" + ("1" * 32)],
                    "chapter_indices": [1],
                }
            ],
            "exclusions": [],
        },
        "entities": [
            {
                "entity_id": character_id,
                "kind": "character",
                "name": "林岚",
                "aliases": ["阿岚"],
            },
            {
                "entity_id": location_id,
                "kind": "location",
                "name": "雾城旧站",
                "aliases": [],
            },
            {
                "entity_id": prop_id,
                "kind": "prop",
                "name": "无名信",
                "aliases": [],
            },
        ],
        "facts": [
            {
                **fact_base(first_event_id),
                "kind": "event_fact",
                "participants": [character_id],
                "location_id": location_id,
                "source_narrative_order": 1,
                "story_time_order": 1,
                "temporal_relations": [
                    {"relation": "before", "other_event_fact_id": second_event_id}
                ],
                "caused_by_fact_ids": [],
                "state_changes": [
                    {
                        "entity_id": prop_id,
                        "property_key": "holder",
                        "before": None,
                        "after": {"kind": "entity_ref", "entity_id": character_id},
                    }
                ],
            },
            {
                **fact_base(second_event_id),
                "kind": "event_fact",
                "participants": [character_id],
                "location_id": location_id,
                "source_narrative_order": 2,
                "story_time_order": 2,
                "temporal_relations": [],
                "caused_by_fact_ids": [first_event_id],
                "state_changes": [],
            },
            {
                **fact_base(
                    rejected_fact_id,
                    importance="detail",
                    canon_status="rejected",
                    canon_certainty="ambiguous",
                ),
                "kind": "character_fact",
                "character_id": character_id,
                "attribute": "误传职业",
                "value": "记者",
                "validity": None,
            },
        ],
        "questions": [],
        "conflicts": [],
    }


if __name__ == "__main__":
    raise SystemExit(main())
