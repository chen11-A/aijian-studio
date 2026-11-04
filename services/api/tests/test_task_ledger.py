import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace

import pytest
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.domain import TrustedReviewActor
from aijian_api.ingestion import ingest_text_file
from aijian_api.remote_execution_authorization import RemoteDispatchSnapshotDraft
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger
from aijian_api.task_ledger_enqueue import (
    EnqueueLocalNodeRequest,
    EnqueueRemoteNodeRequest,
    _insert_remote_dispatch_snapshot,
    _validate_request,
    enqueue_remote_node,
)
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
    task_kind: str = "local.execute",
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
        task_kind=task_kind,
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


def test_remote_enqueue_rejects_missing_snapshot_before_opening_a_transaction(
    tmp_path: Path,
) -> None:
    """Validator evidence: the public wrapper always supplies a snapshot."""
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    request = EnqueueRemoteNodeRequest(
        project_id=project_id,
        definition_id="remote",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["remote"]},
        workflow_input_hash=HASH_A,
        node_key="remote",
        node_type="remote",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=HASH_A,
        idempotency_key="remote:missing-snapshot",
        max_attempts=1,
        task_kind="remote.extract",
        priority=50,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot={},
        dispatch_snapshot=None,
    )

    with pytest.raises(ValueError, match="remote dispatch snapshot is required"):
        enqueue_remote_node(
            request,
            connection_factory=lambda: (_ for _ in ()).throw(AssertionError("must not open")),
            clock=lambda: NOW,
            id_factory=lambda prefix: f"{prefix}_{'0' * 32}",
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM remote_dispatch_snapshots").fetchone() == (
            0,
        )


@pytest.mark.parametrize(
    ("input_request", "execution_mode", "message"),
    (
        (
            EnqueueLocalNodeRequest(
                project_id="prj_" + "1" * 32,
                definition_id="validator",
                definition_version=1,
                definition_hash=HASH_A,
                graph={},
                workflow_input_hash=HASH_A,
                node_key="validator",
                node_type="validator",
                contract_version=1,
                input_bindings={},
                node_input_hash=HASH_A,
                request_fingerprint=HASH_A,
                idempotency_key="validator-invalid-mode",
                max_attempts=1,
                task_kind="validator",
                priority=1,
                available_at=NOW,
            ),
            "invalid",
            "execution mode is invalid",
        ),
        (
            EnqueueLocalNodeRequest(
                project_id="prj_" + "1" * 32,
                definition_id="validator",
                definition_version=1,
                definition_hash=HASH_A,
                graph={},
                workflow_input_hash=HASH_A,
                node_key="validator",
                node_type="validator",
                contract_version=1,
                input_bindings={},
                node_input_hash=HASH_A,
                request_fingerprint=HASH_A,
                idempotency_key="validator-wrong-class",
                max_attempts=1,
                task_kind="validator",
                priority=1,
                available_at=NOW,
            ),
            "remote",
            "require an immutable dispatch snapshot",
        ),
    ),
)
def test_enqueue_request_validator_rejects_unreachable_execution_guards(
    input_request: EnqueueLocalNodeRequest, execution_mode: str, message: str
) -> None:
    """Validator evidence: public wrappers cannot construct either invalid combination."""
    with pytest.raises(ValueError, match=message):
        _validate_request(
            input_request,
            workflow_run_id="wfr_" + "2" * 32,
            node_run_id="node_" + "3" * 32,
            attempt_id="att_" + "4" * 32,
            now=NOW,
            execution_mode=execution_mode,  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    ("draft", "message"),
    (
        (SimpleNamespace(endpoint_binding="not-a-bound-endpoint"), "endpoint binding"),
        (
            SimpleNamespace(
                endpoint_binding="CPA_LOOPBACK_V1",
                approved_currency="USD",
                requested_additional_budget_micros=1,
            ),
            "zero-budget USD",
        ),
        (
            SimpleNamespace(
                endpoint_binding="CPA_LOOPBACK_V1",
                approved_currency="USD",
                requested_additional_budget_micros=0,
                connection_revision=0,
            ),
            "connection revision",
        ),
    ),
)
def test_remote_enqueue_private_policy_guards_reject_unreachable_typed_drafts(
    tmp_path: Path, draft: SimpleNamespace, message: str
) -> None:
    """Validator evidence: public RemoteDispatchSnapshotDraft rejects these values first."""
    database = tmp_path / "workspace.db"
    create_project(database)
    with sqlite3.connect(database) as connection:
        with pytest.raises(ValueError, match=message):
            _insert_remote_dispatch_snapshot(
                connection,
                attempt_id="att_" + "1" * 32,
                project_id="prj_" + "2" * 32,
                draft=draft,  # type: ignore[arg-type]
                created_at=timestamp(NOW),
            )
        assert connection.execute("SELECT COUNT(*) FROM remote_dispatch_snapshots").fetchone() == (
            0,
        )


