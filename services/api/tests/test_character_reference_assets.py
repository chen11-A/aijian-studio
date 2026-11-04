"""Exact local reference identities and original-byte verification, no providers."""

import json
import sqlite3
import struct
import zlib
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.media_asset_store import MediaAssetError, MediaAssetStore
from aijian_api.project_creative_library_contracts import CreateProjectCreativeLibraryVersionRequest
from aijian_api.project_creative_library_store import (
    ProjectCreativeLibraryConflictError,
    ProjectCreativeLibraryInputError,
    ProjectCreativeLibraryStorageError,
    ProjectCreativeLibraryStore,
)
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_project_character_details import details_request
from test_project_creative_library import make_project


def png(path: Path, color: bytes = b"\x00\x00\xff") -> Path:
    def chunk(kind: bytes, content: bytes) -> bytes:
        return (
            struct.pack(">I", len(content))
            + kind
            + content
            + struct.pack(">I", zlib.crc32(kind + content))
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00" + color))
        + chunk(b"IEND", b"")
    )
    return path


def candidate(
    project: str, asset_id: str, version_id: str, digest: str
) -> CreateProjectCreativeLibraryVersionRequest:
    request = details_request(project).model_dump(mode="json")
    request["content"]["schema_version"] = "1.2.0"
    request["content"]["references"] = [
        {
            "reference_id": "crf_" + "f" * 32,
            "ordinal": 1,
            "character_id": "chr_" + "a" * 32,
            "costume_id": "cst_" + "e" * 32,
            "asset_id": asset_id,
            "asset_version_id": version_id,
            "asset_sha256": digest,
            "label": "服装参考",
        }
    ]
    return CreateProjectCreativeLibraryVersionRequest.model_validate(request)


def test_exact_reference_survives_restart_and_protects_historical_asset(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    assets = MediaAssetStore(repository)
    image = assets.import_local(project, png(tmp_path / "reference.png"))
    version = image.latest_version
    request = candidate(project, image.id, version.id, version.sha256)
    saved, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project, payload=request, idempotency_key="reference", actor_id="human"
    )
    reopened = ProjectCreativeLibraryStore(StudioRepository(repository.database_path))
    assert (
        reopened.get_version(project_id=project, version_id=saved.version_id).content
        == request.content
    )
    with pytest.raises(MediaAssetError) as rejected:
        assets.soft_delete(project, image.id)
    assert rejected.value.code == "ASSET_REFERENCED"
    replay, replayed = reopened.write(
        project_id=project, payload=request, idempotency_key="reference", actor_id="human"
    )
    assert replayed and replay.version_id == saved.version_id


@pytest.mark.parametrize("fault", ["project", "version", "hash", "missing", "changed"])
def test_reference_rejects_wrong_scope_identity_or_file_without_append(
    tmp_path: Path, fault: str
) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    other = make_project(repository)
    asset_project = other if fault == "project" else project
    assets = MediaAssetStore(repository)
    image = assets.import_local(asset_project, png(tmp_path / "reference.png"))
    version = image.latest_version
    digest = "0" * 64 if fault == "hash" else version.sha256
    version_id = "asv_" + "0" * 32 if fault == "version" else version.id
    request = candidate(project, image.id, version_id, digest)
    blob = (
        repository.database_path.parent
        / "media-assets"
        / "blobs"
        / version.sha256[:2]
        / version.sha256
    )
    if fault == "missing":
        blob.unlink()
    if fault == "changed":
        blob.write_bytes(b"x" * version.byte_size)
    with pytest.raises(ProjectCreativeLibraryInputError):
        ProjectCreativeLibraryStore(repository).write(
            project_id=project, payload=request, idempotency_key="reject", actor_id="human"
        )
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (0,)
        assert connection.execute(
            "SELECT COUNT(*) FROM project_creative_library_write_requests"
        ).fetchone() == (0,)


