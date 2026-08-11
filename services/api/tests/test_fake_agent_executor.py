import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from multiprocessing import active_children
from pathlib import Path
from threading import Event
from time import monotonic, sleep

import pytest
from aijian_api.agent_skill_contracts import (
    AgentSkillFixtureBundleV1,
    ArtifactProposalV1,
    AttemptSnapshotV1,
    BudgetPolicyV1,
    DefinitionRefV1,
    ProposalCostV1,
    ProposalQcV1,
    canonical_sha256,
)
from aijian_api.agent_skill_registry import (
    AgentRegistration,
    AgentSkillRegistry,
    ResolvedDelegation,
    SkillRegistration,
)
from aijian_api.artifact_proposal_store import (
    ArtifactProposalConflictError,
    ArtifactProposalStore,
)
from aijian_api.fake_agent_executor import (
    FakeAgentSkillExecutor,
    FakeSkillExecutionError,
    FakeSkillTimeoutError,
)
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import ClaimedTask, LeaseLostError, LocalTaskLedger

NOW = datetime(2026, 8, 10, 11, 0, tzinfo=UTC)
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


def fixture_bundle() -> AgentSkillFixtureBundleV1:
    return AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))


def resolved_delegation(
    *,
    hard_limit_micros: int,
    retry_increment_limit_micros: int,
    agent_version: str | None = None,
) -> ResolvedDelegation:
    bundle = fixture_bundle()
    agent = bundle.agent_definition.model_copy(
        update={"version": agent_version or bundle.agent_definition.version}
    )
    skill = bundle.skill_definition.model_copy(
        update={
            "budget": BudgetPolicyV1(
                soft_limit_micros=0,
                hard_limit_micros=hard_limit_micros,
                retry_increment_limit_micros=retry_increment_limit_micros,
            )
        }
    )
    registry = AgentSkillRegistry(
        agents=(AgentRegistration(agent),),
        skills=(SkillRegistration(skill),),
    )
    return registry.resolve_delegation(
        DefinitionRefV1(
            definition_id=agent.agent_definition_id,
            version=agent.version,
        ),
        DefinitionRefV1(
            definition_id=skill.skill_definition_id,
            version=skill.version,
        ),
    )


def valid_fake_skill(snapshot: AttemptSnapshotV1, _invocation: int) -> ArtifactProposalV1:
    return fixture_bundle().artifact_proposal.model_copy(update={"project_id": snapshot.project_id})


def invalid_fake_skill(snapshot: AttemptSnapshotV1, invocation: int) -> ArtifactProposalV1:
    return valid_fake_skill(snapshot, invocation).model_copy(
        update={"target_artifact_type": "Screenplay"}
    )


def permanently_blocked_fake_skill(
    _snapshot: AttemptSnapshotV1,
    _invocation: int,
) -> ArtifactProposalV1:
    while True:
        sleep(1)


def marker_blocked_fake_skill(
    _snapshot: AttemptSnapshotV1,
    _invocation: int,
) -> ArtifactProposalV1:
    marker = os.environ["AIJIAN_FAKE_HANDLER_MARKER"]
    Path(marker).write_text("started", encoding="utf-8")
    while True:
        sleep(1)


def hard_crash_fake_skill(_snapshot: AttemptSnapshotV1, _invocation: int) -> ArtifactProposalV1:
    os._exit(17)


def qc_retry_then_pass(snapshot: AttemptSnapshotV1, invocation: int) -> ArtifactProposalV1:
    proposal = valid_fake_skill(snapshot, invocation)
    if invocation == 0:
        return proposal.model_copy(
            update={
                "cost": ProposalCostV1(estimated_micros=2, actual_micros=2),
                "qc": (
                    ProposalQcV1(
                        check_id="source-span.required",
                        status="FAIL",
                        details="first invocation failed",
                    ),
                ),
            }
        )
    return proposal.model_copy(update={"cost": ProposalCostV1(estimated_micros=3, actual_micros=3)})


def qc_always_fails(snapshot: AttemptSnapshotV1, invocation: int) -> ArtifactProposalV1:
    proposal = valid_fake_skill(snapshot, invocation)
    return proposal.model_copy(
        update={
            "cost": ProposalCostV1(estimated_micros=1, actual_micros=1),
            "qc": (
                ProposalQcV1(
                    check_id="source-span.required",
                    status="FAIL",
                    details=f"failed invocation {invocation}",
                ),
            ),
        }
    )


def qc_retry_is_too_expensive(snapshot: AttemptSnapshotV1, invocation: int) -> ArtifactProposalV1:
    proposal = valid_fake_skill(snapshot, invocation)
    return proposal.model_copy(
        update={
            "cost": ProposalCostV1(estimated_micros=5, actual_micros=1),
            "qc": (
                ProposalQcV1(
                    check_id="source-span.required",
                    status="FAIL",
                    details=f"budget blocked invocation {invocation}",
                ),
            ),
        }
    )


