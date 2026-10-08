"""Translate the one frozen ART04 engineering plan into a candidate MLT job.

This is a server-side, test-only adapter. The caller must resolve every selected
asset version to a trusted local file identity. Neither client XML nor an
unversioned media path is accepted. MLT execution still needs independent QA.
"""

from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from aijian_api.media_execution_plan_contracts import (
    ExecutionMediaRefV1,
    MediaExecutionPlanV1,
)
from aijian_api.media_probe import _open_local_source
from aijian_api.episode_media_execution_plan import ART04_MLT_TEST_SPEC_SHA256
from aijian_api.product_export_contracts import ProductExportSpec
from aijian_api.mlt_execution_worker import (
    MltExecutionError,
    MltExecutionTask,
    MltFileIdentity,
    _plain_directory,
)


SAMPLES_PER_FRAME = 1920
_OPERATION_ID = re.compile(r"eteop_[0-9a-f]{32}\Z")


@dataclass(frozen=True, slots=True)
class MltEngineeringBlueprint:
    plan: MediaExecutionPlanV1
    xml_bytes: bytes
    profile_bytes: bytes
    selected_resources: tuple[MltFileIdentity, ...]
    subtitle_file: MltFileIdentity
    fixture_manifest: MltFileIdentity


def _property(parent: ET.Element, name: str, value: object) -> None:
    ET.SubElement(parent, "property", {"name": name}).text = str(value)


def _reject(message: str) -> None:
    raise MltExecutionError("ENGINEERING_PLAN_UNSUPPORTED", message)


def _require_art04_plan(plan: MediaExecutionPlanV1) -> None:
    if not isinstance(plan, MediaExecutionPlanV1):
        _reject("The input must be the frozen MediaExecutionPlanV1 DTO")
    source = plan.source
    if (
        plan.scope != "ENGINEERING_TEST"
        or source.origin != "FROZEN_ENGINEERING_TEST"
        or source.test_spec_sha256 != ART04_MLT_TEST_SPEC_SHA256
        or (plan.sequence_timebase.frame_rate.num, plan.sequence_timebase.frame_rate.den) != (25, 1)
        or (plan.canvas_width, plan.canvas_height, plan.total_frames) != (1080, 1920, 125)
        or plan.audio_master_sample_rate_hz != 48000
        or plan.audio_mix_policy != "SUM_NO_NORMALIZE_NO_LIMITER"
        or plan.subtitle_output_mode != "BURN_IN"
        or plan.dialogue_speech_status != "DIALOGUE_SPEECH_NOT_TESTED"
        or plan.absent_test_roles != ("SFX",)
        or len(plan.video_tracks) != 2
        or len(plan.audio_tracks) != 2
        or len(plan.subtitle_cues) != 2
        or len(plan.video_transitions) != 1
    ):
        _reject("Plan differs from the frozen 125-frame ART04 test")
    blue, red = plan.video_tracks
    if (
        len(blue.clips) != 1 or len(red.clips) != 1
        or (blue.layer_index, red.layer_index) != (0, 1)
        or (blue.clips[0].start_frame, blue.clips[0].end_frame) != (0, 75)
        or (red.clips[0].start_frame, red.clips[0].end_frame) != (50, 125)
        or any(
            clip.source_in_frame != 0 or clip.source_frame_count != 75
            or clip.embedded_audio != "MUTE"
            or (clip.source_width, clip.source_height) != (320, 568)
            or clip.scale_mode != "STRETCH_TO_CANVAS"
            for clip in (blue.clips[0], red.clips[0])
        )
    ):
        _reject("Video resources or frame positions differ from ART04")
    transition = plan.video_transitions[0]
    if (
        transition.kind != "CROSS_DISSOLVE"
        or (transition.from_track_id, transition.to_track_id) != (blue.track_id, red.track_id)
        or (transition.start_frame, transition.end_frame) != (50, 75)
    ):
        _reject("The exact blue-to-red dissolve is required")
    by_role = {track.role: track for track in plan.audio_tracks}
    if set(by_role) != {"DIALOGUE_TEST", "BGM_TEST"}:
        _reject("The two distinct TEST audio tracks are required")
    dialogue = by_role["DIALOGUE_TEST"].clips
    bgm = by_role["BGM_TEST"].clips
    if (
        len(dialogue) != 2 or len(bgm) != 1
        or [(clip.start_frame, clip.end_frame) for clip in dialogue] != [(25, 50), (75, 100)]
        or (bgm[0].start_frame, bgm[0].end_frame) != (0, 125)
        or any(
            (clip.source_in_sample, clip.source_end_sample, clip.source_total_samples,
             clip.source_sample_rate_hz, clip.gain_millidb) != (0, 48000, 48000, 48000, 0)
            for clip in dialogue
        )
        or (bgm[0].source_in_sample, bgm[0].source_end_sample,
            bgm[0].source_total_samples, bgm[0].source_sample_rate_hz,
            bgm[0].gain_millidb) != (0, 240000, 240000, 48000, 0)
        or dialogue[0].media != dialogue[1].media
    ):
        _reject("Audio sample ranges, source identity or gain differ from ART04")
    cues = plan.subtitle_cues
    if (
        [(cue.start_frame, cue.end_frame, cue.text) for cue in cues] != [
            (25, 50, "TEST 提示音一（非语音）"),
            (75, 100, "TEST 提示音二（非语音）"),
        ]
        or cues[0].script_version_id != cues[1].script_version_id
        or cues[0].script_content_hash != cues[1].script_content_hash
        or cues[0].subtitle_file_sha256 != cues[1].subtitle_file_sha256
        or any(cue.font_family != cues[0].font_family
               or cue.font_size_px != cues[0].font_size_px
               or cue.color_rgba != cues[0].color_rgba for cue in cues)
        or [(clip.script_version_id, clip.script_block_id) for clip in dialogue]
        != [(cue.script_version_id, cue.script_block_id) for cue in cues]
    ):
        _reject("Subtitle cues must match the two TEST script-bound tone intervals")


