"""Original script writes are attributed by existing receipts, never by current head."""

import sqlite3
from dataclasses import replace
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient


@pytest.fixture
def recovery(tmp_path):
    repository = StudioRepository(tmp_path / "recovery.sqlite3")
    scopes = []
    for name in ("Synthetic A", "Synthetic B"):
        project = repository.create_project(
            name=name, aspect_ratio="16:9", target_duration_seconds=10, source_language="zh-CN"
        )
        scopes.extend(
            (project.id, ep)
            for ep in (
                repository.list_episodes(project.id)[0].id,
                repository.create_episode(project.id, title="Second episode").id,
            )
        )
    project, episode = scopes[0]
    raw = {
        "content": {
            "schema_version": "1.0.0",
            "project_id": project,
            "episode_id": episode,
            "production_brief_version_id": None,
            "story_bible_version_id": None,
            "source_extraction_version_id": None,
            "source_proposal_acceptance_id": None,
            "scenes": [
                {
                    "scene_id": "scn_" + "a" * 32,
                    "ordinal": 1,
                    "heading": "Synthetic",
                    "blocks": [
                        {
                            "block_id": "sblk_" + "b" * 32,
                            "ordinal": 1,
                            "kind": "ACTION",
                            "text": "Original full content",
                            "speaker": None,
                            "delivery": None,
                        }
                    ],
                }
            ],
        },
        "parent_version_id": None,
        "expected_revision": None,
        "change_summary": "Original write",
    }
    operation = str(uuid4())
    store = EpisodeScriptStore(repository)
    version, _ = store.write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(raw),
        idempotency_key=operation,
        actor_id="local-user",
    )
    host = "127.0.0.1:43139"
    app = create_app(
        repository=repository,
        sidecar_security=SidecarSecurity(token="x" * 43, host=host, origin="app://aijian"),
    )
    client = TestClient(app, base_url=f"http://{host}", client=("127.0.0.1", 50139))
    client.headers.update({"Authorization": "Bearer " + "x" * 43, "Origin": "app://aijian"})
    return repository, store, client, scopes, operation, raw, version


def route(project, episode, operation):
    return f"/api/v1/projects/{project}/episodes/{episode}/script/write-operations/{operation}"


def rows(repository):
    with sqlite3.connect(repository.database_path) as db:
        return {
            table: db.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            for table in (
                "artifacts",
                "artifact_versions",
                "artifact_heads",
                "artifact_dependencies",
                "episode_script_write_requests",
            )
        }


def test_exact_original_receipt_is_read_only_after_head_advances(recovery):
    repository, store, client, scopes, operation, raw, original = recovery
    project, episode = scopes[0]
    later = {
        **raw,
        "parent_version_id": original.version_id,
        "expected_revision": 1,
        "change_summary": "Later write",
    }
    current, _ = store.write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(later),
        idempotency_key=str(uuid4()),
        actor_id="local-user",
    )
    before = rows(repository)
    for _ in range(2):
        response = client.get(route(project, episode, operation))
        assert response.status_code == 200
        assert response.headers["X-Request-ID"] == response.json()["request_id"]
        data = response.json()["data"]
        assert data["operation_id"] == operation
        assert data["idempotency_key_hash"] == canonical_content_hash({"value": operation})
        assert data["request_hash"] == canonical_content_hash(
            {
                "project_id": project,
                "episode_id": episode,
                "actor_id": "local-user",
                "payload": raw,
            }
        )
        assert data["version"]["version_id"] == original.version_id != current.version_id
        assert data["version"]["version_number"] == 1
        assert data["version"]["head_revision"] == 2
        assert data["version"]["content"] == raw["content"]
    assert rows(repository) == before


@pytest.mark.parametrize("scope_index", [0, 1, 2, 3])
def test_missing_original_or_other_scope_never_claims_not_executed(recovery, scope_index):
    repository, _, client, scopes, operation, _, _ = recovery
    project, episode = scopes[scope_index]
    if scope_index == 0:
        operation = str(uuid4())
    before = rows(repository)
    response = client.get(route(project, episode, operation))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "SCRIPT_WRITE_OPERATION_UNKNOWN"
    assert "NOT_EXECUTED" not in response.text
    assert rows(repository) == before