def qc_retry_exceeds_returned_budget(
    snapshot: AttemptSnapshotV1, invocation: int
) -> ArtifactProposalV1:
    proposal = valid_fake_skill(snapshot, invocation)
    if invocation == 0:
        return proposal.model_copy(
            update={
                "cost": ProposalCostV1(estimated_micros=1, actual_micros=1),
                "qc": (
                    ProposalQcV1(
                        check_id="source-span.required",
                        status="FAIL",
                        details="retry requested",
                    ),
                ),
            }
        )
    return proposal.model_copy(
        update={"cost": ProposalCostV1(estimated_micros=20, actual_micros=20)}
    )


def qc_retry_then_blocks(snapshot: AttemptSnapshotV1, invocation: int) -> ArtifactProposalV1:
    if invocation == 0:
        return qc_always_fails(snapshot, invocation)
    while True:
        sleep(1)


def setup_fake_task(
    tmp_path: Path,
    *,
    max_attempts: int = 2,
) -> tuple[Path, str, list[datetime], LocalTaskLedger, ArtifactProposalV1, str]:
    database = tmp_path / "workspace.db"
    project_id = (
        StudioRepository(database)
        .create_project(
            name="Fake Agent 纵切",
            aspect_ratio="9:16",
            target_duration_seconds=15,
            source_language="zh-CN",
        )
        .id
    )
    bundle = fixture_bundle()
    fields = bundle.attempt.model_dump(mode="json")
    fields["project_id"] = project_id
    fingerprint_payload = {
        key: value
        for key, value in fields.items()
        if key not in {"schema_version", "attempt_id", "attempt_fingerprint"}
    }
    fields["attempt_fingerprint"] = canonical_sha256(fingerprint_payload)
    snapshot = AttemptSnapshotV1.model_validate(fields)
    context_payload = bundle.context_manifest.model_dump(mode="json")
    context_payload["project_id"] = project_id
    context_payload["manifest_hash"] = canonical_sha256(
        {
            "project_id": project_id,
            "agent_definition": context_payload["agent_definition"],
            "skill_definition": context_payload["skill_definition"],
            "entries": context_payload["entries"],
            "total_byte_count": context_payload["total_byte_count"],
        }
    )
    now_text = NOW.isoformat().replace("+00:00", "Z")
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            INSERT INTO agent_runs VALUES (?, ?, ?, ?, 'PENDING', ?, 1, ?, ?)
            """,
            (
                snapshot.agent_run_id,
                project_id,
                snapshot.agent_definition_id,
                snapshot.agent_version,
                json.dumps([snapshot.skill_run_id], separators=(",", ":")),
                now_text,
                now_text,
            ),
        )
        connection.execute(
            """
            INSERT INTO agent_context_manifests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                bundle.context_manifest.context_manifest_id,
                project_id,
                snapshot.agent_definition_id,
                snapshot.agent_version,
                snapshot.skill_definition_id,
                snapshot.skill_version,
                json.dumps(
                    context_payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                context_payload["manifest_hash"],
                now_text,
            ),
        )
        connection.execute(
            """
            INSERT INTO skill_runs VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, 1, ?, ?)
            """,
            (
                snapshot.skill_run_id,
                project_id,
                snapshot.agent_run_id,
                snapshot.skill_definition_id,
                snapshot.skill_version,
                bundle.context_manifest.context_manifest_id,
                now_text,
                now_text,
            ),
        )
    clock = [NOW]
    ledger = LocalTaskLedger(database, clock=lambda: clock[0])
    queued = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="agent-skill-fake-runtime",
        definition_version=1,
        definition_hash=snapshot.input_hash,
        graph={"nodes": [snapshot.skill_definition_id]},
        workflow_input_hash=snapshot.input_hash,
        node_key=snapshot.skill_definition_id,
        node_type="agent.skill.fake",
        contract_version=1,
        input_bindings={"context_manifest_id": bundle.context_manifest.context_manifest_id},
        node_input_hash=snapshot.input_hash,
        request_fingerprint=snapshot.attempt_fingerprint,
        idempotency_key=snapshot.idempotency_key,
        max_attempts=max_attempts,
        task_kind="local.agent-skill.fake",
        priority=80,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot.model_dump(mode="json", exclude={"attempt_id"}),
    )
    proposal = bundle.artifact_proposal.model_copy(update={"project_id": project_id})
    return database, project_id, clock, ledger, proposal, queued.task_id


