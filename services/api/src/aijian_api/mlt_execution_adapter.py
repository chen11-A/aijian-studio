"""Translate the one frozen ART04 engineering plan into a candidate MLT job.

This is a server-side, test-only adapter. The caller must resolve every selected
asset version to a trusted local file identity. Neither client XML nor an
unversioned media path is accepted. MLT execution still needs independent QA.
"""

from __future__ import annotations

import hashlib
import json
import os
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
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.episode_media_execution_plan import ART04_MLT_TEST_SPEC_SHA256
from aijian_api.product_export_contracts import ProductExportSpec
from aijian_api.mlt_execution_worker import (
    MltExecutionError,
    MltExecutionTask,
    MltFileIdentity,
    _managed_directory,
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
    qa_origin_files: tuple[MltFileIdentity, ...]
    generation_lock: MltFileIdentity
    generation_ffmpeg: MltFileIdentity
    generation_ffprobe: MltFileIdentity


@dataclass(frozen=True, slots=True)
class MltResolvedSelection:
    """Authoritative asset/version, rights and inspection row plus managed bytes."""

    media: ExecutionMediaRefV1
    file: MltFileIdentity


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
    media_refs = (blue.clips[0].media, red.clips[0].media, dialogue[0].media, bgm[0].media)
    if (
        len({(ref.asset_id, ref.asset_version_id) for ref in media_refs}) != 4
        or len({ref.sha256 for ref in media_refs}) != 4
    ):
        _reject("The four named video and audio sources must be distinct versions and bytes")
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
    resolve_selected: Callable[[ExecutionMediaRefV1], MltResolvedSelection],
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
    resolved = resolve_selected(ref)
    if not isinstance(resolved, MltResolvedSelection) or resolved.media != ref:
        _reject("The persisted selected version, rights or inspection identity changed")
    identity = resolved.file
    if not isinstance(identity, MltFileIdentity) or identity.sha256 != ref.sha256:
        _reject("The server-resolved file does not match the selected version")
    if not identity.path.is_absolute() or not _managed_directory(identity.path.parent):
        _reject("Selected media path must be local and managed")
    try:
        io_path = managed_local_io_path(identity.path.parent, identity.path)
        if io_path.is_symlink() or not io_path.is_file() or io_path.stat().st_size != ref.byte_size:
            _reject("Selected media file size or path differs from its version")
    except (OSError, ValueError):
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
        io_path = managed_local_io_path(identity.path.parent, identity.path)
        with _open_local_source(io_path) as stream:
            content = stream.read(1024 * 1024 + 1)
            if len(content) > 1024 * 1024 or hashlib.sha256(content).hexdigest() != identity.sha256:
                _reject("Selected SRT bytes differ from the frozen subtitle hash")
    except (OSError, ValueError):
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


def _no_duplicate_json_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            _reject("The QA fixture manifest has duplicate JSON keys")
        result[key] = value
    return result


def _manifest_tool_identity(payload: dict, path_key: str, hash_key: str) -> MltFileIdentity:
    raw_path = payload.get(path_key)
    raw_hash = payload.get(hash_key)
    if (
        not isinstance(raw_path, str) or not isinstance(raw_hash, str)
        or re.fullmatch(r"[0-9A-Fa-f]{64}", raw_hash) is None
    ):
        _reject("The QA fixture manifest lacks a pinned generation tool")
    identity = MltFileIdentity(Path(raw_path), raw_hash.lower())
    if not identity.path.is_absolute() or not _plain_directory(identity.path.parent):
        _reject("The QA generation tool path is not local and managed")
    return identity


def _verify_qa_origin_file(
    root: Path, path_text: str, name: str, byte_size: int, digest: str,
) -> None:
    path = Path(path_text)
    try:
        io_path = managed_local_io_path(root, path)
    except (OSError, ValueError):
        _reject("A QA fixture input escapes its isolated directory")
    if (
        not path.is_absolute() or path.parent != root or path.name != name
        or io_path.is_symlink() or not io_path.is_file()
    ):
        _reject("A QA fixture input escapes its isolated directory")
    try:
        with _open_local_source(io_path) as stream:
            before = os.fstat(stream.fileno())
            actual_digest = hashlib.sha256()
            while chunk := stream.read(1024 * 1024):
                actual_digest.update(chunk)
            after = os.fstat(stream.fileno())
            current = io_path.stat()
    except OSError:
        _reject("A QA fixture input could not be read")
    if (
        before.st_size != byte_size or actual_digest.hexdigest() != digest
        or before.st_dev != after.st_dev or before.st_ino != after.st_ino
        or before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns
        or before.st_dev != current.st_dev or before.st_ino != current.st_ino
        or before.st_size != current.st_size or before.st_mtime_ns != current.st_mtime_ns
    ):
        _reject("A QA fixture input bytes or identity changed")


def _verify_fixture_manifest(
    identity: MltFileIdentity, plan: MediaExecutionPlanV1,
    media_files: dict[tuple[str, str], MltFileIdentity],
    subtitle_file: MltFileIdentity,
) -> tuple[
    tuple[MltFileIdentity, ...], MltFileIdentity, MltFileIdentity, MltFileIdentity,
]:
    if (
        not isinstance(identity, MltFileIdentity)
        or identity.sha256 != plan.source.fixture_manifest_sha256
        or not identity.path.is_absolute()
        or not _managed_directory(identity.path.parent)
    ):
        _reject("The QA fixture manifest must match the frozen execution source")
    try:
        manifest_io = managed_local_io_path(identity.path.parent, identity.path)
        with _open_local_source(manifest_io) as stream:
            content = stream.read(1024 * 1024 + 1)
    except (OSError, ValueError):
        _reject("The QA fixture manifest is unavailable")
    if len(content) > 1024 * 1024 or hashlib.sha256(content).hexdigest() != identity.sha256:
        _reject("The QA fixture manifest bytes differ from the plan")
    try:
        manifest = json.loads(content.decode("utf-8"), object_pairs_hook=_no_duplicate_json_keys)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
        _reject("The QA fixture manifest JSON is invalid")
    if not isinstance(manifest, dict):
        _reject("The QA fixture manifest root is invalid")
    first, second = plan.subtitle_cues
    spec_hash = manifest.get("spec_sha256")
    if (
        manifest.get("kind") != "QA02_MLT_SYNTHETIC_FIVE_INPUT_MANIFEST"
        or manifest.get("status") != "FIVE_INPUTS_FROZEN_NO_MLT"
        or manifest.get("usage") != "SYNTHETIC_TEST_ONLY"
        or not isinstance(spec_hash, str)
        or spec_hash.lower() != ART04_MLT_TEST_SPEC_SHA256
        or manifest.get("project_id") != plan.source.project_id
        or manifest.get("episode_id") != plan.source.episode_id
        or manifest.get("test_script_version_id") != first.script_version_id
        or manifest.get("test_script_content_hash") != first.script_content_hash
        or manifest.get("first_script_block_id") != first.script_block_id
        or manifest.get("second_script_block_id") != second.script_block_id
    ):
        _reject("The QA fixture manifest identity does not match the frozen TEST plan")
    output_directory = manifest.get("output_directory")
    if not isinstance(output_directory, str):
        _reject("The QA fixture directory is missing")
    qa_root = Path(output_directory)
    if not _managed_directory(qa_root) or identity.path.parent != qa_root:
        _reject("The QA fixture manifest is outside its isolated directory")
    blue, red = plan.video_tracks
    dialogue = next(track for track in plan.audio_tracks if track.role == "DIALOGUE_TEST")
    bgm = next(track for track in plan.audio_tracks if track.role == "BGM_TEST")
    refs = {
        "v1-blue.webm": blue.clips[0].media,
        "v2-red.webm": red.clips[0].media,
        "dialogue-test.wav": dialogue.clips[0].media,
        "bgm-test.wav": bgm.clips[0].media,
    }
    entries = manifest.get("files")
    if not isinstance(entries, list) or len(entries) != 5:
        _reject("The QA fixture manifest must contain exactly five inputs")
    seen: set[str] = set()
    origin_files: list[MltFileIdentity] = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            _reject("The QA fixture manifest has an invalid file entry")
        name = entry["name"]
        if name in seen or name not in {*refs, "subtitle-test.srt"}:
            _reject("The QA fixture manifest has a duplicate or unknown input")
        seen.add(name)
        raw_hash = entry.get("sha256")
        byte_size = entry.get("bytes")
        if (
            entry.get("usage") != "SYNTHETIC_TEST_ONLY"
            or not isinstance(entry.get("path"), str)
            or not isinstance(raw_hash, str)
            or re.fullmatch(r"[0-9A-Fa-f]{64}", raw_hash) is None
            or isinstance(byte_size, bool) or not isinstance(byte_size, int)
            or byte_size <= 0
        ):
            _reject("The QA fixture manifest file identity is incomplete")
        if name == "subtitle-test.srt":
            actual = subtitle_file
            expected_sha = first.subtitle_file_sha256
            try:
                expected_bytes = managed_local_io_path(
                    subtitle_file.path.parent, subtitle_file.path,
                ).stat().st_size
            except (OSError, ValueError):
                _reject("Selected SRT is unavailable")
        else:
            ref = refs[name]
            actual = media_files[(ref.asset_id, ref.asset_version_id)]
            expected_sha = ref.sha256
            expected_bytes = ref.byte_size
        if (
            raw_hash.lower() != expected_sha or actual.sha256 != expected_sha
            or byte_size != expected_bytes
        ):
            _reject("A QA fixture entry differs from its selected version")
        _verify_qa_origin_file(qa_root, entry["path"], name, byte_size, expected_sha)
        origin_files.append(MltFileIdentity(Path(entry["path"]), expected_sha))
    if seen != {*refs, "subtitle-test.srt"}:
        _reject("The QA fixture manifest is missing a named input")
    return (
        tuple(origin_files),
        _manifest_tool_identity(manifest, "lock_path", "lock_sha256"),
        _manifest_tool_identity(manifest, "ffmpeg_path", "ffmpeg_sha256"),
        _manifest_tool_identity(manifest, "ffprobe_path", "ffprobe_sha256"),
    )


def build_mlt_engineering_blueprint(
    plan: MediaExecutionPlanV1,
    *,
    resolve_selected: Callable[[ExecutionMediaRefV1], MltResolvedSelection],
    subtitle_file: MltFileIdentity,
    fixture_manifest: MltFileIdentity,
) -> MltEngineeringBlueprint:
    """Build XML bytes from the frozen plan without calling MLT or writing files."""
    _require_art04_plan(plan)
    if (
        not isinstance(subtitle_file, MltFileIdentity)
        or subtitle_file.sha256 != plan.subtitle_cues[0].subtitle_file_sha256
        or not subtitle_file.path.is_absolute()
        or not _managed_directory(subtitle_file.path.parent)
    ):
        _reject("The selected subtitle file must match its frozen SHA")
    try:
        subtitle_io = managed_local_io_path(subtitle_file.path.parent, subtitle_file.path)
        if subtitle_io.is_symlink() or not subtitle_io.is_file():
            _reject("The selected subtitle file is unavailable")
    except (OSError, ValueError):
        _reject("The selected subtitle file is unavailable")
    _verify_subtitle_file(subtitle_file, plan)

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
                # The frozen TEST requests fill without crop or letterbox.
                # Affine's documented distort property ignores source aspect.
                stretch = ET.SubElement(producer, "filter")
                for name, value in (
                    ("mlt_service", "affine"), ("transition.distort", 1),
                    ("transition.rect", "0%/0%:100%x100%:100%"),
                    ("use_normalized", 1),
                ):
                    _property(stretch, name, value)
            else:
                _property(producer, "video_index", -1)
    qa_origin_files, generation_lock, generation_ffmpeg, generation_ffprobe = _verify_fixture_manifest(
        fixture_manifest, plan, resources, subtitle_file,
    )
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
        fixture_manifest=fixture_manifest, qa_origin_files=qa_origin_files,
        generation_lock=generation_lock, generation_ffmpeg=generation_ffmpeg,
        generation_ffprobe=generation_ffprobe,
    )


