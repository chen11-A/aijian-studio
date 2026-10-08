"""Synthetic adapter contracts; no decoder, MLT binary or product export is run."""

import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
from aijian_api import mlt_execution_adapter as adapter
from aijian_api.episode_media_execution_plan import ART04_MLT_TEST_SPEC_SHA256
from aijian_api.media_execution_plan_contracts import MediaExecutionPlanV1
from aijian_api.mlt_execution_worker import MltExecutionError, MltFileIdentity
from aijian_api.product_timeline_export_contracts import ProductExportSpec


def _write(path: Path, body: bytes) -> MltFileIdentity:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return MltFileIdentity(path, hashlib.sha256(body).hexdigest())


def frozen_fixture(
    tmp_path: Path,
) -> tuple[MediaExecutionPlanV1, dict[str, MltFileIdentity], MltFileIdentity]:
    """Freeze stand-in bytes and identities for adapter-only ART04 validation."""
    root = tmp_path / "qa"
    names = ("v1-blue.webm", "v2-red.webm", "dialogue-test.wav", "bgm-test.wav")
    files = {name: _write(root / name, name.encode()) for name in names}
    files["subtitle-test.srt"] = _write(
        root / "subtitle-test.srt",
        (
            "1\n00:00:01,000 --> 00:00:02,000\nTEST 提示音一（非语音）\n\n"
            "2\n00:00:03,000 --> 00:00:04,000\nTEST 提示音二（非语音）\n"
        ).encode(),
    )
    tool = _write(tmp_path / "tools" / "stand-in.bin", b"not an executable")
    version = "ver_" + "a" * 32
    blocks = ("sblk_" + "b" * 32, "sblk_" + "c" * 32)
    script_hash = "sha256:" + "d" * 64
    manifest_payload = {
        "kind": "QA02_MLT_SYNTHETIC_FIVE_INPUT_MANIFEST",
        "status": "FIVE_INPUTS_FROZEN_NO_MLT",
        "usage": "SYNTHETIC_TEST_ONLY",
        "spec_sha256": ART04_MLT_TEST_SPEC_SHA256,
        "project_id": "prj_" + "1" * 32,
        "episode_id": "ep_" + "2" * 32,
        "test_script_version_id": version,
        "test_script_content_hash": script_hash,
        "first_script_block_id": blocks[0],
        "second_script_block_id": blocks[1],
        "output_directory": str(root),
        "files": [
            {
                "name": name,
                "path": str(identity.path),
                "sha256": identity.sha256,
                "bytes": identity.path.stat().st_size,
                "usage": "SYNTHETIC_TEST_ONLY",
            }
            for name, identity in files.items()
        ],
        **{f"{name}_path": str(tool.path) for name in ("lock", "ffmpeg", "ffprobe")},
        **{f"{name}_sha256": tool.sha256 for name in ("lock", "ffmpeg", "ffprobe")},
    }
    manifest = _write(root / "manifest.json", json.dumps(manifest_payload).encode())
    refs = [
        {
            "asset_id": "asset_" + str(index + 3) * 32,
            "asset_version_id": "asv_" + str(index + 3) * 32,
            "sha256": files[name].sha256,
            "byte_size": files[name].path.stat().st_size,
            "rights_status": "CLEARED",
            "rights_decision_id": "ard_" + str(index + 3) * 32,
            **(
                {"probe_evidence_id": "mpe_" + str(index + 3) * 32, "probe_sha256": "7" * 64}
                if index < 2
                else {"inspection_sha256": "8" * 64}
            ),
        }
        for index, name in enumerate(names)
    ]

    def audio_clip(index: int, start: int, end: int, dialogue: bool) -> dict[str, object]:
        return {
            "clip_id": f"audio_{index}",
            "media": refs[2 if dialogue else 3],
            "start_frame": start,
            "end_frame": end,
            "source_in_sample": 0,
            "source_end_sample": (end - start) * 1920,
            "source_total_samples": 48000 if dialogue else 240000,
            "source_sample_rate_hz": 48000,
            "gain_millidb": 0,
            **(
                {
                    "script_version_id": version,
                    "script_block_id": blocks[index],
                    "speaker_id": "spk_" + "e" * 32,
                    "delivery": "ON_SCREEN",
                }
                if dialogue
                else {}
            ),
        }

    plan = MediaExecutionPlanV1.model_validate(
        {
            "scope": "ENGINEERING_TEST",
            "source": {
                "origin": "FROZEN_ENGINEERING_TEST",
                "project_id": manifest_payload["project_id"],
                "episode_id": manifest_payload["episode_id"],
                "test_spec_sha256": ART04_MLT_TEST_SPEC_SHA256,
                "fixture_manifest_sha256": manifest.sha256,
            },
            "sequence_timebase": {
                "frame_rate": {"num": 25, "den": 1},
                "timecode_mode": "NON_DROP_FRAME",
            },
            "canvas_width": 1080,
            "canvas_height": 1920,
            "total_frames": 125,
            "absent_test_roles": ["SFX"],
            "subtitle_output_mode": "BURN_IN",
            "dialogue_speech_status": "DIALOGUE_SPEECH_NOT_TESTED",
            "video_tracks": [
                {
                    "track_id": f"visual_{index}",
                    "layer_index": index,
                    "clips": [
                        {
                            "clip_id": f"video_{index}",
                            "media": refs[index],
                            "start_frame": start,
                            "end_frame": end,
                            "source_in_frame": 0,
                            "source_frame_count": 75,
                            "embedded_audio": "MUTE",
                            "source_width": 320,
                            "source_height": 568,
                            "scale_mode": "STRETCH_TO_CANVAS",
                        }
                    ],
                }
                for index, (start, end) in enumerate(((0, 75), (50, 125)))
            ],
            "audio_tracks": [
                {
                    "track_id": "dialogue",
                    "role": "DIALOGUE_TEST",
                    "clips": [audio_clip(0, 25, 50, True), audio_clip(1, 75, 100, True)],
                },
                {"track_id": "bgm", "role": "BGM_TEST", "clips": [audio_clip(2, 0, 125, False)]},
            ],
            "subtitle_cues": [
                {
                    "cue_id": f"subtitle_{index}",
                    "script_version_id": version,
                    "script_block_id": blocks[index],
                    "script_content_hash": script_hash,
                    "subtitle_file_sha256": files["subtitle-test.srt"].sha256,
                    "text": f"TEST 提示音{'一' if index == 0 else '二'}（非语音）",
                    "start_frame": start,
                    "end_frame": end,
                    "font_family": "Synthetic Test Font",
                    "font_size_px": 48,
                    "color_rgba": "#FFFFFFFF",
                }
                for index, (start, end) in enumerate(((25, 50), (75, 100)))
            ],
            "video_transitions": [
                {
                    "transition_id": "dissolve",
                    "kind": "CROSS_DISSOLVE",
                    "from_track_id": "visual_0",
                    "to_track_id": "visual_1",
                    "start_frame": 50,
                    "end_frame": 75,
                }
            ],
        }
    )
    return plan, files, manifest