def test_fake_executor_persists_proposal_and_enters_human_review_without_draft(
    tmp_path: Path,
) -> None:
    database, _, clock, ledger, proposal, task_id = setup_fake_task(tmp_path)

    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="fake-agent-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=valid_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )

    assert executor.run_once(task_id=task_id)
    assert not executor.run_once(task_id=task_id)
    persisted = ArtifactProposalStore(database).get(proposal.project_id, proposal.proposal_id)
    assert persisted.proposal == proposal

    with sqlite3.connect(database) as connection:
        attempt = connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
            (persisted.producer_attempt_id,),
        ).fetchone()
        node = connection.execute(
            "SELECT status, output_version_id FROM workflow_node_runs"
        ).fetchone()
        task = connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (task_id,)
        ).fetchone()
        artifact_versions = connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone()
        events = connection.execute(
            "SELECT entity_kind, to_status, reason_code FROM workflow_transition_events "
            "WHERE reason_code = 'proposal.ready' ORDER BY entity_kind"
        ).fetchall()
    assert attempt == ("RUNNING", None)
    assert node == ("NEEDS_REVIEW", None)
    assert task == ("COMPLETED",)
    assert artifact_versions == (0,)
    assert events == [
        ("node", "NEEDS_REVIEW", "proposal.ready"),
        ("task", "COMPLETED", "proposal.ready"),
    ]


def test_invalid_fake_proposal_leaves_leased_state_for_crash_recovery(tmp_path: Path) -> None:
    database, _, clock, ledger, proposal, task_id = setup_fake_task(tmp_path)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="fake-agent-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=invalid_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )

    with pytest.raises(ArtifactProposalConflictError, match="frozen attempt"):
        executor.run_once(task_id=task_id)

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("LEASED",)
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == ("RUNNING",)
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "RUNNING",
        )
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
    clock[0] = NOW + timedelta(seconds=31)
    assert ledger.recover_expired_local_tasks().requeued == 1


def test_recovery_preserves_existing_proposal_and_enters_review(
    tmp_path: Path,
) -> None:
    database, _, clock, ledger, proposal, _ = setup_fake_task(tmp_path)
    first_claim = ledger.claim_ready_task(
        worker_id="crashed-worker", lease_duration=timedelta(seconds=30)
    )
    assert first_claim is not None
    first_running = ledger.mark_attempt_running(first_claim)
    first = ArtifactProposalStore(database, clock=lambda: clock[0]).persist(first_running, proposal)
    clock[0] = NOW + timedelta(seconds=31)
    summary = ledger.recover_expired_local_tasks()

    assert (summary.recovered, summary.requeued, summary.failed) == (1, 0, 0)
    assert ArtifactProposalStore(database).get(proposal.project_id, proposal.proposal_id) == first
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            1,
        )
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "NEEDS_REVIEW",
        )
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)


@pytest.mark.parametrize("operation", ("mark", "heartbeat"))
def test_lease_operations_fail_if_lock_wait_crosses_expiry(
    tmp_path: Path,
    operation: str,
) -> None:
    database, _, clock, ledger, _, _ = setup_fake_task(tmp_path)
    claim = ledger.claim_ready_task(worker_id="worker", lease_duration=timedelta(seconds=30))
    assert claim is not None
    opened = Event()

    class ObservableLedger(LocalTaskLedger):
        def _open(self) -> sqlite3.Connection:
            connection = super()._open()
            opened.set()
            return connection

    observable = ObservableLedger(database, clock=lambda: clock[0])
    blocker = sqlite3.connect(database, timeout=5, isolation_level=None)
    blocker.execute("BEGIN IMMEDIATE")
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            if operation == "mark":
                future = executor.submit(observable.mark_attempt_running, claim)
            else:
                future = executor.submit(
                    observable.heartbeat,
                    claim,
                    lease_duration=timedelta(seconds=30),
                )
            assert opened.wait(timeout=2)
            clock[0] = NOW + timedelta(seconds=31)
            blocker.commit()
            with pytest.raises(LeaseLostError, match="stale or expired"):
                future.result(timeout=5)
    finally:
        blocker.close()


