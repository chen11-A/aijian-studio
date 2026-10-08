"""Synthetic fixtures only: no official authentication or inference is performed."""

import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptNotFoundError, EpisodeScriptStore
from aijian_api.official_text_adoption import adopt_text
from aijian_api.official_text_contracts import (
    AdoptOfficialTextRequest,
    CompleteOfficialTextRequest,
    ReserveOfficialTextRequest,
)
from aijian_api.official_text_store import OfficialTextError, OfficialTextStore
from aijian_api.repository import StudioRepository
from test_project_creative_library import make_project


def setup(tmp_path: Path):
    repo = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repo)
    return repo, project, repo.list_episodes(project)[0].id


def reservation(**changes):
    return ReserveOfficialTextRequest.model_validate(
        {
            "operation_id": str(uuid4()),
            "profile_id": str(uuid4()),
            "model": "synthetic-official-test-model",
            "input_text": "Synthetic prompt only",
            "instructions": None,
            "request_hash": "sha256:" + "a" * 64,
            "base": None,
            **changes,
        }
    )


def completion(request, **changes):
    return CompleteOfficialTextRequest.model_validate(
        {
            "operation_id": request.operation_id,
            "profile_id": request.profile_id,
            "model": request.model,
            "request_hash": request.request_hash,
            "text": "Synthetic output.\n  Exact whitespace preserved.  ",
            "completed_at": "2026-10-08T06:00:00Z",
            **changes,
        }
    )


def adoption(operation):
    return AdoptOfficialTextRequest(
        proposal_version_id=operation.proposal.version_id,
        proposal_content_hash=operation.proposal.content_hash,
        confirm=True,
    )


def test_persist_restart_adopt_exact_bytes_replay_and_edit(tmp_path):
    repo, project, episode = setup(tmp_path)
    store = OfficialTextStore(repo)
    request = reservation()
    pending, replay = store.reserve(project, episode, request)
    assert not replay and pending.status == "REMOTE_UNKNOWN"
    assert store.reserve(project, episode, request)[1]
    result = completion(request)
    proposed, replay = store.complete(project, episode, result)
    assert not replay and proposed.adoption is None
    with pytest.raises(EpisodeScriptNotFoundError):
        EpisodeScriptStore(repo).get_latest(project_id=project, episode_id=episode)
    restarted = OfficialTextStore(StudioRepository(repo.database_path))
    assert restarted.get(project, episode, request.operation_id) == proposed
    accepted, replay = adopt_text(
        restarted, project, episode, request.operation_id, adoption(proposed), "local-user"
    )
    assert not replay and accepted.adoption
    script = EpisodeScriptStore(repo).get_latest(project_id=project, episode_id=episode)
    assert script.content.scenes[0].blocks[0].text == result.text
    assert script.content.source_proposal_acceptance_id is None
    assert script.content.source_extraction_version_id is None
    assert adopt_text(
        store, project, episode, request.operation_id, adoption(proposed), "local-user"
    )[1]
    assert (
        EpisodeScriptStore(repo).get_latest(project_id=project, episode_id=episode).version_id
        == script.version_id
    )
    content = script.content.model_dump(mode="json")
    content["scenes"][0]["blocks"][0]["text"] = "Human edited text"
    edited, _ = EpisodeScriptStore(repo).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest(
            content=content,
            parent_version_id=script.version_id,
            expected_revision=script.head_revision,
            change_summary="Human edit",
        ),
        idempotency_key="edit",
        actor_id="human",
    )
    assert edited.parent_version_id == script.version_id
    assert store.get(project, episode, request.operation_id).proposal == proposed.proposal
    with sqlite3.connect(repo.database_path) as connection:
        assert (
            connection.execute("SELECT count(*) FROM episode_script_confirmations").fetchone()[0]
            == 0
        )


