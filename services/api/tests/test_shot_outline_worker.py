import json
import sqlite3
from datetime import timedelta
from time import monotonic, sleep

import pytest
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from aijian_api.shot_outline_worker import (
    ShotOutlineInvocationBuilder,
    shot_outline_fake_skill,
)
from aijian_api.source_extract_worker import LocalFakeSourceExtractWorker
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_snapshots import snapshot_sha256
from fastapi.testclient import TestClient
from test_proposal_run_create_api import HOST, ORIGIN, TOKEN, accepted_source, create_payload


def shot_outline_payload(source: tuple[str, str, str, str, int, int]) -> dict[str, object]:
    payload = create_payload(source)
    payload["agent_definition"] = {
        "definition_id": "director.shot-planner",
        "version": "1.0.0",
    }
    payload["skill_definition"] = {
        "definition_id": "shot.outline",
        "version": "1.0.0",
    }
    return payload


def test_shot_outline_post_runs_to_a_reviewable_eight_shot_proposal(tmp_path) -> None:
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
    created_response = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shot-outline-worker-v1"},
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()["data"]
    replayed_response = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shot-outline-worker-v1"},
    )
    assert replayed_response.status_code == 200
    assert replayed_response.json()["data"]["run_id"] == created["run_id"]

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
            task = next(
                item
                for item in client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"][
                    "tasks"
                ]
                if item["task"]["task_id"] == created["task"]["task_id"]
            )
            if task["proposal_id"] is not None and task["node"]["status"] == "NEEDS_REVIEW":
                break
            sleep(0.02)
        else:
            raise AssertionError("local Fake worker did not publish a ShotOutline proposal")
    finally:
        worker.stop()

    assert task["proposal_id"].startswith("prp_")
    proposal = client.get(f"/api/v1/projects/{project_id}/proposals/{task['proposal_id']}").json()[
        "data"
    ]["proposal"]
    assert proposal["target_artifact_type"] == "ShotOutline"
    assert proposal["payload"]["purpose"] == "DEVELOPMENT_FAKE_ONLY"
    assert [shot["ordinal"] for shot in proposal["payload"]["shots"]] == list(range(1, 9))
    assert len(proposal["payload"]["shots"]) == 8
    assert proposal["dependencies"] == [
        {
            "artifact_type": "SourceManifest",
            "version_id": source[1],
            "approval_required": True,
        }
    ]
    acceptance = client.post(
        f"/api/v1/projects/{project_id}/proposals/{task['proposal_id']}/acceptances",
        headers={"Idempotency-Key": "shot-outline-must-not-draft"},
        json={"parent_version_id": None, "expected_head_revision": None},
    )
    assert acceptance.status_code == 409


def test_one_supervisor_completes_source_and_shot_tasks_in_one_database(tmp_path) -> None:
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
    source_created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=create_payload(source),
        headers={"Idempotency-Key": "mixed-source-v1"},
    ).json()["data"]
    shot_created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "mixed-shot-v1"},
    ).json()["data"]

    worker = LocalFakeSourceExtractWorker(
        repository.database_path,
        poll_interval=timedelta(milliseconds=20),
        recovery_interval=timedelta(milliseconds=100),
        handler_timeout=timedelta(seconds=5),
    )
    worker.start()
    try:
        deadline = monotonic() + 5
        while monotonic() < deadline:
            tasks = client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]["tasks"]
            done = {
                item["task"]["task_id"]
                for item in tasks
                if item["proposal_id"] is not None and item["node"]["status"] == "NEEDS_REVIEW"
            }
            if {source_created["task"]["task_id"], shot_created["task"]["task_id"]} <= done:
                break
            sleep(0.02)
        else:
            raise AssertionError("one supervisor did not complete both supported task types")
    finally:
        worker.stop()


