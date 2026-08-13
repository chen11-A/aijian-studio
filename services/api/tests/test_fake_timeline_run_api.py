from __future__ import annotations

import base64
import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.fake_media_package import FakeMediaPackageError, FakeMediaPackageGenerator
from aijian_api.fake_timeline_run import FakeTimelineRunFactory, LocalFakeTimelineWorker
from aijian_api.main import create_app
from aijian_api.media_toolchain import discover_media_toolchain, load_media_toolchain_lock
from aijian_api.repository import ArtifactNotFoundError, StudioRepository
from aijian_api.security import SidecarSecurity
from aijian_api.task_ledger import LocalTaskLedger
from fastapi.testclient import TestClient

TOKEN = "t" * 43
HOST = "127.0.0.1:43129"
ORIGIN = "app://aijian"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def _generator(workspace: Path) -> FakeMediaPackageGenerator:
    lock = load_media_toolchain_lock(REPOSITORY_ROOT / "config" / "media-toolchain-lock.json")
    toolchain = discover_media_toolchain(lock)
    workspace.mkdir(parents=True, exist_ok=True)
    return FakeMediaPackageGenerator.from_locked_tool_root(
        workspace,
        lock,
        toolchain.ffmpeg_path.parent,
    )


def _approve_manifest(client: TestClient, project_id: str, version_id: str, etag: str) -> None:
    revision = int(etag.strip('"').removeprefix("revision-"))
    base = f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}"
    prepared = client.post(f"{base}:prepare-submit", headers={"If-Match": etag}, json={})
    assert prepared.status_code == 200
    confirmation = {
        "challenge_id": prepared.json()["data"]["challenge"]["id"],
        "confirmation_token": prepared.json()["data"]["confirmation_token"],
    }
    submitted = client.post(f"{base}:submit", headers={"If-Match": etag}, json=confirmation)
    assert submitted.status_code == 200
    signoff_etag = f'"revision-{revision + 1}"'
    prepared = client.post(f"{base}:prepare-signoff", headers={"If-Match": signoff_etag}, json={})
    assert prepared.status_code == 200
    confirmation = {
        "challenge_id": prepared.json()["data"]["challenge"]["id"],
        "confirmation_token": prepared.json()["data"]["confirmation_token"],
    }
    signed = client.post(f"{base}/signoffs", headers={"If-Match": signoff_etag}, json=confirmation)
    assert signed.status_code == 200
    signoff_report_id = prepared.json()["data"]["report"]["id"]
    decision_etag = f'"revision-{revision + 2}"'
    rationale = "来源、哈希和范围已经人工确认。"
    prepared = client.post(
        f"{base}:prepare-decision",
        headers={"If-Match": decision_etag},
        json={
            "decision": "approved",
            "rationale": rationale,
            "readiness_report_id": signoff_report_id,
        },
    )
    assert prepared.status_code == 200
    confirmation = {
        "challenge_id": prepared.json()["data"]["challenge"]["id"],
        "confirmation_token": prepared.json()["data"]["confirmation_token"],
        "decision": "approved",
        "rationale": rationale,
    }
    decided = client.post(
        f"{base}/decisions", headers={"If-Match": decision_etag}, json=confirmation
    )
    assert decided.status_code == 200


def _project_and_source(
    client: TestClient, *, approve_manifest: bool = False
) -> tuple[str, str, str]:
    project = client.post(
        "/api/v1/projects",
        json={
            "name": "雾城来信",
            "aspect_ratio": "9:16",
            "target_duration_seconds": 90,
            "source_language": "zh-CN",
        },
    )
    assert project.status_code == 201
    project_id = str(project.json()["data"]["id"])
    source = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={
            "filename": "golden.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode("第一章\n雨夜来信。".encode()).decode(),
        },
    )
    assert source.status_code == 201
    source_id = str(source.json()["data"]["id"])
    manifest = client.get(f"/api/v1/projects/{project_id}/source-manifest")
    assert manifest.status_code == 200
    version_id = str(manifest.json()["data"]["latest_version"]["id"])
    if approve_manifest:
        _approve_manifest(client, project_id, version_id, str(manifest.headers["etag"]))
    return project_id, source_id, version_id


def _sidecar_client(
    repository: StudioRepository,
    factory: FakeTimelineRunFactory,
) -> TestClient:
    client = TestClient(
        create_app(
            repository=repository,
            sidecar_security=SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN),
            fake_timeline_run_factory=factory,
        ),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    return client


