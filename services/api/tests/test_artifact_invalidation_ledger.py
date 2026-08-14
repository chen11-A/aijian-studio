"""SQLite-backed tests for T04 invalidation operation and path-impact ledger."""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.artifact_invalidation_ledger import (
    is_general_stale,
    projected_effective_impact,
)
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactVersionRecord,
    Project,
    TrustedReviewActor,
)
from aijian_api.repository import (
    ArtifactDependencyInvalidError,
    InvalidationNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)

LOCAL_ACTOR = TrustedReviewActor(
    subject_id="local-user",
    roles=("writer", "continuity_reviewer", "producer"),
)


class MutableClock:
    def __init__(self) -> None:
        self.value = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.value

    def advance(self, delta: timedelta) -> None:
        self.value += delta


def deterministic_id_factory():
    counters: defaultdict[str, int] = defaultdict(int)

    def create_id(prefix: str) -> str:
        counters[prefix] += 1
        return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def create_repository(
    database: Path,
    *,
    transaction_hook=None,
    clock: MutableClock | None = None,
) -> StudioRepository:
    return StudioRepository(
        database,
        id_factory=deterministic_id_factory(),
        clock=clock or MutableClock(),
        challenge_token_factory=lambda: "one-time-native-confirmation",
        transaction_hook=transaction_hook,
    )


def create_project(repository: StudioRepository, name: str = "雾城来信") -> Project:
    return repository.create_project(
        name=name,
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )


def create_version(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    *,
    content: dict[str, object] | None = None,
    dependencies: tuple[ArtifactDependencyDraft, ...] = (),
    parent_version_id: str | None = None,
    expected_revision: int | None = None,
    change_summary: str = "version",
) -> ArtifactVersionRecord:
    return repository.create_artifact_version(
        project_id=project.id,
        artifact_type=artifact_type,
        schema_version="1.0.0",
        content=content if content is not None else {"title": artifact_type},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary=change_summary,
        dependencies=dependencies,
        parent_version_id=parent_version_id,
        expected_revision=expected_revision,
    )


def force_accept(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    version_id: str,
) -> ArtifactVersionRecord:
    head = repository.get_artifact_head(project.id, artifact_type)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_heads_accepted_requires_decision")
        connection.execute(
            """
            UPDATE artifact_heads
            SET accepted_version_id = ?, revision = revision + 1,
                updated_at = '2026-08-03T12:00:00Z'
            WHERE artifact_id = ? AND revision = ?
            """,
            (version_id, head.artifact_id, head.revision),
        )
        connection.commit()
    return repository.get_artifact_version(project.id, artifact_type, version_id)


def approve_source_manifest(
    repository: StudioRepository,
    project: Project,
    artifact: ArtifactVersionRecord,
) -> ArtifactVersionRecord:
    roles = ("writer", "producer")
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=artifact.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        expected_revision=artifact.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    rationale = "来源基线可用"
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
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
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        decision="approved",
        rationale=rationale,
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    return repository.get_artifact_version(
        project.id, "source_manifest", decided.head.accepted_version_id or artifact.version.id
    )


def create_and_approve_manifest(
    repository: StudioRepository,
    project: Project,
    *,
    documents: list[dict[str, object]] | None = None,
    parent: ArtifactVersionRecord | None = None,
    change_summary: str = "manifest",
) -> ArtifactVersionRecord:
    content = {"documents": documents or [{"source_document_id": "src_fixture"}]}
    if parent is None:
        created = create_version(
            repository,
            project,
            "source_manifest",
            content=content,
            change_summary=change_summary,
        )
    else:
        head = repository.get_artifact_head(project.id, "source_manifest")
        created = create_version(
            repository,
            project,
            "source_manifest",
            content=content,
            parent_version_id=parent.version.id,
            expected_revision=head.revision,
            change_summary=change_summary,
        )
    return approve_source_manifest(repository, project, created)


def accept_custom(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    *,
    dependencies: tuple[ArtifactDependencyDraft, ...] = (),
    content: dict[str, object] | None = None,
    change_summary: str = "accepted",
) -> ArtifactVersionRecord:
    created = create_version(
        repository,
        project,
        artifact_type,
        content=content,
        dependencies=dependencies,
        change_summary=change_summary,
    )
    return force_accept(repository, project, artifact_type, created.version.id)


