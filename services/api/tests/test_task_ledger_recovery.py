import json
import sqlite3
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import aijian_api.task_ledger_recovery as task_ledger_recovery
import pytest
from aijian_api.agent_skill_contracts import (
    AgentSkillFixtureBundleV1,
    AttemptSnapshotV1,
    canonical_sha256,
)
from aijian_api.artifact_proposal_store import (
    ArtifactProposalStore,
    PersistedArtifactProposal,
    decode_persisted_proposal_row,
)
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger
from aijian_api.task_ledger_models import timestamp

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


class _SingleRowCursor:
    def __init__(self, row: sqlite3.Row | dict[str, object] | None) -> None:
        self._row = row

    def fetchone(self) -> sqlite3.Row | dict[str, object] | None:
        return self._row


class _RecoveryConnection:
    def __init__(
        self,
        inner: sqlite3.Connection,
        *,
        after_proposal_id_lookup: Callable[[sqlite3.Connection], None] | None = None,
        proposal_truth_row: dict[str, object] | None = None,
        invalidate_proposal_recovery_node: bool = False,
    ) -> None:
        self._inner = inner
        self._after_proposal_id_lookup = after_proposal_id_lookup
        self._proposal_truth_row = proposal_truth_row
        self._invalidate_proposal_recovery_node = invalidate_proposal_recovery_node

    def execute(self, sql: str, parameters: tuple = ()) -> sqlite3.Cursor | _SingleRowCursor:
        if (
            self._proposal_truth_row is not None
            and "FROM agent_artifact_proposals AS proposal" in sql
        ):
            return _SingleRowCursor(self._proposal_truth_row)
        cursor = self._inner.execute(sql, parameters)
        if (
            self._after_proposal_id_lookup is not None
            and "FROM agent_artifact_proposals WHERE producer_attempt_id" in sql
        ):
            row = cursor.fetchone()
            self._after_proposal_id_lookup(self._inner)
            return _SingleRowCursor(row)
        if (
            self._invalidate_proposal_recovery_node
            and "UPDATE workflow_node_runs" in sql
            and "SET status = 'NEEDS_REVIEW'" in sql
        ):
            self._inner.execute(
                "UPDATE workflow_node_runs SET status = 'PENDING' WHERE node_run_id = ?",
                (parameters[1],),
            )
            return self._inner.execute(sql, parameters)
        return cursor

    def rollback(self) -> None:
        self._inner.rollback()

    def close(self) -> None:
        self._inner.close()


def setup_task(
    database: Path,
    clock: list[datetime],
    *,
    max_attempts: int = 2,
    task_kind: str = "local.execute",
):
    project = StudioRepository(database).create_project(
        name="黄金短篇",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    ledger = LocalTaskLedger(database, clock=lambda: clock[0])
    queued = ledger.enqueue_local_node(
        project_id=project.id,
        definition_id="golden-short",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["render.preview"]},
        workflow_input_hash=HASH_A,
        node_key="render.preview",
        node_type="render.preview",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=HASH_B,
        idempotency_key="golden-short:render.preview",
        max_attempts=max_attempts,
        task_kind=task_kind,
        priority=50,
        available_at=clock[0],
    )
    return ledger, queued


def setup_fake_skill_task_with_persisted_proposal(
    tmp_path: Path,
) -> tuple[Path, str, str]:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project = repository.create_project(
        name="Fake Agent 纵切",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    )
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    fields = bundle.attempt.model_dump(mode="json")
    fields["project_id"] = project.id
    fingerprint_payload = {
        key: value
        for key, value in fields.items()
        if key not in {"schema_version", "attempt_id", "attempt_fingerprint"}
    }
    fields["attempt_fingerprint"] = canonical_sha256(fingerprint_payload)
    snapshot = AttemptSnapshotV1.model_validate(fields)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    queued = ledger.enqueue_local_node(
        project_id=project.id,
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
    claim = ledger.claim_ready_task(
        worker_id="proposal-recovery-fixture",
        lease_duration=timedelta(seconds=30),
        task_id=queued.task_id,
    )
    assert claim is not None
    proposal = bundle.artifact_proposal.model_copy(update={"project_id": project.id})
    persisted = ArtifactProposalStore(database, clock=lambda: NOW).persist(claim, proposal)
    context_payload = bundle.context_manifest.model_dump(mode="json")
    context_payload["project_id"] = project.id
    context_payload["manifest_hash"] = canonical_sha256(
        {
            "project_id": project.id,
            "agent_definition": context_payload["agent_definition"],
            "skill_definition": context_payload["skill_definition"],
            "entries": context_payload["entries"],
            "total_byte_count": context_payload["total_byte_count"],
        }
    )
    now_text = timestamp(NOW)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "INSERT INTO agent_runs VALUES (?, ?, ?, ?, 'RUNNING', ?, 1, ?, ?)",
            (
                snapshot.agent_run_id,
                project.id,
                snapshot.agent_definition_id,
                snapshot.agent_version,
                json.dumps([snapshot.skill_run_id], separators=(",", ":")),
                now_text,
                now_text,
            ),
        )
        connection.execute(
            "INSERT INTO agent_context_manifests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bundle.context_manifest.context_manifest_id,
                project.id,
                snapshot.agent_definition_id,
                snapshot.agent_version,
                snapshot.skill_definition_id,
                snapshot.skill_version,
                json.dumps(
                    context_payload,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
                context_payload["manifest_hash"],
                now_text,
            ),
        )
        connection.execute(
            "INSERT INTO skill_runs VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', NULL, 1, ?, ?)",
            (
                snapshot.skill_run_id,
                project.id,
                snapshot.agent_run_id,
                snapshot.skill_definition_id,
                snapshot.skill_version,
                bundle.context_manifest.context_manifest_id,
                now_text,
                now_text,
            ),
        )
    return database, claim.attempt_id, persisted.proposal.proposal_id


