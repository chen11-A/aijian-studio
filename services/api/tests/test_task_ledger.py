import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

import pytest
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger
from aijian_api.task_ledger_models import lease_token, new_id, timestamp, utc_now

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def create_project(database: Path) -> str:
    return (
        StudioRepository(database)
        .create_project(
            name="黄金短篇",
            aspect_ratio="9:16",
            target_duration_seconds=90,
            source_language="zh-CN",
        )
        .id
    )


def enqueue(
    ledger: LocalTaskLedger,
    project_id: str,
    *,
    node_key: str = "render.preview",
    priority: int = 50,
    available_at: datetime = NOW,
    node_input_hash: str = HASH_A,
):
    return ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="golden-short",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["local.execute"]},
        workflow_input_hash=HASH_A,
        node_key=node_key,
        node_type=node_key,
        contract_version=1,
        input_bindings={"source": "ver_source_1"},
        node_input_hash=node_input_hash,
        request_fingerprint=HASH_B,
        idempotency_key=f"golden-short:{node_key}:{HASH_A}",
        max_attempts=2,
        task_kind="local.execute",
        priority=priority,
        available_at=available_at,
    )


def test_enqueued_task_persists_truth_and_initial_events(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)

    queued = enqueue(ledger, project_id)

    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        node = connection.execute(
            "SELECT * FROM workflow_node_runs WHERE node_run_id = ?", (queued.node_run_id,)
        ).fetchone()
        attempt = connection.execute(
            "SELECT * FROM workflow_attempts WHERE attempt_id = ?", (queued.attempt_id,)
        ).fetchone()
        task = connection.execute(
            "SELECT * FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone()
        events = connection.execute(
            "SELECT entity_kind, to_status, sequence FROM workflow_transition_events "
            "ORDER BY entity_kind"
        ).fetchall()

    assert node is not None and node["status"] == "PENDING"
    assert node["attempt_count"] == 0
    assert attempt is not None and attempt["status"] == "READY"
    assert task is not None and task["status"] == "READY"
    assert [(row["entity_kind"], row["to_status"], row["sequence"]) for row in events] == [
        ("attempt", "READY", 1),
        ("node", "PENDING", 1),
        ("task", "READY", 1),
    ]


def test_two_connections_can_claim_a_task_only_once(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    enqueue(LocalTaskLedger(database, clock=lambda: NOW), project_id)
    barrier = Barrier(2)

    def claim(worker_id: str):
        ledger = LocalTaskLedger(database, clock=lambda: NOW)
        barrier.wait()
        return ledger.claim_ready_task(worker_id=worker_id, lease_duration=timedelta(seconds=30))

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(claim, ["worker-a", "worker-b"]))

    winners = [claim for claim in claims if claim is not None]
    assert len(winners) == 1
    assert winners[0].lease_owner in {"worker-a", "worker-b"}

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "RUNNING",
        )
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == ("LEASED",)
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("LEASED",)


