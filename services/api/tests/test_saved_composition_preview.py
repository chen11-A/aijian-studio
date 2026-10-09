"""Decode the real retained DRAFT path used by the editor's composition preview."""

from pathlib import Path

from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.media_asset_store import MediaAssetStore
from test_draft_export_encoder import _pixels, _png, _power, _samples, _wav
from test_draft_export_runtime import fixture, request_for, runtime_for, toolchain, wait_final


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
