"""Exact history inspection cannot retarget or consume approval/Provider/media."""

import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from aijian_api.artifact_invalidation_ledger import InvalidationOperationNotFoundError
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.invalidation_consumer import inspect_consumer
from aijian_api.main import create_app
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.visual_bible_contracts import CreateVisualBibleVersionRequest
from aijian_api.visual_bible_store import VisualBibleStore
from fastapi.testclient import TestClient
from test_g5_storyboard_consumption import approve, assembly, board_request, write_board
from test_invalidation_api import _protected_client, _valid_headers
from test_project_creative_library import make_project
from test_visual_bible_g5 import ACTOR, clear_rights, inspect_fixture, setup_visual


def fixture(tmp_path: Path, *, many_shots=False):
    repository, project, asset, request, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    approved = approve(repository, project, saved)
    episodes = [
        repository.list_episodes(project)[0],
        repository.create_episode(project, title="另一分集"),
    ]
    boards = []
    for e in episodes:
        value = board_request(project, e.id, saved)
        if many_shots:
            second = {
                **value["content"]["shots"][0],
                "shot_id": "shp_" + "e" * 32,
                "ordinal": 2,
                "title": "本装配没有选用的另一镜头",
            }
            value["content"]["shots"].append(second)
        boards.append(write_board(repository, project, e.id, value))
    assemblies = [
        assembly(repository, project, e.id, asset, b) for e, b in zip(episodes, boards, strict=True)
    ]
    newer = request.model_copy(
        update={"parent_version_id": saved.version.id, "expected_revision": approved.head.revision}
    )
    changed = newer.model_dump(mode="json")
    changed["content"]["change_reason"] = "共享参考批准替换"
    candidate, _ = VisualBibleStore(repository).write(
        project,
        CreateVisualBibleVersionRequest.model_validate(changed),
        idempotency_key="replacement",
        actor_id=ACTOR.subject_id,
    )
    approve(repository, project, candidate)
    report = repository.list_invalidation_operations(project)[0]
    return repository, project, asset, episodes, boards, assemblies, report


def url(project, report, path):
    return (
        f"/api/v1/projects/{project}/invalidation-operations/{report.id}/paths/{path.id}/consumer"
    )


def test_exact_two_episode_consumers_keep_historical_shots_after_latest_edit_and_file_loss(
    tmp_path, monkeypatch
):
    repo, project, asset, episodes, boards, assemblies, report = fixture(tmp_path)
    # A new unpinned candidate may rename a shot; it must not replace the affected old version.
    for e, b in zip(episodes, boards, strict=True):
        value = {
            "content": b.content.model_dump(mode="json"),
            "parent_version_id": b.version_id,
            "expected_revision": b.head_revision,
            "change_summary": "new unrelated candidate",
        }
        value["content"]["visual_bible_pin"] = None
        value["content"]["shots"][0]["title"] = "新版标题不要回退到此处"
        EpisodeStoryboardStore(repo).write(
            project_id=project,
            episode_id=e.id,
            payload=CreateEpisodeStoryboardVersionRequest.model_validate(value),
            idempotency_key=e.id,
            actor_id=ACTOR.subject_id,
        )
    version = asset.latest_version
    (
        repo.database_path.parent / "media-assets" / "blobs" / version.sha256[:2] / version.sha256
    ).unlink()
    monkeypatch.setattr(
        MediaAssetStore,
        "get_asset",
        lambda *a, **k: pytest.fail("Readonly inspection must not verify/read originals"),
    )
    before = repo.database_path.read_bytes()
    expected = {
        x.version_id: e.id
        for e, x in [*zip(episodes, boards, strict=True), *zip(episodes, assemblies, strict=True)]
    }
    for path in report.paths:
        if path.affected_version_id not in expected:
            continue
        data = inspect_consumer(repo, project, report.id, path.id)
        assert data.version_id == path.affected_version_id
        assert data.artifact_id == path.affected_artifact_id
        assert data.episode.id == expected[path.affected_version_id]
        assert data.shots and all(s.title != "新版标题不要回退到此处" for s in data.shots)
        assert data.shots[0].storyboard_version_id in {b.version_id for b in boards}
        assert data.assessment_hash == report.assessment_hash
    assert repo.database_path.read_bytes() == before


def test_api_scopes_and_existing_native_security_are_preserved(tmp_path):
    repo, project, _, _, boards, _, report = fixture(tmp_path)
    path = next(p for p in report.paths if p.affected_version_id == boards[0].version_id)
    client = TestClient(create_app(repository=repo))
    response = client.get(url(project, report, path))
    assert (
        response.status_code == 200
        and response.json()["data"]["version_id"] == boards[0].version_id
    )
    assert response.headers["X-Request-ID"] == response.json()["request_id"]
    other = make_project(repo)
    assert client.get(url(other, report, path)).status_code == 404
    assert (
        client.get(url(project, report, path).replace(path.id, "ivp_" + "f" * 32)).status_code
        == 404
    )
    with pytest.raises(InvalidationOperationNotFoundError):
        inspect_consumer(repo, other, report.id, path.id)
    protected = _protected_client(repo)
    assert protected.get(url(project, report, path)).status_code == 401
    assert protected.get(url(project, report, path), headers=_valid_headers()).status_code == 200
    with sqlite3.connect(repo.database_path) as con:
        assert con.execute("SELECT COUNT(*) FROM invalidation_operations").fetchone() == (1,)


def test_assembly_projection_only_lists_exact_referenced_shots(tmp_path):
    repo, project, _, _, boards, assemblies, report = fixture(tmp_path, many_shots=True)
    for board, assembled in zip(boards, assemblies, strict=True):
        board_path = next(p for p in report.paths if p.affected_version_id == board.version_id)
        assembly_path = next(
            p for p in report.paths if p.affected_version_id == assembled.version_id
        )
        assert len(inspect_consumer(repo, project, report.id, board_path.id).shots) == 2
        data = inspect_consumer(repo, project, report.id, assembly_path.id)
        assert len(data.shots) == 1 and data.shot_scope == "ASSEMBLY_REFERENCED_SHOTS"
        assert data.shots[0].shot_id == board.content.shots[0].shot_id
        assert data.shots[0].storyboard_content_hash == board.content_hash


def test_corrupt_affected_version_remains_unknown_without_mutating_sqlite(tmp_path, monkeypatch):
    repo, project, _, _, boards, _, report = fixture(tmp_path)
    path = next(p for p in report.paths if p.affected_version_id == boards[0].version_id)
    original = repo._get_artifact_version_in_connection

    def wrong_hash(connection, **query):
        record = original(connection, **query)
        if query["version_id"] == boards[0].version_id:
            return replace(
                record, version=replace(record.version, content_hash="sha256:" + "0" * 64)
            )
        return record

    monkeypatch.setattr(repo, "_get_artifact_version_in_connection", wrong_hash)
    before = repo.database_path.read_bytes()
    response = TestClient(create_app(repository=repo)).get(url(project, report, path))
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INVALIDATION_LEDGER_CORRUPT"
    assert response.json()["error"]["retryable"] is False
    assert repo.database_path.read_bytes() == before
