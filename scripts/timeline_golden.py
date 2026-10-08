"""Reproduce and attest the Phase 0 frame-exact timeline export."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))

from aijian_api.media_contracts import (  # noqa: E402
    SequenceFrameRateData,
    SequenceTimebaseData,
    sequence_frame_to_audio_sample,
)
from aijian_api.media_toolchain import (  # noqa: E402
    discover_media_toolchain,
    load_media_toolchain_lock,
)
from aijian_api.timeline import (  # noqa: E402
    TimelineAssetV1,
    TimelineClipV1,
    TimelineProxyRefV1,
    TimelineVersionV1,
    reorder_clip,
    replace_clip,
    trim_clip,
)
from aijian_api.timeline_export import (  # noqa: E402
    TimelineExportPurpose,
    TimelineMediaBinding,
    canonical_model_sha256,
    export_timeline_mp4,
)

FIXTURE_ROOT = REPOSITORY_ROOT / "services" / "api" / "tests" / "fixtures" / "media"
MANIFEST_PATH = FIXTURE_ROOT / "timeline-golden-manifest.json"
EVIDENCE_PATH = REPOSITORY_ROOT / "docs" / "quality" / "evidence" / "timeline-golden.json"
PROXY_PATH = FIXTURE_ROOT / "vfr-pattern-25fps-proxy.webm"
NTSC_SOURCE_PATH = FIXTURE_ROOT / "cfr-30000-1001-48000.mkv"
FRAME_WIDTH = 160
FRAME_HEIGHT = 90
FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 3 // 2
MAX_RAW_BYTES = 4 * 1024 * 1024
SHA256_PATTERN = r"^[0-9a-f]{64}$"


class TimelineGoldenError(RuntimeError):
    pass


class TimelineGoldenManifestV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    proxy_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    timeline_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    render_plan_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    output_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    ntsc_render_plan_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    ntsc_output_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    selected_source_frames: tuple[Annotated[int, Field(strict=True, ge=0, le=63)], ...] = Field(
        min_length=1, max_length=64
    )
    maximum_mean_absolute_error: Annotated[float, Field(strict=True, ge=0, le=32)]


def _sha256(path: Path, maximum_bytes: int) -> str:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            if total > maximum_bytes:
                raise TimelineGoldenError("timeline evidence file exceeds its size limit")
            digest.update(chunk)
    return digest.hexdigest()


def _timeline() -> tuple[TimelineVersionV1, tuple[int, ...]]:
    timebase = SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=25, den=1),
        timecode_mode="NON_DROP_FRAME",
    )
    source_hash = "sha256:e9c03ac969603b4655d4d27ff10d25e5fa9de68cff3aa1e5853561b5d656b7ce"
    proxy_hash = "sha256:0801c350d098061a9694017f4adcc3cbe8a37c24dce67c864644f928f286b67a"
    proxy = TimelineProxyRefV1(
        proxy_asset_sha256=proxy_hash,
        editable_frame_count=64,
        sequence_timebase=timebase,
    )
    original = TimelineVersionV1(
        timeline_id="m03-golden-timeline",
        revision=0,
        sequence_timebase=timebase,
        assets=(
            TimelineAssetV1(
                asset_id="vfr-primary",
                source_asset_sha256=source_hash,
                source_frame_count=48,
                proxy=proxy,
            ),
            TimelineAssetV1(
                asset_id="vfr-approved-alternate",
                source_asset_sha256=source_hash,
                source_frame_count=48,
                proxy=proxy,
            ),
        ),
        clips=(
            TimelineClipV1(
                clip_id="clip-a",
                asset_id="vfr-primary",
                source_in_frame=0,
                duration_frames=10,
            ),
            TimelineClipV1(
                clip_id="clip-b",
                asset_id="vfr-primary",
                source_in_frame=15,
                duration_frames=10,
            ),
            TimelineClipV1(
                clip_id="clip-c",
                asset_id="vfr-primary",
                source_in_frame=30,
                duration_frames=12,
            ),
        ),
    )
    trimmed = trim_clip(
        original,
        "clip-a",
        new_source_in_frame=2,
        new_duration_frames=8,
        expected_revision=0,
    )
    reordered = reorder_clip(trimmed, "clip-c", new_index=0, expected_revision=1)
    final = replace_clip(
        reordered,
        "clip-b",
        replacement_asset_id="vfr-approved-alternate",
        replacement_source_in_frame=15,
        expected_revision=2,
    )
    return final, (*range(30, 42), *range(2, 10), *range(15, 25))


def _ntsc_timeline() -> TimelineVersionV1:
    timebase = SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=30000, den=1001),
        timecode_mode="NON_DROP_FRAME",
    )
    return TimelineVersionV1(
        timeline_id="m03-ntsc-audio-phase",
        revision=0,
        sequence_timebase=timebase,
        assets=(
            TimelineAssetV1(
                asset_id="ntsc-source",
                source_asset_sha256=(
                    "sha256:40b832cba0e2cea4416f2b33b899cd747934f42a3e46fa86640bfd12095e08cb"
                ),
                source_frame_count=59,
            ),
        ),
        clips=(
            TimelineClipV1(
                clip_id="nonzero-source-in",
                asset_id="ntsc-source",
                source_in_frame=1,
                duration_frames=1,
            ),
        ),
    )


def _decode_frames(
    executable: Path, media: Path, output: Path, *, exported: bool
) -> tuple[bytes, ...]:
    arguments = [
        str(executable),
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-protocol_whitelist",
        "file",
        "-f",
        "mov" if exported else "matroska",
        "-i",
        str(media),
        "-map",
        "0:v:0",
    ]
    if exported:
        arguments.extend(("-vf", "crop=1080:608:0:656,scale=160:90:flags=bicubic"))
    arguments.extend(
        (
            "-vsync",
            "0",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "rawvideo",
            "-fs",
            str(MAX_RAW_BYTES),
            str(output),
        )
    )
    try:
        subprocess.run(
            arguments,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=60,
        )
        payload = output.read_bytes()
    except (OSError, subprocess.SubprocessError):
        raise TimelineGoldenError("timeline frame decode failed") from None
    if not payload or len(payload) % FRAME_BYTES != 0:
        raise TimelineGoldenError("timeline decoded frames have an invalid byte length")
    return tuple(
        payload[offset : offset + FRAME_BYTES] for offset in range(0, len(payload), FRAME_BYTES)
    )


def _mean_absolute_error(left: bytes, right: bytes) -> float:
    return sum(abs(a - b) for a, b in zip(left, right, strict=True)) / len(left)


def measure() -> dict[str, object]:
    toolchain = discover_media_toolchain(
        load_media_toolchain_lock(REPOSITORY_ROOT / "config" / "media-toolchain-lock.json")
    )
    timeline, selected_frames = _timeline()
    development_root = REPOSITORY_ROOT / ".aijian-dev"
    development_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="timeline-golden-", dir=development_root) as temporary:
        work = Path(temporary)
        output = work / "timeline-golden.mp4"
        stable_proxy = work / "stable-proxy.webm"
        shutil.copyfile(PROXY_PATH, stable_proxy)
        expected_proxy_hash = timeline.assets[0].editing_asset_sha256.removeprefix("sha256:")
        if _sha256(stable_proxy, 512 * 1024 * 1024) != expected_proxy_hash:
            raise TimelineGoldenError("timeline golden proxy hash differs from its contract")
        result = export_timeline_mp4(
            timeline,
            (TimelineMediaBinding(timeline.assets[0].editing_asset_sha256, stable_proxy),),
            output.resolve(),
            toolchain,
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
        source_frames = _decode_frames(
            toolchain.ffmpeg_path,
            stable_proxy,
            work / "source.yuv",
            exported=False,
        )
        if _sha256(stable_proxy, 512 * 1024 * 1024) != expected_proxy_hash:
            raise TimelineGoldenError("timeline golden stable proxy changed during validation")
        ntsc_timeline = _ntsc_timeline()
        stable_ntsc = work / "stable-ntsc.mkv"
        shutil.copyfile(NTSC_SOURCE_PATH, stable_ntsc)
        expected_ntsc_hash = ntsc_timeline.assets[0].editing_asset_sha256.removeprefix("sha256:")
        if _sha256(stable_ntsc, 512 * 1024 * 1024) != expected_ntsc_hash:
            raise TimelineGoldenError("timeline NTSC source hash differs from its contract")
        ntsc_result = export_timeline_mp4(
            ntsc_timeline,
            (TimelineMediaBinding(ntsc_timeline.assets[0].editing_asset_sha256, stable_ntsc),),
            (work / "ntsc-audio-phase.mp4").resolve(),
            toolchain,
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
        if _sha256(stable_ntsc, 512 * 1024 * 1024) != expected_ntsc_hash:
            raise TimelineGoldenError("timeline stable NTSC source changed during validation")
        output_frames = _decode_frames(
            toolchain.ffmpeg_path, result.path, work / "output.yuv", exported=True
        )
        if len(output_frames) != len(selected_frames):
            raise TimelineGoldenError("timeline output frame count differs from the golden edit")
        errors = tuple(
            _mean_absolute_error(source_frames[source_index], output_frame)
            for source_index, output_frame in zip(selected_frames, output_frames, strict=True)
        )
        minimum_errors = tuple(
            min(_mean_absolute_error(source_frame, output_frame) for source_frame in source_frames)
            for output_frame in output_frames
        )
        if any(
            expected_error > minimum_error + 0.05
            for expected_error, minimum_error in zip(errors, minimum_errors, strict=True)
        ):
            raise TimelineGoldenError("decoded timeline frame content differs from the golden edit")
        return {
            "schemaVersion": 1,
            "status": "PASS",
            "timelineSha256": canonical_model_sha256(timeline).removeprefix("sha256:"),
            "renderPlanSha256": result.render_plan_sha256.removeprefix("sha256:"),
            "proxySha256": timeline.assets[0].editing_asset_sha256.removeprefix("sha256:"),
            "outputSha256": result.output_sha256.removeprefix("sha256:"),
            "ntscRenderPlanSha256": ntsc_result.render_plan_sha256.removeprefix("sha256:"),
            "ntscOutputSha256": ntsc_result.output_sha256.removeprefix("sha256:"),
            "ntscAudioPhase": {
                "sourceStartFrame": 1,
                "durationFrames": 1,
                "sourceAudioSampleCount": 1601,
                "logicalAudioSampleCount": 1602,
                "encodedAudioSampleCount": ntsc_result.probe.audio.total_samples
                if ntsc_result.probe.audio is not None
                else None,
                "presentationPacketSampleCount": 1602,
            },
            "selectedSourceFrames": list(selected_frames),
            "maximumMeanAbsoluteError": max(errors),
            "output": {
                "container": "MP4",
                "codec": result.probe.video.codec_name,
                "width": result.probe.video.width,
                "height": result.probe.video.height,
                "frameRate": "25/1",
                "frameCount": len(result.probe.video.frames),
                "audioSampleRateHz": result.probe.audio.sample_rate_hz
                if result.probe.audio is not None
                else None,
                "logicalAudioSampleCount": sequence_frame_to_audio_sample(
                    result.render_plan.total_duration_frames,
                    result.render_plan.sequence_timebase,
                ),
                "encodedAudioSampleCount": result.probe.audio.total_samples
                if result.probe.audio is not None
                else None,
            },
            "operations": [
                {"command": "trim", "revision": 1},
                {"command": "reorder", "revision": 2},
                {"command": "replace", "revision": 3},
            ],
            "toolchain": {
                "profileId": toolchain.profile_id,
                "version": toolchain.version,
                "licenseClass": toolchain.license_class,
                "distributionStatus": toolchain.distribution_status,
            },
            "limitations": {
                "editingMedium": "CFR_PROXY",
                "originalReconnectProven": False,
                "releaseEncoderApproved": False,
            },
        }


def _verify(measured: dict[str, object], manifest: TimelineGoldenManifestV1) -> None:
    exact = {
        "proxySha256": manifest.proxy_sha256,
        "timelineSha256": manifest.timeline_sha256,
        "renderPlanSha256": manifest.render_plan_sha256,
        "outputSha256": manifest.output_sha256,
        "ntscRenderPlanSha256": manifest.ntsc_render_plan_sha256,
        "ntscOutputSha256": manifest.ntsc_output_sha256,
        "selectedSourceFrames": list(manifest.selected_source_frames),
    }
    if any(measured[key] != value for key, value in exact.items()):
        raise TimelineGoldenError("timeline golden result differs from its pinned manifest")
    error = measured["maximumMeanAbsoluteError"]
    if not isinstance(error, float) or error > manifest.maximum_mean_absolute_error:
        raise TimelineGoldenError("timeline decoded frame error exceeds its threshold")


def _report(measured: dict[str, object]) -> dict[str, object]:
    report = dict(measured)
    selected = report.pop("selectedSourceFrames")
    if not isinstance(selected, list):
        raise TimelineGoldenError("timeline selected frame report is invalid")
    selected_payload = json.dumps(selected, separators=(",", ":")).encode("utf-8")
    report["selectedSourceFrameOrder"] = "30-41 -> 2-9 -> 15-24"
    report["selectedSourceFramesSha256"] = hashlib.sha256(selected_payload).hexdigest()
    return report


def _atomic_write_evidence(payload: str) -> None:
    EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\n",
        prefix=f".{EVIDENCE_PATH.name}.",
        suffix=".tmp",
        dir=EVIDENCE_PATH.parent,
        delete=False,
    ) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, EVIDENCE_PATH)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("measure", "verify", "evidence"))
    arguments = parser.parse_args()
    try:
        measured = measure()
        if arguments.command != "measure":
            manifest = TimelineGoldenManifestV1.model_validate_json(
                MANIFEST_PATH.read_text(encoding="utf-8")
            )
            _verify(measured, manifest)
        payload = json.dumps(_report(measured), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if arguments.command == "evidence":
            _atomic_write_evidence(payload)
        else:
            print(payload, end="")
        return 0
    except (OSError, ValueError, TimelineGoldenError) as error:
        print(f"timeline golden failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