def test_specialized_recovery_only_changes_its_exact_task_kind(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    other_ledger, other = setup_task(database, clock)
    fake_ledger, fake = setup_task(
        database,
        clock,
        task_kind="local.agent-skill.fake",
    )
    assert other_ledger.claim_ready_task(
        worker_id="other-worker",
        lease_duration=timedelta(seconds=30),
        task_id=other.task_id,
    )
    assert fake_ledger.claim_ready_task(
        worker_id="fake-worker",
        lease_duration=timedelta(seconds=30),
        task_id=fake.task_id,
    )
    clock[0] = NOW + timedelta(seconds=31)

    summary = fake_ledger.recover_expired_local_tasks(task_kind="local.agent-skill.fake")

    assert (summary.recovered, summary.requeued) == (1, 1)
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (other.task_id,)
        ).fetchone() == ("LEASED",)


def test_expired_running_attempt_is_failed_and_requeued_with_new_identity(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, first = setup_task(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    clock[0] = NOW + timedelta(seconds=31)

    summary = LocalTaskLedger(database, clock=lambda: clock[0]).recover_expired_local_tasks()

    assert summary.recovered == 1
    assert summary.requeued == 1
    assert summary.failed == 0
    with sqlite3.connect(database) as connection:
        attempts = connection.execute(
            "SELECT attempt_id, attempt_number, status, retry_disposition "
            "FROM workflow_attempts ORDER BY attempt_number"
        ).fetchall()
        tasks = connection.execute(
            "SELECT task_id, status FROM task_ledger ORDER BY created_at, task_id"
        ).fetchall()
        node = connection.execute(
            "SELECT status, attempt_count, active_attempt_id FROM workflow_node_runs"
        ).fetchone()
    assert attempts[0] == (first.attempt_id, 1, "FAILED", "SAFE_LOCAL_RETRY")
    assert attempts[1][1:] == (2, "READY", None)
    assert {status for _, status in tasks} == {"COMPLETED", "READY"}
    assert node == ("PENDING", 1, None)

    with pytest.raises(LeaseLostError):
        ledger.heartbeat(running, lease_duration=timedelta(seconds=30))
    with pytest.raises(LeaseLostError):
        ledger.mark_attempt_running(running)

    next_claim = LocalTaskLedger(database, clock=lambda: clock[0]).claim_ready_task(
        worker_id="worker-new",
        lease_duration=timedelta(seconds=30),
    )
    assert next_claim is not None
    assert next_claim.attempt_number == 2
    assert next_claim.attempt_id != first.attempt_id


def test_expired_final_attempt_fails_node_without_requeue(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, _queued = setup_task(database, clock, max_attempts=1)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    clock[0] = NOW + timedelta(seconds=31)

    summary = ledger.recover_expired_local_tasks()

    assert (summary.recovered, summary.requeued, summary.failed) == (1, 0, 1)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == ("FAILED",)
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)


def test_active_or_remote_leases_are_never_requeued_by_local_recovery(tmp_path: Path) -> None:
    active_database = tmp_path / "active.db"
    active_clock = [NOW]
    active_ledger, _queued = setup_task(active_database, active_clock)
    assert active_ledger.claim_ready_task(
        worker_id="worker-active",
        lease_duration=timedelta(seconds=30),
    )
    active_clock[0] = NOW + timedelta(seconds=10)
    assert active_ledger.recover_expired_local_tasks().recovered == 0

    remote_database = tmp_path / "remote.db"
    remote_clock = [NOW]
    remote_ledger, remote = setup_task(remote_database, remote_clock)
    expired = (NOW - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    now_text = NOW.isoformat().replace("+00:00", "Z")
    with sqlite3.connect(remote_database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            UPDATE workflow_attempts
            SET execution_mode = 'remote', status = 'SUBMITTING', dispatch_started_at = ?
            WHERE attempt_id = ?
            """,
            (now_text, remote.attempt_id),
        )
        connection.execute(
            """
            UPDATE workflow_node_runs
            SET status = 'RUNNING', attempt_count = 1, active_attempt_id = ?
            WHERE node_run_id = ?
            """,
            (remote.attempt_id, remote.node_run_id),
        )
        connection.execute(
            """
            UPDATE task_ledger
            SET status = 'LEASED', lease_owner = 'remote-worker', lease_token = 'token',
                lease_generation = 1, lease_expires_at = ?, heartbeat_at = ?
            WHERE task_id = ?
            """,
            (expired, now_text, remote.task_id),
        )
        connection.commit()

    remote_clock[0] = NOW + timedelta(seconds=1)
    assert remote_ledger.recover_expired_local_tasks().recovered == 0
    with sqlite3.connect(remote_database) as connection:
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (remote.attempt_id,)
        ).fetchone() == ("SUBMITTING",)


def test_recovery_rolls_back_if_attempt_changes_inside_transaction(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, queued = setup_task(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_attempt_recovery_race
            AFTER UPDATE OF status ON task_ledger
            WHEN NEW.status = 'COMPLETED'
            BEGIN
                UPDATE workflow_attempts SET status = 'CANCELLED'
                WHERE attempt_id = NEW.attempt_id;
            END
            """
        )
        connection.commit()
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match="expired task changed"):
        ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (queued.attempt_id,)
        ).fetchone() == ("RUNNING",)


def test_output_receipt_recovery_rolls_back_if_attempt_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, queued = setup_task(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    repository = StudioRepository(database, clock=lambda: clock[0])
    project_id = repository.list_projects()[0].id
    repository.create_artifact_version(
        project_id=project_id,
        artifact_type="fake_render",
        schema_version="1.0.0",
        content={"media_hash": HASH_B},
        author_actor_type="system",
        author_actor_id="fake-provider",
        change_summary="模拟输出已提交后进程崩溃",
        producer_attempt_id=running.attempt_id,
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_receipt_recovery_race
            AFTER UPDATE OF status ON task_ledger
            WHEN NEW.status = 'COMPLETED'
            BEGIN
                UPDATE workflow_attempts SET status = 'CANCELLED'
                WHERE attempt_id = NEW.attempt_id;
            END
            """
        )
        connection.commit()
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match="committed output changed"):
        ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (queued.attempt_id,)
        ).fetchone() == ("RUNNING",)


def test_recovery_rejects_when_persisted_proposal_disappears(tmp_path: Path) -> None:
    database, _attempt_id, proposal_id = setup_fake_skill_task_with_persisted_proposal(tmp_path)

    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER IF EXISTS agent_artifact_proposals_immutable_delete")
        connection.commit()

    ledger = LocalTaskLedger(database, clock=lambda: NOW + timedelta(seconds=31))
    original_open = ledger._open
    ledger._open = lambda: _RecoveryConnection(
        original_open(),
        after_proposal_id_lookup=lambda connection: connection.execute(
            "DELETE FROM agent_artifact_proposals WHERE proposal_id = ?", (proposal_id,)
        ),
    )
    with pytest.raises(ValueError, match="persisted proposal disappeared during recovery"):
        ledger.recover_expired_local_tasks()


def test_recovery_rejects_proposal_belongs_to_different_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, _attempt_id, _proposal_id = setup_fake_skill_task_with_persisted_proposal(tmp_path)

    def decode_other_attempt(row: sqlite3.Row) -> PersistedArtifactProposal:
        return replace(decode_persisted_proposal_row(row), producer_attempt_id="att_different")

    monkeypatch.setattr(
        task_ledger_recovery,
        "decode_persisted_proposal_row",
        decode_other_attempt,
    )
    ledger = LocalTaskLedger(database, clock=lambda: NOW + timedelta(seconds=31))
    with pytest.raises(ValueError, match="persisted proposal belongs to a different attempt"):
        ledger.recover_expired_local_tasks()


def test_recovery_rejects_detached_proposal_snapshot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, _attempt_id, _proposal_id = setup_fake_skill_task_with_persisted_proposal(tmp_path)

    def decode_detached_proposal(row: sqlite3.Row) -> PersistedArtifactProposal:
        persisted = decode_persisted_proposal_row(row)
        return replace(
            persisted,
            proposal=persisted.proposal.model_copy(update={"target_artifact_type": "Screenplay"}),
        )

    monkeypatch.setattr(
        task_ledger_recovery,
        "decode_persisted_proposal_row",
        decode_detached_proposal,
    )
    ledger = LocalTaskLedger(database, clock=lambda: NOW + timedelta(seconds=31))
    with pytest.raises(
        ValueError, match="persisted proposal is detached from its attempt snapshot"
    ):
        ledger.recover_expired_local_tasks()


def test_proposal_recovery_rolls_back_if_node_changes_after_task_update(
    tmp_path: Path,
) -> None:
    database, _attempt_id, _proposal_id = setup_fake_skill_task_with_persisted_proposal(tmp_path)
    ledger = LocalTaskLedger(database, clock=lambda: NOW + timedelta(seconds=31))
    original_open = ledger._open
    ledger._open = lambda: _RecoveryConnection(
        original_open(), invalidate_proposal_recovery_node=True
    )

    with pytest.raises(LeaseLostError, match="persisted proposal changed during recovery"):
        ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("LEASED",)
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "RUNNING",
        )


def test_recovery_rejects_if_committed_output_changes_during_recovery(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, queued = setup_task(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    repository = StudioRepository(database, clock=lambda: clock[0])
    project_id = repository.list_projects()[0].id
    running = ledger.mark_attempt_running(claim)
    repository.create_artifact_version(
        project_id=project_id,
        artifact_type="fake_render",
        schema_version="1.0.0",
        content={"media_hash": HASH_B},
        author_actor_type="system",
        author_actor_id="fake-provider",
        change_summary="输出已提交且节点状态变更后的恢复路径",
        producer_attempt_id=running.attempt_id,
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_committed_output_recovery_race
            AFTER UPDATE OF status ON workflow_attempts
            WHEN NEW.status = 'SUCCEEDED'
            BEGIN
                UPDATE workflow_node_runs SET status = 'PENDING'
                WHERE node_run_id = NEW.node_run_id;
            END
            """
        )
        connection.commit()
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match="committed output changed during recovery"):
        LocalTaskLedger(database, clock=lambda: clock[0]).recover_expired_local_tasks()


def test_recovery_rejects_final_recovery_with_unsupported_snapshot_kind(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    ledger, queued = setup_task(database, [NOW], max_attempts=1)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    with sqlite3.connect(database) as connection:
        snapshot_hash = "sha256:" + ("f" * 64)
        connection.execute(
            """
            INSERT INTO workflow_attempt_snapshots (
                attempt_id, snapshot_kind, snapshot_json, snapshot_hash, created_at
            ) VALUES (?, ?, '{}', ?, ?)
            ON CONFLICT(attempt_id) DO UPDATE
            SET snapshot_kind = EXCLUDED.snapshot_kind,
                snapshot_json = EXCLUDED.snapshot_json,
                snapshot_hash = EXCLUDED.snapshot_hash
            """,
            (queued.attempt_id, "unsupported", snapshot_hash, timestamp(NOW)),
        )
        connection.commit()

    ledger = LocalTaskLedger(database, clock=lambda: NOW + timedelta(seconds=31))
    with pytest.raises(ValueError, match="unsupported attempt snapshot kind"):
        ledger.recover_expired_local_tasks()


def test_recovery_rejects_if_workflow_state_changes_during_final_recovery(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    ledger, queued = setup_task(database, [NOW], max_attempts=1)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    with sqlite3.connect(database) as connection:
        workflow_run_id = connection.execute(
            "SELECT workflow_run_id FROM workflow_node_runs WHERE node_run_id = ?",
            (queued.node_run_id,),
        ).fetchone()[0]
        connection.execute(
            "UPDATE workflow_runs SET status = 'FAILED' WHERE workflow_run_id = ?",
            (workflow_run_id,),
        )
        connection.commit()

    ledger = LocalTaskLedger(database, clock=lambda: NOW + timedelta(seconds=31))
    with pytest.raises(LeaseLostError, match="workflow changed during final lease recovery"):
        ledger.recover_expired_local_tasks()


@pytest.mark.parametrize(
    ("max_attempts", "message"),
    [(2, "expired lease recovery"), (1, "final lease recovery")],
)
def test_recovery_rolls_back_if_node_changes_inside_transaction(
    tmp_path: Path,
    max_attempts: int,
    message: str,
) -> None:
    database = tmp_path / f"workspace-{max_attempts}.db"
    clock = [NOW]
    ledger, queued = setup_task(database, clock, max_attempts=max_attempts)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_node_recovery_race
            AFTER UPDATE OF status ON workflow_attempts
            WHEN NEW.status = 'FAILED'
            BEGIN
                UPDATE workflow_node_runs SET status = 'CANCELLED'
                WHERE node_run_id = NEW.node_run_id;
            END
            """
        )
        connection.commit()
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match=message):
        ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT status FROM workflow_node_runs WHERE node_run_id = ?", (queued.node_run_id,)
        ).fetchone() == ("RUNNING",)