def materialize_mlt_engineering_task(
    blueprint: MltEngineeringBlueprint,
    *, operation_id: str, work_root: Path,
) -> MltExecutionTask:
    """Write one immutable candidate project/profile in an exclusive local job dir."""
    if _OPERATION_ID.fullmatch(operation_id) is None or not _managed_directory(work_root):
        raise MltExecutionError("JOB_PATH_UNSAFE", "MLT job root or operation ID is invalid")
    job_dir = work_root / operation_id
    try:
        job_dir_io = managed_local_io_path(work_root, job_dir)
        job_dir_io.mkdir(mode=0o700, exist_ok=False)
        xml_path = job_dir / "project.mlt"
        profile_path = job_dir / "profile.txt"
        with managed_local_io_path(work_root, xml_path).open("xb") as stream:
            stream.write(blueprint.xml_bytes)
        with managed_local_io_path(work_root, profile_path).open("xb") as stream:
            stream.write(blueprint.profile_bytes)
    except (OSError, ValueError):
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
        resources=(*blueprint.selected_resources, blueprint.subtitle_file),
        fixture_manifest=blueprint.fixture_manifest,
        qa_origin_files=blueprint.qa_origin_files,
        generation_lock=blueprint.generation_lock,
        generation_ffmpeg=blueprint.generation_ffmpeg,
        generation_ffprobe=blueprint.generation_ffprobe,
        temporary_output=job_dir / "engineering-test.mp4", total_frames=125,
        spec=spec, expect_audio=True,
    )
