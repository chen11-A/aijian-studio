import json
import sqlite3
from collections import defaultdict
from collections.abc import Callable
from contextlib import closing, contextmanager
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from threading import Event, Thread

import pytest
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactVersionRecord,
    GateDecisionResult,
    PreparedReviewAction,
    Project,
    TrustedReviewActor,
)
from aijian_api.gate_policy import DEFAULT_GATE_POLICIES, GatePolicy
from aijian_api.ingestion import ingest_text_file
from aijian_api.repository import (
    ArtifactDependencyInvalidError,
    GateNotReadyError,
    ReviewInvalidError,
    StudioRepository,
)
from aijian_api.source_manifest import SourceManifestContentV1

LOCAL_ACTOR = TrustedReviewActor(
    subject_id="local-user",
    roles=("writer", "continuity_reviewer", "producer"),
)
OTHER_ACTOR = TrustedReviewActor(
    subject_id="other-user",
    roles=("writer", "continuity_reviewer", "producer"),
)
UNAUTHORIZED_ACTOR = TrustedReviewActor(subject_id="viewer", roles=("viewer",))


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


def create_review_repository(database: Path, clock: MutableClock) -> StudioRepository:
    return StudioRepository(
        database,
        id_factory=deterministic_id_factory(),
        clock=clock,
        challenge_token_factory=lambda: "one-time-native-confirmation",
    )


def create_reviewable_artifact(repository: StudioRepository, *, ready: bool = True):
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    content: dict[str, object] = (
        {
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
        if ready
        else {"title": "", "logline": "", "entities": [], "facts": []}
    )
    source_manifest = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_review_fixture"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源基线",
    )
    approve_artifact(repository, project, source_manifest, "source_manifest")
    dependency = ArtifactDependencyDraft(
        upstream_version_id=source_manifest.version.id,
        relationship="derived_from",
        impact="blocking",
    )
    artifact = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=content,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="初稿",
        dependencies=(dependency,),
        required_accepted_upstream_version_id=source_manifest.version.id,
    )
    return project, artifact


