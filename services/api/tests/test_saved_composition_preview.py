"""Decode the real retained DRAFT path used by the editor's composition preview."""

import json
from pathlib import Path

import pytest
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore, script_speaker_id
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.media_asset_store import MediaAssetStore
from test_draft_export_encoder import _pixels, _png, _power, _samples, _wav
from test_draft_export_runtime import fixture, request_for, runtime_for, toolchain, wait_final
from test_episode_media_assembly import dialogue_fixture


@pytest.mark.parametrize("preview", [False, True], ids=["draft-export", "saved-preview-cache"])
def test_saved_dialogue_decodes_exact_offset_interval_and_old_script_audio_pins(tmp_path, preview):
    repository, project, episode, audio, script, saved = dialogue_fixture(tmp_path)
    tools = toolchain()
    folder = tmp_path / "composition-previews" if preview else tmp_path
    folder.mkdir(exist_ok=True)
    request = request_for(saved, folder / "DRAFT-dialogue.mp4")
    if preview:
        request = request.model_copy(
            update={"output_path": str(folder / f"Aivora-PREVIEW-DRAFT-{request.operation_id}.mp4")}
        )
    old_binding = saved.content.audio_segments[0]
    # The old request exists before both mutable heads change. The same block ID
    # in the new script now belongs to a different speaker/delivery.
    content = script.content.model_dump(mode="json")
    content["scenes"][0]["blocks"][0].update(
        speaker="New synthetic speaker", delivery="OFF_SCREEN", text="New synthetic line."
    )
    newer_script, _ = EpisodeScriptStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": content,
                "parent_version_id": script.version_id,
                "expected_revision": script.head_revision,
                "change_summary": "Newer script must not retarget saved dialogue",
            }
        ),
        idempotency_key="newer-dialogue-script",
        actor_id="synthetic-user",
    )
    newer_audio = MediaAssetStore(repository).import_local(
        project, _wav(tmp_path / "newer-dialogue.wav", 44100, [(3, 1320)]), asset_id=audio.id
    )
    value = saved.content.model_dump(mode="json")
    version = newer_audio.latest_version
    value["audio_segments"][0].update(
        media={"asset_id": audio.id, "asset_version_id": version.id, "sha256": version.sha256},
        script_version_id=newer_script.version_id,
        speaker_id=script_speaker_id(
            project, episode, newer_script.version_id, "New synthetic speaker"
        ),
        delivery="OFF_SCREEN",
    )
    store = EpisodeMediaAssemblyStore(repository)
    newer = store.create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=EpisodeMediaAssemblyContentV1.model_validate(value),
            parent_version_id=saved.version_id,
            expected_revision=saved.head_revision,
            change_summary="Newer assembly must not enter old dialogue preview/export",
        ),
        author_actor_id="synthetic-user",
    )
    assert store.read_version(project, episode).version_id == newer.version_id
    assert (
        store.read_version(project, episode, version_id=saved.version_id).content.audio_segments[0]
        == old_binding
    )
    runtime = runtime_for(repository)
    try:
        runtime.submit(project, episode, request)
        result = wait_final(runtime, project, episode, request.operation_id)
        assert result.status == "SUCCEEDED", result
        assert result.assembly_version_id == saved.version_id
        assert result.assembly_content_hash == saved.content_hash
        output = Path(result.output_path)
        assert len(_pixels(tools, output)) == 48
        samples = _samples(tools, output)
        # Native 44.1 kHz offset removes the first tone. The two selected tones
        # fill only the saved half-open frame interval [12, 36) at 24 fps.
        assert _power(samples, 0.6, 0.9, 880) > 500
        assert _power(samples, 1.1, 1.4, 660) > 500
        assert _power(samples, 0.6, 0.9, 220) < 30
        assert _power(samples, 1.1, 1.4, 1320) < 30
        assert max(abs(value) for value in samples[4800:19200]) < 30
        assert max(abs(value) for value in samples[76800:91200]) < 30
        with repository._connection() as connection:
            row = connection.execute(
                "SELECT provenance_json, verification_json FROM draft_export_jobs "
                "WHERE operation_id=?",
                (request.operation_id,),
            ).fetchone()
        provenance = json.loads(row["provenance_json"])
        assert provenance["assembly"]["content"]["audio_segments"][0] == old_binding.model_dump(
            mode="json"
        )
        evidence = json.loads(row["verification_json"])
        assert evidence["full_decode_verified"] and evidence["cfr_pts_verified"]
        assert evidence["audio"]["assembly_samples"] == 96000
        assert evidence["title"] == "AIVORA DRAFT"
        assert evidence["comment"] == "AIVORA DRAFT - No release approval."
    finally:
        runtime.join_workers()
    reopened = runtime_for(repository)
    try:
        assert reopened.get(project, episode, request.operation_id).status == "SUCCEEDED"
        assert reopened.submit(project, episode, request).output_sha256 == result.output_sha256
    finally:
        reopened.join_workers()


