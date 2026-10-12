"""Real SQLite, immutable source objects and real local PNGs; no model or native runs."""

import sqlite3
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import ArtifactDependencyDraft
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.media_preparation_contracts import (
    CreateMediaPreparationRequest,
    MediaPreparationSnapshotV1,
)
from aijian_api.media_preparation_store import (
    MediaPreparationConflict,
    MediaPreparationError,
    MediaPreparationNotFound,
    MediaPreparationStore,
)
from aijian_api.repository import ArtifactConflictError, StudioRepository
from pydantic import ValidationError
from test_episode_storyboard import payload as board_payload
from test_episode_storyboard import shot, write
from test_project_creative_library import make_project
from test_storyboard_character_bindings import setup as reference_setup


def preparation(p, e, board, parent=None, revision=None):
    return CreateMediaPreparationRequest.model_validate(
        {
            "input": {
                "schema_version": "1.0.0",
                "project_id": p,
                "episode_id": e,
                "capability_intent": "IMAGE",
                "storyboard_version_id": board.version_id,
                "storyboard_content_hash": board.content_hash,
                "shot_id": board.content.shots[0].shot_id,
                "prompt": "完整手工画面：码头灯火与回望。",
                "negative_prompt": "避免失去同一服装。",
                "width": 1920,
                "height": 1080,
                "requested_frames": 1,
            },
            "parent_version_id": parent,
            "expected_revision": revision,
        }
    )


def setup(tmp_path):
    r = StudioRepository(tmp_path / "studio.sqlite3")
    p = make_project(r)
    e = r.list_episodes(p)[0].id
    b = write(EpisodeStoryboardStore(r), board_payload(p, e, shots=[shot()]))[0]
    return r, p, e, b


@pytest.mark.parametrize("bad", ["duplicate_characters", "blank_title", "environment", "visual"])
def test_snapshot_after_validator_semantics_remain_closed(tmp_path, bad):
    r, p, e, b = setup(tmp_path)
    original = MediaPreparationStore(r).write(
        p, e, str(uuid4()), preparation(p, e, b), "local-user"
    )
    snapshot = original.version.content.snapshot.model_dump(mode="json")
    item = snapshot["shot"]
    if bad == "duplicate_characters":
        snapshot["creative_library_version_id"] = "ver_" + "a" * 32
        item["character_ids"] = ["chr_" + "a" * 32] * 2
    elif bad == "blank_title":
        item["title"] = " \t\n"
    elif bad == "environment":
        snapshot["storyboard_schema_version"] = "1.4.0"
        item.update(
            character_bindings=[],
            coverage_notes="",
            continuity_notes="",
            transition_notes="",
            environment_binding={"variant_id": "scv_" + "a" * 32, "reference_ids": []},
        )
    else:
        snapshot.update(
            storyboard_schema_version="1.2.0", visual_bible_version_id="ver_" + "a" * 32
        )
        item["character_bindings"] = []
    with pytest.raises(ValidationError):
        MediaPreparationSnapshotV1.model_validate(snapshot)


def test_exact_full_input_original_uuid_actor_cas_restart_and_old_board(tmp_path):
    r, p, e, b = setup(tmp_path)
    s = MediaPreparationStore(r)
    payload = preparation(p, e, b)
    op = str(uuid4()).upper()
    result = s.write(p, e, op, payload, "local-user")
    v = result.version
    assert v.content.snapshot.shot.model_dump(mode="json") == b.content.shots[0].model_dump(
        mode="json"
    )
    assert v.content.snapshot.fps == 25 and v.content_hash == canonical_content_hash(
        v.content.model_dump(mode="json")
    )
    other = s.write(p, e, str(uuid4()), preparation(p, e, b, v.version_id, 1), "local-user")
    changed = board_payload(p, e, shots=[], parent=b.version_id, revision=b.head_revision)
    write(EpisodeStoryboardStore(r), changed, "new-board")
    restarted = MediaPreparationStore(StudioRepository(r.database_path))
    digest = canonical_content_hash(payload.model_dump(mode="json"))
    assert restarted.original_for_hash(p, e, op, digest, "local-user") == result
    assert restarted.get(p, e, v.version_id) == v
    assert restarted.list(p, e).head_version_id == other.version.version_id
    for bad in (op.lower(), str(uuid4())):
        with pytest.raises(MediaPreparationNotFound):
            restarted.original_for_hash(p, e, bad, digest, "local-user")
    wrong = payload.model_copy(update={"expected_revision": 2, "parent_version_id": v.version_id})
    with pytest.raises(MediaPreparationNotFound):
        restarted.original(p, e, op, wrong, "local-user")
    with pytest.raises(MediaPreparationError):
        restarted.original(p, e, op, payload, "other-actor")
    assert s.write(p, e, op, payload, "local-user") == result
    with pytest.raises(MediaPreparationConflict):
        s.write(p, e, op, wrong, "local-user")
    with r._connection() as c:
        for table in ("workflow_runs", "workflow_attempts", "draft_export_jobs", "gate_decisions"):
            assert c.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            c.execute("UPDATE media_preparation_write_requests SET expected_revision=99")


