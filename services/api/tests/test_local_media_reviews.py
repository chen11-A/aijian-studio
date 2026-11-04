"""Real owned SQLite/imports and explicit facts; no playback, quality or Gate grant."""

import struct
import wave
import zlib
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api import local_media_review_store as review_module
from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import TrustedReviewActor
from aijian_api.episode_assembly_readiness_service import EpisodeAssemblyReadinessService
from aijian_api.episode_media_assembly_contracts import CreateEpisodeMediaAssemblyVersionRequest
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.local_media_original import availability_read_scope
from aijian_api.local_media_review_contracts import CreateLocalMediaReviewRequest
from aijian_api.local_media_review_store import (
    ARTIFACT_TYPE,
    LocalMediaReviewError,
    LocalMediaReviewStore,
)
from aijian_api.main import create_app
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from pydantic import ValidationError


def owned_fixture(directory: Path, *, projects: int = 1, episodes: int = 1):
    directory.mkdir(parents=True, exist_ok=True)
    repository = StudioRepository(directory / "workspace.db")

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    png = directory / "owned-review.png"
    png.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\0\0" * 16) * 16))
        + chunk(b"IEND", b"")
    )
    wav = directory / "owned-review.wav"
    with wave.open(str(wav), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(48000)
        stream.writeframes(struct.pack("<h", 2048) * 48000)
    scopes = []
    for i in range(projects):
        project = repository.create_project(
            name=f"Owned review project {i}",
            aspect_ratio="16:9",
            target_duration_seconds=30,
            source_language="zh-CN",
        )
        image = MediaAssetStore(repository).import_local(project.id, png)
        audio = MediaAssetStore(repository).import_local(project.id, wav)
        ep = [repository.list_episodes(project.id)[0]]
        ep.extend(
            repository.create_episode(project.id, title=f"Owned review episode {j}")
            for j in range(1, episodes)
        )
        for episode in ep:
            content = {
                "schema_version": "1.0.0",
                "project_id": project.id,
                "episode_id": episode.id,
                "sequence_timebase": {
                    "frame_rate": {"num": 24, "den": 1},
                    "timecode_mode": "NON_DROP_FRAME",
                },
                "canvas_width": 160,
                "canvas_height": 90,
                "total_frames": 24,
                "visual_segments": [
                    {
                        "segment_id": "seg_visual",
                        "media_kind": "image",
                        "media": {
                            "asset_id": image.id,
                            "asset_version_id": image.latest_version.id,
                            "sha256": image.latest_version.sha256,
                        },
                        "start_frame": 0,
                        "end_frame": 24,
                    }
                ],
                "audio_segments": [
                    {
                        "segment_id": "seg_audio",
                        "track_kind": "BGM",
                        "media": {
                            "asset_id": audio.id,
                            "asset_version_id": audio.latest_version.id,
                            "sha256": audio.latest_version.sha256,
                        },
                        "start_frame": 0,
                        "end_frame": 24,
                    }
                ],
                "subtitle_segments": [
                    {
                        "segment_id": "seg_subtitle",
                        "text": "自有字幕测试",
                        "render_profile": "noto-cjk-sc-bottom-v1",
                        "start_frame": 0,
                        "end_frame": 24,
                    }
                ],
            }
            assembly = EpisodeMediaAssemblyStore(repository).create_version(
                project.id,
                episode.id,
                CreateEpisodeMediaAssemblyVersionRequest.model_validate(
                    {"content": content, "change_summary": "Owned local review fixture"}
                ),
                author_actor_id="local-user",
            )
            scopes.append((project.id, episode.id, assembly, audio))
    return repository, scopes


def intent(repository, scope, *, kind="AUDIO", previous=None):
    p, e, a, _ = scope
    target = LocalMediaReviewStore(repository).target(
        p, e, a.version_id, a.content_hash, kind, "seg_audio" if kind == "AUDIO" else "seg_subtitle"
    )
    snapshot = target.snapshot
    return CreateLocalMediaReviewRequest.model_validate(
        {
            "input": {
                "schema_version": "1.0.0",
                "project_id": p,
                "episode_id": e,
                "assembly_version_id": a.version_id,
                "assembly_content_hash": a.content_hash,
                "assembly_head_revision": a.head_revision,
                "segment_kind": kind,
                "segment_id": snapshot.segment_id,
                "segment_content_hash": snapshot.segment_content_hash,
                "target_snapshot_hash": target.snapshot_hash,
                "outcome": "CHECKED",
                "observation": "我已核对选中自有原件或固定字幕文字，仍需后续正式审查。",
                "self_review": True,
            },
            "parent_version_id": previous.version.version_id if previous else None,
            "expected_revision": previous.result_revision if previous else None,
        }
    )


def dump(repository):
    with repository._connection() as c:
        return tuple(c.iterdump())


@pytest.mark.parametrize("kind", ["AUDIO", "LITERAL_SUBTITLE"])
def test_explicit_fact_exact_target_dependency_and_formal_blockers_remain(tmp_path, kind):
    repo, scopes = owned_fixture(tmp_path)
    p, e, a, _ = scopes[0]
    store = LocalMediaReviewStore(repo)
    payload = intent(repo, scopes[0], kind=kind)
    op = str(uuid4()).upper()
    result = store.write(p, e, op, payload, "local-user")
    assert result.operation_id == op and result.result_revision == 1
    assert result.payload == payload and result.version.content.input.self_review
    assert result.version.content.formal_status == "BLOCKED"
    record = repo.get_artifact_version(
        project_id=p,
        episode_id=e,
        artifact_type=ARTIFACT_TYPE,
        version_id=result.version.version_id,
    )
    assert [(d.upstream_version_id, d.relationship, d.impact) for d in record.dependencies] == [
        (a.version_id, "derived_from", "blocking")
    ]
    assert record.head.accepted_version_id is None
    before = dump(repo)
    assert (
        store.original(
            p, e, op, canonical_content_hash(payload.model_dump(mode="json")), "local-user"
        )
        == result
    )
    assert store.get(p, e, result.version.version_id) == result.version
    assert (
        store.status(p, e, result.version.version_id, result.version.content_hash).applicability
        == "CURRENT"
    )
    assert dump(repo) == before
    readiness = EpisodeAssemblyReadinessService(repo).inspect(p, e, a.version_id, a.content_hash)
    assert (
        readiness.formal_status == "BLOCKED" and readiness.picture_lock_status == "NO_PICTURE_LOCK"
    )
    assert "SOUND_REVIEW_NOT_RECORDED" in {b.code for b in readiness.blockers}


@pytest.mark.parametrize("fault", ["missing", "corrupt", "rights"])
def test_original_change_stales_dynamic_only_history_and_original_receipt_survive(tmp_path, fault):
    repo, scopes = owned_fixture(tmp_path)
    p, e, a, audio = scopes[0]
    store = LocalMediaReviewStore(repo)
    payload = intent(repo, scopes[0])
    op = str(uuid4())
    result = store.write(p, e, op, payload, "local-user")
    path = (
        repo.database_path.parent
        / "media-assets"
        / "blobs"
        / audio.latest_version.sha256[:2]
        / audio.latest_version.sha256
    )
    if fault == "missing":
        path.unlink()
    elif fault == "corrupt":
        data = path.read_bytes()
        path.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
    else:
        MediaAssetRightsStore(repo).append_human_decision(
            project_id=p,
            asset_id=audio.id,
            version_id=audio.latest_version.id,
            actor_id="local-user",
            command=HumanRightsDecisionInput(
                operation_id="rdop_" + uuid4().hex,
                expected_revision=0,
                decision="RESTRICTED",
                basis_text="The owned fixture rights are deliberately restricted for testing.",
            ),
        )
    before = dump(repo)
    assert (
        store.status(p, e, result.version.version_id, result.version.content_hash).applicability
        == "STALE"
    )
    assert store.get(p, e, result.version.version_id) == result.version
    assert (
        store.original(
            p, e, op, canonical_content_hash(payload.model_dump(mode="json")), "local-user"
        )
        == result
    )
    assert store.write(p, e, op, payload, "local-user") == result
    assert dump(repo) == before
    with pytest.raises(LocalMediaReviewError):
        store.write(p, e, str(uuid4()), payload, "local-user")
    assert dump(repo) == before


def test_new_saved_version_even_identical_content_never_inherits_observation(tmp_path):
    repo, scopes = owned_fixture(tmp_path)
    p, e, a, _ = scopes[0]
    store = LocalMediaReviewStore(repo)
    payload = intent(repo, scopes[0], kind="LITERAL_SUBTITLE")
    result = store.write(p, e, str(uuid4()), payload, "local-user")
    newer = EpisodeMediaAssemblyStore(repo).create_version(
        p,
        e,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=a.content,
            parent_version_id=a.version_id,
            expected_revision=a.head_revision,
            change_summary="Explicit new saved identity",
        ),
        author_actor_id="local-user",
    )
    assert newer.content_hash == a.content_hash and newer.version_id != a.version_id
    before = dump(repo)
    status = store.status(p, e, result.version.version_id, result.version.content_hash)
    assert (
        status.applicability == "STALE" and status.current_assembly.version_id == newer.version_id
    )
    assert store.get(p, e, result.version.version_id) == result.version
    with pytest.raises(LocalMediaReviewError):
        store.write(p, e, str(uuid4()), payload, "local-user")
    assert dump(repo) == before