def test_recovery_uses_persisted_proposal_without_creating_a_second_attempt(
    tmp_path: Path,
) -> None:
    database, _, clock, ledger, proposal, _ = setup_fake_task(tmp_path)
    first_claim = ledger.claim_ready_task(
        worker_id="crashed-worker", lease_duration=timedelta(seconds=30)
    )
    assert first_claim is not None
    first_running = ledger.mark_attempt_running(first_claim)
    ArtifactProposalStore(database, clock=lambda: clock[0]).persist(first_running, proposal)
    clock[0] = NOW + timedelta(seconds=31)
    summary = ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        attempts = connection.execute("SELECT attempt_id, status FROM workflow_attempts").fetchall()
        node = connection.execute("SELECT status FROM workflow_node_runs").fetchone()
        task = connection.execute("SELECT status FROM task_ledger").fetchone()
        agent = connection.execute("SELECT status FROM agent_runs").fetchone()
        skill = connection.execute("SELECT status, proposal_id FROM skill_runs").fetchone()
        events = connection.execute(
            "SELECT entity_kind, reason_code FROM workflow_transition_events "
            "WHERE reason_code = 'proposal.ready_recovered' ORDER BY entity_kind"
        ).fetchall()
    assert (summary.recovered, summary.requeued, summary.failed) == (1, 0, 0)
    assert attempts == [(first_running.attempt_id, "RUNNING")]
    assert node == ("NEEDS_REVIEW",)
    assert task == ("COMPLETED",)
    assert agent == ("NEEDS_REVIEW",)
    assert skill == ("NEEDS_REVIEW", proposal.proposal_id)
    assert events == [
        ("node", "proposal.ready_recovered"),
        ("task", "proposal.ready_recovered"),
    ]


def test_exhausted_recovery_fails_pending_agent_and_skill_runs(tmp_path: Path) -> None:
    database, _, clock, ledger, _, _ = setup_fake_task(tmp_path, max_attempts=1)
    assert ledger.claim_ready_task(
        worker_id="crashed-before-start", lease_duration=timedelta(seconds=30)
    )
    clock[0] = NOW + timedelta(seconds=31)

    summary = ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        node = connection.execute("SELECT status FROM workflow_node_runs").fetchone()
        agent = connection.execute("SELECT status FROM agent_runs").fetchone()
        skill = connection.execute("SELECT status FROM skill_runs").fetchone()
    assert (summary.recovered, summary.failed, summary.requeued) == (1, 1, 0)
    assert node == ("FAILED",)
    assert agent == ("FAILED",)
    assert skill == ("FAILED",)


def test_handler_timeout_returns_without_waiting_and_never_persists_late_result(
    tmp_path: Path,
) -> None:
    database, _, clock, ledger, _, task_id = setup_fake_task(tmp_path)

    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="timeout-worker",
        lease_duration=timedelta(seconds=30),
        heartbeat_interval=timedelta(milliseconds=20),
        handler_timeout=timedelta(milliseconds=80),
        handler=permanently_blocked_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )
    started = monotonic()
    with pytest.raises(FakeSkillTimeoutError, match="timed out"):
        executor.run_once(task_id=task_id)
    assert monotonic() - started < 1.0
    assert not any(child.name == "aijian-fake-agent" for child in active_children())

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("LEASED",)
    clock[0] = NOW + timedelta(seconds=31)
    assert ledger.recover_expired_local_tasks().requeued == 1


def test_hard_crashed_process_is_normalized_and_cannot_persist(tmp_path: Path) -> None:
    database, _, clock, ledger, _, task_id = setup_fake_task(tmp_path)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="hard-crash-worker",
        lease_duration=timedelta(seconds=30),
        heartbeat_interval=timedelta(milliseconds=20),
        handler_timeout=timedelta(seconds=2),
        handler=hard_crash_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )

    with pytest.raises(FakeSkillExecutionError, match="without a result"):
        executor.run_once(task_id=task_id)

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
    assert not any(child.name == "aijian-fake-agent" for child in active_children())


def test_database_lock_cannot_extend_heartbeat_beyond_handler_deadline(tmp_path: Path) -> None:
    database, _, clock, ledger, _, task_id = setup_fake_task(tmp_path)
    marker = tmp_path / "handler-started.txt"
    previous_marker = os.environ.get("AIJIAN_FAKE_HANDLER_MARKER")
    os.environ["AIJIAN_FAKE_HANDLER_MARKER"] = str(marker)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="db-lock-worker",
        lease_duration=timedelta(seconds=30),
        heartbeat_interval=timedelta(milliseconds=100),
        handler_timeout=timedelta(seconds=2),
        handler=marker_blocked_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            execution = pool.submit(executor.run_once, task_id=task_id)
            marker_deadline = monotonic() + 3
            while not marker.exists() and monotonic() < marker_deadline:
                sleep(0.01)
            assert marker.exists()
            blocker = sqlite3.connect(database, timeout=5, isolation_level=None)
            blocker.execute("BEGIN IMMEDIATE")
            locked_at = monotonic()
            try:
                with pytest.raises(LeaseLostError, match="deadline"):
                    execution.result(timeout=3)
                assert monotonic() - locked_at < 2.5
            finally:
                blocker.rollback()
                blocker.close()
    finally:
        if previous_marker is None:
            os.environ.pop("AIJIAN_FAKE_HANDLER_MARKER", None)
        else:
            os.environ["AIJIAN_FAKE_HANDLER_MARKER"] = previous_marker
    assert not any(child.name == "aijian-fake-agent" for child in active_children())