def _source_identity(
    ref: ExecutionMediaRefV1,
    resolve_selected: Callable[[ExecutionMediaRefV1], MltFileIdentity],
    *, video: bool,
) -> MltFileIdentity:
    if (
        ref.rights_status != "CLEARED" or ref.rights_decision_id is None
        or (
            (ref.probe_evidence_id is None or ref.probe_sha256 is None)
            if video else ref.inspection_sha256 is None
        )
    ):
        _reject("Every selected media version needs cleared rights and pinned inspection")
    identity = resolve_selected(ref)
    if not isinstance(identity, MltFileIdentity) or identity.sha256 != ref.sha256:
        _reject("The server-resolved file does not match the selected version")
    if not identity.path.is_absolute() or not _plain_directory(identity.path.parent):
        _reject("Selected media path must be local and managed")
    try:
        if identity.path.is_symlink() or not identity.path.is_file() or identity.path.stat().st_size != ref.byte_size:
            _reject("Selected media file size or path differs from its version")
    except OSError:
        _reject("Selected media file is unavailable")
    return identity


def _add_playlist(root: ET.Element, name: str, clips: tuple, producer_ids: dict[str, str], *, audio: bool) -> None:
    playlist = ET.SubElement(root, "playlist", {"id": name})
    cursor = 0
    for clip in clips:
        if clip.start_frame > cursor:
            ET.SubElement(playlist, "blank", {"length": str(clip.start_frame - cursor)})
        source_in = clip.source_in_sample // SAMPLES_PER_FRAME if audio else clip.source_in_frame
        if audio and (
            clip.source_in_sample % SAMPLES_PER_FRAME
            or clip.source_end_sample % SAMPLES_PER_FRAME
            or clip.source_end_sample - clip.source_in_sample
            != (clip.end_frame - clip.start_frame) * SAMPLES_PER_FRAME
        ):
            _reject("Audio source samples must align exactly with timeline frames")
        ET.SubElement(playlist, "entry", {
            "producer": producer_ids[clip.clip_id],
            "in": str(source_in),
            "out": str(source_in + clip.end_frame - clip.start_frame - 1),
        })
        cursor = clip.end_frame
    if cursor < 125:
        ET.SubElement(playlist, "blank", {"length": str(125 - cursor)})


