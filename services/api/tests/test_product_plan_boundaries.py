"""Pure single-video plan gates; no release profile or export claim is approved."""

from dataclasses import replace
from pathlib import Path

import pytest
from aijian_api import product_export_claim as claim
from aijian_api.episode_media_assembly_contracts import (
    AssemblyAudioSegmentV1,
    AssemblySubtitleSegmentV1,
)
from aijian_api.media_probe import AudioProbeData
from aijian_api.product_export_contracts import ProductExportClaimRequest
from aijian_api.product_export_render_plan import (
    ProductExportPlanError,
    build_single_video_render_plan,
    render_arguments,
)
from aijian_api.product_timeline_export_contracts import ProductExportSpec
from test_media_execution_plan_boundaries import assembly, probe
from test_product_store_boundaries import synthetic_tools


@pytest.fixture
def inputs(tmp_path):
    version = assembly(
        segment_fields={"source_in_frame": 0, "end_frame": 75}, content_fields={"total_frames": 75}
    )
    tools = replace(synthetic_tools(tmp_path), profile_id="synthetic-only")
    spec = ProductExportSpec(
        container="MP4",
        width=320,
        height=568,
        frame_rate_num=25,
        frame_rate_den=1,
        video_codec="H264",
        audio_codec="AAC",
    )
    request = ProductExportClaimRequest(
        operation_id="peop_" + "a" * 32,
        assembly={
            "artifact_id": version.artifact_id,
            "version_id": version.version_id,
            "content_hash": version.content_hash,
            "head_revision": version.head_revision,
        },
        media_rights=(),
        spec=spec,
        output_relative_path="synthetic.mp4",
    )
    return version.content, request, probe(), tools


def test_exact_video_plan_and_arguments_do_not_grant_release_authority(inputs, tmp_path):
    content, request, evidence, tools = inputs
    plan = build_single_video_render_plan(*inputs)
    assert plan.assembly_content_hash == request.assembly.content_hash
    assert plan.source_sha256 == evidence.asset_sha256
    assert plan.total_frames == 75 and not plan.has_audio
    arguments = render_arguments(plan, tmp_path / "source.mp4", tmp_path / "out.mp4")
    assert "-n" in arguments and "-an" in arguments
    assert arguments[arguments.index("-t") + 1] == "3.000000000"
    with pytest.raises(claim.ProductExportClaimError) as caught:
        claim.require_release_profile_configured()
    assert caught.value.code == "RELEASE_TOOLCHAIN_NOT_APPROVED"


@pytest.mark.parametrize(
    "field",
    [
        "project_id",
        "asset_id",
        "version_id",
        "asset_sha256",
        "ffmpeg_sha256",
        "ffprobe_sha256",
        "toolchain_profile_id",
    ],
)
def test_probe_identity_must_bind_selected_media_and_toolchain(inputs, field):
    content, request, evidence, tools = inputs
    with pytest.raises(ProductExportPlanError) as caught:
        build_single_video_render_plan(
            content, request, replace(evidence, **{field: "changed"}), tools
        )
    assert caught.value.code == "PROBE_IDENTITY_CONFLICT"


@pytest.mark.parametrize(
    ("field", "value"),
    [("is_variable_frame_rate", True), ("frames", ()), ("width", 640), ("height", 480)],
)
def test_probe_must_exactly_cover_output_video(inputs, field, value):
    content, request, evidence, tools = inputs
    changed = evidence.probe.model_copy(
        update={"video": evidence.probe.video.model_copy(update={field: value})}
    )
    with pytest.raises(ProductExportPlanError) as caught:
        build_single_video_render_plan(content, request, replace(evidence, probe=changed), tools)
    assert caught.value.code == "VIDEO_PROBE_CONFLICT"


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("width", 640, "CANVAS_CONFLICT"),
        ("height", 480, "CANVAS_CONFLICT"),
        ("frame_rate_num", 24, "FRAME_RATE_CONFLICT"),
        ("video_codec", "OTHER", "VIDEO_CODEC_UNSUPPORTED"),
    ],
)
def test_requested_spec_cannot_silently_rescale_or_retime(inputs, field, value, code):
    content, request, evidence, tools = inputs
    changed = request.model_copy(update={"spec": request.spec.model_copy(update={field: value})})
    with pytest.raises(ProductExportPlanError) as caught:
        build_single_video_render_plan(content, changed, evidence, tools)
    assert caught.value.code == code


@pytest.mark.parametrize("side", ["source", "output"])
def test_render_arguments_reject_relative_paths(inputs, tmp_path, side):
    plan = build_single_video_render_plan(*inputs)
    with pytest.raises(ProductExportPlanError) as caught:
        render_arguments(
            plan,
            Path("source.mp4") if side == "source" else tmp_path / "source.mp4",
            Path("output.mp4") if side == "output" else tmp_path / "output.mp4",
        )
    assert caught.value.code == "PATH_UNSAFE"