@pytest.mark.parametrize(
    "change",
    [
        {"character_id": "chr_" + "0" * 32},
        {"character_id": "chr_" + "c" * 32},
        {"costume_id": "cst_" + "0" * 32},
        {"reference_id": "wrong"},
        {"ordinal": True},
        {"ordinal": 2},
        {"asset_id": "wrong"},
        {"asset_version_id": "wrong"},
        {"asset_sha256": "sha256:" + "a" * 64},
        {"label": " "},
        {"label": "\ud800"},
        {"approved": True},
    ],
)
def test_closed_references_reject_bad_identity_membership_and_unapproved_fields(
    change: dict[str, object],
) -> None:
    value = candidate(
        "prj_" + "a" * 32, "asset_" + "b" * 32, "asv_" + "c" * 32, "d" * 64
    ).model_dump(mode="json")
    value["content"]["references"][0].update(change)
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(value)


def test_duplicate_and_legacy_mislabel_reference_rejected() -> None:
    value = candidate(
        "prj_" + "a" * 32, "asset_" + "b" * 32, "asv_" + "c" * 32, "d" * 64
    ).model_dump(mode="json")
    value["content"]["references"].append({**value["content"]["references"][0], "ordinal": 2})
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(value)
    value["content"]["references"].pop()
    value["content"]["schema_version"] = "1.1.0"
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(value)


def test_audio_cannot_be_used_as_a_visual_character_reference(tmp_path: Path) -> None:
    import wave

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    source = tmp_path / "voice.wav"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * 16)
    asset = MediaAssetStore(repository).import_local(project, source)
    assert asset.latest_version.kind == "audio"
    request = candidate(project, asset.id, asset.latest_version.id, asset.latest_version.sha256)
    with pytest.raises(ProjectCreativeLibraryInputError):
        ProjectCreativeLibraryStore(repository).write(
            project_id=project, payload=request, idempotency_key="audio", actor_id="human"
        )