def _prepare_g1_lock_action(
    repository: StudioRepository, clock: MutableClock, action: str, *, older_report: bool = False
):
    """Use imported G1 v1 -> v2 plus an exact downstream edge, never the G2 fixture."""
    project = repository.create_project(
        name="Synthetic G1 lock review",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    repository.import_source(
        project.id,
        ingest_text_file(filename="v1.txt", content="第一章\n初始证据".encode()),
    )
    first = repository.get_latest_artifact(project.id, "source_manifest")
    SourceManifestContentV1.model_validate(first.version.content)
    approve_artifact(repository, project, first, "source_manifest")
    repository.create_artifact_version(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"manual": "preserve this synthetic dependent"},
        author_actor_type="human",
        author_actor_id=LOCAL_ACTOR.subject_id,
        change_summary="Synthetic exact-version dependency",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=first.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    repository.import_source(
        project.id,
        ingest_text_file(filename="v2.txt", content="第二章\n新增证据".encode()),
    )
    artifact = repository.get_latest_artifact(project.id, "source_manifest")
    SourceManifestContentV1.model_validate(artifact.version.content)
    assert artifact.version.parent_version_id == first.version.id
    assert artifact.head.accepted_version_id == first.version.id
    revision, report_id = artifact.head.revision, None
    context = dict(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        actor=LOCAL_ACTOR,
    )
    decision_payload = dict(
        decision="approved", rationale="Synthetic lock timing review", actor_role="producer"
    )
    for current, method, payload, extra in (
        ("submit", repository.submit_artifact_review, {}, {}),
        (
            "signoff",
            repository.signoff_artifact_review,
            {"roles": ["writer", "producer"]},
            {"roles": ("writer", "producer")},
        ),
        ("decision", repository.decide_artifact_gate, decision_payload, decision_payload),
    ):
        if current == "decision" and older_report:
            clock.advance(timedelta(seconds=240))
        prepared = repository.prepare_review_action(
            **context,
            action=current,
            action_payload=payload,
            expected_revision=revision,
            readiness_report_id=report_id if current == "decision" else None,
        )
        consume = partial(
            method,
            **context,
            expected_revision=revision,
            challenge_id=prepared.challenge.id,
            confirmation_token=prepared.confirmation_token,
            **extra,
        )
        if current == action:
            return artifact, prepared, consume
        result = consume()
        revision = result.head.revision
        report_id = prepared.report.id
    raise AssertionError("Unknown G1 action")


def _g1_review_rows(database: Path) -> dict[str, tuple[tuple, ...]]:
    with closing(sqlite3.connect(database)) as connection:
        return {
            table: tuple(sorted(connection.execute(f"SELECT * FROM {table}").fetchall(), key=repr))
            for table in (
                "artifact_heads",
                "artifact_versions",
                "artifact_dependencies",
                "confirmation_challenges",
                "gate_readiness_reports",
                "review_submissions",
                "role_signoffs",
                "gate_decisions",
                "invalidation_operations",
                "invalidation_reason_paths",
            )
        }


def _consume_under_g1_write_lock(
    repository: StudioRepository,
    clock: MutableClock,
    consume: Callable[[], object],
    monkeypatch: pytest.MonkeyPatch,
):
    events: list[str] = []
    outcomes: list[object] = []
    begin_requested, selected, connection_closed = Event(), Event(), Event()
    original_connection = repository._connection

    def trace(statement: str) -> None:
        sql = " ".join(statement.upper().split())
        if sql == "BEGIN IMMEDIATE":
            events.append("begin_requested")
            begin_requested.set()
        elif sql.startswith("SELECT") and begin_requested.is_set():
            if not selected.is_set():
                events.append("first_select")
                selected.set()
            if "FROM GATE_READINESS_REPORTS" in sql:
                events.append("report_selected")
        elif sql.startswith("UPDATE CONFIRMATION_CHALLENGES SET CONSUMED_AT"):
            events.append("challenge_update")
        elif sql in ("COMMIT", "ROLLBACK"):
            events.append(sql.lower())

    @contextmanager
    def traced_connection():
        try:
            with original_connection() as connection:
                connection.set_trace_callback(trace)
                yield connection
        finally:
            connection_closed.set()

    def work() -> None:
        try:
            outcomes.append(consume())
        except Exception as error:
            outcomes.append(error)

    worker = Thread(target=work, daemon=True)
    started = False
    with monkeypatch.context() as patch:
        patch.setattr(repository, "_connection", traced_connection)
        blocker = sqlite3.connect(repository.database_path, timeout=1)
        try:
            blocker.execute("BEGIN IMMEDIATE")
            worker.start()
            started = True
            assert begin_requested.wait(3), "Consumer did not request a real BEGIN IMMEDIATE"
            assert worker.is_alive() and not selected.is_set()
            clock.advance(timedelta(seconds=2))
            events.append("clock_advanced")
            assert worker.is_alive() and not selected.is_set()
            events.append("pending_before_release")
        finally:
            events.append("release_requested")
            blocker.rollback()
            blocker.close()
            if started:
                worker.join(10)
    assert not worker.is_alive(), "Worker did not exit after blocker release"
    assert connection_closed.is_set(), "Consumer connection did not close"
    with closing(sqlite3.connect(repository.database_path, timeout=1)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.rollback()
    events.append("cleanup_verified")
    assert events.index("release_requested") < events.index("first_select")
    assert len(outcomes) == 1
    return outcomes[0], events


def _assert_g1_lock_result(
    repository: StudioRepository,
    clock: MutableClock,
    artifact: ArtifactVersionRecord,
    prepared: PreparedReviewAction,
    consume: Callable[[], object],
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    expiry: str | None,
) -> None:
    before = _g1_review_rows(repository.database_path)
    before_time = clock.value
    assert before_time < prepared.challenge.expires_at
    assert before_time < prepared.report.expires_at
    outcome, events = _consume_under_g1_write_lock(repository, clock, consume, monkeypatch)
    after = _g1_review_rows(repository.database_path)
    table, timestamp = {
        "submit": ("review_submissions", "submitted_at"),
        "signoff": ("role_signoffs", "signed_at"),
        "decision": ("gate_decisions", "decided_at"),
    }[action]
    with closing(sqlite3.connect(repository.database_path)) as connection:
        connection.row_factory = sqlite3.Row
        challenge = connection.execute(
            "SELECT * FROM confirmation_challenges WHERE challenge_id = ?",
            (prepared.challenge.id,),
        ).fetchone()
        head = connection.execute(
            "SELECT * FROM artifact_heads WHERE artifact_id = ?", (artifact.version.artifact_id,)
        ).fetchone()
        audit_times = [
            row[0]
            for row in connection.execute(
                f"SELECT {timestamp} FROM {table} WHERE version_id = ?", (artifact.version.id,)
            )
        ]
    evidence = {
        "case": f"{action}-{expiry or 'valid'}",
        "events": events,
        "error": str(outcome) if isinstance(outcome, Exception) else None,
        "old_time": before_time.isoformat(),
        "new_time": clock.value.isoformat(),
        "consumed_at": challenge["consumed_at"],
        "audit_times": audit_times,
        "head_revision_delta": head["revision"] - prepared.challenge.head_revision,
        "rows_unchanged": after == before,
        "row_deltas": {name: len(after[name]) - len(rows) for name, rows in before.items()},
    }
    print("G1_LOCK_EVIDENCE " + json.dumps(evidence, sort_keys=True))
    versions_unchanged = after["artifact_versions"] == before["artifact_versions"]
    dependencies_unchanged = after["artifact_dependencies"] == before["artifact_dependencies"]
    assert versions_unchanged and dependencies_unchanged, "Immutable review inputs changed"
    if expiry:
        assert clock.value >= (
            prepared.report.expires_at if expiry == "report" else prepared.challenge.expires_at
        )
        if expiry == "report":
            assert clock.value < prepared.challenge.expires_at
            assert events.index("challenge_update") < events.index("report_selected")
        message = (
            "Readiness report no longer matches"
            if expiry == "report"
            else "Confirmation challenge no longer matches"
        )
        rejected = isinstance(outcome, ReviewInvalidError)
        assert rejected, "Expired G1 action was accepted"
        assert message in str(outcome)
        assert evidence["rows_unchanged"], "Rejected G1 action mutated persistent rows"
        assert challenge["consumed_at"] is None
        assert "rollback" in events and "commit" not in events
    else:
        assert clock.value < min(prepared.report.expires_at, prepared.challenge.expires_at)
        assert not isinstance(outcome, Exception), evidence["error"]
        assert head["revision"] == prepared.challenge.head_revision + 1
        assert len(audit_times) == (2 if action == "signoff" else 1)
        assert "commit" in events and "rollback" not in events
        if action == "decision":
            assert head["accepted_version_id"] == artifact.version.id
            assert head["review_version_id"] is None
            assert (
                len(after["invalidation_operations"]) == len(before["invalidation_operations"]) + 1
            )
            assert len(after["invalidation_reason_paths"]) > len(
                before["invalidation_reason_paths"]
            )
        for recorded in [challenge["consumed_at"], head["updated_at"], *audit_times]:
            assert datetime.fromisoformat(recorded) == clock.value, "Used stale pre-lock time"


@pytest.mark.parametrize("action", ["submit", "signoff", "decision"])
@pytest.mark.parametrize("expires", [True, False], ids=["expired", "valid"])
def test_g1_consumer_uses_post_lock_time(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, action: str, expires: bool
) -> None:
    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    artifact, prepared, consume = _prepare_g1_lock_action(repository, clock, action)
    clock.advance(
        prepared.challenge.expires_at - clock.value - timedelta(seconds=1 if expires else 3)
    )
    _assert_g1_lock_result(
        repository,
        clock,
        artifact,
        prepared,
        consume,
        monkeypatch,
        action,
        "challenge" if expires else None,
    )


def test_g1_decision_expired_report_rolls_back_consumption_after_lock(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    artifact, prepared, consume = _prepare_g1_lock_action(
        repository, clock, "decision", older_report=True
    )
    clock.advance(prepared.report.expires_at - clock.value - timedelta(seconds=1))
    _assert_g1_lock_result(
        repository, clock, artifact, prepared, consume, monkeypatch, "decision", "report"
    )


def approve_artifact(
    repository: StudioRepository,
    project: Project,
    artifact: ArtifactVersionRecord,
    artifact_type: str = "story_bible",
) -> GateDecisionResult:
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


def inherited_source_dependency(artifact: ArtifactVersionRecord) -> dict[str, object]:
    source_version_id = next(
        dependency.upstream_version_id
        for dependency in artifact.dependencies
        if dependency.relationship == "derived_from" and dependency.impact == "blocking"
    )
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


def test_story_bible_creation_requires_exact_accepted_source_manifest_dependency(
    tmp_path: Path,
) -> None:
    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    source_manifest = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_accepted"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源基线",
    )
    dependency = ArtifactDependencyDraft(
        upstream_version_id=source_manifest.version.id,
        relationship="derived_from",
        impact="blocking",
    )
    creation = {
        "project_id": project.id,
        "artifact_type": "story_bible",
        "schema_version": "1.0.0",
        "content": {"title": "雾城", "facts": []},
        "author_actor_type": "human",
        "author_actor_id": "local-user",
        "change_summary": "故事圣经",
        "dependencies": (dependency,),
        "required_accepted_upstream_version_id": source_manifest.version.id,
    }

    with pytest.raises(ArtifactDependencyInvalidError):
        repository.create_artifact_version(**creation)

    omitted_guard = {
        key: value
        for key, value in creation.items()
        if key != "required_accepted_upstream_version_id"
    }
    with pytest.raises(ArtifactDependencyInvalidError):
        repository.create_artifact_version(**omitted_guard)

    approve_artifact(repository, project, source_manifest, "source_manifest")
    without_blocking_edge = {**creation, "dependencies": ()}
    with pytest.raises(ArtifactDependencyInvalidError):
        repository.create_artifact_version(**without_blocking_edge)

    story_bible = repository.create_artifact_version(**creation)

    assert story_bible.dependencies[0].upstream_version_id == source_manifest.version.id


def test_prepare_submit_signoff_and_approve_use_frozen_review_evidence(
    tmp_path: Path,
) -> None:
    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    project, artifact = create_reviewable_artifact(repository)
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=1,
    )
    assert repository.get_artifact_head(project.id, "story_bible") == artifact.head

    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        expected_revision=1,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    assert submitted.head.revision == 2
    assert submitted.head.review_evidence_revision == 1
    assert submitted.head.review_version_id == artifact.version.id
    assert submitted.submission.readiness_report_id == prepared_submit.report.id

    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": ["writer", "continuity_reviewer", "producer"]},
        actor=LOCAL_ACTOR,
        expected_revision=2,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        roles=("writer", "continuity_reviewer", "producer"),
        expected_revision=2,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    assert signed.head.revision == 3
    assert signed.head.review_evidence_revision == 1
    assert len(signed.signoffs) == 3
    assert {item.readiness_report_id for item in signed.signoffs} == {prepared_signoff.report.id}

    prepared_waiver = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="decision",
        action_payload={
            "decision": "approved_with_waiver",
            "rationale": "尚无结构化豁免",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=3,
    )
    with pytest.raises(ReviewInvalidError, match="Waiver approval is disabled"):
        repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            decision="approved_with_waiver",
            rationale="尚无结构化豁免",
            expected_revision=3,
            challenge_id=prepared_waiver.challenge.id,
            confirmation_token=prepared_waiver.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )

    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "连续性基线可用",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=3,
    )
    approved = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        decision="approved",
        rationale="连续性基线可用",
        expected_revision=3,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    assert approved.head.revision == 4
    assert approved.head.accepted_version_id == artifact.version.id
    assert approved.head.review_version_id is None
    assert approved.decision.readiness_report_id == prepared_signoff.report.id
    assert approved.decision.self_review is True
    assert (
        repository.get_artifact_version(
            project.id, "story_bible", artifact.version.id
        ).version.content_hash
        == artifact.version.content_hash
    )

    revised = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=artifact.version.content,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="待拒绝修订",
        parent_version_id=artifact.version.id,
        expected_revision=approved.head.revision,
        **inherited_source_dependency(artifact),
    )
    prepared_revised_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=revised.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=revised.head.revision,
    )
    revised_submission = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=revised.version.id,
        expected_revision=revised.head.revision,
        challenge_id=prepared_revised_submit.challenge.id,
        confirmation_token=prepared_revised_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_rejection = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=revised.version.id,
        action="decision",
        action_payload={
            "decision": "rejected",
            "rationale": "关键事件仍有冲突",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        expected_revision=revised_submission.head.revision,
    )
    rejected = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=revised.version.id,
        decision="rejected",
        rationale="关键事件仍有冲突",
        expected_revision=revised_submission.head.revision,
        challenge_id=prepared_rejection.challenge.id,
        confirmation_token=prepared_rejection.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    assert rejected.head.accepted_version_id == artifact.version.id
    assert rejected.head.review_version_id is None


