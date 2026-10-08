"""Typed media boundaries retain fail-closed input and mixed-track validation."""

import struct
from pathlib import Path

import pytest
from aijian_api import media_asset_audio_inspection as audio
from aijian_api import mlt_test_selection_resolver as selection
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.media_asset_selected_reader import SelectedMediaAssetRead, SelectedReadStatus
from aijian_api.media_execution_plan_contracts import MediaExecutionPlanV1
from aijian_api.product_export_claim import ProductExportClaimError, _selected_tracks
from pydantic import ValidationError
from test_draft_export_runtime import fixture as assembly_fixture
from test_mlt_execution_receipt import fixture as execution_fixture


def wav(*chunks: tuple[bytes, bytes]) -> bytes:
    body = b"WAVE" + b"".join(
        kind + struct.pack("<I", len(payload)) + payload + b"\0" * (len(payload) & 1)
        for kind, payload in chunks
    )
    return b"RIFF" + struct.pack("<I", len(body)) + body


PCM_FORMAT = struct.pack("<HHIIHH", 1, 1, 48_000, 96_000, 2, 16)


@pytest.mark.parametrize("samples", [48_000, 240_000])
def test_pcm_inspection_keeps_exact_sample_count(samples: int) -> None:
    body = wav((b"fmt ", PCM_FORMAT), (b"data", b"\0\0" * samples))
    assert audio._pcm_sample_count(body) == samples


@pytest.mark.parametrize(
    "body",
    [
        b"",
        wav((b"fmt ", PCM_FORMAT)),
        wav((b"data", b"\0\0")),
        wav((b"fmt ", PCM_FORMAT), (b"data", b"\0")),
        wav((b"fmt ", PCM_FORMAT), (b"fmt ", PCM_FORMAT), (b"data", b"\0\0")),
        wav((b"fmt ", PCM_FORMAT), (b"data", b"\0\0"), (b"data", b"\0\0")),
        wav((b"fmt ", PCM_FORMAT), (b"data", b"\0\0"))[:-1],
    ],
)
def test_pcm_inspection_rejects_missing_duplicate_or_truncated_chunks(body: bytes) -> None:
    with pytest.raises(audio.TestAudioInspectionError) as caught:
        audio._pcm_sample_count(body)
    assert caught.value.code == "AUDIO_FORMAT_UNSUPPORTED"


@pytest.mark.parametrize("status", ["MISSING", "UNKNOWN_DATABASE", "UNKNOWN_MEDIA_CHANGED"])
def test_unknown_selected_audio_is_rejected_before_managed_path_use(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: SelectedReadStatus
) -> None:
    monkeypatch.setattr(
        audio,
        "read_selected_media_asset_version",
        lambda *args: SelectedMediaAssetRead(status=status),
    )

    def unexpected_path(*args: object) -> Path:
        raise AssertionError("Unverified media must not reach managed-path admission")

    monkeypatch.setattr(audio, "_managed_path", unexpected_path)
    with pytest.raises(audio.TestAudioInspectionError) as caught:
        audio.inspect_selected_test_wav(
            tmp_path / "synthetic.db",
            "prj_" + "1" * 32,
            "asset_" + "2" * 32,
            "asv_" + "3" * 32,
            expected_samples=48_000,
        )
    assert caught.value.code == "AUDIO_ASSET_UNVERIFIED"


def test_unknown_test_selection_does_not_read_rights_or_probe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest = selection._FixtureManifest(
        project_id="prj_" + "1" * 32,
        episode_id="ep_" + "2" * 32,
        script_version_id="ver_" + "3" * 32,
        script_content_hash="sha256:" + "4" * 64,
        first_block_id="sblk_" + "5" * 32,
        second_block_id="sblk_" + "6" * 32,
        files={"v1-blue.webm": selection._FixtureFile(tmp_path / "blue.webm", "7" * 64, 8)},
        ffmpeg_sha256="8" * 64,
        ffprobe_sha256="9" * 64,
    )
    monkeypatch.setattr(
        selection,
        "read_selected_media_asset_version",
        lambda *args: SelectedMediaAssetRead(status="UNKNOWN_DATABASE"),
    )

    def unexpected_rights(*args: object) -> None:
        raise AssertionError("Unverified media must not reach rights or probe admission")

    monkeypatch.setattr(selection, "read_latest_rights_decision", unexpected_rights)
    with pytest.raises(selection.TestSelectionError) as caught:
        selection._verified_media(
            tmp_path / "synthetic.db",
            manifest,
            "v1-blue.webm",
            selection.AssetVersionSelector("asset_" + "a" * 32, "asv_" + "b" * 32),
        )
    assert caught.value.code == "ASSET_SELECTION_CONFLICT"


def test_mixed_export_tracks_keep_exact_references_and_reject_conflicting_roles(
    tmp_path: Path,
) -> None:
    _repository, _project, _episode, _asset, saved = assembly_fixture(tmp_path)
    payload = saved.content.model_dump(mode="json")
    background = {
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
    content = EpisodeMediaAssemblyContentV1.model_validate(
        {**payload, "audio_segments": [background]}
    )
    assert _selected_tracks(content) == (
        ("VISUAL", "image", content.visual_segments[0].media),
        ("BGM", "audio", content.audio_segments[0].media),
    )
    conflicting = EpisodeMediaAssemblyContentV1.model_validate(
        {**payload, "audio_segments": [{**background, "media": content.visual_segments[0].media}]}
    )
    with pytest.raises(ProductExportClaimError) as caught:
        _selected_tracks(conflicting)
    assert caught.value.code == "MEDIA_TRACK_CONFLICT"


@pytest.mark.parametrize("mutation", ["valid", "duplicate_track", "duplicate_clip", "sample_span"])
def test_execution_plan_validates_audio_alongside_video(tmp_path: Path, mutation: str) -> None:
    task, _runtime, _verifier = execution_fixture(tmp_path)
    payload = task.plan.model_dump(mode="json")
    video = task.plan.video_tracks[0]
    audio_track = {
        "track_id": video.track_id if mutation == "duplicate_track" else "background",
        "role": "BGM_TEST",
        "clips": [
            {
                "clip_id": video.clips[0].clip_id
                if mutation == "duplicate_clip"
                else "background_clip",
                "media": video.clips[0].media.model_dump(mode="json"),
                "start_frame": 0,
                "end_frame": 125,
                "source_in_sample": 0,
                "source_end_sample": 239_999 if mutation == "sample_span" else 240_000,
                "source_total_samples": 240_000,
                "source_sample_rate_hz": 48_000,
                "gain_millidb": 0,
            }
        ],
    }
    candidate = {**payload, "audio_tracks": [audio_track]}
    if mutation == "valid":
        plan = MediaExecutionPlanV1.model_validate(candidate)
        assert MediaExecutionPlanV1.model_validate(plan.model_dump(mode="json")) == plan
        assert plan.video_tracks == task.plan.video_tracks
        assert plan.audio_tracks[0].clips[0].source_end_sample == 240_000
    else:
        expected = "source sample interval" if mutation == "sample_span" else "IDs must be unique"
        with pytest.raises(ValidationError, match=expected):
            MediaExecutionPlanV1.model_validate(candidate)