@pytest.mark.parametrize("samples", [None, 142975, 142976, 144000])
def test_embedded_audio_must_cover_duration_with_declared_tolerance(inputs, samples):
    content, request, evidence, tools = inputs
    content = content.model_copy(
        update={
            "visual_segments": (
                content.visual_segments[0].model_copy(update={"embedded_audio": "PLAY"}),
            )
        }
    )
    audio = (
        None
        if samples is None
        else AudioProbeData(
            stream_index=1,
            codec_name="aac",
            sample_rate_hz=48000,
            channels=2,
            channel_layout="stereo",
            time_base={"num": 1, "den": 48000},
            total_samples=samples,
        )
    )
    evidence = replace(evidence, probe=evidence.probe.model_copy(update={"audio": audio}))
    if samples is None or samples < 142976:
        with pytest.raises(ProductExportPlanError) as caught:
            build_single_video_render_plan(content, request, evidence, tools)
        assert caught.value.code == (
            "EMBEDDED_AUDIO_MISSING" if samples is None else "EMBEDDED_AUDIO_SHORT"
        )
    else:
        assert build_single_video_render_plan(content, request, evidence, tools).has_audio


@pytest.mark.parametrize("kind", ["DIALOGUE", "BGM", "SFX"])
def test_independent_audio_never_silently_disappears(inputs, kind):
    content, request, evidence, tools = inputs
    dialogue = (
        dict(
            script_version_id="ver_" + "a" * 32,
            script_block_id="sblk_" + "b" * 32,
            speaker_id="spk_" + "c" * 32,
            delivery="OFF_SCREEN",
        )
        if kind == "DIALOGUE"
        else {}
    )
    audio = AssemblyAudioSegmentV1(
        segment_id="seg_audio",
        track_kind=kind,
        media=content.visual_segments[0].media,
        start_frame=0,
        end_frame=75,
        **dialogue,
    )
    content = content.model_copy(update={"audio_segments": (audio,)})
    with pytest.raises(ProductExportPlanError) as caught:
        build_single_video_render_plan(content, request, evidence, tools)
    assert caught.value.code == f"{kind}_UNSUPPORTED"
    with pytest.raises(claim.ProductExportClaimError) as caught:
        claim._selected_tracks(content)
    assert caught.value.code == "MEDIA_TRACK_CONFLICT"


@pytest.mark.parametrize("fault", ["multiple", "image", "trim", "subtitle"])
def test_unsupported_assembly_features_do_not_produce_partial_plan(inputs, fault):
    content, request, evidence, tools = inputs
    visual = content.visual_segments[0]
    if fault == "multiple":
        content = content.model_copy(update={"visual_segments": (visual, visual)})
    elif fault == "subtitle":
        subtitle = AssemblySubtitleSegmentV1(
            segment_id="seg_subtitle",
            script_version_id="ver_" + "a" * 32,
            script_block_id="sblk_" + "b" * 32,
            start_frame=0,
            end_frame=75,
        )
        content = content.model_copy(update={"subtitle_segments": (subtitle,)})
        assert claim._formal_script_subtitles(content) == (subtitle,)
    else:
        change = {"media_kind": "image"} if fault == "image" else {"source_in_frame": 1}
        content = content.model_copy(
            update={"visual_segments": (visual.model_copy(update=change),)}
        )
    with pytest.raises(ProductExportPlanError) as caught:
        build_single_video_render_plan(content, request, evidence, tools)
    assert (
        caught.value.code
        == {
            "multiple": "MULTI_SEGMENT_UNSUPPORTED",
            "subtitle": "SUBTITLE_UNSUPPORTED",
            "image": "VISUAL_UNSUPPORTED",
            "trim": "VISUAL_UNSUPPORTED",
        }[fault]
    )


def test_scope_and_operation_hash_are_exact_and_media_count_is_bounded(inputs):
    content, request, _, _ = inputs
    normalized, text, digest = claim._request_identity(
        content.project_id, content.episode_id, request
    )
    assert normalized == request and text.startswith("{") and digest.startswith("sha256:")
    claim._require_matching_operation_hash(digest, digest)
    with pytest.raises(claim.ProductExportClaimError, match="different input"):
        claim._require_matching_operation_hash(digest, "sha256:" + "0" * 64)
    for project, episode in [("invalid", content.episode_id), (content.project_id, "invalid")]:
        with pytest.raises(claim.ProductExportClaimError) as caught:
            claim._request_identity(project, episode, request)
        assert caught.value.code == "INVALID_SCOPE"
    visual = content.visual_segments[0]
    assert claim._selected_tracks(content) == (("VISUAL", "video", visual.media),)
    with pytest.raises(claim.ProductExportClaimError) as caught:
        claim._selected_tracks(content.model_copy(update={"visual_segments": ()}))
    assert caught.value.code == "MEDIA_INPUT_LIMIT"
