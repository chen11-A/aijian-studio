"""Pure mappings from frozen media identities to an uneditable execution plan.

MLT path resolution and process execution belong to separate adapters. The
legacy Timeline checker only confirms compatibility with an authoritative
assembly; it never promotes DEVELOPMENT_FAKE media to an ASSET01 version.
"""

from __future__ import annotations

from collections.abc import Mapping

from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyVersionData
from aijian_api.episode_media_assembly_store import script_speaker_id
from aijian_api.episode_script_contracts import EpisodeScriptContentV1
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidence
from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData
from aijian_api.media_execution_plan_contracts import (
    ExecutionAudioClipV1,
    ExecutionAudioTrackV1,
    ExecutionMediaRefV1,
    ExecutionSourceV1,
    ExecutionSubtitleCueV1,
    ExecutionVideoClipV1,
    ExecutionVideoTrackV1,
    ExecutionVideoTransitionV1,
    FrozenEngineeringTestBindingsV1,
    FrozenTestAudioInspectionV1,
    MediaExecutionPlanV1,
)
from aijian_api.timeline import TimelineVersionV1

ART04_MLT_TEST_SPEC_SHA256 = "4323dfef3eef9337baf49a5118de1397b4c2afbe2e67768e133f87c950ddf16d"


class MediaExecutionPlanError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _probe_matches(
    media: ExecutionMediaRefV1,
    probe: MediaAssetProbeEvidence,
    *,
    project_id: str,
    frame_rate_num: int,
    frame_rate_den: int,
) -> None:
    if (
        probe.project_id != project_id
        or probe.asset_id != media.asset_id
        or probe.version_id != media.asset_version_id
        or probe.asset_sha256 != media.sha256
        or probe.byte_size != media.byte_size
        or probe.id != media.probe_evidence_id
        or probe.probe_sha256 != media.probe_sha256
        or probe.probe.source_asset_sha256 != "sha256:" + media.sha256
    ):
        raise MediaExecutionPlanError(
            "PROBE_IDENTITY_CONFLICT", "Probe does not bind the selected media version"
        )
    video = probe.probe.video
    if video.is_variable_frame_rate or (
        video.average_frame_rate.num,
        video.average_frame_rate.den,
    ) != (frame_rate_num, frame_rate_den):
        raise MediaExecutionPlanError(
            "SOURCE_RATE_UNSUPPORTED", "Video needs a matching CFR source or an explicit conform"
        )


