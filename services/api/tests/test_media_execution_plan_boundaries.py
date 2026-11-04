"""Synthetic pure mappings, not authenticated media, rights, or engine evidence."""

from dataclasses import replace
from datetime import UTC, datetime

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import ArtifactHead, ArtifactVersion, ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyVersionData
from aijian_api.episode_media_execution_plan import (
    ART04_MLT_TEST_SPEC_SHA256,
    MediaExecutionPlanError,
    build_art04_synthetic_execution_plan,
    build_assembly_execution_plan,
    inclusive_mlt_last_frame,
    otio_mapping_losses,
    require_legacy_timeline_alignment,
)
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidence
from aijian_api.media_execution_plan_contracts import (
    ExecutionMediaRefV1,
    FrozenEngineeringTestBindingsV1,
    FrozenTestAudioInspectionV1,
    MediaExecutionPlanReceiptV1,
    MediaExecutionPlanV1,
)
from aijian_api.media_probe import LocalMediaProbeData
from aijian_api.timeline import TimelineVersionV1
from pydantic import ValidationError

PROJECT = "prj_" + "1" * 32
EPISODE = "ep_" + "2" * 32
ASSET = "asset_" + "3" * 32
VERSION = "asv_" + "4" * 32
SHA = "5" * 64
TIMEBASE = {"frame_rate": {"num": 25, "den": 1}, "timecode_mode": "NON_DROP_FRAME"}


def probe():
    return MediaAssetProbeEvidence(
        id="mpe_" + "6" * 32,
        project_id=PROJECT,
        asset_id=ASSET,
        version_id=VERSION,
        asset_sha256=SHA,
        byte_size=100,
        probe_sha256="7" * 64,
        toolchain_profile_id="synthetic-only",
        toolchain_version="test",
        ffmpeg_sha256="8" * 64,
        ffprobe_sha256="9" * 64,
        created_at="2026-10-10T00:00:00Z",
        probe=LocalMediaProbeData.model_validate(
            {
                "source_asset_sha256": "sha256:" + SHA,
                "byte_size": 100,
                "format_names": ("mp4",),
                "container_duration": {"num": 3, "den": 1},
                "video": {
                    "stream_index": 0,
                    "codec_name": "h264",
                    "width": 320,
                    "height": 568,
                    "pixel_format": "yuv420p",
                    "average_frame_rate": {"num": 25, "den": 1},
                    "time_base": {"num": 1, "den": 25},
                    "frames": tuple(
                        {"pts": {"ticks": i, "time_base": {"num": 1, "den": 25}}} for i in range(75)
                    ),
                    "is_variable_frame_rate": False,
                },
                "audio": None,
            }
        ),
    )


def assembly(*, segment_fields=None, content_fields=None, check_fields=None, **fields):
    media = {"asset_id": ASSET, "asset_version_id": VERSION, "sha256": SHA}
    content = {
        "schema_version": "1.0.0",
        "project_id": PROJECT,
        "episode_id": EPISODE,
        "sequence_timebase": TIMEBASE,
        "canvas_width": 320,
        "canvas_height": 568,
        "total_frames": 50,
        "visual_segments": [
            {
                "segment_id": "seg_video",
                "media_kind": "video",
                "media": media,
                "start_frame": 0,
                "end_frame": 50,
                "source_in_frame": 5,
                "embedded_audio": "MUTE",
                **(segment_fields or {}),
            }
        ],
        "audio_segments": [],
        "subtitle_segments": [],
        **(content_fields or {}),
    }
    check = {
        "media": media,
        "kind": "video",
        "availability": "VERIFIED",
        "technical_status": "PROBED_CFR_VIDEO",
        "rights_status": "PENDING_REVIEW",
        **(check_fields or {}),
    }
    return EpisodeMediaAssemblyVersionData.model_validate(
        {
            "artifact_id": "art_" + "a" * 32,
            "version_id": "ver_" + "b" * 32,
            "content_hash": canonical_content_hash(content),
            "head_revision": 2,
            "parent_version_id": None,
            "content": content,
            "media_checks": (check,),
            "playback_status": "DRAFT_VIDEO_PREVIEW",
            **fields,
        }
    )


