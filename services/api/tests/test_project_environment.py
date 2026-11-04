"""Real SQLite/local originals and authenticated API; no Provider or native playback."""

import json
import sqlite3
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.media_asset_store import MediaAssetError, MediaAssetStore
from aijian_api.project_creative_library_contracts import CreateProjectCreativeLibraryVersionRequest
from aijian_api.project_creative_library_store import (
    ProjectCreativeLibraryConflictError,
    ProjectCreativeLibraryInputError,
    ProjectCreativeLibraryNotFoundError,
    ProjectCreativeLibraryStore,
)
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_character_reference_assets import candidate, png
from test_project_creative_library import make_project, payload


def environment(project: str, asset_id: str, version_id: str, digest: str):
    value = candidate(project, asset_id, version_id, digest).model_dump(mode="json")
    content = value["content"]
    content.update(
        schema_version="1.3.0",
        scene_variants=[
            {
                "variant_id": "scv_" + "1" * 32,
                "ordinal": 1,
                "scene_id": "loc_" + "b" * 32,
                "name": "雨后凌晨",
                "view": "港口朝西",
                "time_of_day": "凌晨",
                "weather": "雨后",
                "state": "地面湿润",
                "continuity": "保留窗边灯光",
            }
        ],
        environment_references=[
            {
                "reference_id": "erf_" + str(i + 1) * 32,
                "ordinal": i + 1,
                "scene_id": None if i == 0 else "loc_" + "b" * 32,
                "variant_id": "scv_" + "1" * 32 if i == 2 else None,
                "asset_id": asset_id,
                "asset_version_id": version_id,
                "asset_sha256": digest,
                "label": ("世界材质", "码头基础", "雨后状态")[i],
            }
            for i in range(3)
        ],
    )
    return CreateProjectCreativeLibraryVersionRequest.model_validate(value)


def setup(tmp_path: Path):
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    assets = MediaAssetStore(repository)
    image = assets.import_local(project, png(tmp_path / "reference.png"))
    version = image.latest_version
    return repository, project, image, environment(project, image.id, version.id, version.sha256)


def test_save_restart_history_shared_scope_and_no_execution(tmp_path: Path) -> None:
    repository, project, image, request = setup(tmp_path)
    store = ProjectCreativeLibraryStore(repository)
    old_request = payload(project)
    old, _ = store.write(
        project_id=project, payload=old_request, idempotency_key="old", actor_id="human"
    )
    request = request.model_copy(
        update={"parent_version_id": old.version_id, "expected_revision": 1}
    )
    saved, replayed = store.write(
        project_id=project, payload=request, idempotency_key="environment", actor_id="human"
    )
    assert not replayed
    reopened = ProjectCreativeLibraryStore(StudioRepository(repository.database_path))
    assert reopened.get_latest(project_id=project).content == request.content
    assert saved.content_hash == canonical_content_hash(request.content.model_dump(mode="json"))
    assert (
        reopened.get_version(project_id=project, version_id=old.version_id).content
        == old_request.content
    )
    assert (
        reopened.get_version(project_id=project, version_id=old.version_id).content_hash
        == old.content_hash
    )
    other = make_project(repository)
    with pytest.raises(ProjectCreativeLibraryNotFoundError):
        reopened.get_version(project_id=other, version_id=saved.version_id)
    with pytest.raises(MediaAssetError) as refused:
        MediaAssetStore(repository).soft_delete(project, image.id)
    assert refused.value.code == "ASSET_REFERENCED"
    with sqlite3.connect(repository.database_path) as conn:
        assert conn.execute("SELECT accepted_version_id FROM artifact_heads").fetchall() == [
            (None,)
        ]
        assert conn.execute("SELECT episode_id FROM artifacts").fetchall() == [(None,)]
        assert conn.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (0,)


@pytest.mark.parametrize("schema", ["1.0.0", "1.1.0", "1.2.0"])
def test_cannot_downgrade_and_stale_cas_cannot_append(tmp_path: Path, schema: str) -> None:
    repository, project, _image, request = setup(tmp_path)
    store = ProjectCreativeLibraryStore(repository)
    saved, _ = store.write(
        project_id=project, payload=request, idempotency_key="one", actor_id="human"
    )
    value = request.model_dump(mode="json")
    value.update(parent_version_id=saved.version_id, expected_revision=1)
    content = value["content"]
    content.update(schema_version=schema)
    del content["scene_variants"], content["environment_references"]
    if schema != "1.2.0":
        del content["references"]
    if schema == "1.0.0":
        del content["relationships"], content["costumes"]
    with pytest.raises(ProjectCreativeLibraryConflictError):
        store.write(
            project_id=project,
            payload=CreateProjectCreativeLibraryVersionRequest.model_validate(value),
            idempotency_key="downgrade",
            actor_id="human",
        )
    with pytest.raises(ProjectCreativeLibraryConflictError):
        store.write(project_id=project, payload=request, idempotency_key="stale", actor_id="human")
    assert store.get_latest(project_id=project).version_id == saved.version_id