def _command(source_id: str, manifest_version_id: str) -> dict[str, str]:
    return {
        "source_document_id": source_id,
        "source_manifest_version_id": manifest_version_id,
    }


def _operation(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012x}"


def test_fake_timeline_run_creation_is_sidecar_only(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    client = TestClient(create_app(repository=repository))
    project_id, source_id, manifest_version_id = _project_and_source(client)

    response = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(1)}"},
        json=_command(source_id, manifest_version_id),
    )

    assert response.status_code == 404
    with repository._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_runs").fetchone()[0] == 0

    unavailable = TestClient(
        create_app(
            repository=repository,
            sidecar_security=SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN),
        ),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    unavailable.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    response = unavailable.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(11)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "FAKE_TIMELINE_RUNTIME_UNAVAILABLE"


def test_sidecar_enqueues_once_without_materializing_media_in_request(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    factory = FakeTimelineRunFactory(repository, generator)
    client = _sidecar_client(repository, factory)
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    headers = {"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(2)}"}

    first = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers=headers,
        json=_command(source_id, manifest_version_id),
    )
    replay = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers=headers,
        json=_command(source_id, manifest_version_id),
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["data"] == first.json()["data"]
    data = first.json()["data"]
    assert data["project_id"] == project_id
    assert data["source_document_id"] == source_id
    assert data["source_manifest_version_id"] == manifest_version_id
    assert data["task_status"] == "READY"
    assert data["attempt_status"] == "READY"
    assert data["capability_losses"] == [
        "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
        "STATIC_FRAME_NO_MOTION_GENERATION",
        "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    ]
    assert not (workspace / "fake-media").exists()
    with repository._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_runs").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0] == 1
    try:
        repository.get_latest_artifact(project_id, "timeline")
    except ArtifactNotFoundError:
        pass
    else:  # pragma: no cover - assertion branch
        raise AssertionError("request thread must not create a Timeline")

    changed = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers=headers,
        json=_command(f"src_{'f' * 32}", manifest_version_id),
    )
    duplicate = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(20)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert changed.status_code == 409
    assert duplicate.status_code == 409


def test_toolchain_drift_is_a_stable_unavailable_error_without_enqueuing(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    client = _sidecar_client(repository, FakeTimelineRunFactory(repository, generator))
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    generator._toolchain = replace(  # type: ignore[attr-defined]
        generator._toolchain,  # type: ignore[attr-defined]
        ffmpeg_sha256=f"sha256:{'0' * 64}",
    )

    response = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(15)}"},
        json=_command(source_id, manifest_version_id),
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "FAKE_TIMELINE_RUNTIME_UNAVAILABLE"
    with repository._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_runs").fetchone()[0] == 0


def test_concurrent_create_requests_converge_on_one_durable_run(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    factory = FakeTimelineRunFactory(repository, _generator(workspace))
    client = _sidecar_client(repository, factory)
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    key = f"fake-timeline-run:create:v1:{_operation(12)}"

    def create() -> tuple[str, bool]:
        receipt = factory.create(
            project_id=project_id,
            source_manifest_version_id=manifest_version_id,
            source_document_id=source_id,
            idempotency_key=key,
        )
        return receipt.workflow_run_id, receipt.created

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: create(), range(2)))

    assert len({workflow_id for workflow_id, _created in results}) == 1
    assert sorted(created for _workflow_id, created in results) == [False, True]
    with repository._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_runs").fetchone()[0] == 1


def test_concurrent_distinct_keys_for_one_frozen_input_create_exactly_one_run(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    factory = FakeTimelineRunFactory(repository, _generator(workspace))
    client = _sidecar_client(repository, factory)
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)

    def create(number: int) -> str:
        try:
            receipt = factory.create(
                project_id=project_id,
                source_manifest_version_id=manifest_version_id,
                source_document_id=source_id,
                idempotency_key=f"fake-timeline-run:create:v1:{_operation(number)}",
            )
            return f"created:{receipt.workflow_run_id}"
        except Exception as error:
            return type(error).__name__

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, (16, 17)))

    assert sum(result.startswith("created:") for result in results) == 1
    assert results.count("FakeTimelineRunConflictError") == 1
    with repository._connection() as connection:
        counts = connection.execute(
            """
            SELECT (SELECT COUNT(*) FROM workflow_runs),
                   (SELECT COUNT(*) FROM workflow_node_runs),
                   (SELECT COUNT(*) FROM workflow_attempts),
                   (SELECT COUNT(*) FROM task_ledger)
            """
        ).fetchone()
        assert tuple(counts) == (1, 1, 1, 1)