def build_assembly_execution_plan(
    version: EpisodeMediaAssemblyVersionData,
    probes_by_version_id: Mapping[str, MediaAssetProbeEvidence],
) -> MediaExecutionPlanV1:
    """Map only the subset the current immutable assembly can truly express."""

    content = version.content
    if canonical_content_hash(content.model_dump(mode="json")) != version.content_hash:
        raise MediaExecutionPlanError(
            "ASSEMBLY_HASH_CONFLICT", "Assembly bytes differ from the persisted version hash"
        )
    if content.audio_segments:
        raise MediaExecutionPlanError(
            "AUDIO_GAIN_UNSPECIFIED", "Assembly audio has no locked gain or audio probe"
        )
    if content.subtitle_segments:
        raise MediaExecutionPlanError(
            "SUBTITLE_STYLE_UNSPECIFIED", "Assembly subtitles have no locked text style or file"
        )
    if version.playback_status != "DRAFT_VIDEO_PREVIEW":
        raise MediaExecutionPlanError(
            "ASSEMBLY_NOT_VIDEO_READY", "Assembly is not a verified draft video preview"
        )
    checks = {check.media.asset_version_id: check for check in version.media_checks}
    rate = content.sequence_timebase.frame_rate
    clips: list[ExecutionVideoClipV1] = []
    for segment in content.visual_segments:
        if segment.media_kind != "video":
            raise MediaExecutionPlanError(
                "IMAGE_PRODUCER_UNSUPPORTED",
                "Still-image execution needs a separate producer contract",
            )
        check = checks.get(segment.media.asset_version_id)
        probe = probes_by_version_id.get(segment.media.asset_version_id)
        if check is None or probe is None or check.media != segment.media:
            raise MediaExecutionPlanError(
                "MEDIA_EVIDENCE_MISSING", "Selected video evidence is missing"
            )
        if (
            check.availability != "VERIFIED"
            or check.technical_status != "PROBED_CFR_VIDEO"
            or check.rights_status == "RESTRICTED"
        ):
            raise MediaExecutionPlanError(
                "MEDIA_NOT_READY", "Selected media is not a verified draft source"
            )
        media = ExecutionMediaRefV1(
            asset_id=segment.media.asset_id,
            asset_version_id=segment.media.asset_version_id,
            sha256=segment.media.sha256,
            byte_size=probe.byte_size,
            rights_status=check.rights_status,
            rights_decision_id=check.rights_decision_id,
            probe_evidence_id=probe.id,
            probe_sha256=probe.probe_sha256,
        )
        _probe_matches(
            media,
            probe,
            project_id=content.project_id,
            frame_rate_num=rate.num,
            frame_rate_den=rate.den,
        )
        video = probe.probe.video
        if (video.width, video.height) != (content.canvas_width, content.canvas_height):
            raise MediaExecutionPlanError(
                "SCALE_POLICY_UNSPECIFIED", "Assembly does not select a scale policy"
            )
        if segment.embedded_audio == "PLAY" and probe.probe.audio is None:
            raise MediaExecutionPlanError(
                "EMBEDDED_AUDIO_MISSING", "Selected video has no embedded audio"
            )
        if segment.embedded_audio == "PLAY" and (
            probe.probe.audio is not None and probe.probe.audio.sample_rate_hz != 48000
        ):
            raise MediaExecutionPlanError(
                "EMBEDDED_AUDIO_RATE_UNSUPPORTED",
                "Embedded audio requires an explicit 48 kHz conform",
            )
        clips.append(
            ExecutionVideoClipV1(
                clip_id=segment.segment_id,
                media=media,
                start_frame=segment.start_frame,
                end_frame=segment.end_frame,
                source_in_frame=segment.source_in_frame,
                source_frame_count=len(video.frames),
                embedded_audio=segment.embedded_audio,
                source_width=video.width,
                source_height=video.height,
                scale_mode="IDENTITY",
            )
        )
    return MediaExecutionPlanV1(
        scope="DRAFT_PREVIEW",
        source=ExecutionSourceV1(
            origin="EPISODE_ASSEMBLY",
            project_id=content.project_id,
            episode_id=content.episode_id,
            assembly_artifact_id=version.artifact_id,
            assembly_version_id=version.version_id,
            assembly_content_hash=version.content_hash,
            assembly_head_revision=version.head_revision,
        ),
        sequence_timebase=content.sequence_timebase,
        canvas_width=content.canvas_width,
        canvas_height=content.canvas_height,
        total_frames=content.total_frames,
        video_tracks=(
            ExecutionVideoTrackV1(track_id="visual_0", layer_index=0, clips=tuple(clips)),
        ),
        subtitle_output_mode="NONE",
        dialogue_speech_status="NOT_APPLICABLE",
    )


def require_legacy_timeline_alignment(
    timeline: TimelineVersionV1,
    version: EpisodeMediaAssemblyVersionData,
) -> None:
    """Compare a video-only legacy view; assembly remains the version authority."""

    content = version.content
    if canonical_content_hash(content.model_dump(mode="json")) != version.content_hash:
        raise MediaExecutionPlanError(
            "ASSEMBLY_HASH_CONFLICT", "Assembly bytes differ from the persisted version hash"
        )
    if (
        content.audio_segments
        or content.subtitle_segments
        or any(segment.embedded_audio == "PLAY" for segment in content.visual_segments)
    ):
        raise MediaExecutionPlanError(
            "LEGACY_UNREPRESENTED_MEDIA",
            "Legacy Timeline cannot preserve assembly audio, subtitles, or embedded playback",
        )
    if timeline.media_package is not None:
        raise MediaExecutionPlanError(
            "LEGACY_FAKE_MEDIA", "Development fake bindings cannot become production media"
        )
    if any(asset.proxy is not None for asset in timeline.assets):
        raise MediaExecutionPlanError(
            "LEGACY_PROXY_MAPPING_UNBOUND", "Legacy proxy map has no selected ASSET01 version"
        )
    if (
        timeline.sequence_timebase != content.sequence_timebase
        or timeline.width != content.canvas_width
        or timeline.height != content.canvas_height
        or timeline.total_duration_frames != content.total_frames
        or len(timeline.clips) != len(content.visual_segments)
    ):
        raise MediaExecutionPlanError(
            "LEGACY_SEQUENCE_CONFLICT", "Legacy sequence differs from frozen assembly"
        )
    asset_by_id = {asset.asset_id: asset for asset in timeline.assets}
    if set(asset_by_id) != {segment.media.asset_id for segment in content.visual_segments}:
        raise MediaExecutionPlanError(
            "LEGACY_ASSET_SET_CONFLICT", "Legacy assets differ from frozen assembly"
        )
    cursor = 0
    for clip, segment in zip(timeline.clips, content.visual_segments, strict=True):
        asset = asset_by_id[clip.asset_id]
        if (
            segment.media_kind != "video"
            or clip.clip_id != segment.segment_id
            or asset.asset_id != segment.media.asset_id
            or segment.start_frame != cursor
            or segment.end_frame != cursor + clip.duration_frames
            or clip.source_in_frame != segment.source_in_frame
            or asset.source_asset_sha256 != "sha256:" + segment.media.sha256
        ):
            raise MediaExecutionPlanError(
                "LEGACY_CLIP_CONFLICT", "Legacy clip cannot be losslessly aligned"
            )
        cursor = segment.end_frame


