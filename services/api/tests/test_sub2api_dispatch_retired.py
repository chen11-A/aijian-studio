"""Live Sub2API create and approval writes are retired; historical reads stay."""

import sqlite3
from pathlib import Path

from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient

TOKEN = "r" * 43
HOST = "127.0.0.1:43127"
ORIGIN = "app://aijian"
PROJECT_ID = "prj_" + "ab" * 16
RUN_ID = "agr_" + "cd" * 16
HEX32 = "ef" * 16
DIGEST = "sha256:" + "ab" * 32
_WRITE_TABLES = (
    "sub2api_source_extract_scopes",
    "sub2api_call_approvals",
    "sub2api_call_consumptions",
    "sub2api_call_observations",
    "workflow_runs",
    "task_ledger",
)


def _client(tmp_path: Path) -> tuple[TestClient, StudioRepository]:
    repository = StudioRepository(tmp_path / "workspace.db")
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    client = TestClient(
        create_app(
            repository=repository,
            sidecar_security=security,
            sub2api_runtime_availability=lambda: "WAITING_FOR_EXPLICIT_APPROVAL",
        ),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50102),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    return client, repository


def _create_body() -> dict[str, object]:
    return {
        "selection": {
            "connection_id": "pcn_" + HEX32,
            "connection_revision": 1,
            "model_id": "synthetic-model",
        },
        "source": {
            "agent_definition": {
                "definition_id": "writer.source-analyst-sub2api",
                "version": "1.0.0",
            },
            "skill_definition": {"definition_id": "source.extract-sub2api", "version": "1.0.0"},
            "source_manifest_version_id": "ver_" + HEX32,
            "source_document_id": "src_" + HEX32,
            "source_block_id": "srcb_" + HEX32,
            "start_byte": 0,
            "end_byte": 4,
        },
    }


def _approval_body() -> dict[str, object]:
    return {
        "task_id": "task_" + HEX32,
        "attempt_id": "att_" + HEX32,
        "expected_attempt_fingerprint": DIGEST,
        "unknown_cost_accepted": True,
        "allowed_calls": 1,
    }


def _counts(database: Path) -> dict[str, int]:
    connection = sqlite3.connect(database)
    try:
        return {
            name: int(connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0])
            for name in _WRITE_TABLES
        }
    finally:
        connection.close()


def test_create_and_approval_are_retired_before_any_dispatch_write(tmp_path: Path) -> None:
    client, repository = _client(tmp_path)
    base = f"/api/v1/projects/{PROJECT_ID}/sub2api-source-extract-runs"
    before = _counts(repository.database_path)

    missing = client.post(base, json=_create_body())
    created = client.post(base, json=_create_body(), headers={"Idempotency-Key": "retired-create"})
    approved = client.post(
        f"{base}/{RUN_ID}/approval",
        json=_approval_body(),
        headers={"Idempotency-Key": "retired-approval"},
    )
    operation = client.get(f"{base}/{RUN_ID}/operation")
    approval = client.get(f"{base}/{RUN_ID}/approval")

    assert missing.status_code == 428
    assert missing.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
    for response in (created, approved):
        assert response.status_code == 410
        assert response.json()["error"] == {
            "code": "SUB2API_DISPATCH_RETIRED",
            "message": (
                "Sub2API dispatch is retired; text calls use the signed-in GPT or Grok account"
            ),
            "details": {},
            "retryable": False,
        }
    assert operation.status_code == 404
    assert operation.json()["error"]["code"] == "SUB2API_RUN_NOT_FOUND"
    assert approval.status_code == 404
    assert approval.json()["error"]["code"] == "SUB2API_APPROVAL_NOT_FOUND"
    assert _counts(repository.database_path) == before
    assert set(before.values()) == {0}