@pytest.mark.parametrize("stage", ["version_inserted", "receipt_inserted"])
def test_fact_and_receipt_atomic_rollback_with_all_protected_triggers(tmp_path, stage):
    repo, scopes = owned_fixture(tmp_path)
    p, e, _, _ = scopes[0]
    payload = intent(repo, scopes[0])
    before = dump(repo)

    def hook(operation, step):
        if (operation, step) == ("local_media_review", stage):
            raise RuntimeError("controlled transaction failure")

    repo._transaction_hook = hook
    with pytest.raises(RuntimeError):
        LocalMediaReviewStore(repo).write(p, e, str(uuid4()), payload, "local-user")
    assert dump(repo) == before


def test_history_pagination_exact_get_and_original_result_do_not_follow_new_head(tmp_path):
    repo, scopes = owned_fixture(tmp_path)
    p, e, _, _ = scopes[0]
    store = LocalMediaReviewStore(repo)
    first = None
    previous = None
    for _ in range(22):
        payload = intent(repo, scopes[0], kind="LITERAL_SUBTITLE", previous=previous)
        previous = store.write(p, e, str(uuid4()), payload, "local-user")
        first = first or previous
    page = store.list(p, e)
    tail = store.list(p, e, page.next_cursor)
    assert len(page.items) == 20 and len(tail.items) == 2 and tail.next_cursor is None
    assert store.get(p, e, first.version.version_id) == first.version
    assert (
        store.original(
            p,
            e,
            first.operation_id,
            canonical_content_hash(first.payload.model_dump(mode="json")),
            "local-user",
        )
        == first
    )
    assert first.result_revision == 1 and page.head_revision == 22