def test_remote_enqueue_is_remote_from_creation_and_persists_immutable_facts(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    repository = StudioRepository(database)
    source = repository.import_source(
        project_id, ingest_text_file(filename="remote.txt", content=b"Remote source text")
    )
    manifest_head = repository.get_artifact_head(project_id, "source_manifest")
    actor = TrustedReviewActor(subject_id="local-user", roles=("writer", "producer"))
    submitted = repository.prepare_review_action(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=manifest_head.latest_version_id,
        action="submit",
        action_payload={},
        actor=actor,
        expected_revision=manifest_head.revision,
    )
    reviewed = repository.submit_artifact_review(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=manifest_head.latest_version_id,
        expected_revision=manifest_head.revision,
        challenge_id=submitted.challenge.id,
        confirmation_token=submitted.confirmation_token,
        actor=actor,
    )
    signoff = repository.prepare_review_action(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=manifest_head.latest_version_id,
        action="signoff",
        action_payload={"roles": ["writer", "producer"]},
        actor=actor,
        expected_revision=reviewed.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=manifest_head.latest_version_id,
        roles=("writer", "producer"),
        expected_revision=reviewed.head.revision,
        challenge_id=signoff.challenge.id,
        confirmation_token=signoff.confirmation_token,
        actor=actor,
    )
    decision = repository.prepare_review_action(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=manifest_head.latest_version_id,
        action="decision",
        action_payload={"decision": "approved", "rationale": "test", "actor_role": "producer"},
        actor=actor,
        readiness_report_id=signoff.report.id,
        expected_revision=signed.head.revision,
    )
    repository.decide_artifact_gate(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=manifest_head.latest_version_id,
        decision="approved",
        rationale="test",
        expected_revision=signed.head.revision,
        challenge_id=decision.challenge.id,
        confirmation_token=decision.confirmation_token,
        actor=actor,
        actor_role="producer",
    )
    accepted_manifest = repository.get_artifact_version(
        project_id, "source_manifest", manifest_head.latest_version_id
    )
    connection_id = "pcn_" + "1" * 32
    context_id = "ctx_" + "2" * 32
    context_hash = f"sha256:{'c' * 64}"
    context_json = json.dumps(
        {
            "project_id": project_id,
            "agent_definition": {"definition_id": "remote.agent", "version": "1.0.0"},
            "skill_definition": {"definition_id": "remote.extract", "version": "1.0.0"},
            "entries": [],
            "total_byte_count": 0,
        },
        separators=(",", ":"),
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            """INSERT INTO provider_connections (
            connection_id, provider_kind, display_name, base_url, enabled,
            models_json, revision, created_at, updated_at, credential_ref
            ) VALUES (?, 'OPENAI_COMPATIBLE',
            'test remote', 'http://offline.invalid', 1,
            '[{\"model_id\":\"remote-model\",\"capabilities\":[\"TEXT\"]}]',
            1, ?, ?, ?)""",
            (connection_id, timestamp(NOW), timestamp(NOW), connection_id),
        )
        connection.execute(
            "INSERT INTO agent_runs VALUES (?, ?, ?, ?, 'PENDING', ?, 1, ?, ?)",
            (
                "agr_" + "3" * 32,
                project_id,
                "remote.agent",
                "1.0.0",
                json.dumps(["skr_" + "4" * 32]),
                timestamp(NOW),
                timestamp(NOW),
            ),
        )
        connection.execute(
            "INSERT INTO agent_context_manifests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                context_id,
                project_id,
                "remote.agent",
                "1.0.0",
                "remote.extract",
                "1.0.0",
                context_json,
                context_hash,
                timestamp(NOW),
            ),
        )
        connection.execute(
            "INSERT INTO skill_runs VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, 1, ?, ?)",
            (
                "skr_" + "4" * 32,
                project_id,
                "agr_" + "3" * 32,
                "remote.extract",
                "1.0.0",
                context_id,
                timestamp(NOW),
                timestamp(NOW),
            ),
        )
    snapshot = {
        "schema_version": "1.0.0",
        "project_id": project_id,
        "agent_run_id": "agr_" + "3" * 32,
        "skill_run_id": "skr_" + "4" * 32,
        "output_artifact_type": "Screenplay",
        "agent_definition_id": "remote.agent",
        "agent_version": "1.0.0",
        "skill_definition_id": "remote.extract",
        "skill_version": "1.0.0",
        "prompt_version": "remote@1.0.0",
        "policy_version": "remote-policy@1.0.0",
        "provider_connection_id": connection_id,
        "model_id": "remote-model",
        "capability_snapshot_hash": HASH_A,
        "input_hash": HASH_A,
        "output_schema_version": "1.0.0",
        "idempotency_key": "remote:enqueue:1",
    }
    snapshot["attempt_fingerprint"] = canonical_sha256(
        {key: value for key, value in snapshot.items() if key != "schema_version"}
    )
    draft = RemoteDispatchSnapshotDraft(
        connection_id=connection_id,
        connection_revision=1,
        approved_model_id="remote-model",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH_B,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        policy_version="remote-policy@1.0.0",
        context_manifest_id=context_id,
        context_manifest_hash=context_hash,
        scope={
            "input_hash": HASH_A,
            "context_manifest_hash": context_hash,
            "accepted_manifest_version_id": accepted_manifest.version.id,
            "accepted_manifest_content_hash": accepted_manifest.version.content_hash,
            "source_document_id": source.id,
            "source_block_ids": [source.blocks[0].id],
            "span_bounds": [
                [source.blocks[0].normalized_start_byte, source.blocks[0].normalized_end_byte]
            ],
        },
    )
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    queued = ledger.enqueue_remote_node(
        dispatch_snapshot=draft,
        project_id=project_id,
        definition_id="remote-extract",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["remote.extract"]},
        workflow_input_hash=HASH_A,
        node_key="remote.extract",
        node_type="remote.extract",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=str(snapshot["attempt_fingerprint"]),
        idempotency_key="remote:enqueue:1",
        max_attempts=1,
        task_kind="remote.extract",
        priority=50,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot,
    )
    claim = ledger.claim_remote_task(
        worker_id="remote-worker", lease_duration=timedelta(seconds=30)
    )
    assert claim is not None and claim.attempt_id == queued.attempt_id
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT execution_mode FROM workflow_attempts").fetchone() == (
            "remote",
        )
        assert connection.execute(
            "SELECT attempt_id, connection_id, input_scope_hash FROM remote_dispatch_snapshots"
        ).fetchone() == (queued.attempt_id, connection_id, draft.input_scope_hash())


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