def _verify_subtitle_file(identity: MltFileIdentity, plan: MediaExecutionPlanV1) -> None:
    try:
        with _open_local_source(identity.path) as stream:
            content = stream.read(1024 * 1024 + 1)
            if len(content) > 1024 * 1024 or hashlib.sha256(content).hexdigest() != identity.sha256:
                _reject("Selected SRT bytes differ from the frozen subtitle hash")
    except OSError:
        _reject("Selected SRT could not be read")
    try:
        normalized = content.decode("utf-8").replace("\r\n", "\n").strip("\n")
    except UnicodeDecodeError:
        _reject("Selected SRT is not UTF-8")
    first, second = plan.subtitle_cues
    expected = (
        f"1\n00:00:01,000 --> 00:00:02,000\n{first.text}\n\n"
        f"2\n00:00:03,000 --> 00:00:04,000\n{second.text}"
    )
    if normalized != expected:
        _reject("Selected SRT timing or TEST text differs from the plan")


def _verify_fixture_manifest(identity: MltFileIdentity, plan: MediaExecutionPlanV1) -> None:
    if (
        not isinstance(identity, MltFileIdentity)
        or identity.sha256 != plan.source.fixture_manifest_sha256
        or not identity.path.is_absolute()
        or not _plain_directory(identity.path.parent)
        or identity.path.is_symlink()
    ):
        _reject("The QA fixture manifest must match the frozen execution source")
    try:
        with _open_local_source(identity.path) as stream:
            content = stream.read(1024 * 1024 + 1)
    except OSError:
        _reject("The QA fixture manifest is unavailable")
    if len(content) > 1024 * 1024 or hashlib.sha256(content).hexdigest() != identity.sha256:
        _reject("The QA fixture manifest bytes differ from the plan")


def build_mlt_engineering_blueprint(
    plan: MediaExecutionPlanV1,
    *,
    resolve_selected: Callable[[ExecutionMediaRefV1], MltFileIdentity],
    subtitle_file: MltFileIdentity,
    fixture_manifest: MltFileIdentity,
) -> MltEngineeringBlueprint:
    """Build XML bytes from the frozen plan without calling MLT or writing files."""
    _require_art04_plan(plan)
    if (
        not isinstance(subtitle_file, MltFileIdentity)
        or subtitle_file.sha256 != plan.subtitle_cues[0].subtitle_file_sha256
        or not subtitle_file.path.is_absolute()
        or not _plain_directory(subtitle_file.path.parent)
    ):
        _reject("The selected subtitle file must match its frozen SHA")
    try:
        if subtitle_file.path.is_symlink() or not subtitle_file.path.is_file():
            _reject("The selected subtitle file is unavailable")
    except OSError:
        _reject("The selected subtitle file is unavailable")
    _verify_subtitle_file(subtitle_file, plan)
    _verify_fixture_manifest(fixture_manifest, plan)

    root = ET.Element("mlt", {"producer": "main", "LC_NUMERIC": "C"})
    ET.SubElement(root, "profile", {
        "description": "AIVORA ART04 engineering test 25 fps",
        "width": "1080", "height": "1920", "progressive": "1",
        "sample_aspect_num": "1", "sample_aspect_den": "1",
        "display_aspect_num": "9", "display_aspect_den": "16",
        "frame_rate_num": "25", "frame_rate_den": "1", "colorspace": "709",
    })
    producer_ids: dict[str, str] = {}
    resources: dict[tuple[str, str], MltFileIdentity] = {}
    all_tracks = (*plan.video_tracks, *plan.audio_tracks)
    for track in all_tracks:
        for clip in track.clips:
            key = (clip.media.asset_id, clip.media.asset_version_id)
            identity = _source_identity(
                clip.media, resolve_selected, video=track in plan.video_tracks,
            )
            if key in resources and resources[key] != identity:
                _reject("One selected version resolved to different local files")
            resources[key] = identity
            producer_id = f"media_{len(producer_ids)}"
            producer_ids[clip.clip_id] = producer_id
            producer = ET.SubElement(root, "producer", {"id": producer_id})
            _property(producer, "mlt_service", "avformat")
            _property(producer, "resource", identity.path)
            if track in plan.video_tracks:
                _property(producer, "audio_index", -1)
            else:
                _property(producer, "video_index", -1)
    ordered = (*plan.video_tracks, *sorted(plan.audio_tracks, key=lambda item: item.role == "DIALOGUE_TEST"))
    for index, track in enumerate(ordered):
        _add_playlist(root, f"track_{index}", track.clips, producer_ids,
                      audio=track in plan.audio_tracks)
    tractor = ET.SubElement(root, "tractor", {"id": "main", "in": "0", "out": "124"})
    multitrack = ET.SubElement(tractor, "multitrack")
    for index, track in enumerate(ordered):
        ET.SubElement(multitrack, "track", {
            "producer": f"track_{index}",
            "hide": "video" if track in plan.audio_tracks else "audio",
        })
    dissolve = ET.SubElement(tractor, "transition", {"in": "50", "out": "74"})
    for name, value in (("a_track", 0), ("b_track", 1), ("mlt_service", "luma")):
        _property(dissolve, name, value)
    # Mix the two independent audio-only tracks into the silent video base.
    # sum=1 is required because the frozen plan specifies unit gains and no limiter.
    for audio_index in (2, 3):
        mix = ET.SubElement(tractor, "transition", {"in": "0", "out": "124"})
        for name, value in (
            ("a_track", 0), ("b_track", audio_index), ("mlt_service", "mix"),
            ("start", "1.0"), ("end", "1.0"), ("sum", 1),
        ):
            _property(mix, name, value)
    for cue in plan.subtitle_cues:
        subtitle = ET.SubElement(tractor, "filter", {
            "in": str(cue.start_frame), "out": str(cue.end_frame - 1),
        })
        for name, value in (
            ("mlt_service", "qtext"), ("argument", cue.text),
            ("geometry", "0%/78%:100%x16%:100"),
            ("halign", "center"), ("valign", "middle"),
            ("family", cue.font_family), ("size", cue.font_size_px),
            ("fgcolour", "0x" + cue.color_rgba[1:]),
            ("bgcolour", "0x00000000"),
        ):
            _property(subtitle, name, value)
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    profile_bytes = (
        "description=AIVORA ART04 engineering test 25 fps\n"
        "frame_rate_num=25\nframe_rate_den=1\nwidth=1080\nheight=1920\n"
        "progressive=1\nsample_aspect_num=1\nsample_aspect_den=1\n"
        "display_aspect_num=9\ndisplay_aspect_den=16\ncolorspace=709\n"
    ).encode("ascii")
    return MltEngineeringBlueprint(
        plan=plan, xml_bytes=xml_bytes, profile_bytes=profile_bytes,
        selected_resources=tuple(resources.values()), subtitle_file=subtitle_file,
        fixture_manifest=fixture_manifest,
    )


