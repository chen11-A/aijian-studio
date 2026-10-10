"""Exact saved dialogue bindings stay required for imported local audio."""

import json
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.draft_export_runtime import DraftExportRuntime
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
    script_speaker_id,
)
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.media_asset_store import MediaAssetStore
from pydantic import ValidationError
from test_draft_export_encoder import _wav
from test_draft_export_runtime import fixture, request_for, runtime_for, wait_final


def dialogue_fixture(tmp_path: Path):
    repository, project, episode, _image, initial = fixture(tmp_path)
    script, _ = EpisodeScriptStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": {
                    "project_id": project,
                    "episode_id": episode,
                    "scenes": [
                        {
                            "scene_id": "scn_" + "a" * 32,
                            "ordinal": 1,
                            "heading": "Owned synthetic dialogue test",
                            "blocks": [
                                {
                                    "block_id": "sblk_" + "b" * 32,
                                    "ordinal": 1,
                                    "kind": "DIALOGUE",
                                    "text": "Synthetic test line.",
                                    "speaker": "Synthetic speaker",
                                    "delivery": "ON_SCREEN",
                                },
                                {
                                    "block_id": "sblk_" + "c" * 32,
                                    "ordinal": 2,
                                    "kind": "ACTION",
                                    "text": "Synthetic action.",
                                },
                            ],
                        }
                    ],
                },
                "change_summary": "Owned synthetic dialogue binding",
            }
        ),
        idempotency_key="owned-dialogue-script",
        actor_id="synthetic-user",
    )
    audio = MediaAssetStore(repository).import_local(
        project,
        _wav(tmp_path / "owned-dialogue.wav", 44100, [(1, 220), (0.5, 880), (0.5, 660), (1, 330)]),
    )
    version = audio.latest_version
    value = initial.content.model_dump(mode="json")
    value["total_frames"] = 48
    value["visual_segments"][0]["end_frame"] = 48
    value["audio_segments"] = [
        {
            "segment_id": "seg_dialogue",
            "track_kind": "DIALOGUE",
            "media": {
                "asset_id": audio.id,
                "asset_version_id": version.id,
                "sha256": version.sha256,
            },
            "start_frame": 12,
            "end_frame": 36,
            "source_in_sample": 44100,
            "script_version_id": script.version_id,
            "script_block_id": "sblk_" + "b" * 32,
            "speaker_id": script_speaker_id(
                project, episode, script.version_id, "Synthetic speaker"
            ),
            "delivery": "ON_SCREEN",
        }
    ]
    saved = EpisodeMediaAssemblyStore(repository).create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=EpisodeMediaAssemblyContentV1.model_validate(value),
            parent_version_id=initial.version_id,
            expected_revision=initial.head_revision,
            change_summary="Owned audio bound to exact saved script",
        ),
        author_actor_id="synthetic-user",
    )
    return repository, project, episode, audio, script, saved


@pytest.mark.parametrize(
    "field", ["script_version_id", "script_block_id", "speaker_id", "delivery"]
)
def test_dialogue_rejects_each_missing_binding_field(tmp_path, field):
    repository, project, episode, _audio, _script, saved = dialogue_fixture(tmp_path)
    value = saved.content.model_dump(mode="json")
    value["audio_segments"][0].pop(field)
    with pytest.raises(ValidationError, match="dialogue must bind"):
        EpisodeMediaAssemblyContentV1.model_validate(value)
    digest = persist_content(repository, saved.version_id, value)
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        EpisodeMediaAssemblyStore(repository).read_version(project, episode)
    assert caught.value.code == "ASSEMBLY_CONTENT_CORRUPT"
    runtime = DraftExportRuntime(
        repository, lambda: pytest.fail("unbound dialogue cannot use tools")
    )
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        runtime.submit(
            project,
            episode,
            request_for(saved, tmp_path / "unbound.mp4").model_copy(
                update={"assembly_content_hash": digest}
            ),
        )
    assert caught.value.code == "ASSEMBLY_CONTENT_CORRUPT"


def persist_content(repository, version_id, content):
    """Inject corruption only into this test-owned temporary database."""
    digest = canonical_content_hash(content)
    with repository._connection() as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_versions_immutable_update")
        connection.execute(
            "UPDATE artifact_versions SET content_json=?, content_hash=? WHERE version_id=?",
            (json.dumps(content), digest, version_id),
        )
        connection.commit()
    return digest


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("script_version_id", "ver_" + "0" * 32, "SCRIPT_VERSION_NOT_FOUND"),
        ("script_version_id", "other_episode", "SCRIPT_VERSION_NOT_FOUND"),
        ("script_version_id", "other_project", "SCRIPT_VERSION_NOT_FOUND"),
        ("script_block_id", "sblk_" + "0" * 32, "SCRIPT_BLOCK_NOT_FOUND"),
        ("script_block_id", "sblk_" + "c" * 32, "DIALOGUE_CONFLICT"),
        ("speaker_id", "spk_" + "0" * 32, "SPEAKER_CONFLICT"),
        ("delivery", "OFF_SCREEN", "DIALOGUE_CONFLICT"),
    ],
)
def test_dialogue_save_read_and_export_reject_invalid_exact_binding(tmp_path, field, value, code):
    repository, project, episode, _audio, script, saved = dialogue_fixture(tmp_path)
    if value in {"other_episode", "other_project"}:
        other_project = project
        if value == "other_project":
            other_project = repository.create_project(
                name="Other synthetic project",
                aspect_ratio="16:9",
                target_duration_seconds=30,
                source_language="zh-CN",
            ).id
        other_episode = repository.create_episode(other_project, title="Other synthetic episode").id
        other_content = script.content.model_dump(mode="json")
        other_content.update(project_id=other_project, episode_id=other_episode)
        other_script, _ = EpisodeScriptStore(repository).write(
            project_id=other_project,
            episode_id=other_episode,
            payload=CreateEpisodeScriptVersionRequest.model_validate(
                {"content": other_content, "change_summary": "Wrong-scope script"}
            ),
            idempotency_key="other-script",
            actor_id="synthetic-user",
        )
        value = other_script.version_id
    content = saved.content.model_dump(mode="json")
    content["audio_segments"][0][field] = value
    store = EpisodeMediaAssemblyStore(repository)
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        store.create_version(
            project,
            episode,
            CreateEpisodeMediaAssemblyVersionRequest(
                content=EpisodeMediaAssemblyContentV1.model_validate(content),
                parent_version_id=saved.version_id,
                expected_revision=saved.head_revision,
                change_summary="Must reject invalid dialogue binding",
            ),
            author_actor_id="synthetic-user",
        )
    assert caught.value.code == code
    # Simulate persisted malformed content with an internally consistent assembly
    # hash: saved read/export must still check the referenced immutable script.
    digest = persist_content(repository, saved.version_id, content)
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        store.read_version(project, episode, version_id=saved.version_id)
    assert caught.value.code == code
    runtime = DraftExportRuntime(
        repository, lambda: pytest.fail("invalid binding cannot use tools")
    )
    request = request_for(saved, tmp_path / "invalid.mp4").model_copy(
        update={"assembly_content_hash": digest}
    )
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        runtime.submit(project, episode, request)
    assert caught.value.code == code
    assert runtime.list(project, episode) == []
    assert not (tmp_path / "invalid.mp4").exists()