def test_accepted_head_rejects_clear_and_stale_approved_decision_replay(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = MutableClock()
    repository = create_review_repository(database, clock)
    project, first_artifact = create_reviewable_artifact(repository)
    first_approval = approve_artifact(repository, project, first_artifact)
    second_artifact = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=first_artifact.version.content,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="第二个已批准版本",
        parent_version_id=first_artifact.version.id,
        expected_revision=first_approval.head.revision,
        **inherited_source_dependency(first_artifact),
    )
    second_approval = approve_artifact(repository, project, second_artifact)
    assert second_approval.head.accepted_version_id == second_artifact.version.id

    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="approved Gate decision"):
            connection.execute(
                """
                UPDATE artifact_heads
                SET accepted_version_id = NULL, revision = revision + 1
                WHERE artifact_id = ?
                """,
                (second_artifact.version.artifact_id,),
            )
        connection.rollback()
        with pytest.raises(sqlite3.IntegrityError, match="approved Gate decision"):
            connection.execute(
                """
                UPDATE artifact_heads
                SET accepted_version_id = ?, revision = revision + 1
                WHERE artifact_id = ?
                """,
                (first_artifact.version.id, second_artifact.version.artifact_id),
            )
        connection.rollback()


def test_confirmation_is_single_use_revision_bound_and_expires(tmp_path: Path) -> None:
    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    project, artifact = create_reviewable_artifact(repository)
    prepared = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=1,
    )
    with pytest.raises(ReviewInvalidError):
        repository.submit_artifact_review(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            expected_revision=1,
            challenge_id=prepared.challenge.id,
            confirmation_token=prepared.confirmation_token,
            actor=OTHER_ACTOR,
        )
    repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        expected_revision=1,
        challenge_id=prepared.challenge.id,
        confirmation_token=prepared.confirmation_token,
        actor=LOCAL_ACTOR,
    )

    with pytest.raises(ReviewInvalidError):
        repository.submit_artifact_review(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            expected_revision=2,
            challenge_id=prepared.challenge.id,
            confirmation_token=prepared.confirmation_token,
            actor=LOCAL_ACTOR,
        )

    expiring_report = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": ["writer"]},
        actor=LOCAL_ACTOR,
        expected_revision=2,
    )
    clock.advance(timedelta(minutes=6))
    with pytest.raises(ReviewInvalidError, match="does not match review evidence"):
        repository.prepare_review_action(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            action="decision",
            action_payload={
                "decision": "rejected",
                "rationale": "过期报告",
                "actor_role": "producer",
            },
            actor=LOCAL_ACTOR,
            readiness_report_id=expiring_report.report.id,
            expected_revision=2,
        )

    second_version = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=artifact.version.content,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="修订",
        parent_version_id=artifact.version.id,
        expected_revision=2,
        **inherited_source_dependency(artifact),
    )
    expiring = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=second_version.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=3,
    )
    clock.advance(timedelta(minutes=6))
    with pytest.raises(ReviewInvalidError):
        repository.submit_artifact_review(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=second_version.version.id,
            expected_revision=3,
            challenge_id=expiring.challenge.id,
            confirmation_token=expiring.confirmation_token,
            actor=LOCAL_ACTOR,
        )