def test_assembly_maps_exact_trim_and_identity_without_promoting_pending_rights():
    version = assembly()
    plan = build_assembly_execution_plan(version, {VERSION: probe()})
    clip = plan.video_tracks[0].clips[0]
    assert (clip.start_frame, clip.end_frame, clip.source_in_frame) == (0, 50, 5)
    assert clip.source_frame_count == 75
    assert clip.media.rights_status == "PENDING_REVIEW"
    assert clip.media.rights_decision_id is None
    assert plan.scope == "DRAFT_PREVIEW"
    assert plan.source.assembly_content_hash == version.content_hash
    assert plan.source.assembly_head_revision == 2
    assert not plan.audio_tracks and not plan.subtitle_cues
    assert plan.content_hash == plan.plan_hash
    receipt = MediaExecutionPlanReceiptV1(plan=plan, plan_hash=plan.plan_hash)
    assert receipt.plan == plan
    with pytest.raises(ValidationError, match="receipt hash"):
        MediaExecutionPlanReceiptV1(plan=plan, plan_hash="sha256:" + "0" * 64)
    assert otio_mapping_losses(plan) == (
        "ASSET01_VERSION_AND_RIGHTS_EVIDENCE",
        "PROBE_AND_TOOLCHAIN_EVIDENCE",
    )


@pytest.mark.parametrize(
    ("fields", "code"),
    [
        ({"content_hash": "sha256:" + "0" * 64}, "ASSEMBLY_HASH_CONFLICT"),
        ({"playback_status": "DRAFT_STATIC_ANIMATIC"}, "ASSEMBLY_NOT_VIDEO_READY"),
        ({"media_checks": ()}, "MEDIA_EVIDENCE_MISSING"),
        ({"check_fields": {"availability": "MISSING"}}, "MEDIA_NOT_READY"),
        ({"check_fields": {"technical_status": "PENDING_MEDIA_PROBE"}}, "MEDIA_NOT_READY"),
        ({"check_fields": {"rights_status": "RESTRICTED"}}, "MEDIA_NOT_READY"),
        (
            {"segment_fields": {"media_kind": "image", "source_in_frame": 0}},
            "IMAGE_PRODUCER_UNSUPPORTED",
        ),
        ({"content_fields": {"canvas_width": 640}}, "SCALE_POLICY_UNSPECIFIED"),
        ({"content_fields": {"canvas_height": 480}}, "SCALE_POLICY_UNSPECIFIED"),
        ({"segment_fields": {"embedded_audio": "PLAY"}}, "EMBEDDED_AUDIO_MISSING"),
    ],
)
def test_assembly_refuses_unrepresentable_or_unverified_inputs(fields, code):
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_assembly_execution_plan(assembly(**fields), {VERSION: probe()})
    assert caught.value.code == code


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("project_id", "prj_" + "0" * 32),
        ("asset_id", "asset_" + "0" * 32),
        ("version_id", "asv_" + "0" * 32),
        ("asset_sha256", "0" * 64),
    ],
)
def test_assembly_rejects_probe_bound_to_another_source(field, value):
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_assembly_execution_plan(assembly(), {VERSION: replace(probe(), **{field: value})})
    assert caught.value.code == "PROBE_IDENTITY_CONFLICT"


@pytest.mark.parametrize(
    "changes",
    [
        {"source_asset_sha256": "sha256:" + "0" * 64},
        {"video": {"is_variable_frame_rate": True}},
        {"video": {"average_frame_rate": {"num": 24, "den": 1}}},
    ],
)
def test_assembly_rejects_probe_hash_or_nonmatching_rate(changes):
    evidence = probe()
    payload = evidence.probe.model_dump()
    if "video" in changes:
        payload["video"].update(changes["video"])
        expected = "SOURCE_RATE_UNSUPPORTED"
    else:
        payload.update(changes)
        expected = "PROBE_IDENTITY_CONFLICT"
    evidence = replace(evidence, probe=LocalMediaProbeData.model_validate(payload))
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_assembly_execution_plan(assembly(), {VERSION: evidence})
    assert caught.value.code == expected


