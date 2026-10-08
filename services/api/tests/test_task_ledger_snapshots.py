import hashlib
import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.agent_skill_contracts import AttemptSnapshotV1, canonical_sha256
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger
from aijian_api.task_ledger_models import QueuedTask

NOW = datetime(2026, 8, 10, 9, 0, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"


def enqueue_agent_skill_task(
    ledger: LocalTaskLedger,
    project_id: str,
) -> tuple[dict[str, object], QueuedTask]:
    fingerprint_payload: dict[str, object] = {
        "project_id": project_id,
        "agent_run_id": "agr_" + "a" * 32,
        "skill_run_id": "skr_" + "a" * 32,
        "output_artifact_type": "Screenplay",
        "agent_definition_id": "screenwriter",
        "agent_version": "1.0.0",
        "skill_definition_id": "screenplay.generate",
        "skill_version": "1.0.0",
        "prompt_version": "prompt.screenplay@1.0.0",
        "policy_version": "policy.local-safe@1.0.0",
        "provider_connection_id": "provider:local-fake",
        "model_id": "deterministic-fake-v1",
        "capability_snapshot_hash": HASH_A,
        "input_hash": HASH_A,
        "output_schema_version": "1.0.0",
        "idempotency_key": "idem:snapshot-reader",
    }
    snapshot = {
        "schema_version": "1.0.0",
        **fingerprint_payload,
        "attempt_fingerprint": canonical_sha256(fingerprint_payload),
    }
    queued = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="agent-skill-fake-runtime",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["screenplay.generate"]},
        workflow_input_hash=HASH_A,
        node_key="screenplay.generate",
        node_type="agent.skill.fake",
        contract_version=1,
        input_bindings={"context_manifest_id": "ctx_" + "a" * 32},
        node_input_hash=HASH_A,
        request_fingerprint=str(snapshot["attempt_fingerprint"]),
        idempotency_key="idem:snapshot-reader",
        max_attempts=2,
        task_kind="local.agent-skill.fake",
        priority=80,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot,
    )
    return snapshot, queued


def create_ledger(tmp_path: Path) -> tuple[Path, str, list[datetime], LocalTaskLedger]:
    database = tmp_path / "workspace.db"
    project_id = (
        StudioRepository(database)
        .create_project(
            name="快照读取",
            aspect_ratio="9:16",
            target_duration_seconds=15,
            source_language="zh-CN",
        )
        .id
    )
    clock = [NOW]
    return database, project_id, clock, LocalTaskLedger(database, clock=lambda: clock[0])


def test_current_lease_reads_and_revalidates_closed_attempt_snapshot(tmp_path: Path) -> None:
    _, project_id, _, ledger = create_ledger(tmp_path)
    expected, _ = enqueue_agent_skill_task(ledger, project_id)
    claim = ledger.claim_ready_task(worker_id="fake-worker", lease_duration=timedelta(seconds=30))
    assert claim is not None

    observed = ledger.read_agent_skill_snapshot(claim)

    assert isinstance(observed, AttemptSnapshotV1)
    assert observed.attempt_id == claim.attempt_id
    assert observed.model_dump(mode="json", exclude={"attempt_id"}) == expected


def test_recovered_attempt_rehydrates_new_attempt_id_without_snapshot_drift(
    tmp_path: Path,
) -> None:
    _, project_id, clock, ledger = create_ledger(tmp_path)
    expected, queued = enqueue_agent_skill_task(ledger, project_id)
    expired = ledger.claim_ready_task(
        worker_id="crashed-worker", lease_duration=timedelta(seconds=1)
    )
    assert expired is not None
    clock[0] = NOW + timedelta(seconds=2)
    assert ledger.recover_expired_local_tasks().requeued == 1
    recovered = ledger.claim_ready_task(
        worker_id="recovery-worker", lease_duration=timedelta(seconds=30)
    )
    assert recovered is not None and recovered.attempt_id != queued.attempt_id

    observed = ledger.read_agent_skill_snapshot(recovered)

    assert observed.attempt_id == recovered.attempt_id
    assert observed.model_dump(mode="json", exclude={"attempt_id"}) == expected


def test_snapshot_read_fails_closed_for_stale_lease_and_missing_snapshot(tmp_path: Path) -> None:
    _, project_id, clock, ledger = create_ledger(tmp_path)
    enqueue_agent_skill_task(ledger, project_id)
    stale = ledger.claim_ready_task(worker_id="worker-a", lease_duration=timedelta(seconds=1))
    assert stale is not None
    clock[0] = NOW + timedelta(seconds=2)
    with pytest.raises(LeaseLostError, match="stale or expired"):
        ledger.read_agent_skill_snapshot(stale)

    database = tmp_path / "legacy.db"
    legacy_project = (
        StudioRepository(database)
        .create_project(
            name="旧任务", aspect_ratio="9:16", target_duration_seconds=15, source_language="zh-CN"
        )
        .id
    )
    legacy = LocalTaskLedger(database, clock=lambda: NOW)
    legacy.enqueue_local_node(
        project_id=legacy_project,
        definition_id="legacy",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["legacy"]},
        workflow_input_hash=HASH_A,
        node_key="legacy",
        node_type="legacy",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=HASH_A,
        idempotency_key="legacy:no-snapshot",
        max_attempts=1,
        task_kind="legacy",
        priority=1,
        available_at=NOW,
    )
    legacy_claim = legacy.claim_ready_task(
        worker_id="legacy-worker", lease_duration=timedelta(seconds=30)
    )
    assert legacy_claim is not None
    with pytest.raises(ValueError, match="does not have an Agent/Skill snapshot"):
        legacy.read_agent_skill_snapshot(legacy_claim)