def test_not_ready_unauthorized_actor_and_missing_roles_are_rejected(tmp_path: Path) -> None:
    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    invalid_project, invalid_artifact = create_reviewable_artifact(repository, ready=False)

    with pytest.raises(GateNotReadyError):
        repository.prepare_review_action(
            project_id=invalid_project.id,
            artifact_type="story_bible",
            version_id=invalid_artifact.version.id,
            action="submit",
            action_payload={},
            actor=LOCAL_ACTOR,
            expected_revision=1,
        )

    project, artifact = create_reviewable_artifact(repository)
    with pytest.raises(ReviewInvalidError):
        repository.prepare_review_action(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            action="submit",
            action_payload={},
            actor=UNAUTHORIZED_ACTOR,
            expected_revision=1,
        )

    prepared = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=1,
    )

    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        expected_revision=1,
        challenge_id=prepared.challenge.id,
        confirmation_token=prepared.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": ["writer"]},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        roles=("writer",),
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "签署不完整",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    with pytest.raises(ReviewInvalidError, match="signoffs are incomplete"):
        repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            decision="approved",
            rationale="签署不完整",
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )
    assert repository.get_artifact_head(project.id, "story_bible").accepted_version_id is None


def test_unknown_policy_and_policy_forbidden_self_review_are_rejected(tmp_path: Path) -> None:
    clock = MutableClock()
    database = tmp_path / "workspace.db"
    repository = create_review_repository(database, clock)
    project = repository.create_project(
        name="未知产物",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    unknown = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="unknown_artifact",
        schema_version="1.0.0",
        content={"ready": True},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="未知",
    )
    with pytest.raises(ReviewInvalidError, match="registered Gate policy"):
        repository.prepare_review_action(
            project_id=project.id,
            artifact_type="unknown_artifact",
            version_id=unknown.version.id,
            action="submit",
            action_payload={},
            actor=LOCAL_ACTOR,
            expected_revision=1,
        )

    no_self_review = GatePolicy(
        artifact_type="story_bible",
        gate="G2",
        policy_code="g2.no-self-review",
        policy_version="1",
        readiness_contract_hash="sha256:" + "d" * 64,
        required_roles=("writer", "producer"),
        decision_roles=("producer",),
        submit_roles=("writer",),
        allow_self_review=False,
        allow_multi_role_signoff=False,
        evaluator=lambda _content: {"ready": True, "blocking": []},
    )
    restricted = StudioRepository(
        tmp_path / "restricted.db",
        id_factory=deterministic_id_factory(),
        clock=clock,
        challenge_token_factory=lambda: "restricted-confirmation",
        gate_policies={
            "source_manifest": DEFAULT_GATE_POLICIES["source_manifest"],
            "story_bible": no_self_review,
        },
        allow_gate_policy_override=True,
    )
    restricted_project, restricted_artifact = create_reviewable_artifact(restricted)
    prepared = restricted.prepare_review_action(
        project_id=restricted_project.id,
        artifact_type="story_bible",
        version_id=restricted_artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=1,
    )
    submitted = restricted.submit_artifact_review(
        project_id=restricted_project.id,
        artifact_type="story_bible",
        version_id=restricted_artifact.version.id,
        expected_revision=1,
        challenge_id=prepared.challenge.id,
        confirmation_token=prepared.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    with pytest.raises(ReviewInvalidError, match="forbids self-review"):
        restricted.prepare_review_action(
            project_id=restricted_project.id,
            artifact_type="story_bible",
            version_id=restricted_artifact.version.id,
            action="signoff",
            action_payload={"roles": ["writer"]},
            actor=LOCAL_ACTOR,
            expected_revision=submitted.head.revision,
        )


def test_database_only_allows_first_confirmation_consumption(tmp_path: Path) -> None:
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
        expected_revision=1,
    )

    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE confirmation_challenges SET action = 'decision' WHERE challenge_id = ?",
                (prepared.challenge.id,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="cannot be deleted"):
            connection.execute(
                "DELETE FROM confirmation_challenges WHERE challenge_id = ?",
                (prepared.challenge.id,),
            )

    repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        expected_revision=1,
        challenge_id=prepared.challenge.id,
        confirmation_token=prepared.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE confirmation_challenges SET consumed_at = NULL WHERE challenge_id = ?",
                (prepared.challenge.id,),
            )