@pytest.mark.parametrize("sample_rate", [44100, 48000])
def test_embedded_audio_requires_explicit_48khz(sample_rate):
    evidence = probe()
    payload = evidence.probe.model_dump()
    payload["audio"] = {
        "stream_index": 1,
        "codec_name": "aac",
        "sample_rate_hz": sample_rate,
        "channels": 2,
        "channel_layout": "stereo",
        "time_base": {"num": 1, "den": sample_rate},
        "total_samples": sample_rate * 3,
    }
    evidence = replace(evidence, probe=LocalMediaProbeData.model_validate(payload))
    version = assembly(segment_fields={"embedded_audio": "PLAY"})
    if sample_rate == 48000:
        plan = build_assembly_execution_plan(version, {VERSION: evidence})
        assert plan.video_tracks[0].clips[0].embedded_audio == "PLAY"
    else:
        with pytest.raises(MediaExecutionPlanError) as caught:
            build_assembly_execution_plan(version, {VERSION: evidence})
        assert caught.value.code == "EMBEDDED_AUDIO_RATE_UNSUPPORTED"


def test_missing_probe_and_probe_check_for_another_hash_are_not_usable():
    for version, probes in [
        (assembly(), {}),
        (
            assembly(
                check_fields={
                    "media": {"asset_id": ASSET, "asset_version_id": VERSION, "sha256": "0" * 64}
                }
            ),
            {VERSION: probe()},
        ),
    ]:
        with pytest.raises(MediaExecutionPlanError) as caught:
            build_assembly_execution_plan(version, probes)
        assert caught.value.code == "MEDIA_EVIDENCE_MISSING"


@pytest.mark.parametrize(
    ("field", "segment", "code"),
    [
        (
            "audio_segments",
            {
                "segment_id": "seg_bgm",
                "track_kind": "BGM",
                "media": {"asset_id": ASSET, "asset_version_id": VERSION, "sha256": SHA},
                "start_frame": 0,
                "end_frame": 25,
            },
            "AUDIO_GAIN_UNSPECIFIED",
        ),
        (
            "subtitle_segments",
            {
                "segment_id": "seg_sub",
                "start_frame": 0,
                "end_frame": 25,
                "text": "synthetic",
                "render_profile": "noto-cjk-sc-bottom-v1",
            },
            "SUBTITLE_STYLE_UNSPECIFIED",
        ),
    ],
)
def test_assembly_does_not_invent_missing_audio_or_subtitle_policy(field, segment, code):
    version = assembly(content_fields={field: [segment]})
    # Defaults are part of the persisted canonical content, as in the real store.
    version = version.model_copy(
        update={"content_hash": canonical_content_hash(version.content.model_dump(mode="json"))}
    )
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_assembly_execution_plan(version, {VERSION: probe()})
    assert caught.value.code == code


@pytest.mark.parametrize("start,end", [(0, 1), (1, 25), (50, 75)])
def test_half_open_frames_convert_to_inclusive_last_frame(start, end):
    assert inclusive_mlt_last_frame(start, end) == end - 1


@pytest.mark.parametrize(
    "start,end", [(True, 2), (0, False), (-1, 2), (3, 3), (4, 3), (0.5, 2), (0, "2")]
)
def test_invalid_half_open_frames_are_rejected(start, end):
    with pytest.raises(MediaExecutionPlanError) as caught:
        inclusive_mlt_last_frame(start, end)
    assert caught.value.code == "EMPTY_FRAME_RANGE"