def _test_video(
    media: ExecutionMediaRefV1,
    probe: MediaAssetProbeEvidence,
    *,
    project_id: str,
) -> None:
    _probe_matches(media, probe, project_id=project_id, frame_rate_num=25, frame_rate_den=1)
    video = probe.probe.video
    if (
        len(video.frames) != 75
        or video.width != 320
        or video.height != 568
        or probe.probe.audio is not None
    ):
        raise MediaExecutionPlanError(
            "TEST_VIDEO_SPEC_CONFLICT", "Video does not match the 75-frame silent test source"
        )


def _test_audio(
    media: ExecutionMediaRefV1,
    inspection: FrozenTestAudioInspectionV1,
    *,
    project_id: str,
    expected_samples: int,
) -> None:
    if (
        project_id != inspection.project_id
        or media.asset_id != inspection.asset_id
        or media.asset_version_id != inspection.asset_version_id
        or media.sha256 != inspection.asset_sha256
        or media.byte_size != inspection.byte_size
        or media.inspection_sha256 != inspection.inspection_sha256
        or inspection.total_samples != expected_samples
    ):
        raise MediaExecutionPlanError(
            "TEST_AUDIO_SPEC_CONFLICT", "Audio inspection does not match the selected test source"
        )


def build_art04_synthetic_execution_plan(
    bindings: FrozenEngineeringTestBindingsV1,
    *,
    test_script_record: ArtifactVersionRecord,
    blue_probe: MediaAssetProbeEvidence,
    red_probe: MediaAssetProbeEvidence,
    dialogue_inspection: FrozenTestAudioInspectionV1,
    bgm_inspection: FrozenTestAudioInspectionV1,
) -> MediaExecutionPlanV1:
    """Derive the ART04 fixture after the caller authenticates external receipts.

    This pure mapper compares supplied identities and content. It does not read
    the QA manifest bytes, asset storage, rights decisions, or toolchain.
    An execution entry must verify those sources through trusted readers first.
    """

    if bindings.test_spec_sha256 != ART04_MLT_TEST_SPEC_SHA256:
        raise MediaExecutionPlanError(
            "TEST_SPEC_CONFLICT", "This is not the frozen ART04 test specification"
        )
    if (
        test_script_record.version.id != bindings.test_script_version_id
        or test_script_record.version.content_hash != bindings.test_script_content_hash
    ):
        raise MediaExecutionPlanError(
            "TEST_SCRIPT_VERSION_CONFLICT", "Test script version identity differs"
        )
    if (
        canonical_content_hash(test_script_record.version.content)
        != bindings.test_script_content_hash
    ):
        raise MediaExecutionPlanError(
            "TEST_SCRIPT_HASH_CONFLICT", "Stored test script content hash differs"
        )
    test_script = EpisodeScriptContentV1.model_validate(test_script_record.version.content)
    if (
        test_script.project_id != bindings.project_id
        or test_script.episode_id != bindings.episode_id
    ):
        raise MediaExecutionPlanError(
            "TEST_SCRIPT_SCOPE_CONFLICT", "Test script belongs to another episode"
        )
    blocks = {block.block_id: block for scene in test_script.scenes for block in scene.blocks}
    first = blocks.get(bindings.first_script_block_id)
    second = blocks.get(bindings.second_script_block_id)
    if (
        first is None
        or second is None
        or first.kind != "DIALOGUE"
        or second.kind != "DIALOGUE"
        or first.text != "TEST 提示音一（非语音）"
        or second.text != "TEST 提示音二（非语音）"
        or first.speaker is None
        or second.speaker is None
    ):
        raise MediaExecutionPlanError(
            "TEST_SCRIPT_BLOCK_CONFLICT", "Test script blocks differ from the frozen captions"
        )
    if first.delivery is None or second.delivery is None:
        raise MediaExecutionPlanError(
            "TEST_SCRIPT_DELIVERY_UNKNOWN",
            "Test dialogue delivery is unknown in this script version; "
            "create an explicit new version",
        )
    for media in (
        bindings.blue_video,
        bindings.red_video,
        bindings.dialogue_tone,
        bindings.bgm_tone,
    ):
        if media.rights_status != "CLEARED" or media.rights_decision_id is None:
            raise MediaExecutionPlanError(
                "TEST_RIGHTS_UNCONFIRMED", "Test media needs an exact human rights decision"
            )
    _test_video(bindings.blue_video, blue_probe, project_id=bindings.project_id)
    _test_video(bindings.red_video, red_probe, project_id=bindings.project_id)
    _test_audio(
        bindings.dialogue_tone,
        dialogue_inspection,
        project_id=bindings.project_id,
        expected_samples=48000,
    )
    _test_audio(
        bindings.bgm_tone, bgm_inspection, project_id=bindings.project_id, expected_samples=240000
    )
    if (
        bindings.dialogue_tone.inspection_sha256 is None
        or bindings.bgm_tone.inspection_sha256 is None
    ):
        raise MediaExecutionPlanError(
            "TEST_AUDIO_INSPECTION_MISSING", "Test audio needs frozen inspection receipts"
        )
    first_speaker = script_speaker_id(
        bindings.project_id,
        bindings.episode_id,
        bindings.test_script_version_id,
        first.speaker,
    )
    second_speaker = script_speaker_id(
        bindings.project_id,
        bindings.episode_id,
        bindings.test_script_version_id,
        second.speaker,
    )
    timebase = SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=25, den=1),
        timecode_mode="NON_DROP_FRAME",
    )
    return MediaExecutionPlanV1(
        scope="ENGINEERING_TEST",
        source=ExecutionSourceV1(
            origin="FROZEN_ENGINEERING_TEST",
            project_id=bindings.project_id,
            episode_id=bindings.episode_id,
            test_spec_sha256=bindings.test_spec_sha256,
            fixture_manifest_sha256=bindings.fixture_manifest_sha256,
        ),
        sequence_timebase=timebase,
        canvas_width=1080,
        canvas_height=1920,
        total_frames=125,
        video_tracks=(
            ExecutionVideoTrackV1(
                track_id="visual_blue",
                layer_index=0,
                clips=(
                    ExecutionVideoClipV1(
                        clip_id="blue_clip",
                        media=bindings.blue_video,
                        start_frame=0,
                        end_frame=75,
                        source_in_frame=0,
                        source_frame_count=75,
                        embedded_audio="MUTE",
                        source_width=320,
                        source_height=568,
                        scale_mode="STRETCH_TO_CANVAS",
                    ),
                ),
            ),
            ExecutionVideoTrackV1(
                track_id="visual_red",
                layer_index=1,
                clips=(
                    ExecutionVideoClipV1(
                        clip_id="red_clip",
                        media=bindings.red_video,
                        start_frame=50,
                        end_frame=125,
                        source_in_frame=0,
                        source_frame_count=75,
                        embedded_audio="MUTE",
                        source_width=320,
                        source_height=568,
                        scale_mode="STRETCH_TO_CANVAS",
                    ),
                ),
            ),
        ),
        audio_tracks=(
            ExecutionAudioTrackV1(
                track_id="dialogue_test",
                role="DIALOGUE_TEST",
                clips=(
                    ExecutionAudioClipV1(
                        clip_id="tone_one",
                        media=bindings.dialogue_tone,
                        start_frame=25,
                        end_frame=50,
                        source_in_sample=0,
                        source_end_sample=48000,
                        source_total_samples=48000,
                        source_sample_rate_hz=48000,
                        gain_millidb=bindings.dialogue_gain_millidb,
                        script_version_id=bindings.test_script_version_id,
                        script_block_id=first.block_id,
                        speaker_id=first_speaker,
                        delivery=first.delivery,
                    ),
                    ExecutionAudioClipV1(
                        clip_id="tone_two",
                        media=bindings.dialogue_tone,
                        start_frame=75,
                        end_frame=100,
                        source_in_sample=0,
                        source_end_sample=48000,
                        source_total_samples=48000,
                        source_sample_rate_hz=48000,
                        gain_millidb=bindings.dialogue_gain_millidb,
                        script_version_id=bindings.test_script_version_id,
                        script_block_id=second.block_id,
                        speaker_id=second_speaker,
                        delivery=second.delivery,
                    ),
                ),
            ),
            ExecutionAudioTrackV1(
                track_id="bgm_test",
                role="BGM_TEST",
                clips=(
                    ExecutionAudioClipV1(
                        clip_id="bgm_full",
                        media=bindings.bgm_tone,
                        start_frame=0,
                        end_frame=125,
                        source_in_sample=0,
                        source_end_sample=240000,
                        source_total_samples=240000,
                        source_sample_rate_hz=48000,
                        gain_millidb=bindings.bgm_gain_millidb,
                    ),
                ),
            ),
        ),
        subtitle_cues=(
            ExecutionSubtitleCueV1(
                cue_id="subtitle_one",
                script_version_id=bindings.test_script_version_id,
                script_block_id=first.block_id,
                script_content_hash=bindings.test_script_content_hash,
                subtitle_file_sha256=bindings.subtitle_file_sha256,
                text=first.text,
                start_frame=25,
                end_frame=50,
                font_family=bindings.subtitle_font_family,
                font_size_px=bindings.subtitle_font_size_px,
                color_rgba=bindings.subtitle_color_rgba,
            ),
            ExecutionSubtitleCueV1(
                cue_id="subtitle_two",
                script_version_id=bindings.test_script_version_id,
                script_block_id=second.block_id,
                script_content_hash=bindings.test_script_content_hash,
                subtitle_file_sha256=bindings.subtitle_file_sha256,
                text=second.text,
                start_frame=75,
                end_frame=100,
                font_family=bindings.subtitle_font_family,
                font_size_px=bindings.subtitle_font_size_px,
                color_rgba=bindings.subtitle_color_rgba,
            ),
        ),
        video_transitions=(
            ExecutionVideoTransitionV1(
                transition_id="blue_to_red",
                kind="CROSS_DISSOLVE",
                from_track_id="visual_blue",
                to_track_id="visual_red",
                start_frame=50,
                end_frame=75,
            ),
        ),
        absent_test_roles=("SFX",),
        subtitle_output_mode="BURN_IN",
        dialogue_speech_status="DIALOGUE_SPEECH_NOT_TESTED",
    )