def test_worker_materializes_real_media_and_completes_timeline_with_recovery_receipt(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    factory = FakeTimelineRunFactory(repository, generator)
    client = _sidecar_client(repository, factory)
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    created = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(3)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert created.status_code == 201

    worker = LocalFakeTimelineWorker(
        repository.database_path,
        generator,
        poll_interval_seconds=0.02,
        recovery_interval_seconds=0.05,
    )
    assert worker.run_once()

    timeline_record = repository.get_latest_artifact(project_id, "timeline")
    timeline = timeline_record.version.content
    assert sum(int(clip["duration_frames"]) for clip in timeline["clips"]) == 375
    generated = generator.materialize(
        project_id=project_id,
        source_document_id=source_id,
        source_sha256=f"sha256:{repository.get_source(project_id, source_id).raw_sha256}",
    )
    expected_hashes = [shot.preview_video.sha256 for shot in generated.manifest.shots]
    assert [asset["source_asset_sha256"] for asset in timeline["assets"]] == expected_hashes
    assert [asset["source_frame_count"] for asset in timeline["assets"]] == [125, 125, 125]
    for shot, expected in zip(generated.manifest.shots, expected_hashes, strict=True):
        with generated.resolve(shot.preview_video).open("rb") as stream:
            actual = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
        assert actual == expected

    tasks = client.get(f"/api/v1/projects/{project_id}/tasks")
    assert tasks.status_code == 200
    item = tasks.json()["data"]["tasks"][0]
    assert item["task"]["status"] == "COMPLETED"
    assert item["attempt"]["status"] == "SUCCEEDED"
    assert item["node"]["status"] == "SUCCEEDED"
    assert item["node"]["output_version_id"] == timeline_record.version.id
    with repository._connection() as connection:
        run = connection.execute(
            "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
            (created.json()["data"]["workflow_run_id"],),
        ).fetchone()
        assert run is not None and str(run["status"]) == "SUCCEEDED"
        assert (
            connection.execute(
                "SELECT producer_attempt_id FROM artifact_versions WHERE version_id = ?",
                (timeline_record.version.id,),
            ).fetchone()[0]
            == created.json()["data"]["attempt_id"]
        )
        dependency = connection.execute(
            """
            SELECT upstream_version_id, relationship, impact
            FROM artifact_dependencies WHERE downstream_version_id = ?
            """,
            (timeline_record.version.id,),
        ).fetchall()
        assert [tuple(row) for row in dependency] == [
            (manifest_version_id, "derived_from", "blocking")
        ]
        head = connection.execute(
            """
            SELECT accepted_version_id FROM artifact_heads
            WHERE artifact_id = ?
            """,
            (timeline_record.version.artifact_id,),
        ).fetchone()
        assert head is not None and head["accepted_version_id"] is None
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM gate_decisions WHERE version_id = ?",
                (timeline_record.version.id,),
            ).fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM review_submissions WHERE version_id = ?",
                (timeline_record.version.id,),
            ).fetchone()[0]
            == 0
        )

    compatible = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    assert compatible.status_code == 200
    assert compatible.json()["data"]["version_id"] == timeline_record.version.id
    assert compatible.json()["data"]["total_duration_frames"] == 375
    replay = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(3)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert replay.status_code == 200
    assert replay.json()["data"]["attempt_status"] == "SUCCEEDED"
    assert replay.json()["data"]["task_status"] == "COMPLETED"


def test_unaccepted_manifest_is_rejected_without_enqueuing(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    client = _sidecar_client(repository, FakeTimelineRunFactory(repository, _generator(workspace)))
    project_id, source_id, manifest_version_id = _project_and_source(client)

    response = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(4)}"},
        json=_command(source_id, manifest_version_id),
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "FAKE_TIMELINE_RUN_INPUT_REJECTED"
    with repository._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_runs").fetchone()[0] == 0