def blueprint(tmp_path: Path) -> adapter.MltEngineeringBlueprint:
    plan, files, manifest = frozen_fixture(tmp_path)
    by_hash = {identity.sha256: identity for identity in files.values()}
    return adapter.build_mlt_engineering_blueprint(
        plan,
        resolve_selected=lambda ref: adapter.MltResolvedSelection(ref, by_hash[ref.sha256]),
        subtitle_file=files["subtitle-test.srt"],
        fixture_manifest=manifest,
    )


def test_frozen_mixed_tracks_keep_exact_frames_samples_and_engineering_scope(
    tmp_path: Path,
) -> None:
    built = blueprint(tmp_path)
    root = ET.fromstring(built.xml_bytes)
    playlists = [[(child.tag, child.attrib) for child in item] for item in root.findall("playlist")]
    assert playlists == [
        [("entry", {"producer": "media_0", "in": "0", "out": "74"}), ("blank", {"length": "50"})],
        [("blank", {"length": "50"}), ("entry", {"producer": "media_1", "in": "0", "out": "74"})],
        [("entry", {"producer": "media_4", "in": "0", "out": "124"})],
        [
            ("blank", {"length": "25"}),
            ("entry", {"producer": "media_2", "in": "0", "out": "24"}),
            ("blank", {"length": "25"}),
            ("entry", {"producer": "media_3", "in": "0", "out": "24"}),
            ("blank", {"length": "25"}),
        ],
    ]
    assert root.find("tractor").attrib == {"id": "main", "in": "0", "out": "124"}
    assert [item.attrib for item in root.findall("tractor/filter")] == [
        {"in": "25", "out": "49"},
        {"in": "75", "out": "99"},
    ]
    assert built.plan.scope == "ENGINEERING_TEST"
    assert built.plan.dialogue_speech_status == "DIALOGUE_SPEECH_NOT_TESTED"
    assert len(built.selected_resources) == 4
    assert len(built.qa_origin_files) == 5
    assert built.plan.audio_mix_policy == "SUM_NO_NORMALIZE_NO_LIMITER"