def test_source_and_shot_share_idempotency_namespace_without_cross_type_replay(tmp_path) -> None:
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
        headers={"Idempotency-Key": "shared-cross-type-key"},
    )
    assert created.status_code == 201
    conflict = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shared-cross-type-key"},
    )
    assert conflict.status_code == 409


def test_shot_outline_missing_enqueue_intent_is_idempotency_conflict_without_duplicates(
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
    payload = shot_outline_payload(source)
    headers = {"Idempotency-Key": "shot-missing-enqueue-intent"}
    created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs", json=payload, headers=headers
    )
    assert created.status_code == 201
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER proposal_run_enqueue_intents_immutable_delete")
        connection.execute("DELETE FROM proposal_run_enqueue_intents")

    replay = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs", json=payload, headers=headers
    )
    assert replay.status_code == 409
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM agent_runs").fetchone() == (1,)
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (1,)


def test_shot_outline_rejects_wrong_definition_and_invalid_source_coordinates(tmp_path) -> None:
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    source = accepted_source(client)
    other_source = accepted_source(client)
    project_id = source[0]

    wrong_definition = shot_outline_payload(source)
    wrong_definition["skill_definition"] = {
        "definition_id": "source.extract",
        "version": "1.0.0",
    }
    assert (
        client.post(
            f"/api/v1/projects/{project_id}/proposal-runs",
            json=wrong_definition,
            headers={"Idempotency-Key": "shot-invalid-definition"},
        ).status_code
        == 409
    )

    for index, mutate in enumerate(
        (
            lambda value: value.update({"source_manifest_version_id": "ver_" + "0" * 32}),
            lambda value: value.update({"source_manifest_version_id": other_source[1]}),
            lambda value: value.update({"source_document_id": "src_" + "0" * 32}),
            lambda value: value.update({"start_byte": source[4] + 1}),
        )
    ):
        invalid = shot_outline_payload(source)
        mutate(invalid)
        assert (
            client.post(
                f"/api/v1/projects/{project_id}/proposal-runs",
                json=invalid,
                headers={"Idempotency-Key": f"shot-invalid-source-{index}"},
            ).status_code
            == 409
        )

    assert client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]["tasks"] == []


def test_cancelled_shot_outline_is_not_revived_by_the_supervisor(tmp_path) -> None:
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
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shot-cancel-before-worker"},
    ).json()["data"]
    cancelled = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs/{created['run_id']}/cancellations",
        json={},
        headers={"Idempotency-Key": "shot-cancel-before-worker-cancel"},
    )
    assert cancelled.status_code == 201
    worker = LocalFakeSourceExtractWorker(
        repository.database_path, poll_interval=timedelta(milliseconds=20)
    )
    worker.start()
    try:
        sleep(0.25)
    finally:
        worker.stop()
    tasks = client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]["tasks"]
    assert tasks[0]["proposal_id"] is None
    assert tasks[0]["task"]["status"] == "CANCELLED"


def test_persisted_shot_proposal_recovers_to_needs_review_after_lease_expiry(tmp_path) -> None:
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
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shot-recovery-proposal"},
    ).json()["data"]
    ledger = LocalTaskLedger(repository.database_path)
    claim = ledger.claim_ready_task(
        worker_id="shot-recovery-test",
        lease_duration=timedelta(seconds=30),
        task_id=created["task"]["task_id"],
        task_kind="local.agent-skill.fake",
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    snapshot = ledger.read_agent_skill_snapshot(running)
    invocation = ShotOutlineInvocationBuilder(repository.database_path)(snapshot, running)
    proposal = shot_outline_fake_skill(snapshot, 0, invocation)
    persisted = ArtifactProposalStore(repository.database_path).persist(running, proposal)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute(
            "UPDATE task_ledger SET lease_expires_at = ? WHERE task_id = ?",
            ("2000-01-01T00:00:00+00:00", claim.task_id),
        )
    summary = ledger.recover_expired_local_tasks(task_kind="local.agent-skill.fake")
    assert summary.recovered == 1
    task = client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]["tasks"][0]
    assert task["proposal_id"] == persisted.proposal.proposal_id
    assert task["node"]["status"] == "NEEDS_REVIEW"