def test_cached_saved_composition_decodes_old_snapshot_with_continuous_bgm(tmp_path: Path):
    repository, project, episode, red, initial = fixture(tmp_path)
    media = MediaAssetStore(repository)
    blue = media.import_local(project, _png(tmp_path / "owned-blue.png", (0, 0, 255)))
    bgm = media.import_local(project, _wav(tmp_path / "owned-bgm.wav", 44100, [(1, 220), (2, 440)]))

    def ref(asset):
        version = asset.latest_version
        return {
            "asset_id": asset.id,
            "asset_version_id": version.id,
            "sha256": version.sha256,
        }

    value = initial.content.model_dump(mode="json")
    value["total_frames"] = 48
    value["visual_segments"] = [
        {**value["visual_segments"][0], "media": ref(red)},
        {
            **value["visual_segments"][0],
            "segment_id": "seg_blue",
            "media": ref(blue),
            "start_frame": 24,
            "end_frame": 48,
        },
    ]
    value["audio_segments"] = [
        {
            "segment_id": "seg_bgm",
            "track_kind": "BGM",
            "media": ref(bgm),
            "start_frame": 0,
            "end_frame": 48,
            "source_in_sample": 44100,
        }
    ]
    store = EpisodeMediaAssemblyStore(repository)
    saved = store.create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=EpisodeMediaAssemblyContentV1.model_validate(value),
            parent_version_id=initial.version_id,
            expected_revision=initial.head_revision,
            change_summary="Synthetic saved composition",
        ),
        author_actor_id="synthetic-user",
    )
    # A newer head must not silently enter the immutable preview request.
    value["visual_segments"][0]["media"] = ref(blue)
    store.create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=EpisodeMediaAssemblyContentV1.model_validate(value),
            parent_version_id=saved.version_id,
            expected_revision=saved.head_revision,
            change_summary="Newer saved edit excluded from old preview",
        ),
        author_actor_id="synthetic-user",
    )
    cache = tmp_path / "composition-previews"
    cache.mkdir()
    request = request_for(saved, cache / "unused.mp4")
    output = cache / f"Aivora-PREVIEW-DRAFT-{request.operation_id}.mp4"
    request = request.model_copy(update={"output_path": str(output)})
    tools = toolchain()
    runtime = runtime_for(repository)
    try:
        runtime.submit(project, episode, request)
        result = wait_final(runtime, project, episode, request.operation_id)
        assert result.status == "SUCCEEDED", result
        assert result.assembly_version_id == saved.version_id
        assert result.assembly_content_hash == saved.content_hash
        pixels = _pixels(tools, output)
        assert len(pixels) == 48
        assert all(r > 100 and b < 20 for r, _g, b in pixels[:24])
        assert all(b > 100 and r < 20 for r, _g, b in pixels[24:])
        samples = _samples(tools, output)
        assert _power(samples, 0.1, 0.4, 440) > 500
        assert _power(samples, 1.6, 1.9, 440) > 500
        assert _power(samples, 0.1, 0.4, 220) < 30
        assert (
            runtime.get(project, episode, request.operation_id).output_sha256
            == result.output_sha256
        )
    finally:
        runtime.join_workers()
    reopened = runtime_for(repository)
    try:
        assert reopened.get(project, episode, request.operation_id).status == "SUCCEEDED"
        assert output.is_file()  # Cache lifetime is independent of the renderer/process.
        output.write_bytes(b"changed cache")
        assert reopened.get(project, episode, request.operation_id).error_code == "OUTPUT_CHANGED"
    finally:
        reopened.join_workers()