def test_enqueue_is_idempotent_across_two_independent_connections(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    barrier = Barrier(2)

    def submit(_worker_id: str):
        ledger = LocalTaskLedger(database, clock=lambda: NOW)
        barrier.wait()
        return enqueue(ledger, project_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        queued = list(pool.map(submit, ["caller-a", "caller-b"]))

    assert queued[0] == queued[1]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_runs").fetchone() == (1,)
        assert connection.execute("SELECT COUNT(*) FROM workflow_node_runs").fetchone() == (1,)
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (1,)


def test_enqueue_rejects_idempotency_key_reuse_for_different_input(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id)

    with pytest.raises(ValueError, match="idempotency key"):
        enqueue(ledger, project_id, node_input_hash=HASH_B)


def test_claim_orders_ready_tasks_by_priority_and_availability(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id, node_key="low", priority=10)
    high = enqueue(ledger, project_id, node_key="high", priority=90)
    enqueue(
        ledger,
        project_id,
        node_key="future",
        priority=100,
        available_at=NOW + timedelta(minutes=1),
    )

    claimed = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )

    assert claimed is not None
    assert claimed.task_id == high.task_id


def test_same_second_fractional_availability_is_not_claimed_early(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(
        ledger,
        project_id,
        available_at=NOW + timedelta(microseconds=500_000),
    )

    assert (
        ledger.claim_ready_task(worker_id="worker-a", lease_duration=timedelta(seconds=30)) is None
    )


def test_heartbeat_and_worker_start_require_current_fencing_values(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None

    heartbeat = ledger.heartbeat(claim, lease_duration=timedelta(seconds=45))
    assert heartbeat.task_revision == claim.task_revision + 1
    assert heartbeat.lease_expires_at == NOW + timedelta(seconds=45)

    with pytest.raises(LeaseLostError):
        ledger.heartbeat(claim, lease_duration=timedelta(seconds=30))
    with pytest.raises(LeaseLostError):
        ledger.heartbeat(
            replace(heartbeat, lease_token="wrong-token"),
            lease_duration=timedelta(seconds=30),
        )

    running = ledger.mark_attempt_running(heartbeat)
    assert running.attempt_revision == heartbeat.attempt_revision + 1
    with pytest.raises(LeaseLostError):
        ledger.mark_attempt_running(heartbeat)
    with pytest.raises(LeaseLostError):
        ledger.mark_attempt_running(replace(running, task_revision=999))


def test_definition_version_is_immutable_across_runs(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id)

    with pytest.raises(ValueError, match="definition version is immutable"):
        ledger.enqueue_local_node(
            project_id=project_id,
            definition_id="golden-short",
            definition_version=1,
            definition_hash=HASH_B,
            graph={"nodes": ["changed"]},
            workflow_input_hash=HASH_A,
            node_key="changed",
            node_type="changed",
            contract_version=1,
            input_bindings={},
            node_input_hash=HASH_A,
            request_fingerprint=HASH_B,
            idempotency_key="changed",
            max_attempts=2,
            task_kind="local.execute",
            priority=50,
            available_at=NOW,
        )


def test_claim_rolls_back_if_attempt_or_node_changed_before_binding(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    first = enqueue(ledger, project_id, node_key="attempt-race")
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_attempt_race
            AFTER UPDATE OF status ON task_ledger
            WHEN NEW.status = 'LEASED'
            BEGIN
                UPDATE workflow_attempts SET status = 'FAILED'
                WHERE attempt_id = NEW.attempt_id;
            END
            """
        )
        connection.commit()

    with pytest.raises(LeaseLostError, match="attempt was not ready"):
        ledger.claim_ready_task(worker_id="worker-a", lease_duration=timedelta(seconds=30))
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (first.task_id,)
        ).fetchone() == ("READY",)
        connection.execute("DROP TRIGGER test_attempt_race")
        connection.commit()

    second = enqueue(ledger, project_id, node_key="node-race", priority=100)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE workflow_node_runs SET status = 'FAILED' WHERE node_run_id = ?",
            (second.node_run_id,),
        )
        connection.commit()
    with pytest.raises(LeaseLostError, match="node was not pending"):
        ledger.claim_ready_task(worker_id="worker-a", lease_duration=timedelta(seconds=30))
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (second.attempt_id,)
        ).fetchone() == ("READY",)


def test_ledger_validates_claim_and_enqueue_boundaries(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW, lease_token_factory=lambda: "")
    enqueue(ledger, project_id)

    with pytest.raises(ValueError, match="worker id"):
        ledger.claim_ready_task(worker_id="", lease_duration=timedelta(seconds=30))
    with pytest.raises(ValueError, match="duration"):
        ledger.claim_ready_task(worker_id="worker-a", lease_duration=timedelta(0))
    with pytest.raises(ValueError, match="token"):
        ledger.claim_ready_task(worker_id="worker-a", lease_duration=timedelta(seconds=30))

    with pytest.raises(ValueError, match="priority"):
        enqueue(LocalTaskLedger(database, clock=lambda: NOW), project_id, priority=101)
    with pytest.raises(ValueError, match="versions"):
        LocalTaskLedger(database, clock=lambda: NOW).enqueue_local_node(
            project_id=project_id,
            definition_id="invalid-version",
            definition_version=0,
            definition_hash=HASH_A,
            graph={},
            workflow_input_hash=HASH_A,
            node_key="invalid-version",
            node_type="invalid-version",
            contract_version=1,
            input_bindings={},
            node_input_hash=HASH_A,
            request_fingerprint=HASH_B,
            idempotency_key="invalid-version",
            max_attempts=2,
            task_kind="local.execute",
            priority=50,
            available_at=NOW,
        )
    with pytest.raises(ValueError, match="timezone"):
        timestamp(datetime(2026, 8, 4, 9, 30))

    assert timestamp(NOW) == "2026-08-04T09:30:00.000000Z"

    assert utc_now().tzinfo is not None
    assert new_id("task").startswith("task_")
    assert lease_token()