def test_heartbeat_lease_loss_does_not_wait_for_or_persist_handler_result(
    tmp_path: Path,
) -> None:
    database, _, clock, _, _, task_id = setup_fake_task(tmp_path)

    class LeaseLosingLedger(LocalTaskLedger):
        def heartbeat(
            self,
            claim: ClaimedTask,
            *,
            lease_duration: timedelta,
            lock_timeout: timedelta | None = None,
        ) -> ClaimedTask:
            raise LeaseLostError("injected lease loss")

    ledger = LeaseLosingLedger(database, clock=lambda: clock[0])

    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="lease-loss-worker",
        lease_duration=timedelta(seconds=30),
        heartbeat_interval=timedelta(milliseconds=20),
        handler_timeout=timedelta(seconds=1),
        handler=permanently_blocked_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )
    started = monotonic()
    with pytest.raises(LeaseLostError, match="injected lease loss"):
        executor.run_once(task_id=task_id)
    assert monotonic() - started < 1.0

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )


def test_ready_fake_workflow_can_be_cancelled_idempotently_before_claim(tmp_path: Path) -> None:
    database, project_id, _, ledger, _, task_id = setup_fake_task(tmp_path)
    with sqlite3.connect(database) as connection:
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )

    cancelled = ledger.cancel_local_workflow(
        project_id=project_id,
        workflow_run_id=workflow_run_id,
        actor_id="local-user",
    )
    replay = ledger.cancel_local_workflow(
        project_id=project_id,
        workflow_run_id=workflow_run_id,
        actor_id="local-user",
    )

    assert (cancelled.cancelled_tasks, cancelled.cancelled_attempts, cancelled.cancelled_nodes) == (
        1,
        1,
        1,
    )
    assert replay.already_cancelled
    assert not FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database),
        worker_id="cancelled-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=valid_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    ).run_once(task_id=task_id)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_runs").fetchone() == ("CANCELLED",)
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "CANCELLED",
        )
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "CANCELLED",
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("CANCELLED",)


def test_running_fake_process_is_killed_by_cancellation_and_cannot_write_late_result(
    tmp_path: Path,
) -> None:
    database, project_id, clock, ledger, _, task_id = setup_fake_task(tmp_path)
    marker = tmp_path / "cancel-handler-started.txt"
    previous_marker = os.environ.get("AIJIAN_FAKE_HANDLER_MARKER")
    os.environ["AIJIAN_FAKE_HANDLER_MARKER"] = str(marker)
    with sqlite3.connect(database) as connection:
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="cancel-running-worker",
        lease_duration=timedelta(seconds=30),
        heartbeat_interval=timedelta(milliseconds=50),
        handler_timeout=timedelta(seconds=5),
        handler=marker_blocked_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            execution = pool.submit(executor.run_once, task_id=task_id)
            marker_deadline = monotonic() + 3
            while not marker.exists() and monotonic() < marker_deadline:
                sleep(0.01)
            assert marker.exists()
            ledger.cancel_local_workflow(
                project_id=project_id,
                workflow_run_id=workflow_run_id,
                actor_id="local-user",
            )
            with pytest.raises(LeaseLostError, match="stale or expired"):
                execution.result(timeout=2)
    finally:
        if previous_marker is None:
            os.environ.pop("AIJIAN_FAKE_HANDLER_MARKER", None)
        else:
            os.environ["AIJIAN_FAKE_HANDLER_MARKER"] = previous_marker
    assert not any(child.name == "aijian-fake-agent" for child in active_children())
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        events = connection.execute(
            "SELECT entity_kind, to_status, actor_kind, actor_id FROM workflow_transition_events "
            "WHERE reason_code = 'cancellation.requested' ORDER BY entity_kind"
        ).fetchall()
    assert events == [
        ("attempt", "CANCELLED", "human", "local-user"),
        ("node", "CANCELLED", "human", "local-user"),
        ("task", "CANCELLED", "human", "local-user"),
    ]


def test_proposal_review_can_be_cancelled_without_deleting_immutable_proposal(
    tmp_path: Path,
) -> None:
    database, project_id, clock, ledger, proposal, task_id = setup_fake_task(tmp_path)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="review-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=valid_fake_skill,
        delegation=resolved_delegation(hard_limit_micros=0, retry_increment_limit_micros=0),
    )
    assert executor.run_once(task_id=task_id)
    with sqlite3.connect(database) as connection:
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )

    cancelled = ledger.cancel_local_workflow(
        project_id=project_id,
        workflow_run_id=workflow_run_id,
        actor_id="local-user",
    )

    assert (cancelled.cancelled_tasks, cancelled.cancelled_attempts, cancelled.cancelled_nodes) == (
        0,
        1,
        1,
    )
    persisted = ArtifactProposalStore(database).get(project_id, proposal.proposal_id)
    assert persisted.proposal == proposal