def test_snapshot_read_rejects_claims_that_do_not_match_the_current_lease(
    tmp_path: Path,
) -> None:
    _, project_id, _, ledger = create_ledger(tmp_path)
    enqueue_agent_skill_task(ledger, project_id)
    claim = ledger.claim_ready_task(worker_id="worker-a", lease_duration=timedelta(seconds=30))
    assert claim is not None

    mismatched_claims = (
        replace(claim, lease_owner="wrong-worker"),
        replace(claim, lease_token="wrong-token"),
        replace(claim, lease_generation=999),
        replace(claim, task_revision=999),
    )
    for mismatched in mismatched_claims:
        with pytest.raises(LeaseLostError, match="stale or expired"):
            ledger.read_agent_skill_snapshot(mismatched)

    refreshed = ledger.heartbeat(claim, lease_duration=timedelta(seconds=30))
    assert refreshed.task_revision != claim.task_revision
    with pytest.raises(LeaseLostError, match="stale or expired"):
        ledger.read_agent_skill_snapshot(claim)


def test_snapshot_read_rejects_persisted_attempt_id_override(tmp_path: Path) -> None:
    database, project_id, _, ledger = create_ledger(tmp_path)
    _, queued = enqueue_agent_skill_task(ledger, project_id)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER workflow_attempt_snapshots_immutable_update")
        row = connection.execute(
            "SELECT snapshot_json FROM workflow_attempt_snapshots WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone()
        assert row is not None
        decoded = json.loads(str(row[0]))
        decoded["attempt_id"] = "att_" + "f" * 32
        altered = json.dumps(decoded, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        connection.execute(
            "UPDATE workflow_attempt_snapshots SET snapshot_json = ?, snapshot_hash = ? "
            "WHERE attempt_id = ?",
            (
                altered,
                "sha256:" + hashlib.sha256(altered.encode("utf-8")).hexdigest(),
                queued.attempt_id,
            ),
        )
    claim = ledger.claim_ready_task(worker_id="fake-worker", lease_duration=timedelta(seconds=30))
    assert claim is not None

    with pytest.raises(ValueError, match="integrity validation"):
        ledger.read_agent_skill_snapshot(claim)


def test_snapshot_read_rejects_self_consistent_payload_detached_from_workflow_truth(
    tmp_path: Path,
) -> None:
    database, project_id, _, ledger = create_ledger(tmp_path)
    _, queued = enqueue_agent_skill_task(ledger, project_id)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER workflow_attempt_snapshots_immutable_update")
        row = connection.execute(
            "SELECT snapshot_json FROM workflow_attempt_snapshots WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone()
        assert row is not None
        decoded = json.loads(str(row[0]))
        decoded["input_hash"] = f"sha256:{'b' * 64}"
        fingerprint_payload = {
            key: value
            for key, value in decoded.items()
            if key not in {"schema_version", "attempt_fingerprint"}
        }
        decoded["attempt_fingerprint"] = canonical_sha256(fingerprint_payload)
        altered = json.dumps(decoded, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        connection.execute(
            "UPDATE workflow_attempt_snapshots SET snapshot_json = ?, snapshot_hash = ? "
            "WHERE attempt_id = ?",
            (
                altered,
                "sha256:" + hashlib.sha256(altered.encode("utf-8")).hexdigest(),
                queued.attempt_id,
            ),
        )
    claim = ledger.claim_ready_task(worker_id="fake-worker", lease_duration=timedelta(seconds=30))
    assert claim is not None

    with pytest.raises(ValueError, match="integrity validation"):
        ledger.read_agent_skill_snapshot(claim)


@pytest.mark.parametrize("corruption", ("hash", "noncanonical", "schema"))
def test_snapshot_read_detects_persisted_corruption(
    tmp_path: Path,
    corruption: str,
) -> None:
    database, project_id, _, ledger = create_ledger(tmp_path)
    _, queued = enqueue_agent_skill_task(ledger, project_id)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER workflow_attempt_snapshots_immutable_update")
        row = connection.execute(
            "SELECT snapshot_json FROM workflow_attempt_snapshots WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone()
        assert row is not None
        payload = str(row[0])
        if corruption == "hash":
            connection.execute(
                "UPDATE workflow_attempt_snapshots SET snapshot_hash = ? WHERE attempt_id = ?",
                (HASH_A, queued.attempt_id),
            )
        elif corruption == "noncanonical":
            altered = json.dumps(json.loads(payload), ensure_ascii=False, indent=2)
            altered_hash = "sha256:" + hashlib.sha256(altered.encode("utf-8")).hexdigest()
            connection.execute(
                "UPDATE workflow_attempt_snapshots SET snapshot_json = ?, snapshot_hash = ? "
                "WHERE attempt_id = ?",
                (altered, altered_hash, queued.attempt_id),
            )
        else:
            decoded = json.loads(payload)
            decoded["model_id"] = "tampered-model"
            altered = json.dumps(decoded, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            altered_hash = "sha256:" + hashlib.sha256(altered.encode("utf-8")).hexdigest()
            connection.execute(
                "UPDATE workflow_attempt_snapshots SET snapshot_json = ?, snapshot_hash = ? "
                "WHERE attempt_id = ?",
                (altered, altered_hash, queued.attempt_id),
            )
    claim = ledger.claim_ready_task(worker_id="fake-worker", lease_duration=timedelta(seconds=30))
    assert claim is not None

    with pytest.raises(ValueError, match="integrity validation"):
        ledger.read_agent_skill_snapshot(claim)
