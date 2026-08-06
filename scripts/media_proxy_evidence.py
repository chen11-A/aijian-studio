"""Generate, verify, and attest the Phase 0 VFR-to-CFR golden proxy."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))

from aijian_api.media_contracts import (  # noqa: E402
    ProxyTimeMapV1,
    SequenceFrameRateData,
    SequenceTimebaseData,
)
from aijian_api.media_probe import probe_local_media  # noqa: E402
from aijian_api.media_proxy import (  # noqa: E402
    WINDOWS_RESERVED_NAMES,
    GeneratedMediaProxy,
    generate_cfr_proxy,
)
from aijian_api.media_toolchain import (  # noqa: E402
    MediaToolchain,
    discover_media_toolchain,
    load_media_toolchain_lock,
)

SHA256_PATTERN = r"^[0-9a-f]{64}$"
MAX_PROXY_BYTES = 256 * 1024 * 1024
MAX_MAPPING_BYTES = 4 * 1024 * 1024


class ProxyEvidenceError(RuntimeError):
    pass


class ProxyManifestData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    source_relative_path: str
    source_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    proxy_relative_path: str
    proxy_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    mapping_relative_path: str
    mapping_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    source_frame_count: Annotated[int, Field(strict=True, gt=0, le=10_000)]
    proxy_frame_rate_num: Literal[25] = 25
    proxy_frame_rate_den: Literal[1] = 1
    proxy_frame_count: Annotated[int, Field(strict=True, gt=0, le=10_000)]
    video_width: Literal[160] = 160
    video_height: Literal[90] = 90
    proxy_audio_sample_rate_hz: Literal[48000] = 48000
    proxy_audio_sample_count: Annotated[int, Field(strict=True, gt=0)]
    mapping_entry_count: Annotated[int, Field(strict=True, gt=0, le=10_000)]
    sampling_rule: Literal["HOLD_LAST_PRESENTED_FRAME_AT_PROXY_FRAME_START"]

    @model_validator(mode="after")
    def require_total_mapping(self) -> Self:
        if self.mapping_entry_count != self.proxy_frame_count:
            raise ValueError("mapping must cover every proxy frame")
        return self


def _sha256(path: Path, maximum_bytes: int) -> str:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            if total > maximum_bytes:
                raise ProxyEvidenceError(f"file exceeds size limit: {path.name}")
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_path(root: Path, relative_path: str, suffix: str) -> Path:
    candidate = PurePosixPath(relative_path)
    windows_candidate = PureWindowsPath(relative_path)
    windows_stem = windows_candidate.name.split(".", 1)[0].upper()
    if (
        candidate.is_absolute()
        or windows_candidate.drive
        or windows_candidate.root
        or "\\" in relative_path
        or ":" in relative_path
        or ".." in candidate.parts
        or candidate.name != relative_path
        or relative_path.rstrip(" .") != relative_path
        or windows_stem in WINDOWS_RESERVED_NAMES
        or Path(relative_path).suffix.lower() != suffix
    ):
        raise ProxyEvidenceError("proxy manifest contains a non-canonical path")
    resolved_root = root.resolve(strict=True)
    path = (resolved_root / relative_path).resolve(strict=False)
    if path.parent != resolved_root:
        raise ProxyEvidenceError("proxy manifest path escapes its fixture root")
    return path


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="wb", prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
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
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_proxy_manifest(path: Path) -> ProxyManifestData:
    try:
        return ProxyManifestData.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        raise ProxyEvidenceError("proxy manifest is invalid") from None


def _mapping_payload(mapping: ProxyTimeMapV1) -> bytes:
    return (
        json.dumps(mapping.model_dump(mode="json"), ensure_ascii=False, indent=2, sort_keys=True)
        + "\n"
    ).encode("utf-8")


def _decode_raw_frames(
    executable: Path,
    media_path: Path,
    output_path: Path,
    manifest: ProxyManifestData,
) -> tuple[bytes, ...]:
    try:
        subprocess.run(
            [
                str(executable),
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-n",
                "-protocol_whitelist",
                "file",
                "-i",
                str(media_path),
                "-map",
                "0:v:0",
                "-vsync",
                "0",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "rawvideo",
                "-fs",
                str(MAX_MAPPING_BYTES),
                str(output_path),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=60,
        )
        payload = output_path.read_bytes()
    except (OSError, subprocess.SubprocessError):
        raise ProxyEvidenceError("proxy frame decode failed") from None
    frame_bytes = manifest.video_width * manifest.video_height * 3 // 2
    if not payload or len(payload) % frame_bytes != 0:
        raise ProxyEvidenceError("decoded proxy frames have an invalid byte length")
    return tuple(
        payload[offset : offset + frame_bytes] for offset in range(0, len(payload), frame_bytes)
    )


def validate_frame_mapping(
    manifest: ProxyManifestData,
    fixture_root: Path,
    mapping: ProxyTimeMapV1,
    executable: Path,
) -> None:
    source = _canonical_path(fixture_root, manifest.source_relative_path, ".mkv")
    proxy = _canonical_path(fixture_root, manifest.proxy_relative_path, ".webm")
    _assert_frame_mapping_pixels(manifest, source, proxy, mapping, executable)


def _assert_frame_mapping_pixels(
    manifest: ProxyManifestData,
    source: Path,
    proxy: Path,
    mapping: ProxyTimeMapV1,
    executable: Path,
) -> None:
    development_root = REPOSITORY_ROOT / ".aijian-dev"
    development_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="proxy-frame-map-", dir=development_root) as temp:
        temporary = Path(temp)
        source_frames = _decode_raw_frames(executable, source, temporary / "source.yuv", manifest)
        proxy_frames = _decode_raw_frames(executable, proxy, temporary / "proxy.yuv", manifest)
    if len(proxy_frames) != len(mapping.entries):
        raise ProxyEvidenceError("decoded proxy frame count differs from the mapping")
    if len(source_frames) != manifest.source_frame_count:
        raise ProxyEvidenceError("decoded source frame count differs from the manifest")
    if len(proxy_frames) != manifest.proxy_frame_count:
        raise ProxyEvidenceError("decoded proxy frame count differs from the manifest")
    for entry, proxy_frame in zip(mapping.entries, proxy_frames, strict=True):
        if entry.source_frame_index >= len(source_frames):
            raise ProxyEvidenceError("mapping references a missing source frame")
        if proxy_frame != source_frames[entry.source_frame_index]:
            raise ProxyEvidenceError("proxy pixels differ from the mapped source frame")


def _run_nonzero_pts_smoke(
    manifest: ProxyManifestData,
    fixture_root: Path,
    executable: Path,
    toolchain: MediaToolchain,
) -> dict[str, int | bool]:
    source = _canonical_path(fixture_root, manifest.source_relative_path, ".mkv")
    development_root = REPOSITORY_ROOT / ".aijian-dev"
    development_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="nonzero-pts-proxy-", dir=development_root) as temp:
        temporary = Path(temp)
        shifted_source = temporary / "nonzero-source.mkv"
        try:
            subprocess.run(
                [
                    str(executable),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-nostdin",
                    "-n",
                    "-protocol_whitelist",
                    "file",
                    "-i",
                    str(source),
                    "-map",
                    "0",
                    "-c",
                    "copy",
                    "-output_ts_offset",
                    "5",
                    "-fs",
                    str(MAX_PROXY_BYTES),
                    str(shifted_source),
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=60,
            )
        except (OSError, subprocess.SubprocessError):
            raise ProxyEvidenceError("non-zero PTS source generation failed") from None
        timebase = SequenceTimebaseData(
            frame_rate=SequenceFrameRateData(num=25, den=1),
            timecode_mode="NON_DROP_FRAME",
        )
        generated = generate_cfr_proxy(
            shifted_source.resolve(strict=True),
            (temporary / "nonzero-proxy.webm").resolve(strict=False),
            toolchain,
            sequence_timebase=timebase,
        )
        first_source_pts = generated.time_map.entries[0].source_pts.ticks
        first_proxy_pts = generated.probe.video.frames[0].pts.ticks
        if first_source_pts != 5000 or first_proxy_pts != 0:
            raise ProxyEvidenceError("non-zero source PTS was not normalized and preserved")
        _assert_frame_mapping_pixels(
            manifest,
            shifted_source,
            generated.path,
            generated.time_map,
            executable,
        )
        return {
            "passed": True,
            "sourceFirstPtsTicks": first_source_pts,
            "proxyFirstPtsTicks": first_proxy_pts,
            "mappingFirstSourcePtsTicks": generated.time_map.entries[0].source_pts.ticks,
        }


def _assert_generated(result: GeneratedMediaProxy, manifest: ProxyManifestData) -> ProxyTimeMapV1:
    probe = result.probe
    mapping = result.time_map
    audio = probe.audio
    checks = (
        probe.source_asset_sha256 == f"sha256:{manifest.proxy_sha256}",
        probe.video.average_frame_rate.num == manifest.proxy_frame_rate_num,
        probe.video.average_frame_rate.den == manifest.proxy_frame_rate_den,
        not probe.video.is_variable_frame_rate,
        len(probe.video.frames) == manifest.proxy_frame_count,
        audio is not None,
        audio is not None and audio.sample_rate_hz == manifest.proxy_audio_sample_rate_hz,
        audio is not None and audio.total_samples == manifest.proxy_audio_sample_count,
        mapping.source_asset_sha256 == f"sha256:{manifest.source_sha256}",
        mapping.proxy_asset_sha256 == f"sha256:{manifest.proxy_sha256}",
        mapping.sampling_rule == manifest.sampling_rule,
        len(mapping.entries) == manifest.mapping_entry_count,
        len(mapping.entries) == len(probe.video.frames),
    )
    if not all(checks):
        raise ProxyEvidenceError("generated proxy does not match its manifest")
    if hashlib.sha256(_mapping_payload(mapping)).hexdigest() != manifest.mapping_sha256:
        raise ProxyEvidenceError("generated proxy mapping hash does not match its manifest")
    return mapping


def generate_proxy_fixture(
    manifest: ProxyManifestData,
    fixture_root: Path,
    destination: Path | None = None,
) -> tuple[Path, ProxyTimeMapV1]:
    source = _canonical_path(fixture_root, manifest.source_relative_path, ".mkv")
    source_hash = _sha256(source.resolve(strict=True), MAX_PROXY_BYTES)
    if source_hash != manifest.source_sha256:
        raise ProxyEvidenceError("proxy source hash does not match its manifest")
    proxy = destination or _canonical_path(fixture_root, manifest.proxy_relative_path, ".webm")
    toolchain = discover_media_toolchain(
        load_media_toolchain_lock(REPOSITORY_ROOT / "config" / "media-toolchain-lock.json")
    )
    timebase = SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(
            num=manifest.proxy_frame_rate_num,
            den=manifest.proxy_frame_rate_den,
        ),
        timecode_mode="NON_DROP_FRAME",
    )
    result = generate_cfr_proxy(
        source.resolve(strict=True),
        proxy.resolve(strict=False),
        toolchain,
        sequence_timebase=timebase,
    )
    return proxy, _assert_generated(result, manifest)


def publish_proxy_fixture(manifest: ProxyManifestData, fixture_root: Path) -> tuple[Path, Path]:
    resolved_root = fixture_root.resolve(strict=True)
    proxy_path = _canonical_path(resolved_root, manifest.proxy_relative_path, ".webm")
    mapping_path = _canonical_path(resolved_root, manifest.mapping_relative_path, ".json")
    with tempfile.TemporaryDirectory(
        prefix="media-proxy-publish-", dir=resolved_root.parent
    ) as temp:
        staging_root = Path(temp)
        staged_proxy = staging_root / manifest.proxy_relative_path
        _, mapping = generate_proxy_fixture(manifest, resolved_root, staged_proxy)
        staged_mapping = staging_root / manifest.mapping_relative_path
        _atomic_write(staged_mapping, _mapping_payload(mapping))
        if _sha256(staged_mapping, MAX_MAPPING_BYTES) != manifest.mapping_sha256:
            raise ProxyEvidenceError("staged proxy mapping hash mismatch")

        backup_root = staging_root / "backups"
        backup_root.mkdir()
        targets = ((proxy_path, staged_proxy), (mapping_path, staged_mapping))
        backups: dict[Path, Path | None] = {}
        for target, _staged in targets:
            if target.exists():
                backup = backup_root / target.name
                shutil.copy2(target, backup)
                backups[target] = backup
            else:
                backups[target] = None
        committed: list[Path] = []
        try:
            for target, staged in targets:
                os.replace(staged, target)
                committed.append(target)
        except OSError:
            rollback_failed = False
            for target in reversed(committed):
                stored_backup = backups[target]
                try:
                    if stored_backup is None:
                        target.unlink(missing_ok=True)
                    else:
                        os.replace(stored_backup, target)
                except OSError:
                    rollback_failed = True
            suffix = " and rollback was incomplete" if rollback_failed else ""
            raise ProxyEvidenceError(f"proxy fixture publish failed{suffix}") from None
    return proxy_path, mapping_path


def verify_proxy_fixture(manifest: ProxyManifestData, fixture_root: Path) -> ProxyTimeMapV1:
    source = _canonical_path(fixture_root, manifest.source_relative_path, ".mkv")
    proxy = _canonical_path(fixture_root, manifest.proxy_relative_path, ".webm")
    mapping_path = _canonical_path(fixture_root, manifest.mapping_relative_path, ".json")
    expected = (
        (source, manifest.source_sha256, MAX_PROXY_BYTES),
        (proxy, manifest.proxy_sha256, MAX_PROXY_BYTES),
        (mapping_path, manifest.mapping_sha256, MAX_MAPPING_BYTES),
    )
    for path, expected_hash, limit in expected:
        if _sha256(path.resolve(strict=True), limit) != expected_hash:
            raise ProxyEvidenceError(f"fixture hash mismatch: {path.name}")
    try:
        mapping = ProxyTimeMapV1.model_validate_json(mapping_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        raise ProxyEvidenceError("stored proxy mapping is invalid") from None
    if (
        mapping.source_asset_sha256 != f"sha256:{manifest.source_sha256}"
        or mapping.proxy_asset_sha256 != f"sha256:{manifest.proxy_sha256}"
        or len(mapping.entries) != manifest.mapping_entry_count
    ):
        raise ProxyEvidenceError("stored proxy mapping does not match its manifest")
    return mapping


def write_proxy_evidence(
    manifest: ProxyManifestData,
    manifest_path: Path,
    fixture_root: Path,
    output_path: Path,
) -> None:
    stored_mapping = verify_proxy_fixture(manifest, fixture_root)
    toolchain = discover_media_toolchain(
        load_media_toolchain_lock(REPOSITORY_ROOT / "config" / "media-toolchain-lock.json")
    )
    validate_frame_mapping(manifest, fixture_root, stored_mapping, toolchain.ffmpeg_path)
    stored_proxy_path = _canonical_path(
        fixture_root, manifest.proxy_relative_path, ".webm"
    ).resolve(strict=True)
    stored_proxy_probe = probe_local_media(stored_proxy_path, toolchain)
    stored_audio = stored_proxy_probe.audio
    if (
        stored_proxy_probe.source_asset_sha256 != f"sha256:{manifest.proxy_sha256}"
        or stored_proxy_probe.video.is_variable_frame_rate
        or stored_proxy_probe.video.average_frame_rate.num != manifest.proxy_frame_rate_num
        or stored_proxy_probe.video.average_frame_rate.den != manifest.proxy_frame_rate_den
        or len(stored_proxy_probe.video.frames) != manifest.proxy_frame_count
        or stored_audio is None
        or stored_audio.sample_rate_hz != manifest.proxy_audio_sample_rate_hz
        or stored_audio.total_samples != manifest.proxy_audio_sample_count
    ):
        raise ProxyEvidenceError("stored proxy probe does not match its manifest")
    if verify_proxy_fixture(manifest, fixture_root) != stored_mapping:
        raise ProxyEvidenceError("proxy fixture changed during evidence generation")
    nonzero_pts_smoke = _run_nonzero_pts_smoke(
        manifest, fixture_root, toolchain.ffmpeg_path, toolchain
    )
    development_root = REPOSITORY_ROOT / ".aijian-dev"
    development_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="media-proxy-evidence-", dir=development_root) as temp:
        regenerated_path = Path(temp) / manifest.proxy_relative_path
        _, regenerated_mapping = generate_proxy_fixture(manifest, fixture_root, regenerated_path)
    if regenerated_mapping != stored_mapping:
        raise ProxyEvidenceError("regenerated mapping differs from the stored mapping")
    evidence = {
        "check": "phase0-vfr-to-cfr-proxy",
        "passed": True,
        "manifestSha256": f"sha256:{_sha256(manifest_path, MAX_MAPPING_BYTES)}",
        "sourceAssetSha256": f"sha256:{manifest.source_sha256}",
        "proxyAssetSha256": f"sha256:{manifest.proxy_sha256}",
        "mappingSha256": f"sha256:{manifest.mapping_sha256}",
        "proxyFrameRate": {
            "num": manifest.proxy_frame_rate_num,
            "den": manifest.proxy_frame_rate_den,
        },
        "proxyFrameCount": manifest.proxy_frame_count,
        "mappingEntryCount": manifest.mapping_entry_count,
        "mappingCoversEveryProxyFrame": True,
        "mappedFramePixelsMatchSource": True,
        "nonZeroSourcePtsSmoke": nonzero_pts_smoke,
        "audioSampleRateHz": manifest.proxy_audio_sample_rate_hz,
        "audioSampleCount": manifest.proxy_audio_sample_count,
        "samplingRule": manifest.sampling_rule,
        "deterministicRegeneration": True,
        "externalMediaOrNetworkUsed": False,
        "toolchainProfileId": toolchain.profile_id,
        "toolchainVersion": toolchain.version,
        "ffmpegSha256": f"sha256:{toolchain.ffmpeg_sha256}",
        "ffprobeSha256": f"sha256:{toolchain.ffprobe_sha256}",
        "distributionStatus": toolchain.distribution_status,
    }
    _atomic_write(
        output_path,
        (json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )


def _default_paths() -> tuple[Path, Path]:
    root = REPOSITORY_ROOT / "services" / "api" / "tests" / "fixtures" / "media"
    return root / "proxy-manifest.json", root


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("generate", "verify", "evidence"))
    arguments = parser.parse_args()
    manifest_path, fixture_root = _default_paths()
    manifest = load_proxy_manifest(manifest_path)
    if arguments.command == "generate":
        proxy, mapping_path = publish_proxy_fixture(manifest, fixture_root)
        print(json.dumps({"proxy": str(proxy), "mapping": str(mapping_path)}, sort_keys=True))
        return 0
    mapping = verify_proxy_fixture(manifest, fixture_root)
    if arguments.command == "evidence":
        write_proxy_evidence(
            manifest,
            manifest_path,
            fixture_root,
            REPOSITORY_ROOT / "docs" / "quality" / "evidence" / "media-proxy.json",
        )
    print(json.dumps({"entries": len(mapping.entries), "verified": True}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