def inclusive_mlt_last_frame(start_frame: int, end_frame: int) -> int:
    """Convert one nonempty half-open plan interval to MLT's inclusive out frame."""

    if (
        isinstance(start_frame, bool)
        or isinstance(end_frame, bool)
        or (
            not isinstance(start_frame, int)
            or not isinstance(end_frame, int)
            or start_frame < 0
            or end_frame <= start_frame
        )
    ):
        raise MediaExecutionPlanError(
            "EMPTY_FRAME_RANGE", "MLT out frame needs a nonempty half-open interval"
        )
    return end_frame - 1


def otio_mapping_losses(plan: MediaExecutionPlanV1) -> tuple[str, ...]:
    """Informational only; OTIO is neither imported nor required for execution."""

    losses = ["ASSET01_VERSION_AND_RIGHTS_EVIDENCE", "PROBE_AND_TOOLCHAIN_EVIDENCE"]
    if plan.audio_tracks:
        losses.append("EXACT_AUDIO_SAMPLE_AND_GAIN_POLICY")
    if plan.subtitle_cues:
        losses.append("SCRIPT_BOUND_BURNED_SUBTITLE_STYLE")
    if plan.video_transitions:
        losses.append("EXACT_MLT_TRANSITION_SERVICE_AND_FRAME_MAPPING")
    return tuple(losses)