def engineering_inputs():
    """All values are fabricated unit-test receipts, never read from a QA manifest."""
    now = datetime(2026, 10, 10, tzinfo=UTC)
    content = {
        "project_id": PROJECT,
        "episode_id": EPISODE,
        "scenes": [
            {
                "scene_id": "scn_" + "a" * 32,
                "ordinal": 1,
                "heading": "Synthetic tones only",
                "blocks": [
                    {
                        "block_id": "sblk_" + str(i) * 32,
                        "ordinal": i,
                        "kind": "DIALOGUE",
                        "text": caption,
                        "speaker": "Test speaker",
                        "delivery": "OFF_SCREEN",
                    }
                    for i, caption in enumerate(
                        ("TEST 提示音一（非语音）", "TEST 提示音二（非语音）"), start=1
                    )
                ],
            }
        ],
    }
    version = ArtifactVersion(
        id="ver_" + "b" * 32,
        artifact_id="art_" + "c" * 32,
        version_number=1,
        schema_version="1.0.0",
        content=content,
        content_hash=canonical_content_hash(content),
        author_actor_type="HUMAN",
        author_actor_id="synthetic-test",
        parent_version_id=None,
        change_summary="Test only",
        created_at=now,
    )
    record = ArtifactVersionRecord(
        version=version,
        head=ArtifactHead(
            artifact_id=version.artifact_id,
            latest_version_id=version.id,
            review_version_id=None,
            review_submission_id=None,
            accepted_version_id=None,
            revision=1,
            review_evidence_revision=0,
            updated_at=now,
        ),
        source_spans=(),
        dependencies=(),
    )
    media = [
        ExecutionMediaRefV1(
            asset_id="asset_" + str(i) * 32,
            asset_version_id="asv_" + str(i) * 32,
            sha256=str(i) * 64,
            byte_size=100,
            rights_status="CLEARED",
            rights_decision_id="ard_" + str(i) * 32,
            probe_evidence_id="mpe_" + str(i) * 32 if i < 3 else None,
            probe_sha256="7" * 64 if i < 3 else None,
            inspection_sha256="8" * 64 if i >= 3 else None,
        )
        for i in range(1, 5)
    ]
    bindings = FrozenEngineeringTestBindingsV1(
        test_spec_sha256=ART04_MLT_TEST_SPEC_SHA256,
        fixture_manifest_sha256="9" * 64,
        project_id=PROJECT,
        episode_id=EPISODE,
        blue_video=media[0],
        red_video=media[1],
        dialogue_tone=media[2],
        bgm_tone=media[3],
        test_script_version_id=version.id,
        test_script_content_hash=version.content_hash,
        first_script_block_id="sblk_" + "1" * 32,
        second_script_block_id="sblk_" + "2" * 32,
        subtitle_file_sha256="a" * 64,
        dialogue_gain_millidb=0,
        bgm_gain_millidb=0,
        subtitle_font_family="Synthetic Font",
        subtitle_font_size_px=32,
        subtitle_color_rgba="#FFFFFFFF",
    )
    probes = []
    for item in media[:2]:
        evidence = probe()
        probes.append(
            replace(
                evidence,
                id=item.probe_evidence_id,
                asset_id=item.asset_id,
                version_id=item.asset_version_id,
                asset_sha256=item.sha256,
                probe=evidence.probe.model_copy(
                    update={"source_asset_sha256": "sha256:" + item.sha256}
                ),
            )
        )
    inspections = [
        FrozenTestAudioInspectionV1(
            project_id=PROJECT,
            asset_id=item.asset_id,
            asset_version_id=item.asset_version_id,
            asset_sha256=item.sha256,
            byte_size=item.byte_size,
            inspection_sha256=item.inspection_sha256,
            codec="PCM_S16LE",
            channels=1,
            sample_rate_hz=48000,
            total_samples=samples,
        )
        for item, samples in zip(media[2:], (48000, 240000), strict=True)
    ]
    return bindings, {
        "test_script_record": record,
        "blue_probe": probes[0],
        "red_probe": probes[1],
        "dialogue_inspection": inspections[0],
        "bgm_inspection": inspections[1],
    }