def test_two_projects_two_episodes_are_isolated_and_foreign_pins_rejected(tmp_path):
    r, p, e, b = setup(tmp_path)
    s = MediaPreparationStore(r)
    scopes = []
    for project in (p, make_project(r)):
        for episode in (r.list_episodes(project)[0].id, r.create_episode(project, title="二").id):
            board = (
                b
                if (project, episode) == (p, e)
                else write(
                    EpisodeStoryboardStore(r), board_payload(project, episode, shots=[shot()])
                )[0]
            )
            v = s.write(
                project, episode, str(uuid4()), preparation(project, episode, board), "local-user"
            ).version
            scopes.append((project, episode, v))
    for project, episode, v in scopes:
        assert [i.version_id for i in s.list(project, episode).items] == [v.version_id]
        for other_p, other_e, other in scopes:
            if (other_p, other_e) != (project, episode):
                with pytest.raises((ArtifactConflictError, MediaPreparationError)):
                    s.get(project, episode, other.version_id)
    altered = preparation(p, e, b).model_dump(mode="json")
    altered["input"]["storyboard_version_id"] = scopes[-1][2].content.input.storyboard_version_id
    with pytest.raises((ArtifactConflictError, MediaPreparationError)):
        s.write(
            p, e, str(uuid4()), CreateMediaPreparationRequest.model_validate(altered), "local-user"
        )
    assert len(s.list(p, e).items) == 1


@pytest.mark.parametrize(
    "mutation",
    [
        {"storyboard_content_hash": "sha256:" + "0" * 64},
        {"shot_id": "shp_" + "f" * 32},
        {"schema_version": "0.9.0"},
        {"requested_frames": 2},
        {"width": True},
        {"provider": "invented"},
    ],
)
def test_wrong_hash_shot_schema_and_nonclosed_input_never_writes(tmp_path, mutation):
    r, p, e, b = setup(tmp_path)
    d = preparation(p, e, b).model_dump(mode="json")
    d["input"].update(mutation)
    with pytest.raises((ValueError, ValidationError)):
        MediaPreparationStore(r).write(
            p, e, str(uuid4()), CreateMediaPreparationRequest.model_validate(d), "local-user"
        )
    assert MediaPreparationStore(r).list(p, e).items == ()


@pytest.mark.parametrize("step", ["version_inserted", "receipt_inserted"])
def test_atomic_version_and_receipt_rollback(tmp_path, step):
    r, p, e, b = setup(tmp_path)

    def fail(name, current):
        if name == "media_preparation" and current == step:
            raise sqlite3.OperationalError("Controlled original transaction failure")

    f = MediaPreparationStore(StudioRepository(r.database_path, transaction_hook=fail))
    with pytest.raises(sqlite3.OperationalError):
        f.write(p, e, str(uuid4()), preparation(p, e, b), "local-user")
    assert MediaPreparationStore(r).list(p, e).items == ()
    with r._connection() as c:
        assert c.execute("SELECT count(*) FROM media_preparation_write_requests").fetchone()[0] == 0


