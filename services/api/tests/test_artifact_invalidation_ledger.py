import sqlite3
import threading
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from aijian_api.artifact_invalidation_domain import (
    AcceptedArtifactHead,
    AcceptedHeadReplacement,
    ArtifactVersionIdentity,
    ExactVersionDependency,
    TypedDependencyInvalidationInput,
    TypedDependencyInvalidationResult,
    assess_typed_dependency_invalidation,
)
from aijian_api.artifact_invalidation_ledger import (
    InvalidationLedgerError,
    _persist_invalidation_operation,
    record_accepted_head_replacement,
)
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactVersionRecord,
    InvalidationOperationRecord,
    PreparedReviewAction,
    Project,
    TrustedReviewActor,
)
from aijian_api.invalidation_schema import MIGRATION_15
from aijian_api.repository import StudioRepository

LOCAL_ACTOR = TrustedReviewActor(
    subject_id="local-user",
    roles=("writer", "continuity_reviewer", "producer"),
)
NOW = datetime(2026, 8, 17, 12, 0, tzinfo=UTC)
STORY_CONTENT: dict[str, object] = {
    "title": "雾城",
    "logline": "她循着一封无名信追查旧车站的秘密。",
    "entities": [{"kind": "character", "name": "林岚"}],
    "facts": [
        {
            "importance": "core",
            "canon_status": "confirmed",
            "kind": "event_fact",
        }
    ],
}


class MutableClock:
    def __init__(self) -> None:
        self.value = NOW

    def __call__(self) -> datetime:
        return self.value

    def advance(self, delta: timedelta) -> None:
        self.value += delta


def deterministic_id_factory() -> Any:
    counters: defaultdict[str, int] = defaultdict(int)
    lock = threading.Lock()

    def create_id(prefix: str) -> str:
        with lock:
            counters[prefix] += 1
            return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def create_repository(
    database: Path,
    clock: MutableClock | None = None,
    *,
    transaction_hook: Any = None,
    id_factory: Any = None,
) -> StudioRepository:
    return StudioRepository(
        database,
        id_factory=id_factory or deterministic_id_factory(),
        clock=clock or MutableClock(),
        challenge_token_factory=lambda: "one-time-native-confirmation",
        transaction_hook=transaction_hook,
    )


def approve_artifact(
    repository: StudioRepository,
    project: Project,
    artifact: ArtifactVersionRecord,
    artifact_type: str,
) -> Any:
    roles = (
        ("writer", "producer")
        if artifact_type == "source_manifest"
        else ("writer", "continuity_reviewer", "producer")
    )
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
    rationale = "连续性基线可用"
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
    return repository.decide_artifact_gate(
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


def source_dependency(source_version_id: str) -> dict[str, object]:
    return {
        "dependencies": (
            ArtifactDependencyDraft(
                upstream_version_id=source_version_id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        "required_accepted_upstream_version_id": source_version_id,
    }


def create_source_and_story(
    repository: StudioRepository,
) -> tuple[Project, ArtifactVersionRecord, ArtifactVersionRecord]:
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    source = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_review_fixture"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源基线",
    )
    approve_artifact(repository, project, source, "source_manifest")
    story = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=STORY_CONTENT,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="初稿",
        **source_dependency(source.version.id),
    )
    return project, source, story


def create_downstream(
    repository: StudioRepository,
    project: Project,
    *,
    artifact_type: str,
    change_summary: str,
    dependencies: tuple[ArtifactDependencyDraft, ...],
) -> ArtifactVersionRecord:
    return repository.create_artifact_version(
        project_id=project.id,
        artifact_type=artifact_type,
        schema_version="1.0.0",
        content={"role": artifact_type},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary=change_summary,
        dependencies=dependencies,
    )


def ledger_row_counts(database: Path) -> tuple[int, int]:
    with sqlite3.connect(database) as connection:
        operations = connection.execute(
            "SELECT COUNT(*) FROM invalidation_operations"
        ).fetchone()
        paths = connection.execute(
            "SELECT COUNT(*) FROM invalidation_reason_paths"
        ).fetchone()
    assert operations is not None and paths is not None
    return int(operations[0]), int(paths[0])


def snapshot_immutable_graph(database: Path) -> dict[str, object]:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        return {
            "versions": connection.execute(
                "SELECT version_id, artifact_id, content_hash, parent_version_id "
                "FROM artifact_versions ORDER BY version_id"
            ).fetchall(),
            "dependencies": connection.execute(
                "SELECT dependency_id, downstream_version_id, upstream_version_id, "
                "relationship, impact FROM artifact_dependencies ORDER BY dependency_id"
            ).fetchall(),
            "heads": connection.execute(
                "SELECT artifact_id, latest_version_id, review_version_id, "
                "accepted_version_id, revision FROM artifact_heads ORDER BY artifact_id"
            ).fetchall(),
            "proposals": connection.execute(
                "SELECT COUNT(*) FROM agent_artifact_proposals"
            ).fetchone()[0],
            "tasks": connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0],
            "decisions": connection.execute(
                "SELECT decision_id, version_id, decision FROM gate_decisions "
                "ORDER BY decision_id"
            ).fetchall(),
        }


def flatten_expected_paths(
    result: TypedDependencyInvalidationResult,
) -> list[tuple[str, str, str, str, tuple[str, ...], tuple[str, ...], tuple[str, ...], str]]:
    flattened: list[
        tuple[str, str, str, str, tuple[str, ...], tuple[str, ...], tuple[str, ...], str]
    ] = []
    for affected in result.affected:
        for path in affected.reason_paths:
            flattened.append(
                (
                    affected.artifact_id,
                    affected.version_id,
                    affected.classification,
                    affected.aggregate_impact,
                    path.dependency_ids,
                    path.relationships,
                    path.edge_impacts,
                    path.effective_impact,
                )
            )
    return flattened


