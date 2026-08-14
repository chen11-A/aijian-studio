"""SQLite-backed tests for typed dependency assessment and consumption guard."""

from __future__ import annotations

import sqlite3
import threading
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactVersionRecord,
    DependencyAssessment,
    DependencyMismatchCause,
    Project,
    TrustedReviewActor,
)
from aijian_api.repository import ArtifactDependencyInvalidError, StudioRepository

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
    """Mark a version accepted without Gate registration (test graph fixture only)."""

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


def accept_new(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    *,
    content: dict[str, object] | None = None,
    dependencies: tuple[ArtifactDependencyDraft, ...] = (),
    change_summary: str = "accepted",
) -> ArtifactVersionRecord:
    head = None
    try:
        head = repository.get_artifact_head(project.id, artifact_type)
    except Exception:
        head = None
    if head is None:
        created = create_version(
            repository,
            project,
            artifact_type,
            content=content,
            dependencies=dependencies,
            change_summary=change_summary,
        )
    else:
        created = create_version(
            repository,
            project,
            artifact_type,
            content=content,
            dependencies=dependencies,
            parent_version_id=head.latest_version_id,
            expected_revision=head.revision,
            change_summary=change_summary,
        )
    return force_accept(repository, project, artifact_type, created.version.id)


def cause_by_pin(
    assessment: DependencyAssessment, pinned_upstream_version_id: str
) -> DependencyMismatchCause:
    matches = [
        cause
        for cause in assessment.causes
        if cause.pinned_upstream_version_id == pinned_upstream_version_id
    ]
    assert len(matches) == 1, assessment.causes
    return matches[0]


def test_exact_accepted_direct_dependencies_allow_both_modes(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = accept_new(repository, project, "root")
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )

    for mode in ("general", "render"):
        assessment = repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf.version.id,
            mode=mode,
        )
        assert assessment.causes == ()
        assert assessment.stale is False
        assert assessment.consumable is True
        assert assessment.mode == mode
        assert assessment.artifact_id == leaf.version.artifact_id


def test_old_or_missing_blocking_dependency_blocks_both_modes(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    root_v2 = accept_new(repository, project, "root", content={"n": 2})

    for mode in ("general", "render"):
        assessment = repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf.version.id,
            mode=mode,
        )
        assert assessment.stale is True
        assert assessment.consumable is False
        cause = cause_by_pin(assessment, root_v1.version.id)
        assert cause.current_accepted_version_id == root_v2.version.id
        assert cause.effective_impact == "blocking"
        assert cause.dependency_path == (leaf.dependencies[0].id,)
        assert cause.path_relationships == ("derived_from",)
        assert cause.path_impacts == ("blocking",)

    unaccepted = create_repository(tmp_path / "missing.db")
    project_b = create_project(unaccepted, "未验收上游")
    bare_root = create_version(unaccepted, project_b, "root")
    bare_leaf = create_version(
        unaccepted,
        project_b,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=bare_root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    missing = unaccepted.assess_artifact_dependencies(
        project_id=project_b.id,
        version_id=bare_leaf.version.id,
        mode="general",
    )
    assert missing.stale is True
    assert missing.consumable is False
    cause = cause_by_pin(missing, bare_root.version.id)
    assert cause.current_accepted_version_id is None
    assert cause.effective_impact == "blocking"


def test_old_advisory_dependency_is_visible_but_allows_both_modes(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    root_v2 = accept_new(repository, project, "root", content={"n": 2})

    for mode in ("general", "render"):
        assessment = repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf.version.id,
            mode=mode,
        )
        assert assessment.stale is False
        assert assessment.consumable is True
        cause = cause_by_pin(assessment, root_v1.version.id)
        assert cause.effective_impact == "advisory"
        assert cause.current_accepted_version_id == root_v2.version.id


def test_old_render_only_allows_general_and_blocks_render(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
    )
    accept_new(repository, project, "root", content={"n": 2})

    general = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="general",
    )
    render = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="render",
    )
    assert general.stale is False
    assert general.consumable is True
    assert render.stale is False
    assert render.consumable is False
    assert cause_by_pin(general, root_v1.version.id).effective_impact == "render_only"