@pytest.mark.parametrize("field", ["observation", "outcome", "target_snapshot_hash"])
def test_operation_complete_input_changed_rejected_and_no_second_version(tmp_path, field):
    repo, scopes = owned_fixture(tmp_path)
    p, e, _, _ = scopes[0]
    store = LocalMediaReviewStore(repo)
    payload = intent(repo, scopes[0])
    op = str(uuid4())
    store.write(p, e, op, payload, "local-user")
    value = payload.model_dump(mode="json")
    value["input"][field] = {
        "observation": "另一次独立观察",
        "outcome": "NEEDS_CHANGES",
        "target_snapshot_hash": "sha256:" + "f" * 64,
    }[field]
    changed = CreateLocalMediaReviewRequest.model_validate(value)
    before = dump(repo)
    with pytest.raises(LocalMediaReviewError):
        store.write(p, e, op, changed, "local-user")
    with pytest.raises(LocalMediaReviewError):
        store.original(
            p, e, op, canonical_content_hash(changed.model_dump(mode="json")), "local-user"
        )
    assert dump(repo) == before


def test_two_projects_two_episodes_ownership_and_wrong_actor_rejected(tmp_path):
    repo, scopes = owned_fixture(tmp_path, projects=2, episodes=2)
    store = LocalMediaReviewStore(repo)
    p, e, _, _ = scopes[0]
    payload = intent(repo, scopes[0])
    result = store.write(p, e, str(uuid4()), payload, "local-user")
    before = dump(repo)
    for other_p, other_e, _, _ in scopes[1:]:
        with pytest.raises(ArtifactConflictError):
            store.get(other_p, other_e, result.version.version_id)
        with pytest.raises(LocalMediaReviewError):
            store.write(other_p, other_e, str(uuid4()), payload, "local-user")
    with pytest.raises(LocalMediaReviewError):
        store.write(p, e, str(uuid4()), payload, "foreign-user")
    assert dump(repo) == before