def expected_replacement_result(
    *,
    project_id: str,
    changed_artifact_id: str,
    old_version_id: str,
    new_version_id: str,
    versions: tuple[ArtifactVersionIdentity, ...],
    accepted_heads: tuple[AcceptedArtifactHead, ...],
    dependencies: tuple[ExactVersionDependency, ...],
) -> TypedDependencyInvalidationResult:
    return assess_typed_dependency_invalidation(
        TypedDependencyInvalidationInput(
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
    )


def assert_operation_matches_result(
    operation: InvalidationOperationRecord,
    result: TypedDependencyInvalidationResult,
    *,
    gate_decision_id: str,
) -> None:
    assert operation.project_id == result.project_id
    assert operation.changed_artifact_id == result.changed_artifact_id
    assert operation.old_accepted_version_id == result.old_version_id
    assert operation.new_accepted_version_id == result.new_version_id
    assert operation.gate_decision_id == gate_decision_id
    assert operation.assessment_hash.startswith("sha256:")
    persisted = [
        (
            path.affected_artifact_id,
            path.affected_version_id,
            path.classification,
            path.aggregate_impact,
            path.dependency_ids,
            path.relationships,
            path.edge_impacts,
            path.effective_impact,
        )
        for path in operation.paths
    ]
    expected = flatten_expected_paths(result)
    assert persisted == expected
    assert [path.ordinal for path in operation.paths] == list(range(len(expected)))


def test_first_accepted_version_creates_no_invalidation_operation(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project, source, story = create_source_and_story(repository)

    first_source = repository.list_invalidation_operations(project.id)
    assert first_source == ()
    approved = approve_artifact(repository, project, story, "story_bible")
    assert approved.head.accepted_version_id == story.version.id
    assert repository.list_invalidation_operations(project.id) == ()
    assert ledger_row_counts(repository.database_path) == (0, 0)


def test_accepted_replacement_creates_one_operation_and_all_r01_paths(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project, source, story = create_source_and_story(repository)
    approved_story = approve_artifact(repository, project, story, "story_bible")
    episode = create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    screenplay = create_downstream(
        repository,
        project,
        artifact_type="screenplay",
        change_summary="剧本",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    voice = create_downstream(
        repository,
        project,
        artifact_type="voice",
        change_summary="配音",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=episode.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ArtifactDependencyDraft(
                upstream_version_id=screenplay.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    advisory = create_downstream(
        repository,
        project,
        artifact_type="style_guide",
        change_summary="风格参考",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    render_only = create_downstream(
        repository,
        project,
        artifact_type="previz",
        change_summary="预览",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
    )
    story_draft = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=STORY_CONTENT,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="未采纳修订",
        parent_version_id=story.version.id,
        expected_revision=approved_story.head.revision,
        **source_dependency(source.version.id),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_review_fixture_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    before = snapshot_immutable_graph(repository.database_path)
    approved = approve_artifact(repository, project, source_v2, "source_manifest")

    operations = repository.list_invalidation_operations(project.id)
    assert len(operations) == 1
    operation = operations[0]
    assert operation.changed_artifact_id == source.version.artifact_id
    assert operation.old_accepted_version_id == source.version.id
    assert operation.new_accepted_version_id == source_v2.version.id
    assert operation.gate_decision_id == approved.decision.id
    assert approved.head.accepted_version_id == source_v2.version.id

    expected = expected_replacement_result(
        project_id=project.id,
        changed_artifact_id=source.version.artifact_id,
        old_version_id=source.version.id,
        new_version_id=source_v2.version.id,
        versions=(
            ArtifactVersionIdentity(project.id, source.version.artifact_id, source.version.id),
            ArtifactVersionIdentity(project.id, source.version.artifact_id, source_v2.version.id),
            ArtifactVersionIdentity(project.id, story.version.artifact_id, story.version.id),
            ArtifactVersionIdentity(project.id, story.version.artifact_id, story_draft.version.id),
            ArtifactVersionIdentity(project.id, episode.version.artifact_id, episode.version.id),
            ArtifactVersionIdentity(
                project.id, screenplay.version.artifact_id, screenplay.version.id
            ),
            ArtifactVersionIdentity(project.id, voice.version.artifact_id, voice.version.id),
            ArtifactVersionIdentity(project.id, advisory.version.artifact_id, advisory.version.id),
            ArtifactVersionIdentity(
                project.id, render_only.version.artifact_id, render_only.version.id
            ),
        ),
        accepted_heads=(
            AcceptedArtifactHead(project.id, source.version.artifact_id, source_v2.version.id),
            AcceptedArtifactHead(project.id, story.version.artifact_id, story.version.id),
        ),
        dependencies=(
            ExactVersionDependency(
                id=story.dependencies[0].id,
                project_id=project.id,
                downstream_artifact_id=story.version.artifact_id,
                downstream_version_id=story.version.id,
                upstream_artifact_id=source.version.artifact_id,
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ExactVersionDependency(
                id=story_draft.dependencies[0].id,
                project_id=project.id,
                downstream_artifact_id=story.version.artifact_id,
                downstream_version_id=story_draft.version.id,
                upstream_artifact_id=source.version.artifact_id,
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ExactVersionDependency(
                id=episode.dependencies[0].id,
                project_id=project.id,
                downstream_artifact_id=episode.version.artifact_id,
                downstream_version_id=episode.version.id,
                upstream_artifact_id=source.version.artifact_id,
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ExactVersionDependency(
                id=screenplay.dependencies[0].id,
                project_id=project.id,
                downstream_artifact_id=screenplay.version.artifact_id,
                downstream_version_id=screenplay.version.id,
                upstream_artifact_id=source.version.artifact_id,
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ExactVersionDependency(
                id=voice.dependencies[0].id,
                project_id=project.id,
                downstream_artifact_id=voice.version.artifact_id,
                downstream_version_id=voice.version.id,
                upstream_artifact_id=episode.version.artifact_id,
                upstream_version_id=episode.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ExactVersionDependency(
                id=voice.dependencies[1].id,
                project_id=project.id,
                downstream_artifact_id=voice.version.artifact_id,
                downstream_version_id=voice.version.id,
                upstream_artifact_id=screenplay.version.artifact_id,
                upstream_version_id=screenplay.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ExactVersionDependency(
                id=advisory.dependencies[0].id,
                project_id=project.id,
                downstream_artifact_id=advisory.version.artifact_id,
                downstream_version_id=advisory.version.id,
                upstream_artifact_id=source.version.artifact_id,
                upstream_version_id=source.version.id,
                relationship="references",
                impact="advisory",
            ),
            ExactVersionDependency(
                id=render_only.dependencies[0].id,
                project_id=project.id,
                downstream_artifact_id=render_only.version.artifact_id,
                downstream_version_id=render_only.version.id,
                upstream_artifact_id=source.version.artifact_id,
                upstream_version_id=source.version.id,
                relationship="renders",
                impact="render_only",
            ),
        ),
    )
    assert_operation_matches_result(operation, expected, gate_decision_id=approved.decision.id)
    classifications = {
        path.affected_version_id: path.classification for path in operation.paths
    }
    assert classifications[story.version.id] == "STALE"
    assert classifications[story_draft.version.id] == "INVALIDATE"
    voice_paths = [path for path in operation.paths if path.affected_version_id == voice.version.id]
    assert len(voice_paths) == 2
    assert {path.aggregate_impact for path in voice_paths} == {"blocking"}
    advisory_paths = [
        path for path in operation.paths if path.affected_version_id == advisory.version.id
    ]
    render_paths = [
        path for path in operation.paths if path.affected_version_id == render_only.version.id
    ]
    assert advisory_paths[0].effective_impact == "advisory"
    assert render_paths[0].effective_impact == "render_only"
    after = snapshot_immutable_graph(repository.database_path)
    assert after["versions"] == before["versions"]
    assert after["dependencies"] == before["dependencies"]
    assert after["proposals"] == before["proposals"]
    assert after["tasks"] == before["tasks"]
    before_decisions = {row["decision_id"]: row for row in before["decisions"]}
    after_decisions = {row["decision_id"]: row for row in after["decisions"]}
    assert before_decisions.keys() <= after_decisions.keys()
    for decision_id, decision in before_decisions.items():
        assert after_decisions[decision_id] == decision
    assert approved.decision.id in after_decisions
    before_heads = {row["artifact_id"]: row for row in before["heads"]}
    after_heads = {row["artifact_id"]: row for row in after["heads"]}
    for artifact_id, head in before_heads.items():
        if artifact_id == source.version.artifact_id:
            assert after_heads[artifact_id]["accepted_version_id"] == source_v2.version.id
            assert after_heads[artifact_id]["latest_version_id"] == head["latest_version_id"]
            continue
        assert after_heads[artifact_id] == head
    assert ledger_row_counts(repository.database_path) == (1, len(operation.paths))


def test_story_replacement_without_descendants_creates_operation_and_zero_paths(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project, source, story = create_source_and_story(repository)
    approved_v1 = approve_artifact(repository, project, story, "story_bible")
    story_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=STORY_CONTENT,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="第二版",
        parent_version_id=story.version.id,
        expected_revision=approved_v1.head.revision,
        **source_dependency(source.version.id),
    )
    approved_v2 = approve_artifact(repository, project, story_v2, "story_bible")
    operations = repository.list_invalidation_operations(project.id)
    assert len(operations) == 1
    assert operations[0].old_accepted_version_id == story.version.id
    assert operations[0].new_accepted_version_id == story_v2.version.id
    assert operations[0].gate_decision_id == approved_v2.decision.id
    assert operations[0].paths == ()
    assert ledger_row_counts(repository.database_path) == (1, 0)


def test_exact_internal_replay_returns_same_ids_and_drift_conflicts(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    approved = approve_artifact(repository, project, source_v2, "source_manifest")
    original = repository.list_invalidation_operations(project.id)[0]
    expected = expected_replacement_result(
        project_id=project.id,
        changed_artifact_id=original.changed_artifact_id,
        old_version_id=original.old_accepted_version_id,
        new_version_id=original.new_accepted_version_id,
        versions=_project_version_identities(repository.database_path, project.id),
        accepted_heads=_project_accepted_heads(repository.database_path, project.id),
        dependencies=_project_dependencies(repository.database_path, project.id),
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        replayed = _persist_invalidation_operation(
            connection,
            project_id=project.id,
            changed_artifact_id=original.changed_artifact_id,
            old_version_id=original.old_accepted_version_id,
            new_version_id=original.new_accepted_version_id,
            gate_decision_id=approved.decision.id,
            result=expected,
            created_at=original.created_at,
            id_factory=deterministic_id_factory(),
        )
        connection.commit()
    assert replayed.id == original.id
    assert [path.id for path in replayed.paths] == [path.id for path in original.paths]
    assert ledger_row_counts(repository.database_path) == (1, len(original.paths))

    drifted = TypedDependencyInvalidationResult(
        project_id=project.id,
        changed_artifact_id=original.changed_artifact_id,
        old_version_id=original.old_accepted_version_id,
        new_version_id=original.new_accepted_version_id,
        affected=(),
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(InvalidationLedgerError, match="drift|identity|hash"):
            _persist_invalidation_operation(
                connection,
                project_id=project.id,
                changed_artifact_id=original.changed_artifact_id,
                old_version_id=original.old_accepted_version_id,
                new_version_id=original.new_accepted_version_id,
                gate_decision_id=approved.decision.id,
                result=drifted,
                created_at=original.created_at,
                id_factory=deterministic_id_factory(),
            )
        connection.rollback()
    assert ledger_row_counts(repository.database_path) == (1, len(original.paths))


def _insert_test_only_approved_decision(
    database: Path,
    *,
    artifact: ArtifactVersionRecord,
    signed: Any,
    prepared: PreparedReviewAction,
    decision_id: str,
) -> str:
    submission_id = signed.head.review_submission_id
    assert submission_id is not None
    decided_at = "2026-08-17T12:00:00Z"
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "UPDATE confirmation_challenges SET consumed_at = ? WHERE challenge_id = ?",
            (decided_at, prepared.challenge.id),
        )
        connection.execute(
            """
            INSERT INTO gate_decisions (
                decision_id, artifact_id, version_id, submission_id, gate,
                decision, readiness_report_id, actor_id, actor_role,
                self_review, rationale, decided_at,
                confirmation_challenge_id, head_revision
            ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, 'producer', 0, 'race setup', ?, ?, ?)
            """,
            (
                decision_id,
                artifact.version.artifact_id,
                artifact.version.id,
                submission_id,
                prepared.challenge.gate,
                prepared.report.id,
                LOCAL_ACTOR.subject_id,
                decided_at,
                prepared.challenge.id,
                signed.head.revision,
            ),
        )
        connection.commit()
    return decision_id


def _overlay_accepted_heads(
    database: Path,
    project_id: str,
    changed_artifact_id: str,
    new_version_id: str,
) -> tuple[AcceptedArtifactHead, ...]:
    heads: list[AcceptedArtifactHead] = []
    replaced = False
    for head in _project_accepted_heads(database, project_id):
        if head.artifact_id == changed_artifact_id:
            heads.append(
                AcceptedArtifactHead(project_id, changed_artifact_id, new_version_id)
            )
            replaced = True
        else:
            heads.append(head)
    if not replaced:
        heads.append(AcceptedArtifactHead(project_id, changed_artifact_id, new_version_id))
    return tuple(heads)


def test_two_writers_racing_same_identity_converge(tmp_path: Path) -> None:
    id_factory = deterministic_id_factory()
    repository = create_repository(tmp_path / "workspace.db", id_factory=id_factory)
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    signed, prepared_decision = _prepare_source_replacement_decision(
        repository, project, source_v2
    )
    decision_id = _insert_test_only_approved_decision(
        repository.database_path,
        artifact=source_v2,
        signed=signed,
        prepared=prepared_decision,
        decision_id=id_factory("dec"),
    )
    assert ledger_row_counts(repository.database_path) == (0, 0)
    expected = expected_replacement_result(
        project_id=project.id,
        changed_artifact_id=source.version.artifact_id,
        old_version_id=source.version.id,
        new_version_id=source_v2.version.id,
        versions=_project_version_identities(repository.database_path, project.id),
        accepted_heads=_overlay_accepted_heads(
            repository.database_path,
            project.id,
            source.version.artifact_id,
            source_v2.version.id,
        ),
        dependencies=_project_dependencies(repository.database_path, project.id),
    )
    barrier = threading.Barrier(2)
    results: list[InvalidationOperationRecord] = []
    errors: list[BaseException] = []

    def writer() -> None:
        try:
            connection = sqlite3.connect(repository.database_path, timeout=10)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 10000")
            barrier.wait(timeout=5)
            connection.execute("BEGIN IMMEDIATE")
            record = _persist_invalidation_operation(
                connection,
                project_id=project.id,
                changed_artifact_id=source.version.artifact_id,
                old_version_id=source.version.id,
                new_version_id=source_v2.version.id,
                gate_decision_id=decision_id,
                result=expected,
                created_at=NOW,
                id_factory=id_factory,
            )
            connection.commit()
            connection.close()
            results.append(record)
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=writer) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
    assert errors == []
    assert len(results) == 2
    assert results[0].id == results[1].id
    assert results[0].assessment_hash == results[1].assessment_hash
    assert [path.id for path in results[0].paths] == [path.id for path in results[1].paths]
    assert ledger_row_counts(repository.database_path) == (1, len(results[0].paths))
    loaded = repository.list_invalidation_operations(project.id)
    assert len(loaded) == 1
    assert loaded[0].id == results[0].id
    assert loaded[0].gate_decision_id == decision_id


def test_rejection_and_latest_only_draft_create_no_operation(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project, source, story = create_source_and_story(repository)
    approved = approve_artifact(repository, project, story, "story_bible")
    draft = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=STORY_CONTENT,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="待拒绝修订",
        parent_version_id=story.version.id,
        expected_revision=approved.head.revision,
        **source_dependency(source.version.id),
    )
    assert repository.list_invalidation_operations(project.id) == ()
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=draft.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=draft.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=draft.version.id,
        expected_revision=draft.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_rejection = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=draft.version.id,
        action="decision",
        action_payload={
            "decision": "rejected",
            "rationale": "关键事件仍有冲突",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    rejected = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=draft.version.id,
        decision="rejected",
        rationale="关键事件仍有冲突",
        expected_revision=submitted.head.revision,
        challenge_id=prepared_rejection.challenge.id,
        confirmation_token=prepared_rejection.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    assert rejected.head.accepted_version_id == story.version.id
    assert repository.list_invalidation_operations(project.id) == ()
    assert ledger_row_counts(repository.database_path) == (0, 0)


def test_operation_and_path_rows_are_immutable_and_sql_corruption_is_rejected(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    approve_artifact(repository, project, source_v2, "source_manifest")
    operation = repository.list_invalidation_operations(project.id)[0]
    other = repository.create_project(
        name="他项目",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )

    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE invalidation_operations SET assessment_hash = ? WHERE operation_id = ?",
                ("sha256:" + "0" * 64, operation.id),
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "DELETE FROM invalidation_operations WHERE operation_id = ?",
                (operation.id,),
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE invalidation_reason_paths SET classification = 'INVALIDATE' "
                "WHERE path_id = ?",
                (operation.paths[0].id,),
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "DELETE FROM invalidation_reason_paths WHERE path_id = ?",
                (operation.paths[0].id,),
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO invalidation_operations (
                    operation_id, project_id, changed_artifact_id, old_accepted_version_id,
                    new_accepted_version_id, gate_decision_id, assessment_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "ivo_" + "f" * 32,
                    other.id,
                    operation.changed_artifact_id,
                    operation.old_accepted_version_id,
                    operation.new_accepted_version_id,
                    operation.gate_decision_id,
                    operation.assessment_hash,
                    "2026-08-17T12:00:00Z",
                ),
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO invalidation_reason_paths (
                    path_id, operation_id, project_id, affected_artifact_id,
                    affected_version_id, classification, aggregate_impact,
                    dependency_ids_json, relationships_json, edge_impacts_json,
                    effective_impact, ordinal, created_at
                ) VALUES (?, ?, ?, ?, ?, 'STALE', 'blocking', '[]', '[]', '[]',
                          'blocking', 99, '2026-08-17T12:00:00Z')
                """,
                (
                    "ivp_" + "f" * 32,
                    operation.id,
                    operation.project_id,
                    operation.paths[0].affected_artifact_id,
                    operation.paths[0].affected_version_id,
                ),
            )
        connection.rollback()

    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        connection.execute(
            "UPDATE invalidation_operations SET assessment_hash = ? WHERE operation_id = ?",
            ("sha256:" + "d" * 64, operation.id),
        )
        connection.commit()
    with pytest.raises(InvalidationLedgerError):
        repository.get_invalidation_operation(project.id, operation.id)


def _approve_source_replacement_with_episode(
    repository: StudioRepository,
) -> tuple[Project, ArtifactVersionRecord, ArtifactVersionRecord, InvalidationOperationRecord]:
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    approve_artifact(repository, project, source_v2, "source_manifest")
    operations = repository.list_invalidation_operations(project.id)
    assert len(operations) == 1
    return project, source, source_v2, operations[0]


def test_recovery_reads_fail_closed_on_drifted_gate_and_path_ownership(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project_a, source_a, source_a_v2, operation_a = _approve_source_replacement_with_episode(
        repository
    )
    project_b, _source_b, _source_b_v2, operation_b = _approve_source_replacement_with_episode(
        repository
    )
    before_versions = snapshot_immutable_graph(repository.database_path)["versions"]
    with sqlite3.connect(repository.database_path) as connection:
        story_decision = connection.execute(
            """
            SELECT decision_id FROM gate_decisions
            WHERE artifact_id = ? AND version_id <> ?
            ORDER BY decided_at ASC LIMIT 1
            """,
            (source_a.version.artifact_id, source_a_v2.version.id),
        ).fetchone()
        assert story_decision is not None
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        connection.execute("DROP TRIGGER invalidation_reason_paths_immutable_update")
        connection.execute(
            "UPDATE invalidation_operations SET gate_decision_id = ? WHERE operation_id = ?",
            (str(story_decision[0]), operation_a.id),
        )
        connection.commit()

    with pytest.raises(InvalidationLedgerError, match="ownership"):
        repository.get_invalidation_operation(project_a.id, operation_a.id)
    assert repository.get_invalidation_operation(project_b.id, operation_b.id) == operation_b
    assert snapshot_immutable_graph(repository.database_path)["versions"] == before_versions

    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            "UPDATE invalidation_operations SET gate_decision_id = ? WHERE operation_id = ?",
            (operation_a.gate_decision_id, operation_a.id),
        )
        connection.execute(
            """
            UPDATE invalidation_reason_paths
            SET affected_artifact_id = ?, affected_version_id = ?
            WHERE path_id = ?
            """,
            (
                operation_b.paths[0].affected_artifact_id,
                operation_b.paths[0].affected_version_id,
                operation_a.paths[0].id,
            ),
        )
        connection.commit()

    with pytest.raises(InvalidationLedgerError, match="ownership"):
        repository.get_invalidation_operation(project_a.id, operation_a.id)
    assert repository.get_invalidation_operation(project_b.id, operation_b.id) == operation_b
    assert snapshot_immutable_graph(repository.database_path)["versions"] == before_versions
    assert ledger_row_counts(repository.database_path) == (
        2,
        len(operation_a.paths) + len(operation_b.paths),
    )


def test_assessment_hash_check_rejects_non_hex_digest() -> None:
    with sqlite3.connect(":memory:") as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("CREATE TABLE projects (id TEXT PRIMARY KEY)")
        connection.execute(
            "CREATE TABLE artifacts (artifact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE artifact_versions ("
            "version_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, "
            "UNIQUE (artifact_id, version_id))"
        )
        connection.execute(
            "CREATE TABLE gate_decisions ("
            "decision_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, "
            "version_id TEXT NOT NULL, decision TEXT NOT NULL)"
        )
        for statement in MIGRATION_15:
            connection.execute(statement)
        connection.execute("INSERT INTO projects VALUES ('project-hash')")
        connection.execute("INSERT INTO artifacts VALUES ('art_changed', 'project-hash')")
        connection.execute("INSERT INTO artifact_versions VALUES ('ver_old', 'art_changed')")
        connection.execute("INSERT INTO artifact_versions VALUES ('ver_new', 'art_changed')")
        connection.execute(
            "INSERT INTO gate_decisions "
            "VALUES ('dec_hash', 'art_changed', 'ver_new', 'approved')"
        )
        for bad_hash in (
            "sha256:" + "A" * 64,
            "sha256:" + "g" * 64,
            "sha256:" + "0" * 63 + "G",
            "sha256:" + "z" * 64,
        ):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO invalidation_operations VALUES (
                        'ivo_hash_bad', 'project-hash', 'art_changed', 'ver_old',
                        'ver_new', 'dec_hash', ?, '2026-08-17T12:00:00Z'
                    )
                    """,
                    (bad_hash,),
                )
            connection.rollback()


def _prepare_source_replacement_decision(
    repository: StudioRepository,
    project: Project,
    source_v2: ArtifactVersionRecord,
) -> Any:
    roles = ("writer", "producer")
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=source_v2.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        expected_revision=source_v2.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "闭合失败应回滚",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    return signed, prepared_decision


def test_fail_closed_graph_and_overlay_errors_roll_back_gate(tmp_path: Path) -> None:
    clock = MutableClock()
    repository = create_repository(tmp_path / "workspace.db", clock)
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    episode = create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    signed, prepared_decision = _prepare_source_replacement_decision(
        repository, project, source_v2
    )

    def decide() -> Any:
        return repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="source_manifest",
            version_id=source_v2.version.id,
            decision="approved",
            rationale="闭合失败应回滚",
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )

    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DROP TRIGGER artifact_dependencies_no_cycle")
        connection.execute(
            """
            INSERT INTO artifact_dependencies VALUES (
                'dep_cycle', ?, ?, ?, ?, 'derived_from', 'blocking', ?
            )
            """,
            (
                source.version.artifact_id,
                source.version.id,
                episode.version.artifact_id,
                episode.version.id,
                "2026-08-17T12:00:00Z",
            ),
        )
        connection.commit()

    before_head = repository.get_artifact_head(project.id, "source_manifest")
    with pytest.raises(InvalidationLedgerError, match="cycle"):
        decide()
    after_head = repository.get_artifact_head(project.id, "source_manifest")
    assert after_head.accepted_version_id == source.version.id
    assert after_head.revision == before_head.revision
    assert repository.list_invalidation_operations(project.id) == ()
    assert ledger_row_counts(repository.database_path) == (0, 0)

    _force_delete_dependency(repository.database_path, "dep_cycle")

    other = repository.create_project(
        name="跨项目",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    other_source = repository.create_artifact_version(
        project_id=other.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_other"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="他项目来源",
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            INSERT INTO artifact_dependencies VALUES (
                'dep_cross', ?, ?, ?, ?, 'derived_from', 'blocking', ?
            )
            """,
            (
                episode.version.artifact_id,
                episode.version.id,
                other_source.version.artifact_id,
                other_source.version.id,
                "2026-08-17T12:00:00Z",
            ),
        )
        connection.commit()
    with pytest.raises(InvalidationLedgerError, match="project|cross"):
        decide()
    assert repository.get_artifact_head(project.id, "source_manifest").accepted_version_id == (
        source.version.id
    )
    assert ledger_row_counts(repository.database_path) == (0, 0)

    _force_delete_dependency(repository.database_path, "dep_cross")

    with sqlite3.connect(repository.database_path) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(InvalidationLedgerError, match="overlay|accepted"):
            record_accepted_head_replacement(
                connection,
                project_id=project.id,
                changed_artifact_id=source.version.artifact_id,
                old_version_id=source_v2.version.id,
                new_version_id=source.version.id,
                gate_decision_id="dec_missing",
                created_at=clock.value,
                id_factory=deterministic_id_factory(),
            )
        connection.rollback()

    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            INSERT INTO artifact_dependencies VALUES (
                'dep_missing', ?, ?, 'art_missing', 'ver_missing',
                'derived_from', 'blocking', ?
            )
            """,
            (episode.version.artifact_id, episode.version.id, "2026-08-17T12:00:00Z"),
        )
        connection.commit()
    with pytest.raises(InvalidationLedgerError, match="missing|version"):
        decide()
    assert ledger_row_counts(repository.database_path) == (0, 0)
    assert repository.get_artifact_head(project.id, "source_manifest").accepted_version_id == (
        source.version.id
    )


def test_transaction_hook_crashes_roll_back_and_clean_retry_succeeds(tmp_path: Path) -> None:
    clock = MutableClock()
    failure: list[tuple[str, str] | None] = [None]
    observed: list[tuple[str, str]] = []

    def hook(operation: str, step: str) -> None:
        if operation == "decide_gate":
            observed.append((operation, step))
        if failure[0] == (operation, step):
            raise RuntimeError(f"injected {operation}:{step}")

    repository = create_repository(
        tmp_path / "workspace.db",
        clock,
        transaction_hook=hook,
    )
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    create_downstream(
        repository,
        project,
        artifact_type="screenplay",
        change_summary="剧本",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    observed.clear()
    failure[0] = None
    roles = ("writer", "producer")
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=source_v2.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        expected_revision=source_v2.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    rationale = "故障注入后可重试"
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=source_v2.version.id,
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

    def decide() -> Any:
        return repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="source_manifest",
            version_id=source_v2.version.id,
            decision="approved",
            rationale=rationale,
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )

    observed.clear()
    failure[0] = None
    try:
        decide()
    except Exception:
        pytest.fail("probe decide should succeed only after crash matrix")
    probe_steps = [step for operation, step in observed if operation == "decide_gate"]
    assert "challenge_consumed" in probe_steps
    assert "decision_inserted" in probe_steps
    assert "operation_inserted" in probe_steps
    assert any(step.startswith("path_") for step in probe_steps)
    assert "head_updated" in probe_steps

    # The probe decide already committed. Recreate the crash matrix on a fresh graph.
    crash_db = tmp_path / "crash.db"
    crash_repo = create_repository(crash_db, MutableClock(), transaction_hook=hook)
    crash_project, crash_source, crash_story = create_source_and_story(crash_repo)
    approve_artifact(crash_repo, crash_project, crash_story, "story_bible")
    create_downstream(
        crash_repo,
        crash_project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=crash_source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    create_downstream(
        crash_repo,
        crash_project,
        artifact_type="screenplay",
        change_summary="剧本",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=crash_source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    crash_source_v2 = crash_repo.create_artifact_version(
        project_id=crash_project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_crash"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=crash_source.version.id,
        expected_revision=crash_repo.get_artifact_head(
            crash_project.id, "source_manifest"
        ).revision,
    )
    prepared_submit = crash_repo.prepare_review_action(
        project_id=crash_project.id,
        artifact_type="source_manifest",
        version_id=crash_source_v2.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=crash_source_v2.head.revision,
    )
    submitted = crash_repo.submit_artifact_review(
        project_id=crash_project.id,
        artifact_type="source_manifest",
        version_id=crash_source_v2.version.id,
        expected_revision=crash_source_v2.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = crash_repo.prepare_review_action(
        project_id=crash_project.id,
        artifact_type="source_manifest",
        version_id=crash_source_v2.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = crash_repo.signoff_artifact_review(
        project_id=crash_project.id,
        artifact_type="source_manifest",
        version_id=crash_source_v2.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_decision = crash_repo.prepare_review_action(
        project_id=crash_project.id,
        artifact_type="source_manifest",
        version_id=crash_source_v2.version.id,
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

    def crash_decide() -> Any:
        return crash_repo.decide_artifact_gate(
            project_id=crash_project.id,
            artifact_type="source_manifest",
            version_id=crash_source_v2.version.id,
            decision="approved",
            rationale=rationale,
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )

    path_steps = [step for step in probe_steps if step.startswith("path_")]
    crash_steps = [
        "challenge_consumed",
        "decision_inserted",
        "operation_inserted",
        path_steps[0],
        path_steps[-1],
        "head_updated",
    ]
    for step in crash_steps:
        failure[0] = ("decide_gate", step)
        with pytest.raises(RuntimeError, match="injected decide_gate"):
            crash_decide()
        head = crash_repo.get_artifact_head(crash_project.id, "source_manifest")
        assert head.accepted_version_id == crash_source.version.id
        assert head.revision == signed.head.revision
        assert crash_repo.list_invalidation_operations(crash_project.id) == ()
        assert ledger_row_counts(crash_db) == (0, 0)
        with sqlite3.connect(crash_db) as connection:
            decisions = connection.execute(
                "SELECT COUNT(*) FROM gate_decisions WHERE version_id = ?",
                (crash_source_v2.version.id,),
            ).fetchone()
            consumed = connection.execute(
                "SELECT consumed_at FROM confirmation_challenges WHERE challenge_id = ?",
                (prepared_decision.challenge.id,),
            ).fetchone()
        assert decisions is not None and int(decisions[0]) == 0
        assert consumed is not None and consumed[0] is None

    failure[0] = None
    approved = crash_decide()
    operations = crash_repo.list_invalidation_operations(crash_project.id)
    assert len(operations) == 1
    assert approved.head.accepted_version_id == crash_source_v2.version.id
    assert operations[0].gate_decision_id == approved.decision.id
    assert ledger_row_counts(crash_db)[0] == 1


def test_reopen_after_commit_reads_the_same_operation(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = create_repository(database)
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    approved = approve_artifact(repository, project, source_v2, "source_manifest")
    original = repository.list_invalidation_operations(project.id)[0]
    reopened = create_repository(database)
    recovered = reopened.list_invalidation_operations(project.id)
    assert len(recovered) == 1
    loaded = reopened.get_invalidation_operation(project.id, original.id)
    assert loaded == original
    assert recovered[0] == original
    assert loaded.assessment_hash == original.assessment_hash
    assert loaded.gate_decision_id == approved.decision.id
    assert [path.ordinal for path in loaded.paths] == [path.ordinal for path in original.paths]
    assert [path.classification for path in loaded.paths] == [
        path.classification for path in original.paths
    ]
    assert [path.effective_impact for path in loaded.paths] == [
        path.effective_impact for path in original.paths
    ]
    expected = expected_replacement_result(
        project_id=project.id,
        changed_artifact_id=original.changed_artifact_id,
        old_version_id=original.old_accepted_version_id,
        new_version_id=original.new_accepted_version_id,
        versions=_project_version_identities(database, project.id),
        accepted_heads=_project_accepted_heads(database, project.id),
        dependencies=_project_dependencies(database, project.id),
    )
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        replayed = _persist_invalidation_operation(
            connection,
            project_id=project.id,
            changed_artifact_id=original.changed_artifact_id,
            old_version_id=original.old_accepted_version_id,
            new_version_id=original.new_accepted_version_id,
            gate_decision_id=approved.decision.id,
            result=expected,
            created_at=original.created_at,
            id_factory=deterministic_id_factory(),
        )
        connection.commit()
    assert replayed.id == original.id
    assert [path.id for path in replayed.paths] == [path.id for path in original.paths]
    assert ledger_row_counts(database) == (1, len(original.paths))


def test_project_deletion_cascades_ledger_rows_only_when_project_is_gone(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project, source, story = create_source_and_story(repository)
    approve_artifact(repository, project, story, "story_bible")
    create_downstream(
        repository,
        project,
        artifact_type="episode",
        change_summary="分集",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    approve_artifact(repository, project, source_v2, "source_manifest")
    operation = repository.list_invalidation_operations(project.id)[0]
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "DELETE FROM invalidation_operations WHERE operation_id = ?",
                (operation.id,),
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "DELETE FROM invalidation_reason_paths WHERE path_id = ?",
                (operation.paths[0].id,),
            )
        connection.rollback()

    with sqlite3.connect(":memory:") as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("CREATE TABLE projects (id TEXT PRIMARY KEY)")
        connection.execute(
            "CREATE TABLE artifacts ("
            "artifact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE artifact_versions ("
            "version_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, "
            "UNIQUE (artifact_id, version_id))"
        )
        connection.execute(
            "CREATE TABLE gate_decisions ("
            "decision_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, "
            "version_id TEXT NOT NULL, decision TEXT NOT NULL)"
        )
        for statement in MIGRATION_15:
            connection.execute(statement)
        connection.execute("INSERT INTO projects VALUES ('project-cascade')")
        connection.execute("INSERT INTO artifacts VALUES ('art_changed', 'project-cascade')")
        connection.execute("INSERT INTO artifact_versions VALUES ('ver_old', 'art_changed')")
        connection.execute("INSERT INTO artifact_versions VALUES ('ver_new', 'art_changed')")
        connection.execute("INSERT INTO artifacts VALUES ('art_down', 'project-cascade')")
        connection.execute("INSERT INTO artifact_versions VALUES ('ver_down', 'art_down')")
        connection.execute(
            "INSERT INTO gate_decisions "
            "VALUES ('dec_cascade', 'art_changed', 'ver_new', 'approved')"
        )
        connection.execute(
            """
            INSERT INTO invalidation_operations VALUES (
                'ivo_cascade', 'project-cascade', 'art_changed', 'ver_old', 'ver_new',
                'dec_cascade', ?, '2026-08-17T12:00:00Z'
            )
            """,
            ("sha256:" + "a" * 64,),
        )
        connection.execute(
            """
            INSERT INTO invalidation_reason_paths VALUES (
                'ivp_cascade', 'ivo_cascade', 'project-cascade', 'art_down', 'ver_down',
                'INVALIDATE', 'blocking', '["dep_1"]', '["derived_from"]', '["blocking"]',
                'blocking', 0, '2026-08-17T12:00:00Z'
            )
            """
        )
        connection.commit()
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "DELETE FROM invalidation_operations WHERE operation_id = 'ivo_cascade'"
            )
        connection.rollback()
        connection.execute("DELETE FROM projects WHERE id = 'project-cascade'")
        assert connection.execute("SELECT COUNT(*) FROM invalidation_operations").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM invalidation_reason_paths").fetchone() == (
            0,
        )


def _force_delete_dependency(database: Path, dependency_id: str) -> None:
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DROP TRIGGER IF EXISTS artifact_dependencies_immutable_delete")
        connection.execute(
            "DELETE FROM artifact_dependencies WHERE dependency_id = ?",
            (dependency_id,),
        )
        connection.execute(
            """
            CREATE TRIGGER artifact_dependencies_immutable_delete
            BEFORE DELETE ON artifact_dependencies
            BEGIN
                SELECT RAISE(ABORT, 'artifact_dependencies rows are immutable');
            END
            """
        )
        connection.commit()


def _project_version_identities(
    database: Path, project_id: str
) -> tuple[ArtifactVersionIdentity, ...]:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT artifacts.project_id, artifacts.artifact_id, artifact_versions.version_id
            FROM artifact_versions
            JOIN artifacts ON artifacts.artifact_id = artifact_versions.artifact_id
            WHERE artifacts.project_id = ?
            """,
            (project_id,),
        ).fetchall()
    return tuple(
        ArtifactVersionIdentity(
            project_id=str(row["project_id"]),
            artifact_id=str(row["artifact_id"]),
            version_id=str(row["version_id"]),
        )
        for row in rows
    )


def _project_accepted_heads(database: Path, project_id: str) -> tuple[AcceptedArtifactHead, ...]:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT artifacts.project_id, artifacts.artifact_id, artifact_heads.accepted_version_id
            FROM artifact_heads
            JOIN artifacts ON artifacts.artifact_id = artifact_heads.artifact_id
            WHERE artifacts.project_id = ? AND artifact_heads.accepted_version_id IS NOT NULL
            """,
            (project_id,),
        ).fetchall()
    return tuple(
        AcceptedArtifactHead(
            project_id=str(row["project_id"]),
            artifact_id=str(row["artifact_id"]),
            accepted_version_id=str(row["accepted_version_id"]),
        )
        for row in rows
    )


def _project_dependencies(database: Path, project_id: str) -> tuple[ExactVersionDependency, ...]:
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT dependency.*, downstream.project_id AS project_id
            FROM artifact_dependencies AS dependency
            JOIN artifacts AS downstream
              ON downstream.artifact_id = dependency.downstream_artifact_id
            WHERE downstream.project_id = ?
            """,
            (project_id,),
        ).fetchall()
    return tuple(
        ExactVersionDependency(
            id=str(row["dependency_id"]),
            project_id=str(row["project_id"]),
            downstream_artifact_id=str(row["downstream_artifact_id"]),
            downstream_version_id=str(row["downstream_version_id"]),
            upstream_artifact_id=str(row["upstream_artifact_id"]),
            upstream_version_id=str(row["upstream_version_id"]),
            relationship=str(row["relationship"]),
            impact=row["impact"],
        )
        for row in rows
    )