def test_engineering_mapper_retains_test_scope_exact_audio_spans_and_overlap():
    bindings, inputs = engineering_inputs()
    plan = build_art04_synthetic_execution_plan(bindings, **inputs)
    assert plan.scope == "ENGINEERING_TEST"
    assert plan.total_frames == 125
    assert plan.absent_test_roles == ("SFX",)
    assert plan.dialogue_speech_status == "DIALOGUE_SPEECH_NOT_TESTED"
    assert [track.role for track in plan.audio_tracks] == ["DIALOGUE_TEST", "BGM_TEST"]
    assert [(clip.start_frame, clip.end_frame) for clip in plan.audio_tracks[0].clips] == [
        (25, 50),
        (75, 100),
    ]
    assert plan.audio_tracks[1].clips[0].source_end_sample == 240000
    assert [(cue.start_frame, cue.end_frame) for cue in plan.subtitle_cues] == [(25, 50), (75, 100)]
    transition = plan.video_transitions[0]
    assert (transition.start_frame, transition.end_frame) == (50, 75)
    assert all(track.clips[0].scale_mode == "STRETCH_TO_CANVAS" for track in plan.video_tracks)
    assert otio_mapping_losses(plan)[2:] == (
        "EXACT_AUDIO_SAMPLE_AND_GAIN_POLICY",
        "SCRIPT_BOUND_BURNED_SUBTITLE_STYLE",
        "EXACT_MLT_TRANSITION_SERVICE_AND_FRAME_MAPPING",
    )


@pytest.mark.parametrize(
    ("patch", "code"),
    [
        ({"test_spec_sha256": "0" * 64}, "TEST_SPEC_CONFLICT"),
        ({"test_script_version_id": "ver_" + "0" * 32}, "TEST_SCRIPT_VERSION_CONFLICT"),
        ({"test_script_content_hash": "sha256:" + "0" * 64}, "TEST_SCRIPT_VERSION_CONFLICT"),
        ({"project_id": "prj_" + "0" * 32}, "TEST_SCRIPT_SCOPE_CONFLICT"),
        ({"episode_id": "ep_" + "0" * 32}, "TEST_SCRIPT_SCOPE_CONFLICT"),
        ({"first_script_block_id": "sblk_" + "0" * 32}, "TEST_SCRIPT_BLOCK_CONFLICT"),
    ],
)
def test_engineering_rejects_different_frozen_bindings(patch, code):
    bindings, inputs = engineering_inputs()
    bindings = FrozenEngineeringTestBindingsV1.model_validate({**bindings.model_dump(), **patch})
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_art04_synthetic_execution_plan(bindings, **inputs)
    assert caught.value.code == code


@pytest.mark.parametrize("change", ["hash", "caption", "delivery"])
def test_engineering_rejects_changed_script_bytes_or_unconfirmed_delivery(change):
    bindings, inputs = engineering_inputs()
    record = inputs["test_script_record"]
    content = record.version.content
    if change == "delivery":
        content["scenes"][0]["blocks"][0]["delivery"] = None
        expected = "TEST_SCRIPT_DELIVERY_UNKNOWN"
    else:
        content["scenes"][0]["blocks"][0]["text"] = "Changed caption"
        expected = "TEST_SCRIPT_HASH_CONFLICT" if change == "hash" else "TEST_SCRIPT_BLOCK_CONFLICT"
    if change != "hash":
        content_hash = canonical_content_hash(content)
        inputs["test_script_record"] = replace(
            record, version=replace(record.version, content_hash=content_hash)
        )
        bindings = bindings.model_copy(update={"test_script_content_hash": content_hash})
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_art04_synthetic_execution_plan(bindings, **inputs)
    assert caught.value.code == expected


@pytest.mark.parametrize("role", ["blue_video", "red_video", "dialogue_tone", "bgm_tone"])
def test_engineering_requires_each_exact_human_rights_decision(role):
    bindings, inputs = engineering_inputs()
    media = getattr(bindings, role).model_copy(
        update={"rights_status": "PENDING_REVIEW", "rights_decision_id": None}
    )
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_art04_synthetic_execution_plan(bindings.model_copy(update={role: media}), **inputs)
    assert caught.value.code == "TEST_RIGHTS_UNCONFIRMED"


