"""Deterministic first-slice local MP4 render plan from one verified video.

This engineering slice accepts one complete CFR video segment. Unsupported
assembly tracks fail explicitly; a plan is not a rights or release approval.
"""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidence
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import ProductExportClaimRequest
from aijian_api.product_timeline_export_contracts import ProductExportSpec


class ProductExportPlanError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ProductExportRenderPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal[1] = 1
    mode: Literal["SINGLE_VERIFIED_VIDEO"] = "SINGLE_VERIFIED_VIDEO"
    assembly_content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_asset_id: str = Field(pattern=r"^asset_[0-9a-f]{32}$")
    source_version_id: str = Field(pattern=r"^asv_[0-9a-f]{32}$")
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_probe_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    toolchain_profile_id: str
    ffmpeg_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    ffprobe_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    total_frames: int = Field(gt=0)
    has_audio: bool
    spec: ProductExportSpec

    @property
    def content_hash(self) -> str:
        return canonical_content_hash(self.model_dump(mode="json"))


class EncoderPlan(Protocol):
    source_sha256: str
    toolchain_profile_id: str
    ffmpeg_sha256: str
    ffprobe_sha256: str
    total_frames: int
    has_audio: bool
    spec: ProductExportSpec


def build_single_video_render_plan(
    assembly: EpisodeMediaAssemblyContentV1,
    request: ProductExportClaimRequest,
    evidence: MediaAssetProbeEvidence,
    toolchain: MediaToolchain,
) -> ProductExportRenderPlan:
    """Validate an entire assembly before selecting the narrow render path."""
    if len(assembly.visual_segments) != 1:
        raise ProductExportPlanError(
            "MULTI_SEGMENT_UNSUPPORTED", "Multiple visual segments need a separate render path"
        )
    if assembly.audio_segments:
        kinds = {segment.track_kind for segment in assembly.audio_segments}
        for kind in ("DIALOGUE", "BGM", "SFX"):
            if kind in kinds:
                raise ProductExportPlanError(
                    f"{kind}_UNSUPPORTED", f"Independent {kind} audio is not yet renderable"
                )
    if assembly.subtitle_segments:
        raise ProductExportPlanError(
            "SUBTITLE_UNSUPPORTED", "Subtitle rendering is not yet available"
        )
    visual = assembly.visual_segments[0]
    if visual.media_kind != "video" or visual.source_in_frame != 0:
        raise ProductExportPlanError(
            "VISUAL_UNSUPPORTED", "This render path needs one video from its first frame"
        )
    if assembly.canvas_width != request.spec.width or assembly.canvas_height != request.spec.height:
        raise ProductExportPlanError(
            "CANVAS_CONFLICT", "Requested output dimensions differ from assembly"
        )
    rate = assembly.sequence_timebase.frame_rate
    if (rate.num, rate.den) != (request.spec.frame_rate_num, request.spec.frame_rate_den):
        raise ProductExportPlanError(
            "FRAME_RATE_CONFLICT", "Requested frame rate differs from assembly"
        )
    if request.spec.video_codec != "H264":
        raise ProductExportPlanError(
            "VIDEO_CODEC_UNSUPPORTED", "This render path supports H264 only"
        )
    media = visual.media
    if (
        evidence.project_id != assembly.project_id
        or evidence.asset_id != media.asset_id
        or evidence.version_id != media.asset_version_id
        or evidence.asset_sha256 != media.sha256
        or evidence.probe.source_asset_sha256 != "sha256:" + media.sha256
        or evidence.ffmpeg_sha256 != toolchain.ffmpeg_sha256
        or evidence.ffprobe_sha256 != toolchain.ffprobe_sha256
        or evidence.toolchain_profile_id != toolchain.profile_id
    ):
        raise ProductExportPlanError(
            "PROBE_IDENTITY_CONFLICT", "Video probe does not bind this assembly and toolchain"
        )
    probe = evidence.probe
    if (
        probe.video.is_variable_frame_rate
        or (probe.video.average_frame_rate.num, probe.video.average_frame_rate.den)
        != (rate.num, rate.den)
        or len(probe.video.frames) != assembly.total_frames
        or probe.video.width != request.spec.width
        or probe.video.height != request.spec.height
    ):
        raise ProductExportPlanError(
            "VIDEO_PROBE_CONFLICT", "Selected video cannot fill the declared sequence exactly"
        )
    has_audio = visual.embedded_audio == "PLAY"
    if has_audio and probe.audio is None:
        raise ProductExportPlanError(
            "EMBEDDED_AUDIO_MISSING", "Selected video has no embedded audio"
        )
    if has_audio and probe.audio is not None:
        minimum_samples = (
            Fraction(
                assembly.total_frames * rate.den * probe.audio.sample_rate_hz,
                rate.num,
            )
            - 1024
        )
        if probe.audio.total_samples < minimum_samples:
            raise ProductExportPlanError(
                "EMBEDDED_AUDIO_SHORT", "Embedded audio ends before the sequence"
            )
    return ProductExportRenderPlan(
        assembly_content_hash=canonical_content_hash(assembly.model_dump(mode="json")),
        source_asset_id=media.asset_id,
        source_version_id=media.asset_version_id,
        source_sha256=media.sha256,
        source_probe_sha256=evidence.probe_sha256,
        toolchain_profile_id=toolchain.profile_id,
        ffmpeg_sha256=toolchain.ffmpeg_sha256,
        ffprobe_sha256=toolchain.ffprobe_sha256,
        total_frames=assembly.total_frames,
        has_audio=has_audio,
        spec=request.spec,
    )


def render_arguments(
    plan: EncoderPlan,
    source: Path,
    temporary_output: Path,
) -> tuple[str, ...]:
    """Arguments for a pinned ffmpeg executable; call with shell=False."""
    if not source.is_absolute() or not temporary_output.is_absolute():
        raise ProductExportPlanError("PATH_UNSAFE", "Encoder paths must be absolute")
    rate = f"{plan.spec.frame_rate_num}/{plan.spec.frame_rate_den}"
    duration = Fraction(
        plan.total_frames * plan.spec.frame_rate_den,
        plan.spec.frame_rate_num,
    )
    duration_text = f"{float(duration):.9f}"
    args = [
        "-hide_banner",
        "-nostdin",
        "-n",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-frames:v",
        str(plan.total_frames),
        "-r",
        rate,
        "-fps_mode",
        "cfr",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-t",
        duration_text,
    ]
    if plan.has_audio:
        args.extend(("-map", "0:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2"))
    else:
        args.append("-an")
    args.extend(
        (
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "mp4",
            str(temporary_output),
        )
    )
    return tuple(args)