def dependency_snapshot(
    repository: StudioRepository,
    version_ids: list[str],
) -> list[tuple[object, ...]]:
    with sqlite3.connect(repository.database_path) as connection:
        rows = connection.execute(
            """
            SELECT dependency_id, downstream_version_id, upstream_version_id,
                   relationship, impact
            FROM artifact_dependencies
            WHERE downstream_version_id IN ({placeholders})
            ORDER BY dependency_id
            """.format(placeholders=",".join("?" for _ in version_ids)),
            tuple(version_ids),
        ).fetchall()
    return [tuple(row) for row in rows]


def version_content_snapshot(
    repository: StudioRepository,
    version_ids: list[str],
) -> list[tuple[object, ...]]:
    with sqlite3.connect(repository.database_path) as connection:
        rows = connection.execute(
            """
            SELECT version_id, content_json, content_hash, change_summary
            FROM artifact_versions
            WHERE version_id IN ({placeholders})
            ORDER BY version_id
            """.format(placeholders=",".join("?" for _ in version_ids)),
            tuple(version_ids),
        ).fetchall()
    return [tuple(row) for row in rows]


def count_rows(database: Path, table: str) -> int:
    with sqlite3.connect(database) as connection:
        row = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    assert row is not None
    return int(row[0])


def test_head_replacement_writes_one_operation_and_direct_blocking_impact(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    old = create_and_approve_manifest(repository, project, change_summary="v1")
    leaf = accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=old.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    assert count_rows(repository.database_path, "invalidation_operations") == 0

    new = create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_fixture_v2"}],
        parent=old,
        change_summary="v2",
    )

    operations = repository.list_invalidation_operations(project.id)
    assert len(operations) == 1
    operation = operations[0]
    assert operation.project_id == project.id
    assert operation.changed_artifact_id == old.version.artifact_id
    assert operation.old_accepted_version_id == old.version.id
    assert operation.new_accepted_version_id == new.version.id
    assert operation.gate_decision_id

    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    assert len(impacts) == 1
    impact = impacts[0]
    assert impact.affected_version_id == leaf.version.id
    assert impact.affected_artifact_id == leaf.version.artifact_id
    assert impact.effective_impact == "blocking"
    assert impact.path_impacts == ("blocking",)
    assert impact.path_relationships == ("derived_from",)
    assert len(impact.dependency_path) == 1
    assert impact.path_ordinal == 0
    assert is_general_stale(impacts) is True
    assert projected_effective_impact(impacts) == "blocking"


def test_transitive_path_min_blocking_then_render_only(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    mid = accept_custom(
        repository,
        project,
        "mid",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    leaf = accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=mid.version.id,
                relationship="derived_from",
                impact="render_only",
            ),
        ),
    )

    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    by_version = {impact.affected_version_id: impact for impact in impacts}
    assert set(by_version) == {mid.version.id, leaf.version.id}
    assert by_version[mid.version.id].effective_impact == "blocking"
    assert by_version[leaf.version.id].path_impacts == ("render_only", "blocking")
    assert by_version[leaf.version.id].effective_impact == "render_only"
    assert is_general_stale((by_version[leaf.version.id],)) is False