def test_saved_dialogue_recovery_never_restarts(tmp_path, monkeypatch):
    import threading

    repository, project, episode, _audio, _script, saved = dialogue_fixture(tmp_path)
    runtime = runtime_for(repository)
    start_thread = threading.Thread.start

    def hold_export_worker(thread):
        if not thread.name.startswith("draft-export-"):
            start_thread(thread)

    monkeypatch.setattr(threading.Thread, "start", hold_export_worker)
    request = request_for(saved, tmp_path / "interrupted-dialogue.mp4")
    assert runtime.submit(project, episode, request).status == "QUEUED"
    recovered = DraftExportRuntime(repository, lambda: pytest.fail("must never restart dialogue"))
    assert recovered.get(project, episode, request.operation_id).status == "INTERRUPTED"
    assert recovered.submit(project, episode, request).status == "INTERRUPTED"
    assert not (tmp_path / "interrupted-dialogue.mp4").exists()


def test_dialogue_binding_change_after_encode_never_publishes(tmp_path, monkeypatch):
    from aijian_api import draft_export_encoder

    repository, project, episode, _audio, script, saved = dialogue_fixture(tmp_path)
    real_encode = draft_export_encoder.encode_draft

    def changed_after_encode(*args, **kwargs):
        verified = real_encode(*args, **kwargs)
        content = script.content.model_dump(mode="json")
        content["scenes"][0]["blocks"][0]["delivery"] = "OFF_SCREEN"
        persist_content(repository, script.version_id, content)
        return verified

    monkeypatch.setattr(draft_export_encoder, "encode_draft", changed_after_encode)
    runtime = runtime_for(repository)
    output = tmp_path / "invalidated-dialogue.mp4"
    request = request_for(saved, output)
    try:
        runtime.submit(project, episode, request)
        result = wait_final(runtime, project, episode, request.operation_id)
        assert result.status == "FAILED" and result.error_code == "DIALOGUE_CONFLICT"
        assert result.output_path is None and result.output_sha256 is None
        assert not output.exists()
    finally:
        runtime.join_workers()


@pytest.mark.parametrize("corruption", ["text", "hash", "schema"])
def test_saved_dialogue_rejects_corrupt_script_before_read_save_or_export(tmp_path, corruption):
    repository, project, episode, _audio, script, saved = dialogue_fixture(tmp_path)
    store = EpisodeMediaAssemblyStore(repository)
    # A valid saved script remains readable before fault injection.
    assert store.read_version(project, episode, version_id=saved.version_id) == saved
    with repository._connection() as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_versions_immutable_update")
        if corruption == "text":
            content = script.content.model_dump(mode="json")
            content["scenes"][0]["blocks"][0]["text"] = "Changed without updating the saved hash."
            connection.execute(
                "UPDATE artifact_versions SET content_json=? WHERE version_id=?",
                (json.dumps(content), script.version_id),
            )
        elif corruption == "hash":
            connection.execute(
                "UPDATE artifact_versions SET content_hash=? WHERE version_id=?",
                ("sha256:" + "0" * 64, script.version_id),
            )
        else:
            connection.execute(
                "UPDATE artifact_versions SET schema_version=? WHERE version_id=?",
                ("999.0.0", script.version_id),
            )
        connection.commit()
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        store.read_version(project, episode, version_id=saved.version_id)
    assert caught.value.code == "SCRIPT_VERSION_CORRUPT"
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        store.create_version(
            project,
            episode,
            CreateEpisodeMediaAssemblyVersionRequest(
                content=saved.content,
                parent_version_id=saved.version_id,
                expected_revision=saved.head_revision,
                change_summary="Corrupt saved script must not be rebound",
            ),
            author_actor_id="synthetic-user",
        )
    assert caught.value.code == "SCRIPT_VERSION_CORRUPT"
    runtime = DraftExportRuntime(repository, lambda: pytest.fail("corrupt script cannot use tools"))
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        runtime.submit(project, episode, request_for(saved, tmp_path / "corrupt-script.mp4"))
    assert caught.value.code == "SCRIPT_VERSION_CORRUPT"
    assert runtime.list(project, episode) == []
    assert not (tmp_path / "corrupt-script.mp4").exists()