@pytest.mark.parametrize("dimension", ["width", "height", "frames"])
def test_engineering_video_must_match_exact_frozen_geometry(dimension):
    bindings, inputs = engineering_inputs()
    evidence = inputs["blue_probe"]
    video = evidence.probe.video.model_dump()
    video[dimension] = video[dimension][:-1] if dimension == "frames" else video[dimension] + 1
    payload = evidence.probe.model_dump()
    payload["video"] = video
    inputs["blue_probe"] = replace(evidence, probe=LocalMediaProbeData.model_validate(payload))
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_art04_synthetic_execution_plan(bindings, **inputs)
    assert caught.value.code == "TEST_VIDEO_SPEC_CONFLICT"


@pytest.mark.parametrize(
    "patch",
    [
        {"project_id": "prj_" + "0" * 32},
        {"asset_id": "asset_" + "0" * 32},
        {"asset_version_id": "asv_" + "0" * 32},
        {"asset_sha256": "0" * 64},
        {"byte_size": 101},
        {"inspection_sha256": "0" * 64},
        {"total_samples": 47999},
    ],
)
def test_engineering_audio_inspection_binds_exact_source_and_sample_count(patch):
    bindings, inputs = engineering_inputs()
    inputs["dialogue_inspection"] = FrozenTestAudioInspectionV1.model_validate(
        {**inputs["dialogue_inspection"].model_dump(), **patch}
    )
    with pytest.raises(MediaExecutionPlanError) as caught:
        build_art04_synthetic_execution_plan(bindings, **inputs)
    assert caught.value.code == "TEST_AUDIO_SPEC_CONFLICT"


def engineering_plan_payload():
    bindings, inputs = engineering_inputs()
    return build_art04_synthetic_execution_plan(bindings, **inputs).model_dump(mode="json")


def set_nested(payload, path, value):
    target = payload
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("scope",), "DRAFT_PREVIEW", "exact assembly"),
        (("absent_test_roles",), [], "mark SFX absent"),
        (("dialogue_speech_status",), "NOT_APPLICABLE", "cannot claim tested speech"),
        (("subtitle_output_mode",), "NONE", "exact cue set"),
        (("video_tracks", 0, "layer_index"), 1, "layers must be ordered"),
        (("audio_tracks", 0, "track_id"), "visual_blue", "track IDs must be unique"),
        (("subtitle_cues", 0, "cue_id"), "blue_clip", "execution IDs must be unique"),
        (("video_tracks", 1, "clips", 0, "start_frame"), 76, "uncovered sequence frame"),
        (("total_frames",), 126, "end at total_frames"),
        (("total_frames",), 124, "exceed the sequence"),
        (("video_tracks", 0, "clips", 0, "scale_mode"), "IDENTITY", "dimensions to match"),
        (("video_tracks", 0, "clips", 0, "end_frame"), 76, "selected source frames"),
        (("video_tracks", 0, "clips", 0, "start_frame"), 75, "interval must be positive"),
        (("audio_tracks", 0, "clips", 1, "start_frame"), 49, "overlap within a track"),
        (("audio_tracks", 1, "clips", 0, "end_frame"), 126, "exceed the sequence"),
        (("audio_tracks", 0, "clips", 0, "source_end_sample"), 47999, "absolute frame span"),
        (("audio_tracks", 0, "clips", 0, "source_end_sample"), 48001, "positive frame and sample"),
        (("audio_tracks", 0, "clips", 0, "source_in_sample"), 48000, "positive frame and sample"),
        (("audio_tracks", 0, "clips", 0, "end_frame"), 25, "positive frame and sample"),
        (("audio_tracks", 0, "clips", 0, "delivery"), None, "exact script and speaker"),
        (("audio_tracks", 1, "clips", 0, "delivery"), "ON_SCREEN", "cannot claim a script speaker"),
        (("subtitle_cues", 1, "start_frame"), 49, "subtitle cues overlap"),
        (("subtitle_cues", 1, "end_frame"), 126, "subtitle cues overlap"),
        (("subtitle_cues", 0, "end_frame"), 25, "subtitle interval must be positive"),
        (("video_transitions", 0, "end_frame"), 126, "tracks or range is invalid"),
        (("video_transitions", 0, "from_track_id"), "missing", "tracks or range is invalid"),
        (("video_transitions", 0, "start_frame"), 49, "every transition frame"),
        (("video_transitions", 0, "end_frame"), 74, "one exact lower-to-upper"),
        (("video_transitions",), [], "one exact lower-to-upper"),
        (("video_transitions", 0, "to_track_id"), "visual_blue", "two tracks and a positive"),
        (("video_transitions", 0, "end_frame"), 50, "two tracks and a positive"),
        (("audio_tracks", 0, "role"), "DIALOGUE", "explicit test audio roles"),
        (("audio_tracks", 1, "role"), "SFX", "explicit test audio roles"),
    ],
)
def test_execution_contract_rejects_ambiguous_ranges_and_scope_claims(path, value, message):
    payload = engineering_plan_payload()
    set_nested(payload, path, value)
    with pytest.raises(ValidationError, match=message):
        MediaExecutionPlanV1.model_validate(payload)