@pytest.mark.parametrize("text", ["", " \t\n", "\u001c\u0085", "\ud800"])
def test_empty_or_non_scalar_observation_rejected_before_write(tmp_path, text):
    repo, scopes = owned_fixture(tmp_path)
    value = intent(repo, scopes[0]).model_dump(mode="json")
    value["input"]["observation"] = text
    with pytest.raises(ValidationError):
        CreateLocalMediaReviewRequest.model_validate(value)


@pytest.mark.parametrize("declaration", [False, 1, "true"])
def test_self_review_requires_actual_explicit_boolean(tmp_path, declaration):
    repo, scopes = owned_fixture(tmp_path)
    value = intent(repo, scopes[0]).model_dump(mode="json")
    value["input"]["self_review"] = declaration
    with pytest.raises(ValidationError):
        CreateLocalMediaReviewRequest.model_validate(value)


def test_original_budget_scope_and_sql_fence_reject_without_new_fact(tmp_path, monkeypatch):
    repo, scopes = owned_fixture(tmp_path)
    p, e, _, _ = scopes[0]
    payload = intent(repo, scopes[0])
    store = LocalMediaReviewStore(repo)
    before = dump(repo)
    with availability_read_scope(1), pytest.raises(LocalMediaReviewError):
        store.write(p, e, str(uuid4()), payload, "local-user")
    assert dump(repo) == before
    result = store.write(p, e, str(uuid4()), payload, "local-user")
    monkeypatch.setattr(review_module, "MAX_LOCAL_REVIEW_BYTES", 1)
    monkeypatch.setattr(
        repo,
        "_get_artifact_version_in_connection",
        lambda *args, **kwargs: pytest.fail("SQL fence before JSON"),
    )
    with pytest.raises(RuntimeError):
        store.get(p, e, result.version.version_id)


def test_literal_text_review_does_not_require_unrelated_audio_original_or_g5(tmp_path):
    repo, scopes = owned_fixture(tmp_path)
    p, e, _, audio = scopes[0]
    path = (
        repo.database_path.parent
        / "media-assets"
        / "blobs"
        / audio.latest_version.sha256[:2]
        / audio.latest_version.sha256
    )
    path.unlink()
    payload = intent(repo, scopes[0], kind="LITERAL_SUBTITLE")
    result = LocalMediaReviewStore(repo).write(p, e, str(uuid4()), payload, "local-user")
    assert result.version.content.observation_method == "LITERAL_SUBTITLE_TEXT_AND_RANGE"
    assert result.version.content.target_snapshot.media_original is None
    assert result.version.content.formal_status == "BLOCKED"


