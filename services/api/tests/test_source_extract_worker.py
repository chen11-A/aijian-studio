import hashlib
import json
import sqlite3
from datetime import timedelta
from time import monotonic, sleep

import pytest
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from aijian_api.source_extract_worker import (
    LocalFakeSourceExtractWorker,
    SourceExtractInvocationBuilder,
)
from aijian_api.task_ledger import LocalTaskLedger
from fastapi.testclient import TestClient
from test_proposal_run_create_api import HOST, ORIGIN, TOKEN, accepted_source, create_payload


def test_production_fake_worker_turns_a_real_ready_task_into_a_reviewable_proposal(
    tmp_path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    source = accepted_source(client)
    project_id = source[0]
    with sqlite3.connect(repository.database_path) as connection:
        materialized_before = tuple(
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("artifacts", "artifact_versions", "artifact_heads", "gate_decisions")
        )
    created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=create_payload(source),
        headers={"Idempotency-Key": "worker-source-extract-v1"},
    ).json()["data"]
    worker = LocalFakeSourceExtractWorker(
        repository.database_path,
        poll_interval=timedelta(milliseconds=20),
        recovery_interval=timedelta(milliseconds=100),
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=5),
    )
    worker.start()
    try:
        deadline = monotonic() + 5
        while monotonic() < deadline:
            tasks = client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]
            task = next(
                item
                for item in tasks["tasks"]
                if item["task"]["task_id"] == created["task"]["task_id"]
            )
            if task["proposal_id"] is not None and task["task"]["status"] == "COMPLETED":
                break
            sleep(0.02)
        else:
            raise AssertionError("local Fake worker did not publish a proposal in time")
    finally:
        worker.stop()

    assert task["task"]["status"] == "COMPLETED"
    assert task["node"]["status"] == "NEEDS_REVIEW"
    assert task["proposal_id"].startswith("prp_")
    proposal = client.get(f"/api/v1/projects/{project_id}/proposals/{task['proposal_id']}").json()[
        "data"
    ]["proposal"]
    assert proposal["producer_agent_run_id"] == created["agent_run"]["agent_run_id"]
    assert proposal["producer_skill_run_id"] == created["skill_run"]["skill_run_id"]
    assert proposal["dependencies"] == [
        {
            "artifact_type": "SourceManifest",
            "version_id": source[1],
            "approval_required": True,
        }
    ]
    assert proposal["source_spans"][0] == {
        "source_span_id": proposal["source_spans"][0]["source_span_id"],
        "source_document_id": source[2],
        "source_block_id": source[3],
        "start_byte": source[4],
        "end_byte": source[5],
        "claim": "所选原文片段已作为后续改编的来源证据。",
        "quote_hash": proposal["source_spans"][0]["quote_hash"],
    }
    source_document = repository.get_source(project_id, source[2])
    excerpt = source_document.normalized_text.encode("utf-8")[source[4] : source[5]]
    excerpt_digest = hashlib.sha256(excerpt).hexdigest()
    expected_span_id = (
        "spn_"
        + canonical_sha256(
            {
                "project_id": project_id,
                "source_document_id": source[2],
                "source_block_id": source[3],
                "start_byte": source[4],
                "end_byte": source[5],
                "content_sha256": excerpt_digest,
            }
        ).removeprefix("sha256:")[:32]
    )
    assert proposal["source_spans"][0]["source_span_id"] == expected_span_id
    assert proposal["source_spans"][0]["quote_hash"] == f"sha256:{excerpt_digest}"
    assert proposal["cost"] == {
        "currency": "USD",
        "estimated_micros": 0,
        "actual_micros": 0,
    }
    assert proposal["capability_losses"] == [
        {
            "code": "local-fake.no-semantic-extraction",
            "description": "本地 Fake 仅建立证据链，不执行真实语义抽取。",
        }
    ]
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute(
            "SELECT status FROM agent_runs WHERE agent_run_id = ?",
            (created["agent_run"]["agent_run_id"],),
        ).fetchone() == ("NEEDS_REVIEW",)
        assert connection.execute(
            "SELECT status, proposal_id FROM skill_runs WHERE skill_run_id = ?",
            (created["skill_run"]["skill_run_id"],),
        ).fetchone() == ("NEEDS_REVIEW", task["proposal_id"])
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
            (created["attempt"]["attempt_id"],),
        ).fetchone() == ("RUNNING", None)
        assert connection.execute(
            "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
            (created["task"]["workflow_run_id"],),
        ).fetchone() == ("ACTIVE",)
        assert (
            tuple(
                connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in ("artifacts", "artifact_versions", "artifact_heads", "gate_decisions")
            )
            == materialized_before
        )
    assert not LocalTaskLedger(repository.database_path).claim_ready_task(
        worker_id="duplicate-worker",
        lease_duration=timedelta(seconds=30),
        task_id=created["task"]["task_id"],
    )