@pytest.mark.parametrize("change", ["missing", "changed"])
def test_selected_real_reference_verified_new_save_and_historical_read_survives(tmp_path, change):
    r, p, e, lib, bd = reference_setup(tmp_path)
    b = write(EpisodeStoryboardStore(r), CreateEpisodeStoryboardVersionRequest.model_validate(bd))[
        0
    ]
    s = MediaPreparationStore(r)
    v = s.write(p, e, str(uuid4()), preparation(p, e, b), "local-user").version
    ref = lib.content.references[0]
    blob = tmp_path / "media-assets" / "blobs" / ref.asset_sha256[:2] / ref.asset_sha256
    if change == "missing":
        blob.unlink()
    else:
        blob.write_bytes(b"changed actual original")
    assert s.get(p, e, v.version_id) == v
    assert v.content.snapshot.selected_references[0].asset_sha256 == ref.asset_sha256
    with pytest.raises(ValueError):
        s.write(p, e, str(uuid4()), preparation(p, e, b, v.version_id, 1), "local-user")
    assert len(s.list(p, e).items) == 1


def test_sql_256k_fence_precedes_json_and_snapshot_integrity_cannot_be_rehashed(
    tmp_path, monkeypatch
):
    r, p, e, b = setup(tmp_path)
    s = MediaPreparationStore(r)
    v = s.write(p, e, str(uuid4()), preparation(p, e, b), "local-user").version
    bad = v.content.model_dump(mode="json")
    bad["snapshot"]["shot"]["title"] = "wrong exact shot"

    def controlled_append(content, parent, revision):
        # The generic immutable store deliberately does not apply this domain's
        # validator. Build an inconsistent fixture without changing any guard.
        record = r.create_artifact_version(
            project_id=p,
            episode_id=e,
            artifact_type="episode_media_preparation",
            schema_version="1.0.0",
            content=content,
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="Save independent media request input",
            parent_version_id=parent,
            expected_revision=revision,
            dependencies=(
                ArtifactDependencyDraft(
                    upstream_version_id=b.version_id, relationship="derived_from", impact="blocking"
                ),
            ),
        )
        with r._connection() as c:
            c.execute(
                "INSERT INTO media_preparation_write_requests VALUES(?,?,?,?,?,?,?)",
                (
                    p,
                    e,
                    canonical_content_hash({"value": str(uuid4())}),
                    "sha256:" + "0" * 64,
                    record.version.artifact_id,
                    record.version.id,
                    revision,
                ),
            )
            c.commit()
        return record.version.id

    wrong = controlled_append(bad, v.version_id, 1)
    with pytest.raises(MediaPreparationError, match="snapshot"):
        s.get(p, e, wrong)
    bad["input"]["prompt"] = "x" * 270_000
    oversized = controlled_append(bad, wrong, 2)
    original = r._get_artifact_version_in_connection

    def trap(connection, **kwargs):
        if kwargs.get("version_id") == oversized:
            pytest.fail("oversized preparation JSON materialized")
        return original(connection, **kwargs)

    monkeypatch.setattr(r, "_get_artifact_version_in_connection", trap)
    with pytest.raises(MediaPreparationError, match="SQL materialization"):
        s.get(p, e, oversized)
    with r._connection() as c:
        assert c.execute(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' "
            "AND name='artifact_versions_immutable_update'"
        ).fetchone()


