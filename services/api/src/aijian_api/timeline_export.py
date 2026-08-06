"""Deterministic render planning for the Phase 0 timeline."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import threading
from contextlib import ExitStack
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.media_contracts import (
    CONTENT_HASH_PATTERN,
    NonNegativeStrictInteger,
    SequenceTimebaseData,
    sequence_frame_to_audio_sample,
)
from aijian_api.media_probe import (
    LocalMediaProbeData,
    MediaProbeError,
    _is_remote_windows_path,
    probe_local_media,
)
from aijian_api.media_proxy import (
    WINDOWS_RESERVED_NAMES,
    MediaProxyError,
    _require_phase0_independent_container,
    _sha256,
    guarded_media_snapshot,
)
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.timeline import PositiveFrameCount, TimelineId, TimelineVersionV1

TIMELINE_EXPORT_TIMEOUT_SECONDS = 180
MAX_TIMELINE_EXPORT_BYTES = 512 * 1024 * 1024
MAX_TIMELINE_EXPORT_CLIPS = 256
MAX_TIMELINE_EXPORT_INPUTS = 64
MAX_TIMELINE_EXPORT_INPUT_BYTES = 512 * 1024 * 1024
MAX_TIMELINE_EXPORT_TOTAL_INPUT_BYTES = 2 * 1024 * 1024 * 1024
MAX_TIMELINE_EXPORT_DURATION_FRAMES = 60_000
MAX_TIMELINE_EXPORT_INPUT_PIXELS = 3840 * 2160
MAX_TIMELINE_FILTER_GRAPH_BYTES = 256 * 1024
MAX_TIMELINE_PACKET_OUTPUT_BYTES = 16 * 1024 * 1024
_TIMELINE_EXPORT_SLOT = threading.BoundedSemaphore(value=1)
ContentHash = Annotated[str, Field(pattern=CONTENT_HASH_PATTERN)]


class TimelineExportError(RuntimeError):
    pass


class TimelineExportPurpose(StrEnum):
    PRODUCT_EXPORT = "PRODUCT_EXPORT"
    DEVELOPMENT_EVIDENCE = "DEVELOPMENT_EVIDENCE"


@dataclass(frozen=True, slots=True)
class TimelineMediaBinding:
    editing_asset_sha256: str
    path: Path


@dataclass(frozen=True, slots=True)
class GeneratedTimelineExport:
    path: Path
    probe: LocalMediaProbeData
    output_sha256: str
    render_plan: TimelineRenderPlanV1
    render_plan_sha256: str


class TimelineRenderClipV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    clip_id: TimelineId
    asset_id: TimelineId
    input_index: NonNegativeStrictInteger
    editing_asset_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    source_start_frame: NonNegativeStrictInteger
    source_end_frame: PositiveFrameCount
    audio_start_sample: NonNegativeStrictInteger
    audio_end_sample: PositiveFrameCount
    timeline_start_frame: NonNegativeStrictInteger
    timeline_end_frame: PositiveFrameCount
    output_audio_sample_count: PositiveFrameCount

    @model_validator(mode="after")
    def require_forward_ranges(self) -> Self:
        if self.source_end_frame <= self.source_start_frame:
            raise ValueError("render clip frame range must move forward")
        if self.audio_end_sample <= self.audio_start_sample:
            raise ValueError("render clip audio range must move forward")
        if self.timeline_end_frame <= self.timeline_start_frame:
            raise ValueError("render clip timeline range must move forward")
        return self


class TimelineRenderPlanV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    timeline_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    sequence_timebase: SequenceTimebaseData
    width: Literal[1080] = 1080
    height: Literal[1920] = 1920
    total_duration_frames: PositiveFrameCount
    input_asset_sha256: tuple[ContentHash, ...] = Field(min_length=1, max_length=10_000)
    clips: tuple[TimelineRenderClipV1, ...] = Field(min_length=1, max_length=10_000)

    @model_validator(mode="after")
    def require_closed_input_and_duration_mapping(self) -> Self:
        if len(set(self.input_asset_sha256)) != len(self.input_asset_sha256):
            raise ValueError("render plan input hashes must be unique")
        used_indices: set[int] = set()
        total_duration = 0
        expected_timeline_start = 0
        for clip in self.clips:
            if clip.input_index >= len(self.input_asset_sha256):
                raise ValueError("render clip input index is out of range")
            if self.input_asset_sha256[clip.input_index] != clip.editing_asset_sha256:
                raise ValueError("render clip hash does not match its input index")
            if clip.audio_start_sample != sequence_frame_to_audio_sample(
                clip.source_start_frame, self.sequence_timebase
            ) or clip.audio_end_sample != sequence_frame_to_audio_sample(
                clip.source_end_frame, self.sequence_timebase
            ):
                raise ValueError("render clip audio range does not match its frame range")
            if clip.timeline_start_frame != expected_timeline_start:
                raise ValueError("render clip timeline ranges must be contiguous")
            clip_duration = clip.source_end_frame - clip.source_start_frame
            expected_timeline_end = expected_timeline_start + clip_duration
            if clip.timeline_end_frame != expected_timeline_end:
                raise ValueError("render clip timeline range does not match its frame duration")
            expected_output_samples = sequence_frame_to_audio_sample(
                expected_timeline_end, self.sequence_timebase
            ) - sequence_frame_to_audio_sample(expected_timeline_start, self.sequence_timebase)
            if clip.output_audio_sample_count != expected_output_samples:
                raise ValueError(
                    "render clip output audio length does not match its timeline range"
                )
            used_indices.add(clip.input_index)
            total_duration += clip_duration
            expected_timeline_start = expected_timeline_end
        if used_indices != set(range(len(self.input_asset_sha256))):
            raise ValueError("render plan contains an unused input")
        if total_duration != self.total_duration_frames:
            raise ValueError("render plan total duration does not match its clips")
        return self


def canonical_model_sha256(model: BaseModel) -> str:
    payload = json.dumps(
        model.model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def build_timeline_render_plan(timeline: TimelineVersionV1) -> TimelineRenderPlanV1:
    input_indices: dict[str, int] = {}
    input_hashes: list[str] = []
    clips: list[TimelineRenderClipV1] = []
    timeline_start_frame = 0
    for clip in timeline.clips:
        asset = timeline.asset_by_id(clip.asset_id)
        editing_hash = asset.editing_asset_sha256
        input_index = input_indices.get(editing_hash)
        if input_index is None:
            input_index = len(input_hashes)
            input_indices[editing_hash] = input_index
            input_hashes.append(editing_hash)
        end_frame = clip.source_in_frame + clip.duration_frames
        timeline_end_frame = timeline_start_frame + clip.duration_frames
        timeline_start_sample = sequence_frame_to_audio_sample(
            timeline_start_frame, timeline.sequence_timebase
        )
        timeline_end_sample = sequence_frame_to_audio_sample(
            timeline_end_frame, timeline.sequence_timebase
        )
        clips.append(
            TimelineRenderClipV1(
                clip_id=clip.clip_id,
                asset_id=clip.asset_id,
                input_index=input_index,
                editing_asset_sha256=editing_hash,
                source_start_frame=clip.source_in_frame,
                source_end_frame=end_frame,
                audio_start_sample=sequence_frame_to_audio_sample(
                    clip.source_in_frame, timeline.sequence_timebase
                ),
                audio_end_sample=sequence_frame_to_audio_sample(
                    end_frame, timeline.sequence_timebase
                ),
                timeline_start_frame=timeline_start_frame,
                timeline_end_frame=timeline_end_frame,
                output_audio_sample_count=timeline_end_sample - timeline_start_sample,
            )
        )
        timeline_start_frame = timeline_end_frame
    return TimelineRenderPlanV1(
        timeline_sha256=canonical_model_sha256(timeline),
        sequence_timebase=timeline.sequence_timebase,
        width=timeline.width,
        height=timeline.height,
        total_duration_frames=timeline.total_duration_frames,
        input_asset_sha256=tuple(input_hashes),
        clips=tuple(clips),
    )


def _filter_graph(plan: TimelineRenderPlanV1, *, has_audio: bool) -> str:
    filters: list[str] = []
    concat_inputs: list[str] = []
    for index, clip in enumerate(plan.clips):
        filters.append(
            f"[{clip.input_index}:v:0]"
            f"trim=start_frame={clip.source_start_frame}:end_frame={clip.source_end_frame},"
            "setpts=PTS-STARTPTS,"
            f"scale={plan.width}:{plan.height}:"
            "force_original_aspect_ratio=decrease:force_divisible_by=2,"
            f"pad={plan.width}:{plan.height}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"setsar=1[v{index}]"
        )
        concat_inputs.append(f"[v{index}]")
        if has_audio:
            filters.append(
                f"[{clip.input_index}:a:0]"
                f"atrim=start_sample={clip.audio_start_sample}:"
                f"end_sample={clip.audio_end_sample},"
                "asetpts=PTS-STARTPTS,"
                f"apad=whole_len={clip.output_audio_sample_count},"
                f"atrim=end_sample={clip.output_audio_sample_count}[a{index}]"
            )
            concat_inputs.append(f"[a{index}]")
    if has_audio:
        filters.append(
            "".join(concat_inputs) + f"concat=n={len(plan.clips)}:v=1:a=1[vout][aconcat]"
        )
        total_samples = sequence_frame_to_audio_sample(
            plan.total_duration_frames, plan.sequence_timebase
        )
        filters.append(
            f"[aconcat]apad=whole_len={total_samples},"
            f"atrim=end_sample={total_samples},asetpts=PTS-STARTPTS[aout]"
        )
    else:
        filters.append("".join(concat_inputs) + f"concat=n={len(plan.clips)}:v=1:a=0[vout]")
    return ";".join(filters)


def _ffmpeg_arguments(
    snapshots: tuple[Path, ...],
    destination: Path,
    plan: TimelineRenderPlanV1,
    *,
    has_audio: bool,
) -> list[str]:
    filter_graph = _filter_graph(plan, has_audio=has_audio)
    if len(filter_graph.encode("utf-8")) > MAX_TIMELINE_FILTER_GRAPH_BYTES:
        raise TimelineExportError("timeline filter graph exceeds the size limit")
    arguments = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n"]
    for snapshot in snapshots:
        arguments.extend(("-protocol_whitelist", "file", "-f", "matroska", "-i", str(snapshot)))
    arguments.extend(("-filter_complex", filter_graph, "-map", "[vout]"))
    if has_audio:
        arguments.extend(("-map", "[aout]"))
    rate = plan.sequence_timebase.frame_rate
    arguments.extend(
        (
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            f"{rate.num}/{rate.den}",
            "-fps_mode",
            "cfr",
            "-threads",
            "1",
        )
    )
    if has_audio:
        arguments.extend(("-c:a", "aac", "-b:a", "192k", "-ar", "48000"))
    arguments.extend(
        (
            "-fflags",
            "+bitexact",
            "-flags:v",
            "+bitexact",
            "-map_metadata",
            "-1",
            "-movflags",
            "+faststart",
            "-fs",
            str(MAX_TIMELINE_EXPORT_BYTES),
            str(destination),
        )
    )
    return arguments


def _validate_destination(destination: Path) -> Path:
    name = destination.name
    stem = name.split(".", 1)[0].upper()
    if (
        not destination.is_absolute()
        or destination.suffix.lower() != ".mp4"
        or _is_remote_windows_path(destination)
        or ":" in name
        or name.rstrip(" .") != name
        or stem in WINDOWS_RESERVED_NAMES
    ):
        raise TimelineExportError("timeline destination must be an absolute local .mp4 path")
    try:
        parent = destination.parent.resolve(strict=True)
    except (OSError, RuntimeError):
        raise TimelineExportError("timeline destination directory is invalid") from None
    if _is_remote_windows_path(parent) or not parent.is_dir():
        raise TimelineExportError("timeline destination directory must be local")
    resolved = parent / name
    if resolved.exists():
        raise TimelineExportError("timeline destination already exists")
    return resolved


def _validate_editing_probe(
    probe: LocalMediaProbeData,
    plan: TimelineRenderPlanV1,
    input_index: int,
) -> None:
    rate = plan.sequence_timebase.frame_rate
    video = probe.video
    if (
        video.is_variable_frame_rate
        or video.width * video.height > MAX_TIMELINE_EXPORT_INPUT_PIXELS
        or (video.average_frame_rate.num, video.average_frame_rate.den) != (rate.num, rate.den)
    ):
        raise TimelineExportError("timeline input must match the Sequence CFR frame rate")
    required_frame_count = max(
        clip.source_end_frame for clip in plan.clips if clip.input_index == input_index
    )
    if len(video.frames) < required_frame_count:
        raise TimelineExportError("timeline input does not cover the requested frame range")
    if probe.audio is not None:
        required_sample_count = max(
            clip.audio_end_sample for clip in plan.clips if clip.input_index == input_index
        )
        if probe.audio.total_samples < required_sample_count:
            raise TimelineExportError("timeline input does not cover the requested audio range")


def _validate_export_probe(
    probe: LocalMediaProbeData,
    plan: TimelineRenderPlanV1,
    *,
    has_audio: bool,
) -> None:
    rate = plan.sequence_timebase.frame_rate
    if not {"mov", "mp4"}.issubset(set(probe.format_names)):
        raise TimelineExportError("timeline export container is not MP4")
    if (
        probe.video.width != plan.width
        or probe.video.height != plan.height
        or probe.video.codec_name != "h264"
        or probe.video.pixel_format != "yuv420p"
        or probe.video.is_variable_frame_rate
        or (probe.video.average_frame_rate.num, probe.video.average_frame_rate.den)
        != (rate.num, rate.den)
        or len(probe.video.frames) != plan.total_duration_frames
    ):
        raise TimelineExportError("timeline export video does not match the render plan")
    if (probe.audio is not None) != has_audio:
        raise TimelineExportError("timeline export audio presence changed")
    if probe.audio is not None and (
        probe.audio.sample_rate_hz != 48_000 or probe.audio.codec_name != "aac"
    ):
        raise TimelineExportError("timeline export audio is not 48 kHz AAC")
    if probe.audio is not None:
        if (probe.audio.time_base.num, probe.audio.time_base.den) != (1, 48_000):
            raise TimelineExportError("timeline export audio timebase is not 1/48000")
        expected_samples = sequence_frame_to_audio_sample(
            plan.total_duration_frames, plan.sequence_timebase
        )
        if not expected_samples <= probe.audio.total_samples < expected_samples + 1024:
            raise TimelineExportError("timeline export audio length exceeds AAC padding bounds")


def _require_export_authorization(
    toolchain: MediaToolchain,
    purpose: TimelineExportPurpose,
) -> None:
    if not isinstance(purpose, TimelineExportPurpose):
        raise TimelineExportError("timeline export purpose is invalid")
    if purpose == TimelineExportPurpose.PRODUCT_EXPORT:
        raise TimelineExportError("Phase 0 product export encoder is not release-approved")
    if toolchain.distribution_status != "DEVELOPMENT_ONLY":
        raise TimelineExportError("development evidence requires a development-only toolchain")


def _require_export_resource_bounds(plan: TimelineRenderPlanV1) -> None:
    if len(plan.clips) > MAX_TIMELINE_EXPORT_CLIPS:
        raise TimelineExportError("timeline export exceeds the clip limit")
    if len(plan.input_asset_sha256) > MAX_TIMELINE_EXPORT_INPUTS:
        raise TimelineExportError("timeline export exceeds the input limit")
    if plan.total_duration_frames > MAX_TIMELINE_EXPORT_DURATION_FRAMES:
        raise TimelineExportError("timeline export exceeds the duration limit")


def _strict_packet_integer(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TimelineExportError("timeline AAC packet timing is invalid")
    return value


def _presentation_audio_sample_count(payload: bytes, stream_index: int) -> int:
    try:
        document = json.loads(payload)
        packets = document["packets"]
    except (UnicodeError, json.JSONDecodeError, KeyError, TypeError):
        raise TimelineExportError("timeline AAC packet report is invalid") from None
    if not isinstance(packets, list) or not packets:
        raise TimelineExportError("timeline AAC packet report is empty")
    cursor = 0
    for packet in packets:
        if not isinstance(packet, dict):
            raise TimelineExportError("timeline AAC packet timing is invalid")
        if _strict_packet_integer(packet.get("stream_index")) != stream_index:
            raise TimelineExportError("timeline AAC packet stream changed")
        pts = _strict_packet_integer(packet.get("pts"))
        duration = _strict_packet_integer(packet.get("duration"))
        if duration <= 0:
            raise TimelineExportError("timeline AAC packet duration is invalid")
        skip_samples = 0
        discard_padding = 0
        side_data = packet.get("side_data_list", [])
        if not isinstance(side_data, list):
            raise TimelineExportError("timeline AAC packet side data is invalid")
        for entry in side_data:
            if not isinstance(entry, dict) or entry.get("side_data_type") != "Skip Samples":
                raise TimelineExportError("timeline AAC packet side data is unsupported")
            skip_samples += _strict_packet_integer(entry.get("skip_samples"))
            discard_padding += _strict_packet_integer(entry.get("discard_padding"))
        start = pts + skip_samples
        end = pts + duration - discard_padding
        if start < 0 or end < start:
            raise TimelineExportError("timeline AAC presentation interval is invalid")
        if end == 0:
            continue
        if start != cursor or end <= cursor:
            raise TimelineExportError("timeline AAC presentation intervals are not contiguous")
        cursor = end
    if cursor <= 0:
        raise TimelineExportError("timeline AAC presentation duration is empty")
    return cursor


def _validate_presentation_audio_samples(
    executable: Path,
    media_path: Path,
    *,
    stream_index: int,
    expected_samples: int,
) -> None:
    command = [
        str(executable),
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        "mov",
        "-i",
        str(media_path),
        "-select_streams",
        "a:0",
        "-show_packets",
        "-show_entries",
        "packet=pts,duration,stream_index:"
        "packet_side_data=side_data_type,skip_samples,discard_padding",
        "-of",
        "json",
    ]
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if process.stdout is None:
        process.kill()
        process.wait()
        raise TimelineExportError("timeline audio validation pipe is unavailable")
    process_stdout = process.stdout
    output = bytearray()
    output_exceeded = threading.Event()
    read_failed = threading.Event()

    def count_output() -> None:
        try:
            while chunk := process_stdout.read(64 * 1024):
                remaining = MAX_TIMELINE_PACKET_OUTPUT_BYTES - len(output)
                if len(chunk) > remaining:
                    output.extend(chunk[:remaining])
                    output_exceeded.set()
                    process.kill()
                    return
                output.extend(chunk)
        except OSError:
            read_failed.set()
            process.kill()

    reader = threading.Thread(target=count_output, name="aijian-audio-count", daemon=True)
    reader.start()
    try:
        return_code = process.wait(timeout=TIMELINE_EXPORT_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        reader.join(timeout=1.0)
        raise TimelineExportError("timeline audio validation timed out") from None
    reader.join(timeout=1.0)
    if reader.is_alive() or read_failed.is_set():
        process.kill()
        process.wait()
        raise TimelineExportError("timeline audio validation failed")
    if output_exceeded.is_set():
        raise TimelineExportError("timeline AAC packet report exceeds the size limit")
    if return_code != 0:
        raise TimelineExportError("timeline AAC packet probe failed")
    if _presentation_audio_sample_count(bytes(output), stream_index) != expected_samples:
        raise TimelineExportError("timeline presentation audio length is not frame-exact")


def _export_timeline_mp4_in_slot(
    timeline: TimelineVersionV1,
    bindings: tuple[TimelineMediaBinding, ...],
    destination: Path,
    toolchain: MediaToolchain,
    *,
    purpose: TimelineExportPurpose,
) -> GeneratedTimelineExport:
    """Render a validated CFR timeline and publish a no-clobber MP4."""

    plan = build_timeline_render_plan(timeline)
    _require_export_authorization(toolchain, purpose)
    _require_export_resource_bounds(plan)
    resolved_destination = _validate_destination(destination)
    binding_by_hash: dict[str, Path] = {}
    for binding in bindings:
        if binding.editing_asset_sha256 in binding_by_hash:
            raise TimelineExportError("timeline media bindings contain duplicate hashes")
        binding_by_hash[binding.editing_asset_sha256] = binding.path
    if set(binding_by_hash) != set(plan.input_asset_sha256):
        raise TimelineExportError("timeline media bindings do not exactly match the render plan")

    parent = resolved_destination.parent
    try:
        with tempfile.TemporaryDirectory(prefix="aijian-timeline-export-", dir=parent) as temporary:
            staged = Path(temporary) / "render.mp4"
            with ExitStack() as stack:
                snapshot_paths: list[Path] = []
                probes: list[LocalMediaProbeData] = []
                total_input_bytes = 0
                for expected_hash in plan.input_asset_sha256:
                    binding_path = binding_by_hash[expected_hash]
                    snapshot = stack.enter_context(
                        guarded_media_snapshot(
                            binding_path,
                            maximum_bytes=MAX_TIMELINE_EXPORT_INPUT_BYTES,
                        )
                    )
                    total_input_bytes += snapshot.byte_size
                    if total_input_bytes > MAX_TIMELINE_EXPORT_TOTAL_INPUT_BYTES:
                        raise TimelineExportError("timeline export exceeds the total input limit")
                    if snapshot.source_asset_sha256 != expected_hash:
                        raise TimelineExportError("timeline input hash does not match its binding")
                    _require_phase0_independent_container(snapshot.path)
                    probe = probe_local_media(snapshot.path.resolve(strict=True), toolchain)
                    if probe.source_asset_sha256 != expected_hash:
                        raise TimelineExportError("timeline input probe hash changed")
                    _validate_editing_probe(probe, plan, len(probes))
                    snapshot_paths.append(snapshot.path)
                    probes.append(probe)
                audio_presence = {probe.audio is not None for probe in probes}
                if len(audio_presence) != 1:
                    raise TimelineExportError("timeline inputs must use one audio-presence policy")
                has_audio = audio_presence.pop()
                if has_audio and any(
                    probe.audio is None or probe.audio.sample_rate_hz != 48_000 for probe in probes
                ):
                    raise TimelineExportError(
                        "timeline input audio must use the 48 kHz working rate"
                    )
                subprocess.run(
                    [
                        str(toolchain.ffmpeg_path),
                        *_ffmpeg_arguments(
                            tuple(snapshot_paths), staged, plan, has_audio=has_audio
                        ),
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                    timeout=TIMELINE_EXPORT_TIMEOUT_SECONDS,
                )
            output_hash = f"sha256:{_sha256(staged, MAX_TIMELINE_EXPORT_BYTES)}"
            output_probe = probe_local_media(staged.resolve(strict=True), toolchain)
            if output_probe.source_asset_sha256 != output_hash:
                raise TimelineExportError("timeline export hash changed during validation")
            _validate_export_probe(output_probe, plan, has_audio=has_audio)
            if output_probe.audio is not None:
                expected_samples = sequence_frame_to_audio_sample(
                    plan.total_duration_frames, plan.sequence_timebase
                )
                _validate_presentation_audio_samples(
                    toolchain.ffprobe_path,
                    staged,
                    stream_index=output_probe.audio.stream_index,
                    expected_samples=expected_samples,
                )
            os.link(staged, resolved_destination)
            return GeneratedTimelineExport(
                path=resolved_destination,
                probe=output_probe,
                output_sha256=output_hash,
                render_plan=plan,
                render_plan_sha256=canonical_model_sha256(plan),
            )
    except TimelineExportError:
        raise
    except (MediaProbeError, MediaProxyError, OSError, subprocess.SubprocessError):
        raise TimelineExportError("timeline export failed") from None


def export_timeline_mp4(
    timeline: TimelineVersionV1,
    bindings: tuple[TimelineMediaBinding, ...],
    destination: Path,
    toolchain: MediaToolchain,
    *,
    purpose: TimelineExportPurpose,
) -> GeneratedTimelineExport:
    """Run one bounded local export; concurrent calls fail instead of queueing unbounded work."""

    if not _TIMELINE_EXPORT_SLOT.acquire(blocking=False):
        raise TimelineExportError("timeline export worker is busy")
    try:
        return _export_timeline_mp4_in_slot(
            timeline,
            bindings,
            destination,
            toolchain,
            purpose=purpose,
        )
    finally:
        _TIMELINE_EXPORT_SLOT.release()