@pytest.mark.parametrize(
    "changes",
    [
        {"probe_evidence_id": None},
        {"probe_sha256": None},
        {"rights_decision_id": None},
    ],
)
def test_media_contract_rejects_partial_evidence_pairs(changes):
    bindings, _ = engineering_inputs()
    with pytest.raises(ValidationError):
        ExecutionMediaRefV1.model_validate({**bindings.blue_video.model_dump(), **changes})


def test_video_contract_requires_probe_even_when_no_partial_pair_exists():
    payload = engineering_plan_payload()
    media = payload["video_tracks"][0]["clips"][0]["media"]
    media.update(probe_evidence_id=None, probe_sha256=None)
    with pytest.raises(ValidationError, match="persisted probe evidence"):
        MediaExecutionPlanV1.model_validate(payload)


@pytest.mark.parametrize("kind", ["media", "caption"])
def test_frozen_test_bindings_do_not_alias_distinct_roles(kind):
    bindings, _ = engineering_inputs()
    payload = bindings.model_dump()
    if kind == "media":
        payload["red_video"] = payload["blue_video"]
    else:
        payload["second_script_block_id"] = payload["first_script_block_id"]
    with pytest.raises(ValidationError, match="distinct"):
        FrozenEngineeringTestBindingsV1.model_validate(payload)


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"scope": "ENGINEERING_TEST"}, "frozen fixture specification"),
        ({"absent_test_roles": ["SFX"]}, "test-only absent roles"),
        ({"dialogue_speech_status": "DIALOGUE_SPEECH_NOT_TESTED"}, "cannot claim speech testing"),
    ],
)
def test_draft_plan_never_acquires_test_scope_claims(patch, message):
    payload = build_assembly_execution_plan(assembly(), {VERSION: probe()}).model_dump(mode="json")
    payload.update(patch)
    with pytest.raises(ValidationError, match=message):
        MediaExecutionPlanV1.model_validate(payload)


def legacy_timeline(**fields):
    return TimelineVersionV1.model_validate(
        {
            "timeline_id": "synthetic-timeline",
            "revision": 1,
            "sequence_timebase": TIMEBASE,
            "assets": (
                {
                    "asset_id": ASSET,
                    "source_asset_sha256": "sha256:" + SHA,
                    "source_frame_count": 75,
                },
            ),
            "clips": (
                {
                    "clip_id": "seg_video",
                    "asset_id": ASSET,
                    "source_in_frame": 5,
                    "duration_frames": 50,
                },
            ),
            **fields,
        }
    )


def test_legacy_alignment_is_read_only_and_never_replaces_assembly_authority():
    version = assembly(content_fields={"canvas_width": 1080, "canvas_height": 1920})
    timeline = legacy_timeline()
    original = timeline.model_dump_json()
    assert require_legacy_timeline_alignment(timeline, version) is None
    assert timeline.model_dump_json() == original
    assert version.head_revision == 2


