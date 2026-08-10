import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event

import pytest
from aijian_api.agent_skill_contracts import (
    AgentSkillFixtureBundleV1,
    ArtifactProposalV1,
    AttemptSnapshotV1,
    canonical_sha256,
)
from aijian_api.artifact_proposal_store import (
    ArtifactProposalConflictError,
    ArtifactProposalStore,
)
from aijian_api.fake_agent_executor import FakeAgentSkillExecutor
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger

NOW = datetime(2026, 8, 10, 11, 0, tzinfo=UTC)
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


def fixture_bundle() -> AgentSkillFixtureBundleV1:
    return AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))


def setup_fake_task(
    tmp_path: Path,
) -> tuple[Path, str, list[datetime], LocalTaskLedger, ArtifactProposalV1, str]:
    database = tmp_path / "workspace.db"
    project_id = StudioRepository(database).create_project(
        name="Fake Agent 纵切",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    ).id
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
        max_attempts=2,
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
    observed_attempts: list[str] = []

    def fake_skill(snapshot: AttemptSnapshotV1) -> ArtifactProposalV1:
        observed_attempts.append(snapshot.attempt_id)
        return proposal

    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="fake-agent-worker",
        lease_duration=timedelta(seconds=30),
        handler=fake_skill,
    )

    assert executor.run_once(task_id=task_id)
    assert len(observed_attempts) == 1
    assert not executor.run_once(task_id=task_id)
    persisted = ArtifactProposalStore(database).get(proposal.project_id, proposal.proposal_id)
    assert persisted.proposal == proposal

    with sqlite3.connect(database) as connection:
        attempt = connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
            (observed_attempts[0],),
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
    invalid = proposal.model_copy(update={"target_artifact_type": "Screenplay"})
    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="fake-agent-worker",
        lease_duration=timedelta(seconds=30),
        handler=lambda _snapshot: invalid,
    )

    with pytest.raises(ArtifactProposalConflictError, match="frozen attempt"):
        executor.run_once(task_id=task_id)

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("LEASED",)
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "RUNNING",
        )
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "RUNNING",
        )
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
    clock[0] = NOW + timedelta(seconds=31)
    assert ledger.recover_expired_local_tasks().requeued == 1


def test_recovered_fake_execution_reuses_existing_proposal_and_enters_review(
    tmp_path: Path,
) -> None:
    database, _, clock, ledger, proposal, _ = setup_fake_task(tmp_path)
    first_claim = ledger.claim_ready_task(
        worker_id="crashed-worker", lease_duration=timedelta(seconds=30)
    )
    assert first_claim is not None
    first_running = ledger.mark_attempt_running(first_claim)
    first = ArtifactProposalStore(database, clock=lambda: clock[0]).persist(
        first_running, proposal
    )
    clock[0] = NOW + timedelta(seconds=31)
    assert ledger.recover_expired_local_tasks().requeued == 1

    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="recovery-worker",
        lease_duration=timedelta(seconds=30),
        handler=lambda _snapshot: proposal,
    )
    assert executor.run_once()

    assert ArtifactProposalStore(database).get(proposal.project_id, proposal.proposal_id) == first
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            1,
        )
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "NEEDS_REVIEW",
        )


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


def test_recovered_attempt_cannot_reuse_proposal_after_frozen_snapshot_drift(
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
    assert ledger.recover_expired_local_tasks().requeued == 1

    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER workflow_attempt_snapshots_immutable_update")
        latest = connection.execute(
            "SELECT attempt_id FROM workflow_attempts ORDER BY attempt_number DESC LIMIT 1"
        ).fetchone()
        assert latest is not None
        attempt_id = str(latest[0])
        row = connection.execute(
            "SELECT snapshot_json FROM workflow_attempt_snapshots WHERE attempt_id = ?",
            (attempt_id,),
        ).fetchone()
        assert row is not None
        payload = json.loads(str(row[0]))
        payload["model_id"] = "different-fake-model-v2"
        fingerprint_payload = {
            key: value
            for key, value in payload.items()
            if key not in {"schema_version", "attempt_fingerprint"}
        }
        payload["attempt_fingerprint"] = canonical_sha256(fingerprint_payload)
        snapshot_json = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        snapshot_hash = "sha256:" + hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
        connection.execute(
            "UPDATE workflow_attempt_snapshots SET snapshot_json = ?, snapshot_hash = ? "
            "WHERE attempt_id = ?",
            (snapshot_json, snapshot_hash, attempt_id),
        )
        connection.execute(
            "UPDATE workflow_attempts SET request_fingerprint = ? WHERE attempt_id = ?",
            (payload["attempt_fingerprint"], attempt_id),
        )

    executor = FakeAgentSkillExecutor(
        ledger,
        ArtifactProposalStore(database, clock=lambda: clock[0]),
        worker_id="recovery-worker",
        lease_duration=timedelta(seconds=30),
        handler=lambda _snapshot: proposal,
    )
    with pytest.raises(ValueError, match="snapshot differs"):
        executor.run_once()