def test_blocking_then_render_only_path_effective_render_only(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    mid = accept_new(
        repository,
        project,
        "mid",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
    )
    leaf = accept_new(
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
    accept_new(repository, project, "root", content={"n": 2})

    general = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="general",
    )
    render = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="render",
    )
    cause = cause_by_pin(general, root_v1.version.id)
    assert cause.effective_impact == "render_only"
    assert cause.path_impacts == ("blocking", "render_only")
    assert general.stale is False
    assert general.consumable is True
    assert render.consumable is False


def test_advisory_then_blocking_path_effective_advisory(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    mid = accept_new(
        repository,
        project,
        "mid",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=mid.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    accept_new(repository, project, "root", content={"n": 2})

    for mode in ("general", "render"):
        assessment = repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf.version.id,
            mode=mode,
        )
        cause = cause_by_pin(assessment, root_v1.version.id)
        assert cause.effective_impact == "advisory"
        assert cause.path_impacts == ("advisory", "blocking")
        assert assessment.stale is False
        assert assessment.consumable is True


def test_multiple_paths_retain_causes_and_independent_blocking_wins(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    alt_v1 = accept_new(repository, project, "alt", content={"n": 1})
    side = accept_new(
        repository,
        project,
        "side",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=alt_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="references",
                impact="advisory",
            ),
            ArtifactDependencyDraft(
                upstream_version_id=side.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    root_v2 = accept_new(repository, project, "root", content={"n": 2})
    alt_v2 = accept_new(repository, project, "alt", content={"n": 2})

    assessment = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="general",
    )
    assert assessment.stale is True
    assert assessment.consumable is False
    pins = {cause.pinned_upstream_version_id for cause in assessment.causes}
    assert root_v1.version.id in pins
    assert alt_v1.version.id in pins
    assert cause_by_pin(assessment, root_v1.version.id).effective_impact == "advisory"
    assert cause_by_pin(assessment, alt_v1.version.id).effective_impact == "blocking"
    assert (
        cause_by_pin(assessment, root_v1.version.id).current_accepted_version_id
        == root_v2.version.id
    )
    assert (
        cause_by_pin(assessment, alt_v1.version.id).current_accepted_version_id == alt_v2.version.id
    )
    assert [cause.dependency_path for cause in assessment.causes] == sorted(
        cause.dependency_path for cause in assessment.causes
    )


def test_advancing_only_latest_does_not_invalidate_descendants(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    root_head = repository.get_artifact_head(project.id, "root")
    root_latest = create_version(
        repository,
        project,
        "root",
        content={"n": 2},
        parent_version_id=root_v1.version.id,
        expected_revision=root_head.revision,
        change_summary="draft only",
    )
    assert root_latest.head.accepted_version_id == root_v1.version.id
    assert root_latest.head.latest_version_id == root_latest.version.id

    assessment = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="general",
    )
    assert assessment.causes == ()
    assert assessment.stale is False
    assert assessment.consumable is True
    unchanged = repository.get_artifact_version(project.id, "leaf", leaf.version.id)
    assert unchanged.version == leaf.version
    assert unchanged.dependencies == leaf.dependencies


def test_review_actions_without_accepted_head_movement_do_not_invalidate(tmp_path: Path) -> None:
    from test_review_repository import (
        approve_artifact,
        create_review_repository,
        create_reviewable_artifact,
    )

    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    project, story = create_reviewable_artifact(repository)
    approved_story = approve_artifact(repository, project, story)
    source_head_before = repository.get_artifact_head(project.id, "source_manifest")

    # Submit/signoff/reject a new SourceManifest draft without moving accepted G1.
    latest = repository.get_latest_artifact(project.id, "source_manifest")
    draft = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_review_only"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="review only",
        parent_version_id=latest.version.id,
        expected_revision=latest.head.revision,
    )
    prepared = repository.prepare_review_action(
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
        challenge_id=prepared.challenge.id,
        confirmation_token=prepared.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        action="signoff",
        action_payload={"roles": ["writer", "producer"]},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        roles=("writer", "producer"),
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
            "decision": "rejected",
            "rationale": "not ready",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=draft.version.id,
        decision="rejected",
        rationale="not ready",
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    source_head_after = repository.get_artifact_head(project.id, "source_manifest")
    assert source_head_after.accepted_version_id == source_head_before.accepted_version_id

    assessment = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=approved_story.decision.version_id,
        mode="general",
    )
    assert assessment.causes == ()
    assert assessment.stale is False
    assert assessment.consumable is True


def test_accepted_head_advance_makes_descendants_stale_without_mutating_them(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    before = repository.get_artifact_version(project.id, "leaf", leaf.version.id)
    accept_new(repository, project, "root", content={"n": 2})
    after = repository.get_artifact_version(project.id, "leaf", leaf.version.id)
    assert after.version == before.version
    assert after.dependencies == before.dependencies
    assessment = repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="general",
    )
    assert assessment.stale is True
    assert assessment.consumable is False


def test_accepted_artifact_guard_rejects_draft_and_old_accepted_and_honors_modes(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root_v1 = accept_new(repository, project, "root", content={"n": 1})
    leaf_v1 = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
    )
    leaf_head = repository.get_artifact_head(project.id, "leaf")
    draft = create_version(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
        parent_version_id=leaf_v1.version.id,
        expected_revision=leaf_head.revision,
        change_summary="draft",
    )
    with pytest.raises(ArtifactDependencyInvalidError, match="current accepted"):
        repository.require_accepted_artifact_consumable(
            project_id=project.id,
            version_id=draft.version.id,
            mode="general",
        )

    accept_new(repository, project, "root", content={"n": 2})
    general = repository.require_accepted_artifact_consumable(
        project_id=project.id,
        version_id=leaf_v1.version.id,
        mode="general",
    )
    assert general.consumable is True
    assert general.stale is False
    with pytest.raises(ArtifactDependencyInvalidError, match="not consumable"):
        repository.require_accepted_artifact_consumable(
            project_id=project.id,
            version_id=leaf_v1.version.id,
            mode="render",
        )

    leaf_v2 = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
        content={"title": "new leaf"},
    )
    with pytest.raises(ArtifactDependencyInvalidError, match="current accepted"):
        repository.require_accepted_artifact_consumable(
            project_id=project.id,
            version_id=leaf_v1.version.id,
            mode="general",
        )
    assert leaf_v2.head.accepted_version_id == leaf_v2.version.id