def test_cancellation_rejects_project_mismatch_and_empty_actor_without_writes(
    tmp_path: Path,
) -> None:
    database, _, _, ledger, _, _ = setup_fake_task(tmp_path)
    with sqlite3.connect(database) as connection:
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )
        before = (
            connection.execute("SELECT status, cancel_requested_at FROM workflow_runs").fetchone(),
            connection.execute("SELECT status FROM workflow_node_runs").fetchone(),
            connection.execute("SELECT status FROM workflow_attempts").fetchone(),
            connection.execute("SELECT status FROM task_ledger").fetchone(),
            connection.execute("SELECT COUNT(*) FROM workflow_transition_events").fetchone(),
        )

    with pytest.raises(LookupError, match="not found"):
        ledger.cancel_local_workflow(
            project_id="prj_" + "f" * 32,
            workflow_run_id=workflow_run_id,
            actor_id="local-user",
        )
    with pytest.raises(ValueError, match="actor"):
        ledger.cancel_local_workflow(
            project_id=str(fixture_bundle().attempt.project_id),
            workflow_run_id=workflow_run_id,
            actor_id="",
        )

    with sqlite3.connect(database) as connection:
        after = (
            connection.execute("SELECT status, cancel_requested_at FROM workflow_runs").fetchone(),
            connection.execute("SELECT status FROM workflow_node_runs").fetchone(),
            connection.execute("SELECT status FROM workflow_attempts").fetchone(),
            connection.execute("SELECT status FROM task_ledger").fetchone(),
            connection.execute("SELECT COUNT(*) FROM workflow_transition_events").fetchone(),
        )
    assert after == before