def test_failed_original_attribution_of_committed_write_is_unknown_not_rejection(
    tmp_path, monkeypatch
):
    repo, scopes = owned_fixture(tmp_path)
    p, e, _, _ = scopes[0]
    payload = intent(repo, scopes[0])
    store = LocalMediaReviewStore(repo)
    op = str(uuid4())
    store.write(p, e, op, payload, "local-user")
    before = dump(repo)

    def bad_projection(*args, **kwargs):
        raise LocalMediaReviewError(
            "LOCAL_MEDIA_REVIEW_INPUT_REJECTED", "controlled bad attribution"
        )

    monkeypatch.setattr(store, "_version", bad_projection)
    with pytest.raises(RuntimeError, match="Committed review receipt attribution failed"):
        store.write(p, e, op, payload, "local-user")
    assert dump(repo) == before


def test_unreadable_current_original_is_unknown_while_historic_fact_stays_readable(tmp_path):
    repo, scopes = owned_fixture(tmp_path)
    p, e, _, _ = scopes[0]
    payload = intent(repo, scopes[0])
    store = LocalMediaReviewStore(repo)
    result = store.write(p, e, str(uuid4()), payload, "local-user")
    with availability_read_scope(1):
        status = store.status(p, e, result.version.version_id, result.version.content_hash)
    assert status.applicability == "UNKNOWN" and status.formal_status == "BLOCKED"
    assert store.get(p, e, result.version.version_id) == result.version


def test_actual_auth_http_original_recovery_no_store_and_browser_write_absent(tmp_path):
    repo, scopes = owned_fixture(tmp_path)
    p, e, a, _ = scopes[0]
    payload = intent(repo, scopes[0], kind="LITERAL_SUBTITLE")
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    headers = {"Authorization": "Bearer " + "x" * 43, "Origin": "app://aijian"}
    app = create_app(repository=repo, sidecar_security=security)
    base = f"/api/v1/projects/{p}/episodes/{e}"
    with TestClient(app, base_url="http://127.0.0.1:43124", client=("127.0.0.1", 50101)) as client:
        assert client.get(base + "/local-media-reviews").status_code == 401
        op = str(uuid4()).upper()
        response = client.post(
            base + "/local-media-reviews",
            json=payload.model_dump(mode="json"),
            headers={**headers, "Idempotency-Key": op},
        )
        assert response.status_code == 201, response.text
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["data"]["operation_id"] == op
        v = response.json()["data"]["version"]
        original = client.get(
            base + f"/local-media-review-operations/{op}",
            params={"payload_hash": canonical_content_hash(payload.model_dump(mode="json"))},
            headers=headers,
        )
        assert original.status_code == 200 and original.json()["data"] == response.json()["data"]
        missing = client.get(
            base + f"/local-media-review-operations/{op.lower()}",
            params={"payload_hash": canonical_content_hash(payload.model_dump(mode="json"))},
            headers=headers,
        )
        assert missing.status_code == 404
        assert (
            client.get(
                base + f"/local-media-reviews/versions/{v['version_id']}", headers=headers
            ).status_code
            == 200
        )
        assert (
            client.get(
                base + f"/local-media-reviews/versions/{v['version_id']}/status",
                params={"expected_content_hash": v["content_hash"]},
                headers=headers,
            ).json()["data"]["formal_status"]
            == "BLOCKED"
        )
        assert (
            client.get(
                base + f"/media-assembly/versions/{a.version_id}/local-review-target",
                params={
                    "expected_content_hash": a.content_hash,
                    "segment_kind": "LITERAL_SUBTITLE",
                    "segment_id": "seg_subtitle",
                },
                headers=headers,
            ).status_code
            == 200
        )
    browser = create_app(repository=repo)
    with TestClient(browser) as client:
        assert (
            client.post(
                base + "/local-media-reviews", json=payload.model_dump(mode="json")
            ).status_code
            == 405
        )


