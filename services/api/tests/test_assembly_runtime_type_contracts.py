"""Keep authoritative assembly validation and fail-closed media statuses intact."""

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
    _media_refs,
)
from pydantic import ValidationError
from test_draft_export_runtime import fixture


def test_mixed_visual_audio_refs_retain_exact_kind_and_reject_conflicts(tmp_path):
    _repository, _project, _episode, _asset, saved = fixture(tmp_path)
    original = saved.content.model_dump(mode="json")
    audio = {
        "segment_id": "seg_audio",
        "track_kind": "BGM",
        "start_frame": 0,
        "end_frame": 24,
        "media": {
            "asset_id": "asset_" + "a" * 32,
            "asset_version_id": "asv_" + "b" * 32,
            "sha256": "c" * 64,
        },
    }
    content = EpisodeMediaAssemblyContentV1.model_validate({**original, "audio_segments": [audio]})
    refs = _media_refs(content)
    assert refs == (
        (content.visual_segments[0].media, "image"),
        (content.audio_segments[0].media, "audio"),
    )
    conflicting = EpisodeMediaAssemblyContentV1.model_validate(
        {
            **original,
            "audio_segments": [{**audio, "media": original["visual_segments"][0]["media"]}],
        }
    )
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        _media_refs(conflicting)
    assert caught.value.code == "MEDIA_KIND_CONFLICT"


def test_frame_rate_revalidation_rejects_an_invalid_nested_copy(tmp_path):
    _repository, _project, _episode, _asset, saved = fixture(tmp_path)
    rate = saved.content.sequence_timebase.frame_rate.model_copy(update={"num": 23})
    timebase = saved.content.sequence_timebase.model_copy(update={"frame_rate": rate})
    payload = {**saved.content.model_dump(), "sequence_timebase": timebase}
    with pytest.raises(ValidationError, match="not supported"):
        EpisodeMediaAssemblyContentV1.model_validate(payload)


@pytest.mark.parametrize(
    "subtitles",
    [
        [],
        [
            {
                "segment_id": "seg_legacy",
                "script_version_id": "ver_" + "a" * 32,
                "script_block_id": "sblk_" + "b" * 32,
                "start_frame": 0,
                "end_frame": 3,
            }
        ],
        [
            {
                "segment_id": "seg_literal",
                "text": "本地字幕",
                "render_profile": "noto-cjk-sc-bottom-v1",
                "start_frame": 3,
                "end_frame": 6,
            }
        ],
    ],
)
def test_subtitle_content_roundtrip_keeps_canonical_hash(tmp_path, subtitles):
    _repository, _project, _episode, _asset, saved = fixture(tmp_path)
    payload = {**saved.content.model_dump(mode="json"), "subtitle_segments": subtitles}
    content = EpisodeMediaAssemblyContentV1.model_validate(payload)
    assert content.model_dump(mode="json") == payload
    assert canonical_content_hash(content.model_dump(mode="json")) == canonical_content_hash(
        payload
    )


@pytest.mark.parametrize(
    "mutation,availability",
    [
        ("missing", "MISSING"),
        ("corrupt", "CORRUPT"),
        ("symlink", "UNKNOWN_UNSAFE_PATH"),
    ],
)
def test_readback_keeps_history_and_write_rejects_unavailable_media(
    tmp_path, mutation, availability
):
    repository, project, episode, asset, saved = fixture(tmp_path)
    digest = asset.latest_version.sha256
    blob = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
    if mutation == "corrupt":
        body = bytearray(blob.read_bytes())
        body[-1] ^= 1
        blob.write_bytes(body)
    else:
        blob.unlink()
        if mutation == "symlink":
            blob.symlink_to(tmp_path / "owned-synthetic.png")
    store = EpisodeMediaAssemblyStore(repository)
    current = store.read_version(project, episode)
    assert current.version_id == saved.version_id
    assert current.content_hash == saved.content_hash
    assert current.media_checks[0].availability == availability
    assert current.playback_status == "BLOCKED_MEDIA_BYTES"
    assert current.export_status == "NO_EXPORT_CLAIM"
    with pytest.raises(EpisodeMediaAssemblyError) as caught:
        store.create_version(
            project,
            episode,
            CreateEpisodeMediaAssemblyVersionRequest(
                content=saved.content,
                parent_version_id=saved.version_id,
                expected_revision=saved.head_revision,
                change_summary="Cannot use missing original",
            ),
            author_actor_id="synthetic-user",
        )
    assert caught.value.code == "MEDIA_" + availability
    assert store.read_version(project, episode).version_id == saved.version_id