@pytest.mark.parametrize(
    ("remote_status", "retry_disposition"),
    (("REMOTE_UNKNOWN", "REMOTE_UNKNOWN"), ("CANCEL_REQUESTED", None)),
)
def test_active_remote_attempt_blocks_local_cancellation_without_partial_state(
    tmp_path: Path,
    remote_status: str,
    retry_disposition: str | None,
) -> None:
    database, project_id, _, ledger, _, _ = setup_fake_task(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )
        now = NOW.isoformat()
        connection.execute(
            """
            INSERT INTO workflow_node_runs (
                node_run_id, workflow_run_id, node_key, node_type, contract_version,
                input_bindings_json, input_hash, idempotency_key, status, attempt_count,
                max_attempts, revision, created_at, updated_at
            ) VALUES (?, ?, 'remote.node', 'remote.provider', 1, '{}', ?, ?,
                      'RECONCILIATION_REQUIRED', 1, 1, 1, ?, ?)
            """,
            ("node_" + "e" * 32, workflow_run_id, f"sha256:{'e' * 64}", "remote:idem", now, now),
        )
        connection.execute(
            """
            INSERT INTO workflow_attempts (
                attempt_id, node_run_id, attempt_number, execution_mode, status,
                input_hash, request_fingerprint, retry_disposition,
                revision, created_at, updated_at
            ) VALUES (?, ?, 1, 'remote', ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                "att_" + "e" * 32,
                "node_" + "e" * 32,
                remote_status,
                f"sha256:{'e' * 64}",
                f"sha256:{'d' * 64}",
                retry_disposition,
                now,
                now,
            ),
        )
        before_events = connection.execute(
            "SELECT COUNT(*) FROM workflow_transition_events"
        ).fetchone()

    with pytest.raises(ValueError, match="remote"):
        ledger.cancel_local_workflow(
            project_id=project_id,
            workflow_run_id=workflow_run_id,
            actor_id="local-user",
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_runs").fetchone() == ("ACTIVE",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE execution_mode = 'local'"
        ).fetchone() == ("READY",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE execution_mode = 'remote'"
        ).fetchone() == (remote_status,)
        assert connection.execute("SELECT COUNT(*) FROM workflow_transition_events").fetchone() == (
            before_events
        )


def test_terminal_or_empty_active_workflow_is_not_mislabelled_cancelled(tmp_path: Path) -> None:
    terminal_path = tmp_path / "terminal"
    terminal_path.mkdir()
    terminal_db, terminal_project, _, terminal_ledger, _, _ = setup_fake_task(terminal_path)
    with sqlite3.connect(terminal_db) as connection:
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )
        connection.execute("UPDATE workflow_runs SET status = 'SUCCEEDED'")
    with pytest.raises(ValueError, match="not cancellable"):
        terminal_ledger.cancel_local_workflow(
            project_id=terminal_project,
            workflow_run_id=workflow_run_id,
            actor_id="local-user",
        )

    empty_path = tmp_path / "empty"
    empty_path.mkdir()
    empty_db, empty_project, _, empty_ledger, _, _ = setup_fake_task(empty_path)
    with sqlite3.connect(empty_db) as connection:
        empty_run = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )
        connection.execute("UPDATE task_ledger SET status = 'COMPLETED'")
        connection.execute(
            "UPDATE workflow_attempts SET status = 'FAILED', retry_disposition = 'NON_RETRYABLE'"
        )
        connection.execute("UPDATE workflow_node_runs SET status = 'SUCCEEDED'")
    with pytest.raises(ValueError, match="no cancellable"):
        empty_ledger.cancel_local_workflow(
            project_id=empty_project,
            workflow_run_id=empty_run,
            actor_id="local-user",
        )
    with sqlite3.connect(empty_db) as connection:
        assert connection.execute("SELECT status FROM workflow_runs").fetchone() == ("ACTIVE",)


def test_multinode_cancellation_counts_only_active_local_work_and_preserves_terminal_node(
    tmp_path: Path,
) -> None:
    database, project_id, _, ledger, _, _ = setup_fake_task(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )
        now = NOW.isoformat()
        connection.execute(
            """
            INSERT INTO workflow_node_runs (
                node_run_id, workflow_run_id, node_key, node_type, contract_version,
                input_bindings_json, input_hash, idempotency_key, status, attempt_count,
                max_attempts, revision, created_at, updated_at
            ) VALUES (?, ?, 'second.local', 'agent.skill.fake', 1, '{}', ?, ?,
                      'PENDING', 0, 1, 1, ?, ?)
            """,
            ("node_" + "c" * 32, workflow_run_id, f"sha256:{'c' * 64}", "second:idem", now, now),
        )
        connection.execute(
            """
            INSERT INTO workflow_attempts (
                attempt_id, node_run_id, attempt_number, execution_mode, status,
                input_hash, request_fingerprint, revision, created_at, updated_at
            ) VALUES (?, ?, 1, 'local', 'READY', ?, ?, 1, ?, ?)
            """,
            (
                "att_" + "c" * 32,
                "node_" + "c" * 32,
                f"sha256:{'c' * 64}",
                f"sha256:{'b' * 64}",
                now,
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO task_ledger (
                task_id, attempt_id, task_kind, status, priority, available_at,
                lease_generation, revision, created_at, updated_at
            ) VALUES (?, ?, 'local.agent-skill.fake', 'READY', 70, ?, 0, 1, ?, ?)
            """,
            ("task_" + "c" * 32, "att_" + "c" * 32, now, now, now),
        )
        connection.execute(
            """
            INSERT INTO workflow_node_runs (
                node_run_id, workflow_run_id, node_key, node_type, contract_version,
                input_bindings_json, input_hash, idempotency_key, status, attempt_count,
                max_attempts, revision, created_at, updated_at
            ) VALUES (?, ?, 'done.local', 'local.done', 1, '{}', ?, ?,
                      'SUCCEEDED', 0, 1, 1, ?, ?)
            """,
            ("node_" + "d" * 32, workflow_run_id, f"sha256:{'d' * 64}", "done:idem", now, now),
        )

    result = ledger.cancel_local_workflow(
        project_id=project_id,
        workflow_run_id=workflow_run_id,
        actor_id="local-user",
    )

    assert (result.cancelled_tasks, result.cancelled_attempts, result.cancelled_nodes) == (2, 2, 2)
    with sqlite3.connect(database) as connection:
        statuses = connection.execute(
            "SELECT node_key, status FROM workflow_node_runs ORDER BY node_key"
        ).fetchall()
        cancellation_events = connection.execute(
            "SELECT entity_kind, COUNT(*) FROM workflow_transition_events "
            "WHERE reason_code = 'cancellation.requested' GROUP BY entity_kind "
            "ORDER BY entity_kind"
        ).fetchall()
    assert statuses == [
        ("done.local", "SUCCEEDED"),
        ("second.local", "CANCELLED"),
        ("source.extract", "CANCELLED"),
    ]
    assert cancellation_events == [("attempt", 2), ("node", 2), ("task", 2)]


def test_cancellation_rolls_back_all_state_if_event_creation_fails(tmp_path: Path) -> None:
    database, project_id, _, _, _, _ = setup_fake_task(tmp_path)
    with sqlite3.connect(database) as connection:
        workflow_run_id = str(
            connection.execute("SELECT workflow_run_id FROM workflow_runs").fetchone()[0]
        )
        before_events = connection.execute(
            "SELECT COUNT(*) FROM workflow_transition_events"
        ).fetchone()
    calls = 0

    def failing_id_factory(prefix: str) -> str:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("injected cancellation event failure")
        return f"{prefix}_{calls:032x}"

    ledger = LocalTaskLedger(database, clock=lambda: NOW, id_factory=failing_id_factory)
    with pytest.raises(RuntimeError, match="event failure"):
        ledger.cancel_local_workflow(
            project_id=project_id,
            workflow_run_id=workflow_run_id,
            actor_id="local-user",
        )

    with sqlite3.connect(database) as connection:
        run = connection.execute("SELECT status, cancel_requested_at FROM workflow_runs").fetchone()
        assert run == (
            "ACTIVE",
            None,
        )
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "PENDING",
        )
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == ("READY",)
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("READY",)
        assert connection.execute("SELECT COUNT(*) FROM workflow_transition_events").fetchone() == (
            before_events
        )