def test_stale_base_preserves_proposal_and_old_script(tmp_path):
    repo, project, episode = setup(tmp_path)
    store = OfficialTextStore(repo)
    request = reservation()
    store.reserve(project, episode, request)
    script, _ = EpisodeScriptStore(repo).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest(
            content={"project_id": project, "episode_id": episode, "scenes": []},
            change_summary="Concurrent manual draft",
        ),
        idempotency_key="concurrent",
        actor_id="human",
    )
    proposed, _ = store.complete(project, episode, completion(request))
    with pytest.raises(OfficialTextError, match="SCRIPT_CHANGED"):
        adopt_text(store, project, episode, request.operation_id, adoption(proposed), "human")
    assert store.get(project, episode, request.operation_id).proposal == proposed.proposal
    assert (
        EpisodeScriptStore(repo).get_latest(project_id=project, episode_id=episode).version_id
        == script.version_id
    )


def test_unknown_blocks_new_request_and_cross_scope_reuse(tmp_path):
    repo, project, episode = setup(tmp_path)
    store = OfficialTextStore(repo)
    request = reservation()
    store.reserve(project, episode, request)
    with pytest.raises(OfficialTextError, match="UNRESOLVED"):
        store.reserve(project, episode, reservation())
    other = repo.create_episode(project, title="Other").id
    with pytest.raises(OfficialTextError, match="CONFLICT"):
        store.reserve(project, other, request)
    with pytest.raises(OfficialTextError, match="NOT_FOUND"):
        store.get(project, other, request.operation_id)
    assert (
        store.not_sent(project, episode, request.operation_id, "CANCELLED")[0].status == "NOT_SENT"
    )
    assert store.not_sent(project, episode, request.operation_id, "CANCELLED")[1]
    assert not store.reserve(project, episode, reservation())[1]
    with pytest.raises(OfficialTextError, match="CONFLICT"):
        store.complete(project, episode, completion(request))


def test_mismatch_and_modified_replay_rejected(tmp_path):
    repo, project, episode = setup(tmp_path)
    store = OfficialTextStore(repo)
    request = reservation()
    store.reserve(project, episode, request)
    with pytest.raises(OfficialTextError, match="MISMATCH"):
        store.complete(project, episode, completion(request, profile_id=str(uuid4())))
    with pytest.raises(OfficialTextError, match="CONFLICT"):
        store.reserve(project, episode, request.model_copy(update={"input_text": "Changed"}))
    proposed, _ = store.complete(project, episode, completion(request))
    assert store.complete(project, episode, completion(request))[1]
    with pytest.raises(OfficialTextError, match="CONFLICT"):
        store.complete(project, episode, completion(request, text="Changed"))
    with pytest.raises(OfficialTextError, match="MISMATCH"):
        adopt_text(
            store,
            project,
            episode,
            request.operation_id,
            adoption(proposed).model_copy(update={"proposal_content_hash": "sha256:" + "b" * 64}),
            "human",
        )


def test_adoption_failure_rolls_back_and_migration_37_is_atomic(tmp_path, monkeypatch):
    repo, project, episode = setup(tmp_path)
    store = OfficialTextStore(repo)
    request = reservation()
    store.reserve(project, episode, request)
    proposed, _ = store.complete(project, episode, completion(request))
    original = store.read_in_connection

    def fail_after_adoption(connection, p, e, operation):
        value = original(connection, p, e, operation)
        if value.adoption:
            raise OfficialTextError("SYNTHETIC_READBACK_FAILURE", 500)
        return value

    monkeypatch.setattr(store, "read_in_connection", fail_after_adoption)
    with pytest.raises(OfficialTextError, match="SYNTHETIC"):
        adopt_text(store, project, episode, request.operation_id, adoption(proposed), "human")
    with sqlite3.connect(repo.database_path) as connection:
        assert (
            connection.execute(
                "SELECT count(*) FROM artifacts WHERE artifact_type='episode_script'"
            ).fetchone()[0]
            == 0
        )
        assert connection.execute("SELECT count(*) FROM official_text_adoptions").fetchone()[0] == 0
    db = tmp_path / "migration.sqlite3"

    def stop(version, step):
        if version == 37 and step == 2:
            raise RuntimeError("synthetic migration interruption")

    with pytest.raises(RuntimeError, match="synthetic"):
        StudioRepository(db, migration_hook=stop)
    with sqlite3.connect(db) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 36
        assert (
            connection.execute(
                "SELECT count(*) FROM sqlite_master WHERE name='official_text_operations'"
            ).fetchone()[0]
            == 0
        )
    StudioRepository(db)