def test_transitive_path_min_advisory_then_blocking(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    mid = accept_custom(
        repository,
        project,
        "mid",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    leaf = accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=mid.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )

    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    leaf_impact = next(
        impact for impact in impacts if impact.affected_version_id == leaf.version.id
    )
    assert leaf_impact.path_impacts == ("blocking", "advisory")
    assert leaf_impact.effective_impact == "advisory"
    assert is_general_stale((leaf_impact,)) is False


def test_diamond_retains_independent_paths_and_blocking_wins(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    left = accept_custom(
        repository,
        project,
        "left",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    right = accept_custom(
        repository,
        project,
        "right",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    sink = accept_custom(
        repository,
        project,
        "sink",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=left.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ArtifactDependencyDraft(
                upstream_version_id=right.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )

    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    sink_paths = [
        impact for impact in impacts if impact.affected_version_id == sink.version.id
    ]
    assert len(sink_paths) == 2
    effective = {path.effective_impact for path in sink_paths}
    assert effective == {"blocking", "advisory"}
    assert is_general_stale(tuple(sink_paths)) is True
    assert projected_effective_impact(tuple(sink_paths)) == "blocking"
    assert [path.path_ordinal for path in sink_paths] == sorted(
        path.path_ordinal for path in sink_paths
    )
    path_keys = [path.dependency_path for path in sink_paths]
    assert path_keys == sorted(path_keys)


def test_render_only_and_advisory_do_not_mark_general_stale(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    render_leaf = accept_custom(
        repository,
        project,
        "render_leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
    )
    advisory_leaf = accept_custom(
        repository,
        project,
        "advisory_leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="mentions",
                impact="advisory",
            ),
        ),
    )

    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    by_version = {impact.affected_version_id: impact for impact in impacts}
    assert by_version[render_leaf.version.id].effective_impact == "render_only"
    assert by_version[advisory_leaf.version.id].effective_impact == "advisory"
    assert is_general_stale(impacts) is False
    assert projected_effective_impact(impacts) == "render_only"


def test_initial_acceptance_rejection_and_review_actions_write_no_operation(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    manifest = create_version(
        repository,
        project,
        "source_manifest",
        content={"documents": [{"source_document_id": "src_review"}]},
        change_summary="draft",
    )
    assert repository.list_invalidation_operations(project.id) == ()

    approved = approve_source_manifest(repository, project, manifest)
    assert approved.version.id == manifest.version.id
    assert repository.list_invalidation_operations(project.id) == ()

    rejected_draft = create_version(
        repository,
        project,
        "source_manifest",
        content={"documents": [{"source_document_id": "src_reject"}]},
        parent_version_id=approved.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
        change_summary="reject-me",
    )
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=rejected_draft.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=rejected_draft.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=rejected_draft.version.id,
        expected_revision=rejected_draft.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    assert repository.list_invalidation_operations(project.id) == ()

    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=rejected_draft.version.id,
        action="signoff",
        action_payload={"roles": ["writer", "producer"]},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=rejected_draft.version.id,
        roles=("writer", "producer"),
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    assert repository.list_invalidation_operations(project.id) == ()

    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=rejected_draft.version.id,
        action="decision",
        action_payload={
            "decision": "rejected",
            "rationale": "不接受此版本",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    rejected = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=rejected_draft.version.id,
        decision="rejected",
        rationale="不接受此版本",
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    assert rejected.head.accepted_version_id == approved.version.id
    assert repository.list_invalidation_operations(project.id) == ()
    assert count_rows(repository.database_path, "invalidation_path_impacts") == 0


def test_descendant_versions_remain_byte_identical_after_ledger_write(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    leaf = accept_custom(
        repository,
        project,
        "leaf",
        content={"note": "人工修改保留", "count": 3},
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        change_summary="人工镜头意图",
    )
    leaf_head_before = repository.get_artifact_head(project.id, "leaf")
    content_before = version_content_snapshot(repository, [leaf.version.id])
    deps_before = dependency_snapshot(repository, [leaf.version.id])

    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )

    leaf_head_after = repository.get_artifact_head(project.id, "leaf")
    assert leaf_head_after.accepted_version_id == leaf.version.id
    assert leaf_head_after.revision == leaf_head_before.revision
    assert leaf_head_after.latest_version_id == leaf_head_before.latest_version_id
    assert version_content_snapshot(repository, [leaf.version.id]) == content_before
    assert dependency_snapshot(repository, [leaf.version.id]) == deps_before
    reloaded = repository.get_artifact_version(project.id, "leaf", leaf.version.id)
    assert reloaded.version.content == {"note": "人工修改保留", "count": 3}
    assert reloaded.version.content_hash == leaf.version.content_hash
    assert reloaded.version.change_summary == "人工镜头意图"


def test_failure_after_head_update_rolls_back_challenge_decision_head_and_ledger(
    tmp_path: Path,
) -> None:
    failure: list[tuple[str, str] | None] = [None]

    def fail_at_step(operation: str, step: str) -> None:
        if failure[0] == (operation, step):
            raise RuntimeError(f"injected {operation}:{step}")

    repository = create_repository(
        tmp_path / "workspace.db",
        transaction_hook=fail_at_step,
    )
    project = create_project(repository)
    old = create_and_approve_manifest(repository, project, change_summary="root-v1")
    accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=old.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    head_before = repository.get_artifact_head(project.id, "source_manifest")
    draft = create_version(
        repository,
        project,
        "source_manifest",
        content={"documents": [{"source_document_id": "src_fail"}]},
        parent_version_id=old.version.id,
        expected_revision=head_before.revision,
        change_summary="root-v2-fail",
    )
    roles = ("writer", "producer")
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=draft.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        expected_revision=draft.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "应整体回滚",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )

    for step in (
        "head_updated",
        "invalidation_operation_inserted",
        "invalidation_impacts_persisted",
    ):
        failure[0] = ("decide_gate", step)
        with pytest.raises(RuntimeError, match="injected decide_gate"):
            repository.decide_artifact_gate(
                project_id=project.id,
                artifact_type="source_manifest",
                version_id=draft.version.id,
                decision="approved",
                rationale="应整体回滚",
                expected_revision=signed.head.revision,
                challenge_id=prepared_decision.challenge.id,
                confirmation_token=prepared_decision.confirmation_token,
                actor=LOCAL_ACTOR,
                actor_role="producer",
            )
        head = repository.get_artifact_head(project.id, "source_manifest")
        assert head.accepted_version_id == old.version.id
        assert head.revision == signed.head.revision
        assert repository.list_invalidation_operations(project.id) == ()
        assert count_rows(repository.database_path, "invalidation_path_impacts") == 0
        with sqlite3.connect(repository.database_path) as connection:
            decision = connection.execute(
                "SELECT 1 FROM gate_decisions WHERE version_id = ?",
                (draft.version.id,),
            ).fetchone()
            challenge = connection.execute(
                """
                SELECT consumed_at FROM confirmation_challenges
                WHERE challenge_id = ?
                """,
                (prepared_decision.challenge.id,),
            ).fetchone()
        assert decision is None
        assert challenge is not None
        assert challenge[0] is None

    failure[0] = None
    approved = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        decision="approved",
        rationale="应整体回滚",
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    assert approved.head.accepted_version_id == draft.version.id
    assert len(repository.list_invalidation_operations(project.id)) == 1


def test_corrupt_cross_project_and_cycle_graphs_fail_closed_and_roll_back(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    other = create_project(repository, name="旁支项目")
    old = create_and_approve_manifest(repository, project, change_summary="root-v1")
    foreign = accept_custom(repository, other, "foreign_leaf")
    head_before = repository.get_artifact_head(project.id, "source_manifest")
    draft = create_version(
        repository,
        project,
        "source_manifest",
        content={"documents": [{"source_document_id": "src_bad"}]},
        parent_version_id=old.version.id,
        expected_revision=head_before.revision,
        change_summary="root-v2-bad",
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_dependencies_no_cycle")
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            INSERT INTO artifact_dependencies (
                dependency_id, downstream_artifact_id, downstream_version_id,
                upstream_artifact_id, upstream_version_id, relationship, impact, created_at
            ) VALUES (?, ?, ?, ?, ?, 'derived_from', 'blocking', '2026-08-03T12:00:00Z')
            """,
            (
                "dep_cross_project",
                foreign.version.artifact_id,
                foreign.version.id,
                old.version.artifact_id,
                old.version.id,
            ),
        )
        connection.commit()

    roles = ("writer", "producer")
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=draft.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        expected_revision=draft.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "跨项目应失败",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    with pytest.raises(ArtifactDependencyInvalidError, match="project boundaries"):
        repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="source_manifest",
            version_id=draft.version.id,
            decision="approved",
            rationale="跨项目应失败",
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )
    head = repository.get_artifact_head(project.id, "source_manifest")
    assert head.accepted_version_id == old.version.id
    assert head.revision == signed.head.revision
    assert repository.list_invalidation_operations(project.id) == ()

    # Replace the bad edge with a cycle and prove defensive fail-closed behavior.
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_dependencies_immutable_delete")
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            "DELETE FROM artifact_dependencies WHERE dependency_id = 'dep_cross_project'"
        )
        connection.commit()

    mid = accept_custom(
        repository,
        project,
        "cycle_mid",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=old.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_dependencies_no_cycle")
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            INSERT INTO artifact_dependencies (
                dependency_id, downstream_artifact_id, downstream_version_id,
                upstream_artifact_id, upstream_version_id, relationship, impact, created_at
            ) VALUES (
                'dep_cycle_back', ?, ?, ?, ?, 'derived_from', 'blocking',
                '2026-08-03T12:00:00Z'
            )
            """,
            (
                old.version.artifact_id,
                old.version.id,
                mid.version.artifact_id,
                mid.version.id,
            ),
        )
        connection.commit()

    with pytest.raises(ArtifactDependencyInvalidError, match="cycle"):
        repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="source_manifest",
            version_id=draft.version.id,
            decision="approved",
            rationale="跨项目应失败",
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )
    assert repository.get_artifact_head(project.id, "source_manifest").accepted_version_id == (
        old.version.id
    )
    assert repository.list_invalidation_operations(project.id) == ()


def test_missing_downstream_version_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    old = create_and_approve_manifest(repository, project, change_summary="root-v1")
    head_before = repository.get_artifact_head(project.id, "source_manifest")
    draft = create_version(
        repository,
        project,
        "source_manifest",
        content={"documents": [{"source_document_id": "src_missing"}]},
        parent_version_id=old.version.id,
        expected_revision=head_before.revision,
        change_summary="root-v2-missing",
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            INSERT INTO artifact_dependencies (
                dependency_id, downstream_artifact_id, downstream_version_id,
                upstream_artifact_id, upstream_version_id, relationship, impact, created_at
            ) VALUES (
                'dep_missing_downstream', 'art_missing', 'ver_missing',
                ?, ?, 'derived_from', 'blocking', '2026-08-03T12:00:00Z'
            )
            """,
            (old.version.artifact_id, old.version.id),
        )
        connection.commit()

    roles = ("writer", "producer")
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=draft.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        expected_revision=draft.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "缺失下游应失败",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    with pytest.raises(ArtifactDependencyInvalidError, match="downstream version is missing"):
        repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="source_manifest",
            version_id=draft.version.id,
            decision="approved",
            rationale="缺失下游应失败",
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )
    assert repository.list_invalidation_operations(project.id) == ()
    assert (
        repository.get_artifact_head(project.id, "source_manifest").accepted_version_id
        == old.version.id
    )


def test_operation_and_impact_reads_are_project_scoped_and_deterministic(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project_a = create_project(repository, name="项目甲")
    project_b = create_project(repository, name="项目乙")
    root_a = create_and_approve_manifest(repository, project_a, change_summary="a-v1")
    accept_custom(
        repository,
        project_a,
        "leaf_a",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_a.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    accept_custom(
        repository,
        project_a,
        "leaf_a2",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_a.version.id,
                relationship="mentions",
                impact="advisory",
            ),
        ),
    )
    create_and_approve_manifest(
        repository,
        project_a,
        documents=[{"source_document_id": "src_a_v2"}],
        parent=root_a,
        change_summary="a-v2",
    )
    root_b = create_and_approve_manifest(repository, project_b, change_summary="b-v1")
    create_and_approve_manifest(
        repository,
        project_b,
        documents=[{"source_document_id": "src_b_v2"}],
        parent=root_b,
        change_summary="b-v2",
    )

    ops_a = repository.list_invalidation_operations(project_a.id)
    ops_b = repository.list_invalidation_operations(project_b.id)
    assert len(ops_a) == 1
    assert len(ops_b) == 1
    assert ops_a[0].project_id == project_a.id
    assert ops_b[0].project_id == project_b.id

    impacts_a = repository.list_invalidation_path_impacts(
        project_id=project_a.id,
        operation_id=ops_a[0].id,
    )
    assert [impact.path_ordinal for impact in impacts_a] == list(range(len(impacts_a)))
    assert [impact.dependency_path for impact in impacts_a] == sorted(
        impact.dependency_path for impact in impacts_a
    )

    loaded = repository.get_invalidation_operation(
        project_id=project_a.id,
        operation_id=ops_a[0].id,
    )
    assert loaded.id == ops_a[0].id

    with pytest.raises(InvalidationNotFoundError):
        repository.get_invalidation_operation(
            project_id=project_a.id,
            operation_id=ops_b[0].id,
        )
    with pytest.raises(InvalidationNotFoundError):
        repository.list_invalidation_path_impacts(
            project_id=project_a.id,
            operation_id=ops_b[0].id,
        )
    with pytest.raises(InvalidationNotFoundError):
        repository.get_invalidation_operation(
            project_id=project_a.id,
            operation_id="invop_missing",
        )
    with pytest.raises(ProjectNotFoundError):
        repository.list_invalidation_operations("prj_missing")