def test_shot_worker_rejects_tampered_frozen_workflow_identity(tmp_path) -> None:
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
    _created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shot-workflow-drift"},
    ).json()["data"]
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER workflow_definitions_immutable_update")
        connection.execute(
            "UPDATE workflow_definitions SET graph_json = ? WHERE definition_id = ?",
            (
                '{"nodes":["shot.outline"],"runtime":"tampered"}',
                "agent-skill-shot-outline-fake-runtime",
            ),
        )
    ledger = LocalTaskLedger(repository.database_path)
    claim = ledger.claim_ready_task(
        worker_id="shot-workflow-drift-test",
        lease_duration=timedelta(seconds=30),
        task_id=_created["task"]["task_id"],
        task_kind="local.agent-skill.fake",
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    snapshot = ledger.read_agent_skill_snapshot(running)
    with pytest.raises(PermissionError, match="workflow truth"):
        ShotOutlineInvocationBuilder(repository.database_path)(snapshot, running)


def test_supervisor_skips_future_shot_task_and_runs_ready_source_task(tmp_path) -> None:
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
    source_created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=create_payload(source),
        headers={"Idempotency-Key": "source-before-future-shot"},
    ).json()["data"]
    shot_created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "future-shot-task"},
    ).json()["data"]
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute(
            "UPDATE task_ledger SET available_at = ? WHERE task_id = ?",
            ("2999-01-01T00:00:00+00:00", shot_created["task"]["task_id"]),
        )
    worker = LocalFakeSourceExtractWorker(
        repository.database_path, poll_interval=timedelta(milliseconds=20)
    )
    worker.start()
    try:
        deadline = monotonic() + 5
        while monotonic() < deadline:
            tasks = client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]["tasks"]
            source_task = next(
                item
                for item in tasks
                if item["task"]["task_id"] == source_created["task"]["task_id"]
            )
            if source_task["proposal_id"] is not None:
                break
            sleep(0.02)
        else:
            raise AssertionError("future ShotOutline task blocked ready SourceExtraction")
    finally:
        worker.stop()
    shot_task = next(
        item for item in tasks if item["task"]["task_id"] == shot_created["task"]["task_id"]
    )
    assert shot_task["proposal_id"] is None


def test_supervisor_skips_unknown_output_type_without_blocking_source(tmp_path) -> None:
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
    source_created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=create_payload(source),
        headers={"Idempotency-Key": "source-before-unknown-shot"},
    ).json()["data"]
    shot_created = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "unknown-shot-task"},
    ).json()["data"]
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER workflow_attempt_snapshots_immutable_update")
        row = connection.execute(
            "SELECT snapshot_json FROM workflow_attempt_snapshots WHERE attempt_id = ?",
            (shot_created["task"]["attempt_id"],),
        ).fetchone()
        payload = json.loads(row[0])
        payload["output_artifact_type"] = "UnknownOutput"
        snapshot_json = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        connection.execute(
            "UPDATE workflow_attempt_snapshots SET snapshot_json = ?, snapshot_hash = ? "
            "WHERE attempt_id = ?",
            (snapshot_json, snapshot_sha256(snapshot_json), shot_created["task"]["attempt_id"]),
        )
    worker = LocalFakeSourceExtractWorker(
        repository.database_path, poll_interval=timedelta(milliseconds=20)
    )
    worker.start()
    try:
        deadline = monotonic() + 5
        while monotonic() < deadline:
            tasks = client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]["tasks"]
            source_task = next(
                item
                for item in tasks
                if item["task"]["task_id"] == source_created["task"]["task_id"]
            )
            if source_task["proposal_id"] is not None:
                break
            sleep(0.02)
        else:
            raise AssertionError("unknown task blocked ready SourceExtraction")
    finally:
        worker.stop()
