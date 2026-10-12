"""Bounded immutable G5 directory reads; no original inspection or approval writes."""

import sqlite3

import pytest
from aijian_api.repository import ArtifactConflictError, ArtifactNotFoundError
from aijian_api.visual_bible_contracts import CreateVisualBibleVersionRequest
from aijian_api.visual_bible_store import VisualBibleStore
from test_project_creative_library import make_project
from test_visual_bible_g5 import ACTOR, setup_visual


def versions(tmp_path, count=26):
    repository, project, asset, request, saved = setup_visual(tmp_path)
    store = VisualBibleStore(repository)
    result = [saved]
    for n in range(2, count + 1):
        value = request.model_dump(mode="json")
        value["content"]["change_reason"] = f"人工另存视觉候选 {n}"
        value.update(
            parent_version_id=result[-1].version.id,
            expected_revision=result[-1].head.revision,
            change_summary=f"候选 {n}",
        )
        result.append(
            store.write(
                project,
                CreateVisualBibleVersionRequest.model_validate(value),
                idempotency_key=f"history-{n}",
                actor_id=ACTOR.subject_id,
            )[0]
        )
    return repository, project, asset, store, result


def test_history_pages_are_exact_project_immutable_sources_without_original_reads(
    tmp_path, monkeypatch
):
    repository, project, asset, store, saved = versions(tmp_path)
    # Old versions remain discoverable after the physical original disappears.
    raw = asset.latest_version.sha256
    (repository.database_path.parent / "media-assets" / "blobs" / raw[:2] / raw).unlink()
    from aijian_api.media_asset_store import MediaAssetStore

    monkeypatch.setattr(
        MediaAssetStore,
        "get_asset",
        lambda *_a, **_k: pytest.fail("History must not inspect physical originals"),
    )
    all_entries, cursor = [], None
    while True:
        page = store.history(project, limit=7, cursor=cursor)
        assert page.cursor == cursor and len(page.items) <= 7
        assert page.head == saved[-1].head
        all_entries.extend(page.items)
        cursor = page.next_cursor
        if cursor is None:
            break
    assert [e.id for e in all_entries] == [s.version.id for s in reversed(saved)]
    assert [e.content_hash for e in all_entries] == [
        s.version.content_hash for s in reversed(saved)
    ]
    assert store.history(project, cursor=saved[0].version.id).items == ()
    other = make_project(repository)
    with pytest.raises(ArtifactNotFoundError):
        store.history(other)
    with pytest.raises(ArtifactConflictError):
        store.history(project, cursor=saved[0].version.content.creative_library_version_id)
    for limit in (0, 21, True, 1.2):
        with pytest.raises(ValueError):
            store.history(project, limit=limit)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM gate_decisions").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM confirmation_challenges").fetchone() == (0,)


def test_api_history_has_bounded_query_contract_and_same_snapshot_head(tmp_path):
    from aijian_api.main import create_app
    from fastapi.testclient import TestClient

    repository, project, _, _, saved = versions(tmp_path, 3)
    client = TestClient(create_app(repository=repository))
    path = f"/api/v1/projects/{project}/visual-bible/history"
    first = client.get(path, params={"limit": 2})
    assert first.status_code == 200
    data = first.json()["data"]
    assert [v["id"] for v in data["items"]] == [s.version.id for s in reversed(saved[1:])]
    assert data["next_cursor"] == saved[1].version.id
    assert "content" not in data["items"][0]
    second = client.get(path, params={"limit": 2, "cursor": data["next_cursor"]})
    assert (
        second.status_code == 200 and second.json()["data"]["items"][0]["id"] == saved[0].version.id
    )
    assert first.headers["etag"] == second.headers["etag"]
    for params in ({"limit": 21}, {"limit": 0}, {"cursor": "../version"}):
        assert client.get(path, params=params).status_code == 422