def test_routes_require_desktop_auth_and_adoption_rejects_renderer_text(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repo, project, episode = setup(tmp_path)
    root = f"/api/v1/projects/{project}/episodes/{episode}/official-text"
    request = reservation()
    assert (
        TestClient(create_app(repository=repo))
        .post(root, json=request.model_dump(mode="json"))
        .status_code
        == 405
    )
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    client = TestClient(
        create_app(repository=repo, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    assert client.post(root, json=request.model_dump(mode="json")).status_code == 401
    client.headers.update({"Authorization": f"Bearer {'x' * 43}", "Origin": "app://aijian"})
    assert client.post(root, json=request.model_dump(mode="json")).status_code == 200
    response = client.post(
        root + f"/{request.operation_id}/completion",
        json=completion(request).model_dump(mode="json"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["request_id"] == response.headers["x-request-id"]
    proposal = response.json()["data"]["operation"]["proposal"]
    body = {
        "proposal_version_id": proposal["version_id"],
        "proposal_content_hash": proposal["content_hash"],
        "confirm": True,
    }
    assert (
        client.post(
            root + f"/{request.operation_id}/adoption", json={**body, "text": "Counterfeit"}
        ).status_code
        == 422
    )
    assert client.post(root + f"/{request.operation_id}/adoption", json=body).status_code == 200
    assert len(client.get(root).json()["data"]) == 1


def test_exact_existing_script_base_appends_and_keeps_original_history(tmp_path):
    repo, project, episode = setup(tmp_path)
    scripts = EpisodeScriptStore(repo)
    initial, _ = scripts.write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest(
            content={
                "project_id": project,
                "episode_id": episode,
                "scenes": [
                    {
                        "scene_id": "scn_" + "a" * 32,
                        "ordinal": 1,
                        "heading": "Human original",
                        "blocks": [
                            {
                                "block_id": "sblk_" + "a" * 32,
                                "ordinal": 1,
                                "kind": "ACTION",
                                "text": "Human original text",
                            }
                        ],
                    }
                ],
            },
            change_summary="Manual original",
        ),
        idempotency_key="first",
        actor_id="human",
    )
    base = {
        "version_id": initial.version_id,
        "content_hash": initial.content_hash,
        "head_revision": initial.head_revision,
    }
    store = OfficialTextStore(repo)
    with pytest.raises(OfficialTextError, match="SCRIPT_CHANGED"):
        store.reserve(
            project, episode, reservation(base={**base, "content_hash": "sha256:" + "b" * 64})
        )
    request = reservation(base=base)
    store.reserve(project, episode, request)
    proposed, _ = store.complete(project, episode, completion(request))
    accepted, _ = adopt_text(
        store, project, episode, request.operation_id, adoption(proposed), "human"
    )
    latest = scripts.get_latest(project_id=project, episode_id=episode)
    assert latest.parent_version_id == initial.version_id
    assert latest.head_revision == initial.head_revision + 1
    assert latest.content.scenes[0] == initial.content.scenes[0]
    assert latest.content.scenes[1].blocks[0].text == proposed.proposal.result.text
    assert (
        scripts.get_version(
            project_id=project, episode_id=episode, version_id=initial.version_id
        ).content_hash
        == initial.content_hash
    )
    assert store.get(project, episode, request.operation_id) == accepted
    with sqlite3.connect(repo.database_path) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="cannot be rewritten"):
            connection.execute(
                "UPDATE official_text_operations SET status='NOT_SENT', "
                "error_code='CANCELLED', proposal_version_id=NULL"
            )
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("UPDATE official_text_adoptions SET actor_id='other'")