def test_qc_failure_retries_once_within_frozen_skill_budget_then_persists_pass(
    tmp_path: Path,
) -> None:
    database, project_id, clock, ledger, proposal, task_id = setup_fake_task(tmp_path)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="qc-retry-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=qc_retry_then_pass,
        delegation=resolved_delegation(hard_limit_micros=10, retry_increment_limit_micros=5),
    )

    assert executor.run_once(task_id=task_id)

    persisted = ArtifactProposalStore(database).get(project_id, proposal.proposal_id).proposal
    assert all(check.status == "PASS" for check in persisted.qc)
    assert (persisted.cost.estimated_micros, persisted.cost.actual_micros) == (5, 5)


def test_second_qc_failure_is_persisted_for_human_escalation_without_third_try(
    tmp_path: Path,
) -> None:
    database, project_id, clock, ledger, proposal, task_id = setup_fake_task(tmp_path)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="qc-fail-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=qc_always_fails,
        delegation=resolved_delegation(hard_limit_micros=10, retry_increment_limit_micros=5),
    )

    assert executor.run_once(task_id=task_id)

    persisted = ArtifactProposalStore(database).get(project_id, proposal.proposal_id).proposal
    assert persisted.qc[0].status == "FAIL"
    assert persisted.qc[0].details == "failed invocation 1"
    assert persisted.cost.actual_micros == 2
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "NEEDS_REVIEW",
        )


def test_qc_retry_is_skipped_when_frozen_increment_budget_is_insufficient(
    tmp_path: Path,
) -> None:
    database, project_id, clock, ledger, proposal, task_id = setup_fake_task(tmp_path)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="qc-budget-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=qc_retry_is_too_expensive,
        delegation=resolved_delegation(hard_limit_micros=10, retry_increment_limit_micros=0),
    )

    assert executor.run_once(task_id=task_id)

    persisted = ArtifactProposalStore(database).get(project_id, proposal.proposal_id).proposal
    assert persisted.qc[0].details == "budget blocked invocation 0"
    assert persisted.cost.actual_micros == 1


def test_retry_cost_over_frozen_increment_and_hard_limit_escalates_for_review(
    tmp_path: Path,
) -> None:
    database, project_id, clock, ledger, proposal, task_id = setup_fake_task(tmp_path)
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="qc-over-budget-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=qc_retry_exceeds_returned_budget,
        delegation=resolved_delegation(hard_limit_micros=10, retry_increment_limit_micros=5),
    )

    assert executor.run_once(task_id=task_id)

    persisted = ArtifactProposalStore(database).get(project_id, proposal.proposal_id).proposal
    failed_checks = {check.check_id for check in persisted.qc if check.status == "FAIL"}
    assert failed_checks == {"budget.retry-increment", "budget.hard-limit"}
    assert persisted.cost.actual_micros == 21


def test_definition_version_mismatch_fails_before_starting_handler(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, _, clock, ledger, _, task_id = setup_fake_task(tmp_path)
    marker = tmp_path / "handler-started.txt"
    monkeypatch.setenv("AIJIAN_FAKE_HANDLER_MARKER", str(marker))
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="mismatched-definition-worker",
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=2),
        handler=marker_blocked_fake_skill,
        delegation=resolved_delegation(
            hard_limit_micros=0,
            retry_increment_limit_micros=0,
            agent_version="2.0.0",
        ),
    )

    with pytest.raises(PermissionError, match="does not match"):
        executor.run_once(task_id=task_id)

    assert not marker.exists()


def test_second_invocation_uses_shared_deadline_and_leaves_no_child(
    tmp_path: Path,
) -> None:
    database, _, clock, ledger, _, task_id = setup_fake_task(tmp_path)
    before_children = {process.pid for process in active_children()}
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="qc-timeout-worker",
        lease_duration=timedelta(seconds=30),
        heartbeat_interval=timedelta(milliseconds=20),
        handler_timeout=timedelta(milliseconds=150),
        handler=qc_retry_then_blocks,
        delegation=resolved_delegation(hard_limit_micros=10, retry_increment_limit_micros=5),
    )

    started = monotonic()
    with pytest.raises(FakeSkillTimeoutError, match="timed out"):
        executor.run_once(task_id=task_id)

    assert monotonic() - started < 1
    assert {process.pid for process in active_children()} == before_children