def test_worker_claims_only_its_exact_task_kind(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    client = _sidecar_client(repository, FakeTimelineRunFactory(repository, generator))
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    created = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(5)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert created.status_code == 201
    ledger = LocalTaskLedger(repository.database_path)
    other = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="other-local-task",
        definition_version=1,
        definition_hash=f"sha256:{'1' * 64}",
        graph={"nodes": ["other"]},
        workflow_input_hash=f"sha256:{'2' * 64}",
        node_key="other",
        node_type="other",
        contract_version=1,
        input_bindings={},
        node_input_hash=f"sha256:{'2' * 64}",
        request_fingerprint=f"sha256:{'3' * 64}",
        idempotency_key="other:task",
        max_attempts=1,
        task_kind="local.other",
        priority=100,
        available_at=datetime.now(UTC),
    )

    assert LocalFakeTimelineWorker(repository.database_path, generator).run_once()

    with repository._connection() as connection:
        assert (
            connection.execute(
                "SELECT status FROM task_ledger WHERE task_id = ?", (other.task_id,)
            ).fetchone()[0]
            == "READY"
        )


def test_committed_timeline_is_recovered_after_completion_crash(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    client = _sidecar_client(repository, FakeTimelineRunFactory(repository, generator))
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    created = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(6)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert created.status_code == 201

    def crash(phase: str) -> None:
        if phase == "artifact_persisted":
            raise RuntimeError("injected crash after durable output")

    worker = LocalFakeTimelineWorker(
        repository.database_path,
        generator,
        lease_duration=timedelta(seconds=1),
        fault_hook=crash,
    )
    try:
        worker.run_once()
    except RuntimeError as error:
        assert str(error) == "injected crash after durable output"
    else:  # pragma: no cover - assertion branch
        raise AssertionError("fault hook did not interrupt completion")
    incomplete = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    assert incomplete.status_code == 409
    assert incomplete.json()["error"]["code"] == "TIMELINE_ALREADY_EXISTS"
    time.sleep(1.1)
    summary = LocalTaskLedger(repository.database_path).recover_expired_local_tasks(
        task_kind="local.timeline.assemble.fake.media.v1"
    )
    assert summary.recovered == summary.succeeded == 1
    with repository._connection() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM artifact_versions WHERE producer_attempt_id = ?",
                (created.json()["data"]["attempt_id"],),
            ).fetchone()[0]
            == 1
        )
        states = connection.execute(
            """
            SELECT run.status, node.status, attempt.status, task.status
            FROM workflow_runs AS run
            JOIN workflow_node_runs AS node ON node.workflow_run_id = run.workflow_run_id
            JOIN workflow_attempts AS attempt ON attempt.node_run_id = node.node_run_id
            JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
            WHERE run.workflow_run_id = ?
            """,
            (created.json()["data"]["workflow_run_id"],),
        ).fetchone()
        assert tuple(states) == ("SUCCEEDED", "SUCCEEDED", "SUCCEEDED", "COMPLETED")
    compatible = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    assert compatible.status_code == 200


def test_sidecar_openapi_publishes_typed_run_but_public_openapi_does_not(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    public_schema = create_app(repository=repository).openapi()
    sidecar_schema = create_app(
        repository=repository,
        sidecar_security=SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN),
        fake_timeline_run_factory=FakeTimelineRunFactory(repository, _generator(workspace)),
    ).openapi()

    path = "/api/v1/projects/{project_id}/fake-timeline-runs"
    assert path not in public_schema["paths"]
    operation = sidecar_schema["paths"][path]["post"]
    assert operation["operationId"] == "createFakeTimelineRun"
    assert "FakeTimelineRunResponse" in str(operation["responses"]["201"])
    assert "FakeTimelineRunResponse" in str(operation["responses"]["200"])