def test_database_rejects_cross_artifact_review_ownership(tmp_path: Path) -> None:
    clock = MutableClock()
    database = tmp_path / "workspace.db"
    repository = create_review_repository(database, clock)
    first_project, first_artifact = create_reviewable_artifact(repository)
    second_project, second_artifact = create_reviewable_artifact(repository)

    def submit(project_id: str, version_id: str, revision: int):
        prepared = repository.prepare_review_action(
            project_id=project_id,
            artifact_type="story_bible",
            version_id=version_id,
            action="submit",
            action_payload={},
            actor=LOCAL_ACTOR,
            expected_revision=revision,
        )
        submitted = repository.submit_artifact_review(
            project_id=project_id,
            artifact_type="story_bible",
            version_id=version_id,
            expected_revision=revision,
            challenge_id=prepared.challenge.id,
            confirmation_token=prepared.confirmation_token,
            actor=LOCAL_ACTOR,
        )
        return prepared, submitted

    first_prepared, first_submitted = submit(
        first_project.id, first_artifact.version.id, first_artifact.head.revision
    )
    _, second_submitted = submit(
        second_project.id, second_artifact.version.id, second_artifact.head.revision
    )

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError, match="ownership mismatch"):
            connection.execute(
                """
                INSERT INTO role_signoffs VALUES (
                    'sig_cross', ?, ?, ?, 'G2', 'writer', 'local-user', 1, ?, 1,
                    NULL, '2026-08-03T12:00:00Z'
                )
                """,
                (
                    second_artifact.version.artifact_id,
                    second_artifact.version.id,
                    first_submitted.submission.id,
                    first_prepared.report.id,
                ),
            )
        connection.rollback()

        with pytest.raises(sqlite3.IntegrityError, match="ownership mismatch"):
            connection.execute(
                "UPDATE artifact_heads SET review_submission_id = ? WHERE artifact_id = ?",
                (
                    first_submitted.submission.id,
                    second_artifact.version.artifact_id,
                ),
            )
        connection.rollback()
    assert second_submitted.head.review_submission_id is not None