@pytest.mark.parametrize(
    "fields,code",
    [
        ({"content_hash": "sha256:" + "0" * 64}, "ASSEMBLY_HASH_CONFLICT"),
        ({"segment_fields": {"embedded_audio": "PLAY"}}, "LEGACY_UNREPRESENTED_MEDIA"),
        ({"segment_fields": {"source_in_frame": 6}}, "LEGACY_CLIP_CONFLICT"),
        ({"segment_fields": {"segment_id": "seg_other"}}, "LEGACY_CLIP_CONFLICT"),
        ({"segment_fields": {"media_kind": "image", "source_in_frame": 0}}, "LEGACY_CLIP_CONFLICT"),
    ],
)
def test_legacy_cannot_hide_hash_audio_or_clip_mismatch(fields, code):
    version = assembly(content_fields={"canvas_width": 1080, "canvas_height": 1920}, **fields)
    with pytest.raises(MediaExecutionPlanError) as caught:
        require_legacy_timeline_alignment(legacy_timeline(), version)
    assert caught.value.code == code


@pytest.mark.parametrize("dimension", ["canvas_width", "canvas_height"])
def test_legacy_canvas_dimensions_must_match(dimension):
    version = assembly(content_fields={"canvas_width": 1080, "canvas_height": 1920, dimension: 320})
    with pytest.raises(MediaExecutionPlanError) as caught:
        require_legacy_timeline_alignment(legacy_timeline(), version)
    assert caught.value.code == "LEGACY_SEQUENCE_CONFLICT"


@pytest.mark.parametrize(
    "change", ["rate", "duration", "count", "asset_set", "asset_hash", "proxy", "fake_package"]
)
def test_legacy_rejects_sequence_asset_and_fake_bindings(change):
    payload = legacy_timeline().model_dump(mode="json")
    expected = "LEGACY_SEQUENCE_CONFLICT"
    if change == "rate":
        payload["sequence_timebase"]["frame_rate"]["num"] = 24
    elif change == "duration":
        payload["clips"][0]["duration_frames"] = 49
    elif change == "count":
        clip = payload["clips"][0]
        clip["duration_frames"] = 25
        payload["clips"].append({**clip, "clip_id": "second"})
    elif change == "asset_set":
        payload["assets"][0]["asset_id"] = "asset_" + "0" * 32
        payload["clips"][0]["asset_id"] = "asset_" + "0" * 32
        expected = "LEGACY_ASSET_SET_CONFLICT"
    elif change == "asset_hash":
        payload["assets"][0]["source_asset_sha256"] = "sha256:" + "0" * 64
        expected = "LEGACY_CLIP_CONFLICT"
    elif change == "proxy":
        payload["assets"][0]["proxy"] = {
            "proxy_asset_sha256": "sha256:" + "0" * 64,
            "editable_frame_count": 75,
            "sequence_timebase": TIMEBASE,
        }
        expected = "LEGACY_PROXY_MAPPING_UNBOUND"
    else:
        payload["media_package"] = {
            "media_package_id": "fmp_" + "0" * 32,
            "manifest_sha256": "sha256:" + "0" * 64,
            "assets": [
                {
                    "asset_id": ASSET,
                    "preview_relative_path": "synthetic.webm",
                    "preview_sha256": "sha256:" + SHA,
                    "preview_byte_length": 100,
                    "source_asset_sha256": "sha256:" + SHA,
                    "source_frame_count": 75,
                    "editing_asset_sha256": "sha256:" + SHA,
                    "editable_frame_count": 75,
                }
            ],
        }
        expected = "LEGACY_FAKE_MEDIA"
    timeline = TimelineVersionV1.model_validate(payload)
    version = assembly(content_fields={"canvas_width": 1080, "canvas_height": 1920})
    with pytest.raises(MediaExecutionPlanError) as caught:
        require_legacy_timeline_alignment(timeline, version)
    assert caught.value.code == expected
