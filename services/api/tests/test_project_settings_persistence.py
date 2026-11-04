"""Real workspace transactions and API recovery; no provider or native execution."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.main import create_app
from aijian_api.project_management import update_project
from aijian_api.project_management_contracts import UpdateProjectRequest
from aijian_api.project_settings_contracts import UpdateProjectSettingsRequestV1
from aijian_api.project_settings_store import ProjectSettingsStore, SettingsConflictError
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient


@pytest.fixture
def env(tmp_path: Path):
    repository = StudioRepository(tmp_path / "workspace.db")
    client = TestClient(create_app(repository=repository))

    def create(name):
        return repository.create_project(
            name=name, aspect_ratio="9:16", target_duration_seconds=90, source_language="zh-CN"
        ).id

    return repository, client, create("A"), create("B")


def command(revision=1, **changes):
    return {
        "operation_id": f"pso_{uuid4().hex}",
        "expected_project_revision": revision,
        "changes": changes or {"description": "已保存\n项目说明😀"},
    }


def test_settings_share_project_revision_but_leave_episodes_and_artifacts_unchanged(env):
    repo, client, a, b = env
    a_episodes = repo.list_episodes(a)
    b_before = client.get(f"/api/v1/projects/{b}/settings").json()["data"]
    with repo._connection() as connection:
        artifact_before = [
            tuple(row) for row in connection.execute("SELECT * FROM artifact_versions")
        ]
    payload = command(
        name="作品新名",
        description="准确说明",
        sequence_timebase={
            "frame_rate": {"num": 30000, "den": 1001},
            "timecode_mode": "DROP_FRAME",
        },
    )
    response = client.post(f"/api/v1/projects/{a}/settings", json=payload)
    assert response.status_code == 200
    receipt = response.json()["data"]
    assert receipt["request_hash"] == canonical_content_hash({"project_id": a, **payload})
    assert receipt["result_revision"] == 2
    assert receipt["result"]["sequence_timebase"] == payload["changes"]["sequence_timebase"]
    assert repo.get_project(a).name == "作品新名"
    assert repo.list_episodes(a) == a_episodes
    assert client.get(f"/api/v1/projects/{b}/settings").json()["data"] == b_before
    with repo._connection() as connection:
        assert [
            tuple(row) for row in connection.execute("SELECT * FROM artifact_versions")
        ] == artifact_before
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0] == 0


def test_receipt_survives_restart_later_revision_and_same_operation_replay(env):
    repo, client, a, b = env
    payload = command()
    first = client.post(f"/api/v1/projects/{a}/settings", json=payload).json()["data"]
    assert (
        client.post(
            f"/api/v1/projects/{a}/settings", json=command(2, description="后续")
        ).status_code
        == 200
    )
    restarted = TestClient(create_app(repository=StudioRepository(repo._database_path)))
    historical = restarted.get(
        f"/api/v1/projects/{a}/settings/operations/{payload['operation_id']}"
    )
    assert historical.status_code == 200
    assert historical.json()["data"] == first
    assert restarted.post(f"/api/v1/projects/{a}/settings", json=payload).json()["data"] == first
    assert restarted.get(f"/api/v1/projects/{a}/settings").json()["data"]["revision"] == 3
    assert (
        restarted.get(
            f"/api/v1/projects/{b}/settings/operations/{payload['operation_id']}"
        ).status_code
        == 404
    )


def test_operation_identity_conflict_and_legacy_cas_are_atomic(env):
    repo, client, a, _ = env
    payload = command()
    assert client.post(f"/api/v1/projects/{a}/settings", json=payload).status_code == 200
    payload["changes"]["description"] = "替换原操作内容"
    assert client.post(f"/api/v1/projects/{a}/settings", json=payload).status_code == 409
    update_project(
        repo, project_id=a, payload=UpdateProjectRequest(name="旧接口改名"), expected_revision=2
    )
    assert client.post(f"/api/v1/projects/{a}/settings", json=command(2)).status_code == 409
    assert client.get(f"/api/v1/projects/{a}/settings").json()["data"]["name"] == "旧接口改名"


def test_noop_receipt_and_explicit_clear_differ_from_omitted_timebase(env):
    _, client, a, _ = env
    root = f"/api/v1/projects/{a}/settings"
    noop = command(name="A")
    assert client.post(root, json=noop).json()["data"]["result_revision"] == 1
    set_rate = command(
        sequence_timebase={"frame_rate": {"num": 24, "den": 1}, "timecode_mode": "NON_DROP_FRAME"}
    )
    assert client.post(root, json=set_rate).json()["data"]["result_revision"] == 2
    assert (
        client.post(root, json=command(2, name="A2")).json()["data"]["result"]["sequence_timebase"]
        is not None
    )
    assert (
        client.post(root, json=command(3, sequence_timebase=None)).json()["data"]["result"][
            "sequence_timebase"
        ]
        is None
    )


@pytest.mark.parametrize("step", ["project_updated", "receipt_inserted"])
def test_transaction_failure_rolls_back_metadata_and_receipt(env, step):
    repo, client, a, _ = env

    def fail(operation, reached):
        if operation == "project_settings" and reached == step:
            raise RuntimeError("controlled failure")

    repo._transaction_hook = fail
    payload = command(name="不能落盘")
    assert client.post(f"/api/v1/projects/{a}/settings", json=payload).status_code == 500
    assert repo.get_project(a).revision == 1
    assert repo.get_project(a).name == "A"
    assert (
        client.get(
            f"/api/v1/projects/{a}/settings/operations/{payload['operation_id']}"
        ).status_code
        == 404
    )


def test_two_concurrent_writers_only_one_commits(env):
    repo, _, a, _ = env
    requests = [
        UpdateProjectSettingsRequestV1.model_validate(command(description=str(i))) for i in range(2)
    ]

    def write(payload):
        try:
            return ProjectSettingsStore(repo).write(a, payload).result_revision
        except SettingsConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, requests))
    assert sorted(str(x) for x in results) == ["2", "conflict"]
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM project_settings_write_receipts").fetchone()[0]
            == 1
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"aspect_ratio": "16:9"},
        {"description": None},
        {},
        {"name": "a\u200bb"},
        {"description": "x\ud800"},
        {"sequence_timebase": {"frame_rate": {"num": 24, "den": 1}, "timecode_mode": "DROP_FRAME"}},
    ],
)
def test_invalid_or_unsupported_settings_do_not_write(env, changes):
    repo, client, a, _ = env
    payload = command()
    payload["changes"] = changes
    assert (
        client.post(
            f"/api/v1/projects/{a}/settings",
            content=json.dumps(payload),
            headers={"Content-Type": "application/json"},
        ).status_code
        == 422
    )
    assert repo.get_project(a).revision == 1


def test_bad_persisted_timebase_fails_closed(env):
    repo, client, a, _ = env
    with repo._connection() as connection:
        connection.execute(
            "UPDATE projects SET sequence_timebase_json = ? WHERE id = ?",
            ('{"frame_rate":{"num":24,"den":1},"timecode_mode":"DROP_FRAME"}', a),
        )
        connection.commit()
    assert client.get(f"/api/v1/projects/{a}/settings").status_code == 500
    assert client.post(f"/api/v1/projects/{a}/settings", json=command()).status_code == 500


def test_actual_sidecar_auth_rejection_is_definite_and_has_no_receipt(env):
    repo, _, a, _ = env
    token, host = "x" * 43, "127.0.0.1:43124"
    client = TestClient(
        create_app(
            repository=repo,
            sidecar_security=SidecarSecurity(token=token, host=host, origin="app://aijian"),
        ),
        base_url=f"http://{host}",
        client=("127.0.0.1", 50103),
    )
    payload = command(name="不能写入")
    result = client.post(f"/api/v1/projects/{a}/settings", json=payload)
    assert result.status_code == 401
    assert result.json()["error"]["code"] == "SIDECAR_AUTH_REQUIRED"
    assert repo.get_project(a).revision == 1
    client.headers.update({"Authorization": f"Bearer {token}", "Origin": "https://invalid.example"})
    result = client.post(f"/api/v1/projects/{a}/settings", json=payload)
    assert result.status_code == 403
    assert result.json()["error"]["code"] == "SIDECAR_REQUEST_REJECTED"
    assert repo.get_project(a).revision == 1
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM project_settings_write_receipts").fetchone()[0]
            == 0
        )