def test_deterministic_media_failure_closes_all_run_states(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    client = _sidecar_client(repository, FakeTimelineRunFactory(repository, generator))
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    created = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(7)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert created.status_code == 201

    generator._fault_hook = lambda phase: (
        (_ for _ in ()).throw(FakeMediaPackageError("injected media failure"))
        if phase == "shots_generated"
        else None
    )
    worker = LocalFakeTimelineWorker(repository.database_path, generator)
    try:
        worker.run_once()
    except FakeMediaPackageError:
        pass
    else:  # pragma: no cover - assertion branch
        raise AssertionError("media failure was not propagated")

    with repository._connection() as connection:
        states = connection.execute(
            """
            SELECT run.status, node.status, attempt.status, attempt.error_code, task.status
            FROM workflow_runs AS run
            JOIN workflow_node_runs AS node ON node.workflow_run_id = run.workflow_run_id
            JOIN workflow_attempts AS attempt ON attempt.node_run_id = node.node_run_id
            JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
            WHERE run.workflow_run_id = ?
            """,
            (created.json()["data"]["workflow_run_id"],),
        ).fetchone()
        assert tuple(states) == (
            "FAILED",
            "FAILED",
            "FAILED",
            "FAKE_MEDIA_GENERATION_FAILED",
            "COMPLETED",
        )
        assert (
            connection.execute(
                """
                SELECT COUNT(*)
                FROM artifact_versions AS version
                JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
                WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline'
                """,
                (project_id,),
            ).fetchone()[0]
            == 0
        )


def test_worker_fails_closed_when_accepted_manifest_changes_after_enqueue(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    client = _sidecar_client(repository, FakeTimelineRunFactory(repository, generator))
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    created = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(13)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert created.status_code == 201

    source = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={
            "filename": "changed.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode(b"changed source").decode(),
        },
    )
    assert source.status_code == 201
    latest_manifest = client.get(f"/api/v1/projects/{project_id}/source-manifest")
    assert latest_manifest.status_code == 200
    latest_version_id = str(latest_manifest.json()["data"]["latest_version"]["id"])
    assert latest_version_id != manifest_version_id
    _approve_manifest(client, project_id, latest_version_id, str(latest_manifest.headers["etag"]))

    worker = LocalFakeTimelineWorker(repository.database_path, generator)
    with pytest.raises(PermissionError, match="no longer accepted"):
        worker.run_once()
    with repository._connection() as connection:
        states = connection.execute(
            """
            SELECT run.status, node.status, attempt.status, task.status
            FROM workflow_runs AS run
            JOIN workflow_node_runs AS node ON node.workflow_run_id = run.workflow_run_id
            JOIN workflow_attempts AS attempt ON attempt.node_run_id = node.node_run_id
            JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
            WHERE run.workflow_run_id = ?
            """,
            (created.json()["data"]["workflow_run_id"],),
        ).fetchone()
        assert tuple(states) == ("FAILED", "FAILED", "FAILED", "COMPLETED")
        assert (
            connection.execute(
                """
                SELECT COUNT(*) FROM artifacts
                WHERE project_id = ? AND artifact_type = 'timeline'
                """,
                (project_id,),
            ).fetchone()[0]
            == 0
        )


def test_running_worker_stops_promptly_without_failing_the_leased_task(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    repository = StudioRepository(workspace / "workspace.sqlite3")
    generator = _generator(workspace)
    client = _sidecar_client(repository, FakeTimelineRunFactory(repository, generator))
    project_id, source_id, manifest_version_id = _project_and_source(client, approve_manifest=True)
    created = client.post(
        f"/api/v1/projects/{project_id}/fake-timeline-runs",
        headers={"Idempotency-Key": f"fake-timeline-run:create:v1:{_operation(14)}"},
        json=_command(source_id, manifest_version_id),
    )
    assert created.status_code == 201
    entered = threading.Event()

    def blocked_materialize(**kwargs: object) -> object:
        stop_requested = kwargs["stop_requested"]
        assert callable(stop_requested)
        entered.set()
        while not stop_requested():
            time.sleep(0.01)
        raise FakeMediaPackageError("stopped")

    generator.materialize = blocked_materialize  # type: ignore[method-assign]
    worker = LocalFakeTimelineWorker(
        repository.database_path,
        generator,
        poll_interval_seconds=0.01,
    )
    worker.start()
    assert entered.wait(2.0)
    started = time.monotonic()
    worker.stop(timeout=3.0)
    assert time.monotonic() - started < 3.0

    with repository._connection() as connection:
        states = connection.execute(
            """
            SELECT run.status, node.status, attempt.status, task.status
            FROM workflow_runs AS run
            JOIN workflow_node_runs AS node ON node.workflow_run_id = run.workflow_run_id
            JOIN workflow_attempts AS attempt ON attempt.node_run_id = node.node_run_id
            JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
            WHERE run.workflow_run_id = ?
            """,
            (created.json()["data"]["workflow_run_id"],),
        ).fetchone()
        assert tuple(states) == ("ACTIVE", "RUNNING", "RUNNING", "LEASED")