def test_native_nonwriter_denied_and_postcommit_response_failure_is_unknown(tmp_path, monkeypatch):
    from aijian_api import local_media_review_routes as routes

    repo, scopes = owned_fixture(tmp_path)
    p, e, _, _ = scopes[0]
    payload = intent(repo, scopes[0])
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    headers = {
        "Authorization": "Bearer " + "x" * 43,
        "Origin": "app://aijian",
        "Idempotency-Key": str(uuid4()),
    }
    url = f"/api/v1/projects/{p}/episodes/{e}/local-media-reviews"
    app = create_app(
        repository=repo,
        sidecar_security=security,
        review_actor=TrustedReviewActor(subject_id="local-user", roles=("producer",)),
    )
    before = dump(repo)
    with TestClient(app, base_url="http://127.0.0.1:43124", client=("127.0.0.1", 50101)) as client:
        assert (
            client.post(url, json=payload.model_dump(mode="json"), headers=headers).status_code
            == 403
        )
    assert dump(repo) == before
    app = create_app(repository=repo, sidecar_security=security)
    monkeypatch.setattr(
        routes,
        "LocalMediaReviewOperationResponse",
        lambda **kwargs: (_ for _ in ()).throw(ValueError("controlled response fault")),
    )
    with TestClient(app, base_url="http://127.0.0.1:43124", client=("127.0.0.1", 50101)) as client:
        response = client.post(url, json=payload.model_dump(mode="json"), headers=headers)
        assert (
            response.status_code == 500
            and response.json()["error"]["code"] == "LOCAL_MEDIA_REVIEW_WRITE_UNKNOWN"
        )
    result = LocalMediaReviewStore(repo).original(
        p,
        e,
        headers["Idempotency-Key"],
        canonical_content_hash(payload.model_dump(mode="json")),
        "local-user",
    )
    assert result.result_revision == 1


def test_confirmed_source_duplicate_and_new_draft_stay_current_replacement_stales(tmp_path):
    from test_assembly_script_provenance import confirm, revise, source_fixture

    repo, p, e, _, script, assembly, _ = source_fixture(tmp_path)
    store = LocalMediaReviewStore(repo)
    target = store.target(p, e, assembly.version_id, assembly.content_hash, "AUDIO", "seg_dialogue")
    i = target.snapshot
    payload = CreateLocalMediaReviewRequest.model_validate(
        {
            "input": {
                "schema_version": "1.0.0",
                "project_id": p,
                "episode_id": e,
                "assembly_version_id": assembly.version_id,
                "assembly_content_hash": assembly.content_hash,
                "assembly_head_revision": assembly.head_revision,
                "segment_kind": "AUDIO",
                "segment_id": i.segment_id,
                "segment_content_hash": i.segment_content_hash,
                "target_snapshot_hash": target.snapshot_hash,
                "outcome": "NEEDS_CHANGES",
                "observation": "人工观察：此录音尚需对白内容检查。",
                "self_review": True,
            },
            "parent_version_id": None,
            "expected_revision": None,
        }
    )
    result = store.write(p, e, str(uuid4()), payload, "local-user")
    confirm(repo, p, e, script)
    assert (
        store.status(p, e, result.version.version_id, result.version.content_hash).applicability
        == "CURRENT"
    )
    new_script = revise(repo, p, e, script)
    assert (
        store.status(p, e, result.version.version_id, result.version.content_hash).applicability
        == "CURRENT"
    )
    confirm(repo, p, e, new_script)
    status = store.status(p, e, result.version.version_id, result.version.content_hash)
    assert status.applicability == "STALE"
    assert status.reasons[0].code == "LOCAL_MEDIA_REVIEW_SOURCE_CHANGED"
    assert store.get(p, e, result.version.version_id) == result.version
    assert (
        store.original(
            p,
            e,
            result.operation_id,
            canonical_content_hash(payload.model_dump(mode="json")),
            "local-user",
        )
        == result
    )