def test_worker_stops_promptly_while_sqlite_is_locked(tmp_path) -> None:
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    blocker = sqlite3.connect(repository.database_path, timeout=5, isolation_level=None)
    blocker.execute("BEGIN IMMEDIATE")
    worker = LocalFakeSourceExtractWorker(
        repository.database_path,
        poll_interval=timedelta(milliseconds=20),
    )
    try:
        worker.start()
        sleep(0.05)
        started = monotonic()
        worker.stop(timeout=4)
        assert monotonic() - started < 1
    finally:
        blocker.rollback()
        blocker.close()


def test_invocation_builder_fails_closed_on_a_duplicate_exact_task(tmp_path) -> None:
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    source = accepted_source(client)
    project_id = source[0]
    created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=create_payload(source),
        headers={"Idempotency-Key": "duplicate-task-worker-v1"},
    ).json()["data"]
    ledger = LocalTaskLedger(repository.database_path)
    claim = ledger.claim_ready_task(
        worker_id="truth-test-worker",
        lease_duration=timedelta(seconds=30),
        task_id=created["task"]["task_id"],
        task_kind="local.agent-skill.fake",
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    snapshot = ledger.read_agent_skill_snapshot(running)
    builder = SourceExtractInvocationBuilder(repository.database_path)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute(
            """
            INSERT INTO task_ledger (
                task_id, attempt_id, task_kind, status, priority, available_at,
                lease_generation, revision, created_at, updated_at
            )
            SELECT 'task_00000000000000000000000000000000', attempt_id, task_kind,
                   'COMPLETED', priority, available_at, 0, 1, created_at, updated_at
            FROM task_ledger WHERE task_id = ?
            """,
            (running.task_id,),
        )
        connection.commit()

    with pytest.raises(PermissionError, match="one exact frozen task"):
        builder(snapshot, running)


def test_invocation_builder_fails_closed_on_self_consistent_workflow_graph_drift(
    tmp_path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    source = accepted_source(client)
    project_id = source[0]
    created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=create_payload(source),
        headers={"Idempotency-Key": "graph-drift-worker-v1"},
    ).json()["data"]
    ledger = LocalTaskLedger(repository.database_path)
    claim = ledger.claim_ready_task(
        worker_id="truth-test-worker",
        lease_duration=timedelta(seconds=30),
        task_id=created["task"]["task_id"],
        task_kind="local.agent-skill.fake",
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    snapshot = ledger.read_agent_skill_snapshot(running)
    builder = SourceExtractInvocationBuilder(repository.database_path)
    drifted_graph = {"nodes": ["source.extract"], "runtime": "tampered-local-fake-v1"}
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER workflow_definitions_immutable_update")
        connection.execute(
            """
            UPDATE workflow_definitions
            SET graph_json = ?, definition_hash = ?
            WHERE definition_id = 'agent-skill-fake-runtime' AND version = 1
            """,
            (
                json.dumps(drifted_graph, separators=(",", ":"), sort_keys=True),
                canonical_sha256(drifted_graph),
            ),
        )
        connection.commit()

    with pytest.raises(PermissionError, match="detached from enqueue intent"):
        builder(snapshot, running)