def test_materialized_task_preserves_source_and_hashes_without_product_claim(
    tmp_path: Path,
) -> None:
    built = blueprint(tmp_path)
    work_root = tmp_path / "jobs"
    work_root.mkdir()
    task = adapter.materialize_mlt_engineering_task(
        built,
        operation_id="eteop_" + "f" * 32,
        work_root=work_root,
    )
    assert task.xml.path.read_bytes() == built.xml_bytes
    assert task.xml.sha256 == hashlib.sha256(built.xml_bytes).hexdigest()
    assert task.profile.path.read_bytes() == built.profile_bytes
    assert task.profile.sha256 == hashlib.sha256(built.profile_bytes).hexdigest()
    assert task.execution_plan_hash == built.plan.content_hash
    assert task.resources == (*built.selected_resources, built.subtitle_file)
    assert (
        task.assembly_artifact_id is task.assembly_version_id is task.assembly_content_hash is None
    )
    assert type(task.spec) is ProductExportSpec


@pytest.mark.parametrize("audio", [False, True])
def test_playlist_rejects_clip_kind_that_disagrees_with_audio_flag(
    tmp_path: Path,
    audio: bool,
) -> None:
    plan, _files, _manifest = frozen_fixture(tmp_path)
    clips = plan.video_tracks[0].clips if audio else plan.audio_tracks[0].clips
    with pytest.raises(MltExecutionError) as caught:
        adapter._add_playlist(ET.Element("mlt"), "mismatched", clips, {}, audio=audio)
    assert caught.value.code == "ENGINEERING_PLAN_UNSUPPORTED"


def test_playlist_rejects_non_frame_aligned_audio_offsets(tmp_path: Path) -> None:
    plan, _files, _manifest = frozen_fixture(tmp_path)
    clip = (
        plan.audio_tracks[0]
        .clips[0]
        .model_copy(
            update={
                "source_in_sample": 1,
                "source_end_sample": 48001,
                "source_total_samples": 48001,
            },
        )
    )
    with pytest.raises(MltExecutionError, match="align exactly"):
        adapter._add_playlist(
            ET.Element("mlt"), "audio", (clip,), {clip.clip_id: "tone"}, audio=True
        )


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"path": None, "hash": "a" * 64},
        {"path": 1, "hash": "a" * 64},
        {"path": "/absolute/tool", "hash": None},
        {"path": "/absolute/tool", "hash": "z" * 64},
        {"path": "relative/tool", "hash": "a" * 64},
    ],
)
def test_manifest_tool_rejects_missing_or_malformed_pinned_identity(
    payload: dict[str, object],
) -> None:
    with pytest.raises(MltExecutionError) as caught:
        adapter._manifest_tool_identity(payload, "path", "hash")
    assert caught.value.code == "ENGINEERING_PLAN_UNSUPPORTED"


def test_manifest_tool_preserves_absolute_path_and_normalizes_pinned_hash(tmp_path: Path) -> None:
    tool = _write(tmp_path / "synthetic-tool", b"stand-in")
    assert (
        adapter._manifest_tool_identity(
            {"path": str(tool.path), "hash": tool.sha256.upper()},
            "path",
            "hash",
        )
        == tool
    )


def test_uncleared_rights_are_rejected_before_selection_resolution(tmp_path: Path) -> None:
    plan, files, manifest = frozen_fixture(tmp_path)
    clip = plan.video_tracks[0].clips[0]
    uncleared = clip.media.model_copy(update={"rights_status": "PENDING_REVIEW"})
    altered_track = plan.video_tracks[0].model_copy(
        update={"clips": (clip.model_copy(update={"media": uncleared}),)},
    )
    altered_plan = plan.model_copy(update={"video_tracks": (altered_track, plan.video_tracks[1])})

    def unexpected_selection(ref: object) -> adapter.MltResolvedSelection:
        raise AssertionError("Uncleared rights cannot reach source resolution")

    with pytest.raises(MltExecutionError, match="cleared rights"):
        adapter.build_mlt_engineering_blueprint(
            altered_plan,
            resolve_selected=unexpected_selection,
            subtitle_file=files["subtitle-test.srt"],
            fixture_manifest=manifest,
        )


def test_changed_subtitle_bytes_are_rejected_against_frozen_hash(tmp_path: Path) -> None:
    plan, files, manifest = frozen_fixture(tmp_path)
    files["subtitle-test.srt"].path.write_bytes(b"changed")
    with pytest.raises(MltExecutionError, match="frozen subtitle hash"):
        adapter.build_mlt_engineering_blueprint(
            plan,
            resolve_selected=lambda ref: adapter.MltResolvedSelection(ref, files["v1-blue.webm"]),
            subtitle_file=files["subtitle-test.srt"],
            fixture_manifest=manifest,
        )
