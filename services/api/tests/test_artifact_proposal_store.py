import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
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
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger
from aijian_api.task_ledger_models import ClaimedTask

NOW = datetime(2026, 8, 10, 10, 0, tzinfo=UTC)
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


def fixture_bundle() -> AgentSkillFixtureBundleV1:
    return AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))


def setup_claim(
    tmp_path: Path,
) -> tuple[Path, str, LocalTaskLedger, ClaimedTask, ArtifactProposalV1]:
    database = tmp_path / "workspace.db"
    project_id = (
        StudioRepository(database)
        .create_project(
            name="提案持久化",
            aspect_ratio="9:16",
            target_duration_seconds=15,
            source_language="zh-CN",
        )
        .id
    )
    bundle = fixture_bundle()
    snapshot_fields = bundle.attempt.model_dump(mode="json")
    snapshot_fields["project_id"] = project_id
    fingerprint_payload = {
        key: value
        for key, value in snapshot_fields.items()
        if key not in {"schema_version", "attempt_id", "attempt_fingerprint"}
    }
    snapshot_fields["attempt_fingerprint"] = canonical_sha256(fingerprint_payload)
    snapshot = AttemptSnapshotV1.model_validate(snapshot_fields)
    snapshot_payload = snapshot.model_dump(mode="json", exclude={"attempt_id"})
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
            "INSERT INTO agent_runs VALUES (?, ?, ?, ?, 'PENDING', ?, 1, ?, ?)",
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
            "INSERT INTO agent_context_manifests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bundle.context_manifest.context_manifest_id,
                project_id,
                snapshot.agent_definition_id,
                snapshot.agent_version,
                snapshot.skill_definition_id,
                snapshot.skill_version,
                json.dumps(
                    context_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ),
                context_payload["manifest_hash"],
                now_text,
            ),
        )
        connection.execute(
            "INSERT INTO skill_runs VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, 1, ?, ?)",
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
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    ledger.enqueue_local_node(
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
        attempt_snapshot=snapshot_payload,
    )
    claim = ledger.claim_ready_task(
        worker_id="fake-agent-worker", lease_duration=timedelta(seconds=30)
    )
    assert claim is not None
    claim = ledger.mark_attempt_running(claim)
    proposal = bundle.artifact_proposal.model_copy(update={"project_id": project_id})
    return database, project_id, ledger, claim, proposal


def test_current_worker_persists_and_reads_project_scoped_immutable_proposal(
    tmp_path: Path,
) -> None:
    database, project_id, _, claim, proposal = setup_claim(tmp_path)
    store = ArtifactProposalStore(database, clock=lambda: NOW)

    persisted = store.persist(claim, proposal)

    assert persisted.proposal == proposal
    assert persisted.producer_attempt_id == claim.attempt_id
    assert persisted.proposal_hash == canonical_sha256(proposal.model_dump(mode="json"))
    assert store.get(project_id, proposal.proposal_id) == persisted
    with pytest.raises(LookupError):
        store.get("prj_" + "f" * 32, proposal.proposal_id)

    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE agent_artifact_proposals SET target_artifact_type = 'Screenplay' "
                "WHERE proposal_id = ?",
                (proposal.proposal_id,),
            )
        connection.rollback()
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )


def test_exact_replay_is_idempotent_but_proposal_drift_conflicts(tmp_path: Path) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)
    store = ArtifactProposalStore(database, clock=lambda: NOW)
    first = store.persist(claim, proposal)
    assert store.persist(claim, proposal) == first

    changed_payload = {"summary": "different valid proposal"}
    changed = proposal.model_copy(
        update={
            "payload": changed_payload,
            "payload_hash": canonical_sha256(changed_payload),
        }
    )
    with pytest.raises(ArtifactProposalConflictError, match="different content"):
        store.persist(claim, changed)


def test_two_connections_converge_on_one_exact_proposal(tmp_path: Path) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = tuple(
            executor.map(
                lambda _: ArtifactProposalStore(database, clock=lambda: NOW).persist(
                    claim, proposal
                ),
                range(2),
            )
        )

    assert results[0] == results[1]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            1,
        )


def test_recovery_preserves_the_exact_immutable_skill_proposal(tmp_path: Path) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)
    first = ArtifactProposalStore(database, clock=lambda: NOW).persist(claim, proposal)
    later = NOW + timedelta(seconds=31)
    recovered_ledger = LocalTaskLedger(database, clock=lambda: later)
    summary = recovered_ledger.recover_expired_local_tasks()

    assert (summary.recovered, summary.requeued, summary.failed) == (1, 0, 0)
    assert ArtifactProposalStore(database).get(proposal.project_id, proposal.proposal_id) == first
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            1,
        )
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "NEEDS_REVIEW",
        )


@pytest.mark.parametrize(
    "update",
    (
        {"project_id": "prj_" + "f" * 32},
        {"producer_agent_run_id": "agr_" + "f" * 32},
        {"producer_skill_run_id": "skr_" + "f" * 32},
        {"target_artifact_type": "Screenplay"},
    ),
)
def test_proposal_must_match_the_frozen_attempt_snapshot(
    tmp_path: Path,
    update: dict[str, str],
) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)
    changed = proposal.model_copy(update=update)
    with pytest.raises(ArtifactProposalConflictError, match="frozen attempt"):
        ArtifactProposalStore(database, clock=lambda: NOW).persist(claim, changed)


def test_stale_lease_cannot_persist_a_proposal(tmp_path: Path) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)
    stale = replace(claim, lease_token="stale-token")
    with pytest.raises(LeaseLostError, match="stale or expired"):
        ArtifactProposalStore(database, clock=lambda: NOW).persist(stale, proposal)


def test_lock_wait_that_crosses_lease_expiry_fails_closed(tmp_path: Path) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)
    clock = [NOW]
    opened = Event()

    class ObservableStore(ArtifactProposalStore):
        def _open(self) -> sqlite3.Connection:
            connection = super()._open()
            opened.set()
            return connection

    blocker = sqlite3.connect(database, timeout=5, isolation_level=None)
    blocker.execute("BEGIN IMMEDIATE")
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                ObservableStore(database, clock=lambda: clock[0]).persist,
                claim,
                proposal,
            )
            assert opened.wait(timeout=2)
            clock[0] = NOW + timedelta(seconds=31)
            blocker.commit()
            with pytest.raises(LeaseLostError, match="stale or expired"):
                future.result(timeout=5)
    finally:
        blocker.close()


@pytest.mark.parametrize("sensitive_key", ("APIKey", "apikey", "openai_api_key"))
def test_open_proposal_payload_rejects_compact_sensitive_keys(
    tmp_path: Path,
    sensitive_key: str,
) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)
    payload = {"summary": "safe summary", sensitive_key: "must-not-persist"}
    changed = proposal.model_copy(
        update={"payload": payload, "payload_hash": canonical_sha256(payload)}
    )

    with pytest.raises(ArtifactProposalConflictError, match="sensitive"):
        ArtifactProposalStore(database, clock=lambda: NOW).persist(claim, changed)


@pytest.mark.parametrize("business_key", ("token_count", "token_budget"))
def test_open_proposal_payload_allows_noncredential_token_metrics(
    tmp_path: Path,
    business_key: str,
) -> None:
    database, _, _, claim, proposal = setup_claim(tmp_path)
    payload = {"summary": "safe summary", business_key: 42}
    changed = proposal.model_copy(
        update={"payload": payload, "payload_hash": canonical_sha256(payload)}
    )

    persisted = ArtifactProposalStore(database, clock=lambda: NOW).persist(claim, changed)

    assert persisted.proposal.payload[business_key] == 42