def materialize_mlt_engineering_task(
    blueprint: MltEngineeringBlueprint,
    *, operation_id: str, work_root: Path,
) -> MltExecutionTask:
    """Write one immutable candidate project/profile in an exclusive local job dir."""
    if _OPERATION_ID.fullmatch(operation_id) is None or not _plain_directory(work_root):
        raise MltExecutionError("JOB_PATH_UNSAFE", "MLT job root or operation ID is invalid")
    job_dir = work_root / operation_id
    try:
        job_dir.mkdir(mode=0o700, exist_ok=False)
        xml_path = job_dir / "project.mlt"
        profile_path = job_dir / "profile.txt"
        with xml_path.open("xb") as stream:
            stream.write(blueprint.xml_bytes)
        with profile_path.open("xb") as stream:
            stream.write(blueprint.profile_bytes)
    except OSError:
        raise MltExecutionError("JOB_MATERIALIZATION_FAILED", "MLT job files could not be written") from None
    plan = blueprint.plan
    spec = ProductExportSpec(
        container="MP4", width=1080, height=1920,
        frame_rate_num=25, frame_rate_den=1, video_codec="H264", audio_codec="AAC",
    )
    return MltExecutionTask(
        operation_id=operation_id, plan=plan,
        execution_plan_hash=plan.content_hash,
        assembly_artifact_id=None, assembly_version_id=None,
        assembly_content_hash=None,
        xml=MltFileIdentity(xml_path, hashlib.sha256(blueprint.xml_bytes).hexdigest()),
        profile=MltFileIdentity(profile_path, hashlib.sha256(blueprint.profile_bytes).hexdigest()),
        resources=(
            *blueprint.selected_resources, blueprint.subtitle_file,
            blueprint.fixture_manifest,
        ),
        temporary_output=job_dir / "engineering-test.mp4", total_frames=125,
        spec=spec, expect_audio=True,
    )