def test_history_and_idempotent_replay_survive_missing_original_but_new_save_rejects(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    image = MediaAssetStore(repository).import_local(project, png(tmp_path / "reference.png"))
    request = candidate(project, image.id, image.latest_version.id, image.latest_version.sha256)
    store = ProjectCreativeLibraryStore(repository)
    saved, _ = store.write(
        project_id=project, payload=request, idempotency_key="save", actor_id="human"
    )
    digest = image.latest_version.sha256
    (tmp_path / "media-assets" / "blobs" / digest[:2] / digest).unlink()
    assert (
        store.get_version(project_id=project, version_id=saved.version_id).content
        == request.content
    )
    replay, replayed = store.write(
        project_id=project, payload=request, idempotency_key="save", actor_id="human"
    )
    assert replayed and replay.version_id == saved.version_id
    fresh = request.model_copy(
        update={"parent_version_id": saved.version_id, "expected_revision": saved.head_revision}
    )
    with pytest.raises(ProjectCreativeLibraryInputError):
        store.write(project_id=project, payload=fresh, idempotency_key="fresh", actor_id="human")
    for schema in ("1.0.0", "1.1.0"):
        value = fresh.model_dump(mode="json")
        value["content"].pop("references")
        value["content"]["schema_version"] = schema
        if schema == "1.0.0":
            value["content"].pop("costumes")
            value["content"].pop("relationships")
        with pytest.raises(ProjectCreativeLibraryConflictError):
            store.write(
                project_id=project,
                payload=CreateProjectCreativeLibraryVersionRequest.model_validate(value),
                idempotency_key=schema,
                actor_id="human",
            )
    assert store.get_latest(project_id=project).version_id == saved.version_id


def test_two_episodes_keep_exact_v3_pins_after_asset_and_library_versions_change(
    tmp_path: Path,
) -> None:
    from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
    from test_episode_storyboard import payload as storyboard_payload
    from test_episode_storyboard import shot, write

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    assets = MediaAssetStore(repository)
    image = assets.import_local(project, png(tmp_path / "old.png"))
    old = image.latest_version
    changed = assets.import_local(
        project, png(tmp_path / "new.png", b"\xff\x00\x00"), asset_id=image.id
    )
    new = changed.latest_version
    store = ProjectCreativeLibraryStore(repository)
    request = candidate(project, image.id, old.id, old.sha256)
    first, _ = store.write(
        project_id=project, payload=request, idempotency_key="old", actor_id="human"
    )
    episodes = [
        repository.list_episodes(project)[0].id,
        repository.create_episode(project, title="第二集").id,
    ]
    boards = EpisodeStoryboardStore(repository)
    linked = shot()
    linked["character_ids"] = ["chr_" + "a" * 32]
    board_a, _ = write(
        boards, storyboard_payload(project, episodes[0], shots=[linked], library=first.version_id)
    )
    fresh = candidate(project, image.id, new.id, new.sha256).model_copy(
        update={"parent_version_id": first.version_id, "expected_revision": first.head_revision}
    )
    second, _ = store.write(
        project_id=project, payload=fresh, idempotency_key="new", actor_id="human"
    )
    board_b, _ = write(
        boards, storyboard_payload(project, episodes[1], shots=[linked], library=second.version_id)
    )
    for board, expected in ((board_a, first), (board_b, second)):
        exact = boards.get_version(
            project_id=project, episode_id=board.episode_id, version_id=board.version_id
        )
        assert exact.content.creative_library_version_id == expected.version_id
        assert (
            store.get_version(project_id=project, version_id=expected.version_id).content
            == expected.content
        )
    assert first.content_hash != second.content_hash


def test_recomputed_hash_cannot_hide_orphan_reference_on_read(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    image = MediaAssetStore(repository).import_local(project, png(tmp_path / "reference.png"))
    store = ProjectCreativeLibraryStore(repository)
    saved, _ = store.write(
        project_id=project,
        payload=candidate(project, image.id, image.latest_version.id, image.latest_version.sha256),
        idempotency_key="save",
        actor_id="human",
    )
    invalid = saved.content.model_dump(mode="json")
    invalid["references"][0]["character_id"] = "chr_" + "c" * 32
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_versions_immutable_update")
        connection.execute(
            "UPDATE artifact_versions SET content_json = ?, content_hash = ? WHERE version_id = ?",
            (json.dumps(invalid), canonical_content_hash(invalid), saved.version_id),
        )
    with pytest.raises(ProjectCreativeLibraryStorageError):
        store.get_version(project_id=project, version_id=saved.version_id)


def test_v3_write_keeps_existing_native_auth_origin_and_readback_boundary(tmp_path: Path) -> None:
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    image = MediaAssetStore(repository).import_local(project, png(tmp_path / "reference.png"))
    value = candidate(
        project, image.id, image.latest_version.id, image.latest_version.sha256
    ).model_dump(mode="json")
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    path = f"/api/v1/projects/{project}/creative-library"
    assert (
        client.post(
            path + "/versions", json=value, headers={"Idempotency-Key": "unauthorized"}
        ).status_code
        == 401
    )
    client.headers.update({"Authorization": f"Bearer {'x' * 43}", "Origin": "https://wrong.test"})
    assert (
        client.post(
            path + "/versions", json=value, headers={"Idempotency-Key": "wrong-origin"}
        ).status_code
        == 403
    )
    client.headers["Origin"] = "app://aijian"
    response = client.post(path + "/versions", json=value, headers={"Idempotency-Key": "v3"})
    assert response.status_code == 201, response.text
    version = response.json()["data"]["version"]
    assert version["content"] == value["content"]
    assert version["content_hash"] == canonical_content_hash(value["content"])
    assert client.get(path + "/versions/" + version["version_id"]).json()["data"] == version
    assert TestClient(create_app(repository=repository)).post(
        path + "/versions", json=value
    ).status_code in (404, 405)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT accepted_version_id FROM artifact_heads").fetchone() == (
            None,
        )