def test_review_failure_injection_rolls_back_challenge_rows_and_heads(tmp_path: Path) -> None:
    clock = MutableClock()
    failure: list[tuple[str, str] | None] = [None]

    def fail_at_step(operation: str, step: str) -> None:
        if failure[0] == (operation, step):
            raise RuntimeError(f"injected {operation}:{step}")

    repository = StudioRepository(
        tmp_path / "workspace.db",
        id_factory=deterministic_id_factory(),
        clock=clock,
        challenge_token_factory=lambda: "failure-injection-confirmation",
        transaction_hook=fail_at_step,
    )
    project, artifact = create_reviewable_artifact(repository)
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=1,
    )
    failure[0] = ("submit_review", "challenge_consumed")
    with pytest.raises(RuntimeError, match="injected submit_review"):
        repository.submit_artifact_review(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            expected_revision=1,
            challenge_id=prepared_submit.challenge.id,
            confirmation_token=prepared_submit.confirmation_token,
            actor=LOCAL_ACTOR,
        )
    assert repository.get_artifact_head(project.id, "story_bible").revision == 1

    failure[0] = None
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        expected_revision=1,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": ["writer", "continuity_reviewer", "producer"]},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    failure[0] = ("signoff_review", "signoff_2")
    with pytest.raises(RuntimeError, match="injected signoff_review"):
        repository.signoff_artifact_review(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            roles=("writer", "continuity_reviewer", "producer"),
            expected_revision=submitted.head.revision,
            challenge_id=prepared_signoff.challenge.id,
            confirmation_token=prepared_signoff.confirmation_token,
            actor=LOCAL_ACTOR,
        )
    assert repository.get_artifact_head(project.id, "story_bible").revision == 2

    failure[0] = None
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        roles=("writer", "continuity_reviewer", "producer"),
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "故障注入后可重试",
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    failure[0] = ("decide_gate", "decision_inserted")
    with pytest.raises(RuntimeError, match="injected decide_gate"):
        repository.decide_artifact_gate(
            project_id=project.id,
            artifact_type="story_bible",
            version_id=artifact.version.id,
            decision="approved",
            rationale="故障注入后可重试",
            expected_revision=signed.head.revision,
            challenge_id=prepared_decision.challenge.id,
            confirmation_token=prepared_decision.confirmation_token,
            actor=LOCAL_ACTOR,
            actor_role="producer",
        )
    head = repository.get_artifact_head(project.id, "story_bible")
    assert head.revision == signed.head.revision
    assert head.accepted_version_id is None

    failure[0] = None
    approved = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=artifact.version.id,
        decision="approved",
        rationale="故障注入后可重试",
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    assert approved.head.accepted_version_id == artifact.version.id