def test_authenticated_actual_http_private_save_get_only_recovery_and_public_read(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    r, p, e, b = setup(tmp_path)
    security = SidecarSecurity(
        token="test-local-preparation-no-provider-at-least-32-characters",
        host="127.0.0.1:43127",
        origin="app://aijian",
    )
    app = create_app(repository=r, sidecar_security=security)
    headers = {
        "Authorization": "Bearer test-local-preparation-no-provider-at-least-32-characters",
        "Origin": "app://aijian",
    }
    url = f"/api/v1/projects/{p}/episodes/{e}"
    op = str(uuid4()).upper()
    payload = preparation(p, e, b)
    with TestClient(app, base_url="http://127.0.0.1:43127", client=("127.0.0.1", 50101)) as client:
        response = client.post(
            url + "/media-preparations",
            json=payload.model_dump(mode="json"),
            headers={**headers, "Idempotency-Key": op},
        )
        assert response.status_code == 201, response.text
        actual = response.json()["data"]
        assert actual["payload"] == payload.model_dump(mode="json")
        recovered = client.get(
            url + f"/media-preparation-operations/{op}",
            params={"payload_hash": canonical_content_hash(payload.model_dump(mode="json"))},
            headers=headers,
        )
        assert recovered.status_code == 200 and recovered.json()["data"] == actual
        assert recovered.headers["Cache-Control"] == "no-store"
        assert (
            client.get(
                url + f"/media-preparation-operations/{op}",
                params={"payload_hash": "sha256:" + "0" * 64},
                headers=headers,
            ).status_code
            == 404
        )
        assert (
            client.get(url + "/media-preparations", headers=headers).json()["data"]["items"][0][
                "version_id"
            ]
            == actual["version"]["version_id"]
        )
    paths = app.openapi()["paths"]
    assert url not in paths
    assert not any("media-preparation-operations" in path for path in paths)
    public = create_app(repository=r)
    assert not any(
        "media-preparation-operations" in route.path
        for route in public.routes
        if hasattr(route, "path")
    )


def test_keyset_history_is_bounded_exclusive_and_cursor_scope_verified(tmp_path):
    r, p, e, b = setup(tmp_path)
    s = MediaPreparationStore(r)
    versions = []
    for _ in range(23):
        page = s.list(p, e)
        v = s.write(
            p,
            e,
            str(uuid4()),
            preparation(p, e, b, page.head_version_id, page.head_revision),
            "local-user",
        ).version
        versions.append(v)
    first = s.list(p, e)
    assert len(first.items) == 20 and first.next_cursor == versions[3].version_id
    tail = s.list(p, e, first.next_cursor)
    assert [v.version_id for v in tail.items] == [v.version_id for v in reversed(versions[:3])]
    assert tail.next_cursor is None and tail.head_version_id == first.head_version_id
    with pytest.raises(ArtifactConflictError):
        s.list(p, e, "ver_" + "f" * 32)


def test_response_failure_after_commit_is_unknown_and_original_get_recovers(tmp_path, monkeypatch):
    from aijian_api import media_preparation_routes as routes
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    r, p, e, b = setup(tmp_path)
    payload = preparation(p, e, b)
    op = str(uuid4())
    token = "controlled-preparation-response-failure-no-runtime-authority"
    app = create_app(
        repository=r, sidecar_security=SidecarSecurity(token=token, host="127.0.0.1:43127")
    )
    real = routes.MediaPreparationOperationResponse

    def fail_response(*args, **kwargs):
        raise ValueError("Controlled postcommit response construction failure")

    headers = {"Authorization": "Bearer " + token, "Origin": "app://aijian", "Idempotency-Key": op}
    url = f"/api/v1/projects/{p}/episodes/{e}"
    with TestClient(app, base_url="http://127.0.0.1:43127", client=("127.0.0.1", 50101)) as client:
        monkeypatch.setattr(routes, "MediaPreparationOperationResponse", fail_response)
        post = client.post(
            url + "/media-preparations", json=payload.model_dump(mode="json"), headers=headers
        )
        assert (
            post.status_code == 500
            and post.json()["error"]["code"] == "MEDIA_PREPARATION_WRITE_UNKNOWN"
        )
        monkeypatch.setattr(routes, "MediaPreparationOperationResponse", real)
        recovered = client.get(
            url + f"/media-preparation-operations/{op}",
            params={"payload_hash": canonical_content_hash(payload.model_dump(mode="json"))},
            headers=headers,
        )
        assert recovered.status_code == 200 and recovered.json()["data"][
            "payload"
        ] == payload.model_dump(mode="json")
    assert len(MediaPreparationStore(r).list(p, e).items) == 1


def test_historical_page_uses_shared_recursive_source_budget(tmp_path):
    r, p, e, b = setup(tmp_path)
    s = MediaPreparationStore(r)
    head = None
    revision = None
    # Each immutable board is healthy and below its2M single-body bound, while
    # twenty distinct exact sources exceed the shared32MiB page budget.
    for n in range(20):
        shots = [shot(i) for i in range(1, 101)]
        for item in shots[1:]:
            item["description"] = "x" * 17_500
        newer = write(
            EpisodeStoryboardStore(r),
            board_payload(p, e, shots=shots, parent=b.version_id, revision=b.head_revision),
            f"large-board-{n}",
        )[0]
        v = s.write(
            p, e, str(uuid4()), preparation(p, e, newer, head, revision), "local-user"
        ).version
        head = v.version_id
        revision = n + 1
        b = newer
    with pytest.raises(ValueError, match="materialization budget"):
        s.list(p, e)
    assert s.get(p, e, head).version_id == head