def test_g2_still_rejects_stale_g1_before_challenge_consumption(tmp_path: Path) -> None:
    from test_review_repository import (
        _advance_accepted_source_manifest as advance_g1,
    )
    from test_review_repository import (
        _challenge_consumed,
        _review_row_counts,
        create_review_repository,
        create_reviewable_artifact,
    )

    clock = MutableClock()
    database = tmp_path / "workspace.db"
    repository = create_review_repository(database, clock)
    project, artifact = create_reviewable_artifact(repository)
    prepared = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=artifact.head.revision,
    )
    advance_g1(repository, project)
    with pytest.raises(ArtifactDependencyInvalidError):
        repository.submit_artifact_review(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            expected_revision=artifact.head.revision,
            challenge_id=prepared.challenge.id,
            confirmation_token=prepared.confirmation_token,
            actor=LOCAL_ACTOR,
        )
    head = repository.get_artifact_head(project.id, "story_bible")
    assert head == artifact.head
    assert head.accepted_version_id is None
    assert _challenge_consumed(database, prepared.challenge.id) is False
    assert _review_row_counts(database, artifact.version.id) == (0, 0, 0)


def test_assessment_snapshot_is_complete_old_or_new_under_race(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    writer = create_repository(database)
    project = create_project(writer)
    root_v1 = accept_new(writer, project, "root", content={"n": 1})
    leaf = accept_new(
        writer,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    target_selected = threading.Event()
    writer_finished = threading.Event()

    def pause_after_target(operation: str, step: str) -> None:
        if (operation, step) == ("assess_artifact_dependencies", "target_selected"):
            target_selected.set()
            assert writer_finished.wait(5), "writer did not finish while assessment snapshot open"

    reader = create_repository(database, transaction_hook=pause_after_target)
    results: list[DependencyAssessment] = []
    errors: list[BaseException] = []

    def read_assessment() -> None:
        try:
            results.append(
                reader.assess_artifact_dependencies(
                    project_id=project.id,
                    version_id=leaf.version.id,
                    mode="general",
                )
            )
        except BaseException as error:  # pragma: no cover - asserted below
            errors.append(error)

    thread = threading.Thread(target=read_assessment)
    thread.start()
    assert target_selected.wait(5), "reader did not establish assessment snapshot"
    root_v2 = accept_new(writer, project, "root", content={"n": 2})
    writer_finished.set()
    thread.join(5)
    assert not thread.is_alive()
    assert errors == []
    assert len(results) == 1
    assessment = results[0]
    # Snapshot started before the accepted-head write; must be complete old view.
    assert assessment.causes == ()
    assert assessment.stale is False
    assert assessment.consumable is True
    later = writer.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="general",
    )
    assert later.stale is True
    assert cause_by_pin(later, root_v1.version.id).current_accepted_version_id == root_v2.version.id


def _disable_head_guards(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute("DROP TRIGGER IF EXISTS artifact_heads_accepted_requires_decision")
    connection.execute("DROP TRIGGER IF EXISTS artifact_heads_revision_increments_once")


def test_missing_or_corrupt_heads_fail_closed(tmp_path: Path) -> None:
    """Defensive corruption handling for assessed/traversed artifact heads."""

    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = accept_new(repository, project, "root")
    leaf = accept_new(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )

    # Target artifact_heads row missing.
    with sqlite3.connect(repository.database_path) as connection:
        _disable_head_guards(connection)
        connection.execute(
            "DELETE FROM artifact_heads WHERE artifact_id = ?",
            (leaf.version.artifact_id,),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="head is missing"):
        repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf.version.id,
            mode="general",
        )
    with pytest.raises(ArtifactDependencyInvalidError, match="head is missing"):
        repository.require_accepted_artifact_consumable(
            project_id=project.id,
            version_id=leaf.version.id,
            mode="general",
        )

    # Restore target head and corrupt traversed upstream accepted pointer to a
    # non-existent version id.
    repository_b = create_repository(tmp_path / "missing-accepted.db")
    project_b = create_project(repository_b, "缺失验收指针")
    root_b = accept_new(repository_b, project_b, "root")
    leaf_b = accept_new(
        repository_b,
        project_b,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_b.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository_b.database_path) as connection:
        _disable_head_guards(connection)
        connection.execute(
            """
            UPDATE artifact_heads
            SET accepted_version_id = 'ver_deadbeefdeadbeefdeadbeefdeadbeef'
            WHERE artifact_id = ?
            """,
            (root_b.version.artifact_id,),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="Accepted version is missing"):
        repository_b.assess_artifact_dependencies(
            project_id=project_b.id,
            version_id=leaf_b.version.id,
            mode="general",
        )

    # Accepted pointer exists but is owned by a different artifact.
    repository_c = create_repository(tmp_path / "wrong-owner.db")
    project_c = create_project(repository_c, "错误验收归属")
    root_c = accept_new(repository_c, project_c, "root")
    other_c = accept_new(repository_c, project_c, "other")
    leaf_c = accept_new(
        repository_c,
        project_c,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_c.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository_c.database_path) as connection:
        _disable_head_guards(connection)
        connection.execute(
            """
            UPDATE artifact_heads
            SET accepted_version_id = ?
            WHERE artifact_id = ?
            """,
            (other_c.version.id, root_c.version.artifact_id),
        )
        connection.commit()
    with pytest.raises(
        ArtifactDependencyInvalidError, match="Accepted version ownership is corrupted"
    ):
        repository_c.assess_artifact_dependencies(
            project_id=project_c.id,
            version_id=leaf_c.version.id,
            mode="general",
        )

    # Accepted pointer resolves to a version owned by a different project.
    repository_d = create_repository(tmp_path / "cross-accepted.db")
    project_d = create_project(repository_d, "跨项目验收")
    foreign = create_project(repository_d, "外项目")
    root_d = accept_new(repository_d, project_d, "root")
    foreign_root = create_version(repository_d, foreign, "foreign_root")
    leaf_d = accept_new(
        repository_d,
        project_d,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_d.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository_d.database_path) as connection:
        _disable_head_guards(connection)
        connection.execute(
            """
            UPDATE artifact_heads
            SET accepted_version_id = ?
            WHERE artifact_id = ?
            """,
            (foreign_root.version.id, root_d.version.artifact_id),
        )
        connection.commit()
    with pytest.raises(
        ArtifactDependencyInvalidError, match="Accepted version ownership is corrupted"
    ):
        repository_d.assess_artifact_dependencies(
            project_id=project_d.id,
            version_id=leaf_d.version.id,
            mode="general",
        )

    # Missing traversed upstream head row fails closed (not reported as soft mismatch).
    repository_e = create_repository(tmp_path / "missing-upstream-head.db")
    project_e = create_project(repository_e, "缺失上游头")
    root_e = accept_new(repository_e, project_e, "root")
    leaf_e = accept_new(
        repository_e,
        project_e,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_e.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository_e.database_path) as connection:
        _disable_head_guards(connection)
        connection.execute(
            "DELETE FROM artifact_heads WHERE artifact_id = ?",
            (root_e.version.artifact_id,),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="head is missing"):
        repository_e.assess_artifact_dependencies(
            project_id=project_e.id,
            version_id=leaf_e.version.id,
            mode="general",
        )


def test_cross_project_or_corrupted_dependency_ownership_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    other = create_project(repository, "另一项目")
    root = accept_new(repository, project, "root")
    leaf = create_version(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    other_root = create_version(repository, other, "other")

    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("DROP TRIGGER artifact_dependencies_immutable_update")
        connection.execute(
            """
            UPDATE artifact_dependencies
            SET upstream_artifact_id = ?
            WHERE dependency_id = ?
            """,
            (other_root.version.artifact_id, leaf.dependencies[0].id),
        )
        connection.commit()

    with pytest.raises(ArtifactDependencyInvalidError, match="ownership|cross|project"):
        repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf.version.id,
            mode="general",
        )

    repository_b = create_repository(tmp_path / "cross.db")
    project_a = create_project(repository_b, "A")
    project_b = create_project(repository_b, "B")
    root_a = accept_new(repository_b, project_a, "root")
    leaf_a = create_version(
        repository_b,
        project_a,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_a.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository_b.database_path) as connection:
        connection.execute(
            "UPDATE artifacts SET project_id = ? WHERE artifact_id = ?",
            (project_b.id, root_a.version.artifact_id),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="project"):
        repository_b.assess_artifact_dependencies(
            project_id=project_a.id,
            version_id=leaf_a.version.id,
            mode="general",
        )


def test_defensive_cycle_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    a = create_version(repository, project, "a")
    b = create_version(
        repository,
        project,
        "b",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=a.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_dependencies_no_cycle")
        connection.execute(
            """
            INSERT INTO artifact_dependencies VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "dep_cycle_back",
                a.version.artifact_id,
                a.version.id,
                b.version.artifact_id,
                b.version.id,
                "derived_from",
                "blocking",
                "2026-08-03T12:00:00Z",
            ),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="cycle"):
        repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=a.version.id,
            mode="general",
        )


def test_assessment_is_read_only(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = accept_new(repository, project, "root")
    leaf = create_version(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    before_head = repository.get_artifact_head(project.id, "leaf")
    before_root = repository.get_artifact_head(project.id, "root")
    with sqlite3.connect(repository.database_path) as connection:
        counts_before = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "artifact_versions",
                "artifact_dependencies",
                "artifact_heads",
                "review_submissions",
                "gate_decisions",
            )
        }
    repository.assess_artifact_dependencies(
        project_id=project.id,
        version_id=leaf.version.id,
        mode="general",
    )
    assert repository.get_artifact_head(project.id, "leaf") == before_head
    assert repository.get_artifact_head(project.id, "root") == before_root
    with sqlite3.connect(repository.database_path) as connection:
        counts_after = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in counts_before
        }
    assert counts_after == counts_before


def test_assessor_helpers_and_fail_closed_inputs(tmp_path: Path) -> None:
    from aijian_api.artifact_invalidation import (
        effective_path_impact,
        impact_min,
        parse_impact,
    )

    assert parse_impact("blocking") == "blocking"
    assert parse_impact("advisory") == "advisory"
    assert parse_impact("render_only") == "render_only"
    with pytest.raises(ArtifactDependencyInvalidError, match="impact"):
        parse_impact("impossible")
    assert impact_min("blocking", "advisory") == "advisory"
    assert impact_min("advisory", "blocking") == "advisory"
    assert effective_path_impact(("blocking", "render_only")) == "render_only"
    with pytest.raises(ArtifactDependencyInvalidError, match="empty"):
        effective_path_impact(())

    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    with pytest.raises(ArtifactDependencyInvalidError, match="Unsupported consumption mode"):
        repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id="ver_missing",
            mode="export",  # type: ignore[arg-type]
        )
    with pytest.raises(ArtifactDependencyInvalidError, match="not found"):
        repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id="ver_" + "0" * 32,
            mode="general",
        )
    with pytest.raises(ArtifactDependencyInvalidError, match="not found"):
        repository.require_accepted_artifact_consumable(
            project_id=project.id,
            version_id="ver_" + "0" * 32,
            mode="general",
        )

    root = accept_new(repository, project, "root")
    leaf = create_version(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_dependencies_immutable_update")
        connection.execute(
            """
            UPDATE artifact_dependencies
            SET downstream_artifact_id = ?
            WHERE dependency_id = ?
            """,
            (root.version.artifact_id, leaf.dependencies[0].id),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="ownership"):
        repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf.version.id,
            mode="general",
        )

    leaf_b = create_version(
        repository,
        project,
        "leaf_b",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_dependencies_immutable_update")
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            UPDATE artifact_dependencies
            SET upstream_version_id = 'ver_deadbeefdeadbeefdeadbeefdeadbeef'
            WHERE dependency_id = ?
            """,
            (leaf_b.dependencies[0].id,),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="missing"):
        repository.assess_artifact_dependencies(
            project_id=project.id,
            version_id=leaf_b.version.id,
            mode="general",
        )


def test_g2_structural_source_manifest_requirement_still_enforced(tmp_path: Path) -> None:
    from test_review_repository import create_review_repository, create_reviewable_artifact

    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    project, story = create_reviewable_artifact(repository)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_dependencies_immutable_update")
        connection.execute(
            """
            UPDATE artifact_dependencies
            SET relationship = 'references', impact = 'advisory'
            WHERE dependency_id = ?
            """,
            (story.dependencies[0].id,),
        )
        connection.commit()
    with pytest.raises(ArtifactDependencyInvalidError, match="SourceManifest"):
        repository.prepare_review_action(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=story.version.id,
            action="submit",
            action_payload={},
            actor=LOCAL_ACTOR,
            expected_revision=story.head.revision,
        )