@pytest.mark.parametrize("damage", ["request_hash", "artifact_id", "version_id", "content_hash"])
def test_corrupt_original_receipt_or_version_fails_closed_without_writes(
    recovery, monkeypatch, damage
):
    repository, _, client, scopes, operation, _, original = recovery
    # The production immutability triggers must remain effective. Corrupt read
    # evidence is injected in memory after SQLite reads, never by disabling them.
    with sqlite3.connect(repository.database_path) as db:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            if damage == "content_hash":
                db.execute(
                    "UPDATE artifact_versions SET content_hash = ? WHERE version_id = ?",
                    ("sha256:" + "f" * 64, original.version_id),
                )
            else:
                db.execute(f"UPDATE episode_script_write_requests SET {damage} = ?", ("wrong",))
    original_open = EpisodeScriptStore._open

    class FaultRead:
        def __init__(self, connection):
            self.connection = connection

        def __getattr__(self, name):
            return getattr(self.connection, name)

        def execute(self, sql, args=()):
            cursor = self.connection.execute(sql, args)
            if "FROM episode_script_write_requests" not in sql or damage == "content_hash":
                return cursor

            class ReceiptRead:
                def fetchone(self):
                    row = dict(cursor.fetchone())
                    row[damage] = "sha256:" + "f" * 64 if damage == "request_hash" else "missing"
                    return row

            return ReceiptRead()

    monkeypatch.setattr(EpisodeScriptStore, "_open", lambda self: FaultRead(original_open(self)))
    if damage == "content_hash":
        get_record = repository._get_artifact_version_in_connection

        def corrupt_record(*args, **kwargs):
            record = get_record(*args, **kwargs)
            return replace(
                record, version=replace(record.version, content_hash="sha256:" + "f" * 64)
            )

        monkeypatch.setattr(repository, "_get_artifact_version_in_connection", corrupt_record)
    before = rows(repository)
    response = client.get(route(*scopes[0], operation))
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "SCRIPT_STORAGE_FAILED"
    assert rows(repository) == before


def test_read_operation_requires_local_auth_and_valid_original_id(recovery):
    repository, _, client, scopes, operation, _, _ = recovery
    before = rows(repository)
    assert client.get(route(*scopes[0], "not-an-operation")).status_code == 422
    client.headers.pop("Authorization")
    assert client.get(route(*scopes[0], operation)).status_code == 401
    assert rows(repository) == before


def test_historical_receipt_preserves_old_content_bytes_and_hash(recovery):
    repository, _, client, scopes, _, raw, _ = recovery
    project, episode = scopes[1]
    old = {**raw, "content": {**raw["content"], "project_id": project, "episode_id": episode}}
    for name in (
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
    ):
        old["content"].pop(name)
    old["content"]["scenes"][0]["blocks"][0].pop("delivery")
    version = repository.create_artifact_version(
        project_id=project,
        episode_id=episode,
        artifact_type="episode_script",
        schema_version="1.0.0",
        content=old["content"],
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary=old["change_summary"],
    )
    operation = str(uuid4())
    request_hash = canonical_content_hash(
        {"project_id": project, "episode_id": episode, "actor_id": "local-user", "payload": old}
    )
    with sqlite3.connect(repository.database_path) as db:
        db.execute(
            """INSERT INTO episode_script_write_requests
                   (project_id, episode_id, idempotency_key_hash, request_hash,
                    artifact_id, version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                project,
                episode,
                canonical_content_hash({"value": operation}),
                request_hash,
                version.version.artifact_id,
                version.version.id,
                "2026-10-11T00:00:00Z",
            ),
        )
    before = rows(repository)
    response = client.get(route(project, episode, operation))
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["request_hash"] == request_hash
    assert data["version"]["content"] == old["content"]
    assert data["version"]["content_hash"] == canonical_content_hash(old["content"])
    assert rows(repository) == before