def test_local_task_ledger_rejects_non_positive_connection_timeout(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    with pytest.raises(
        ValueError,
        match="connection timeout must be positive",
    ):
        LocalTaskLedger(database, connection_timeout=timedelta(seconds=0))


def test_claim_and_recovery_reject_blank_task_kind(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id)

    with pytest.raises(ValueError, match="task kind must not be empty"):
        ledger.claim_ready_task(
            worker_id="worker-a",
            lease_duration=timedelta(seconds=30),
            task_kind="   ",
        )

    with pytest.raises(ValueError, match="task kind must not be empty"):
        ledger.recover_expired_local_tasks(task_kind="   ")


def test_heartbeat_rejects_non_positive_lock_timeout(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None

    with pytest.raises(ValueError, match="heartbeat lock timeout must be positive"):
        ledger.heartbeat(
            claim,
            lease_duration=timedelta(seconds=30),
            lock_timeout=timedelta(0),
        )


def test_heartbeat_rewraps_non_locked_operational_error(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None

    class _LockedConnection:
        def __init__(self, inner: sqlite3.Connection) -> None:
            self._inner = inner

        def execute(self, sql: str, parameters: tuple = ()) -> sqlite3.Cursor:
            if str(sql).strip().startswith("BEGIN IMMEDIATE"):
                raise sqlite3.OperationalError("disk I/O error")
            return self._inner.execute(sql, parameters)

        def rollback(self) -> None:
            self._inner.rollback()

        def close(self) -> None:
            self._inner.close()

    baseline_open = ledger._open
    original_connection = sqlite3.connect(database)
    ledger._open = lambda: _LockedConnection(original_connection)
    with pytest.raises(
        sqlite3.OperationalError,
        match="disk I/O error",
    ):
        ledger.heartbeat(
            claim,
            lease_duration=timedelta(seconds=30),
            lock_timeout=timedelta(seconds=1),
        )
    ledger._open = baseline_open
    original_connection.close()


def test_specialized_worker_claims_only_its_exact_task_kind(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    other = enqueue(ledger, project_id, node_key="timeline", priority=100)
    expected = enqueue(
        ledger,
        project_id,
        node_key="source.extract",
        priority=10,
        task_kind="local.agent-skill.fake",
    )

    claimed = ledger.claim_ready_task(
        worker_id="source-extract-worker",
        lease_duration=timedelta(seconds=30),
        task_kind="local.agent-skill.fake",
    )

    assert claimed is not None and claimed.task_id == expected.task_id
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (other.task_id,)
        ).fetchone() == ("READY",)


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


def test_claim_validator_rejects_unknown_execution_mode_without_mutation(tmp_path: Path) -> None:
    """Validator evidence: the public local/remote claim wrappers cannot supply this mode."""
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    queued = enqueue(ledger, project_id)

    with pytest.raises(ValueError, match="unsupported execution mode"):
        ledger.claim_ready_task(
            worker_id="worker-a",
            lease_duration=timedelta(seconds=30),
            _execution_mode="invalid",
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == ("READY",)
        assert connection.execute(
            "SELECT lease_owner FROM task_ledger WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == (None,)


def test_mark_attempt_running_fails_for_unsupported_snapshot_kind(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    queued = enqueue(ledger, project_id)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    with sqlite3.connect(database) as connection:
        now_text = timestamp(NOW)
        snapshot_hash = "sha256:" + ("f" * 64)
        connection.execute(
            """
            INSERT INTO workflow_attempt_snapshots (
                attempt_id, snapshot_kind, snapshot_json, snapshot_hash, created_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(attempt_id) DO UPDATE
            SET snapshot_kind = EXCLUDED.snapshot_kind
               ,snapshot_json = EXCLUDED.snapshot_json
               ,snapshot_hash = EXCLUDED.snapshot_hash
            """,
            (queued.attempt_id, "unsupported", "{}", snapshot_hash, now_text),
        )
        connection.commit()

    with pytest.raises(ValueError, match="unsupported attempt snapshot kind"):
        ledger.mark_attempt_running(claim)


def test_fail_local_task_rejects_blank_error_code(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    project_id = create_project(database)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    enqueue(ledger, project_id)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None

    with pytest.raises(ValueError, match="error code must not be empty"):
        ledger.fail_local_task(claim, error_code="   ")