@pytest.mark.parametrize("fault", ["project", "version", "hash", "missing", "changed"])
def test_environment_original_identity_rejects_before_append(tmp_path: Path, fault: str) -> None:
    repository, project, image, request = setup(tmp_path)
    value = request.model_dump(mode="json")
    value["content"]["references"] = []
    ref = value["content"]["environment_references"][0]
    if fault == "project":
        other = make_project(repository)
        other_image = MediaAssetStore(repository).import_local(other, png(tmp_path / "other.png"))
        ref.update(asset_id=other_image.id, asset_version_id=other_image.latest_version.id)
    elif fault == "version":
        ref["asset_version_id"] = "asv_" + "0" * 32
    elif fault == "hash":
        ref["asset_sha256"] = "0" * 64
    else:
        digest = image.latest_version.sha256
        blob = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
        if fault == "missing":
            blob.unlink()
        else:
            blob.write_bytes(b"x" * image.latest_version.byte_size)
    with pytest.raises(ProjectCreativeLibraryInputError):
        ProjectCreativeLibraryStore(repository).write(
            project_id=project,
            payload=CreateProjectCreativeLibraryVersionRequest.model_validate(value),
            idempotency_key="invalid",
            actor_id="human",
        )
    with sqlite3.connect(repository.database_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (0,)
        assert conn.execute(
            "SELECT COUNT(*) FROM project_creative_library_write_requests"
        ).fetchone() == (0,)


def test_missing_original_preserves_history_replay_and_prevents_new_save(tmp_path: Path) -> None:
    repository, project, image, request = setup(tmp_path)
    store = ProjectCreativeLibraryStore(repository)
    saved, _ = store.write(
        project_id=project, payload=request, idempotency_key="one", actor_id="human"
    )
    digest = image.latest_version.sha256
    (tmp_path / "media-assets" / "blobs" / digest[:2] / digest).unlink()
    assert (
        store.get_version(project_id=project, version_id=saved.version_id).content
        == request.content
    )
    replay, replayed = store.write(
        project_id=project, payload=request, idempotency_key="one", actor_id="human"
    )
    assert replayed and replay.version_id == saved.version_id
    newer = request.model_copy(
        update={"parent_version_id": saved.version_id, "expected_revision": 1}
    )
    with pytest.raises(ProjectCreativeLibraryInputError):
        store.write(project_id=project, payload=newer, idempotency_key="new", actor_id="human")


@pytest.mark.parametrize(
    "change",
    [
        {"variant_id": "wrong"},
        {"scene_id": "loc_" + "f" * 32},
        {"ordinal": True},
        {"ordinal": 2},
        {"name": " "},
        {"view": "x" * 241},
        {"state": "\ud800"},
        {"approved": True},
    ],
)
def test_closed_state_fields(change: dict[str, object]) -> None:
    value = environment(
        "prj_" + "a" * 32, "asset_" + "a" * 32, "asv_" + "a" * 32, "a" * 64
    ).model_dump(mode="json")
    value["content"]["scene_variants"][0].update(change)
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(value)


@pytest.mark.parametrize(
    "change",
    [
        {"reference_id": "wrong"},
        {"scene_id": "loc_" + "f" * 32},
        {"scene_id": None, "variant_id": "scv_" + "1" * 32},
        {"variant_id": "scv_" + "2" * 32},
        {"ordinal": True},
        {"asset_id": "wrong"},
        {"asset_version_id": "wrong"},
        {"asset_sha256": "sha256:" + "a" * 64},
        {"label": " "},
        {"label": "\ud800"},
        {"approved": True},
    ],
)
def test_closed_reference_owner_and_identity(change: dict[str, object]) -> None:
    value = environment(
        "prj_" + "a" * 32, "asset_" + "a" * 32, "asv_" + "a" * 32, "a" * 64
    ).model_dump(mode="json")
    value["content"]["environment_references"][2].update(change)
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(value)


def test_duplicate_and_cross_scene_state_rejected() -> None:
    value = environment(
        "prj_" + "a" * 32, "asset_" + "a" * 32, "asv_" + "a" * 32, "a" * 64
    ).model_dump(mode="json")
    content = value["content"]
    content["scenes"].append({**content["scenes"][0], "scene_id": "loc_" + "2" * 32, "ordinal": 2})
    content["environment_references"][2]["scene_id"] = "loc_" + "2" * 32
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(value)
    content["environment_references"][2]["scene_id"] = "loc_" + "b" * 32
    content["scene_variants"].append({**content["scene_variants"][0], "ordinal": 2})
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(value)


def test_authenticated_http_exact_content_and_fixture(tmp_path: Path) -> None:
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository, project, _image, request = setup(tmp_path)
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    client.headers.update({"Authorization": "Bearer " + "x" * 43, "Origin": "app://aijian"})
    path = f"/api/v1/projects/{project}/creative-library"
    response = client.post(
        path + "/versions",
        json=request.model_dump(mode="json"),
        headers={"Idempotency-Key": "environment"},
    )
    assert response.status_code == 201, response.text
    version = response.json()["data"]["version"]
    assert client.get(path + "/versions/" + version["version_id"]).json()["data"] == version
    assert version["content_hash"] == canonical_content_hash(
        request.content.model_dump(mode="json")
    )
    client.headers.pop("Authorization")
    assert (
        client.post(
            path + "/versions",
            json=request.model_dump(mode="json"),
            headers={"Idempotency-Key": "forbidden"},
        ).status_code
        == 401
    )
    fixture = json.loads(
        (
            Path(__file__).resolve().parents[3]
            / "packages/contracts/fixtures/project-environment.json"
        ).read_text(encoding="utf-8")
    )
    checked = CreateProjectCreativeLibraryVersionRequest.model_validate(fixture["request"])
    assert checked.content.model_dump(mode="json") == fixture["response"]["data"]["content"]
    assert (
        canonical_content_hash(checked.content.model_dump(mode="json"))
        == fixture["response"]["data"]["content_hash"]
    )


def test_existing_g5_character_chain_accepts_exact_v4_library(tmp_path: Path) -> None:
    from aijian_api.visual_bible_contracts import CreateVisualBibleVersionRequest
    from aijian_api.visual_bible_store import VisualBibleStore
    from test_visual_bible_g5 import (
        ACTOR,
        clear_rights,
        consume_decision,
        decision_payload,
        inspect_fixture,
        prepare,
        setup_visual,
        signed,
    )

    repository, project, asset, visual_request, old_visual = setup_visual(tmp_path)
    store = ProjectCreativeLibraryStore(repository)
    old = store.get_latest(project_id=project)
    value = old.content.model_dump(mode="json")
    value.update(schema_version="1.3.0", scene_variants=[], environment_references=[])
    request = CreateProjectCreativeLibraryVersionRequest.model_validate(
        {
            "content": value,
            "parent_version_id": old.version_id,
            "expected_revision": old.head_revision,
            "change_summary": "保存环境版本",
        }
    )
    library, _ = store.write(
        project_id=project,
        payload=request,
        idempotency_key="environment",
        actor_id=ACTOR.subject_id,
    )
    upgraded = visual_request.model_dump(mode="json")
    upgraded["content"].update(
        creative_library_version_id=library.version_id,
        creative_library_content_hash=library.content_hash,
    )
    upgraded.update(
        parent_version_id=old_visual.version.id, expected_revision=old_visual.head.revision
    )
    saved, _ = VisualBibleStore(repository).write(
        project,
        CreateVisualBibleVersionRequest.model_validate(upgraded),
        idempotency_key="upgraded",
        actor_id=ACTOR.subject_id,
    )
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sign, report = signed(repository, project, saved)
    challenge = prepare(
        repository, project, saved, sign.head.revision, "decision", decision_payload(), report
    )
    result = consume_decision(repository, project, saved, sign.head, challenge)
    assert result.head.accepted_version_id == saved.version.id
    assert result.decision.gate == "G5"
    assert (
        VisualBibleStore(repository).get_version(project, old_visual.version.id).version
        == old_visual.version
    )


def test_existing_character_shot_consumer_preserves_v4_pins_and_fresh_checks(
    tmp_path: Path,
) -> None:
    from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
    from aijian_api.episode_storyboard_store import (
        EpisodeStoryboardInputError,
        EpisodeStoryboardStore,
    )
    from test_episode_storyboard import payload as storyboard_payload
    from test_episode_storyboard import shot

    repository, project, image, request = setup(tmp_path)
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project, payload=request, idempotency_key="library", actor_id="human"
    )
    episode = repository.list_episodes(project)[0].id
    linked = shot()
    linked["character_ids"] = ["chr_" + "a" * 32]
    value = storyboard_payload(
        project, episode, shots=[linked], library=library.version_id
    ).model_dump(mode="json")
    value["content"]["schema_version"] = "1.1.0"
    value["content"]["shots"][0]["character_bindings"] = [
        {
            "character_id": "chr_" + "a" * 32,
            "costume_id": "cst_" + "e" * 32,
            "reference_ids": ["crf_" + "f" * 32],
        }
    ]
    store = EpisodeStoryboardStore(repository)
    original = CreateEpisodeStoryboardVersionRequest.model_validate(value)
    saved, _ = store.write(
        project_id=project,
        episode_id=episode,
        payload=original,
        idempotency_key="shot",
        actor_id="human",
    )
    assert saved.content == original.content
    digest = image.latest_version.sha256
    (tmp_path / "media-assets" / "blobs" / digest[:2] / digest).unlink()
    assert (
        store.get_version(
            project_id=project, episode_id=episode, version_id=saved.version_id
        ).content
        == original.content
    )
    value.update(parent_version_id=saved.version_id, expected_revision=saved.head_revision)
    with pytest.raises(EpisodeStoryboardInputError):
        store.write(
            project_id=project,
            episode_id=episode,
            payload=CreateEpisodeStoryboardVersionRequest.model_validate(value),
            idempotency_key="new-shot",
            actor_id="human",
        )
