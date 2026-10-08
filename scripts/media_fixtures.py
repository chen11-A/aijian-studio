"""Generate and verify the small synthetic golden-media corpus."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from importlib import import_module
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import TYPE_CHECKING, Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

SHA256_PATTERN = r"^[0-9a-f]{64}$"
FIXTURE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{2,79}$"
MAX_FIXTURE_BYTES = 16 * 1024 * 1024
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))

CANONICAL_RECIPE_ARGUMENTS: dict[str, tuple[str, ...]] = {
    "cfr-24000-1001-44100": (
        "testsrc2=size=160x90:rate=24000/1001:duration=2",
        "sine=frequency=440:sample_rate=44100:duration=2",
        "ffv1",
        "pcm_s16le",
        "bitexact",
    ),
    "cfr-24-48000": (
        "testsrc2=size=160x90:rate=24:duration=2",
        "sine=frequency=550:sample_rate=48000:duration=2",
        "ffv1",
        "pcm_s16le",
        "bitexact",
    ),
    "cfr-25-44100": (
        "testsrc2=size=160x90:rate=25:duration=2",
        "sine=frequency=660:sample_rate=44100:duration=2",
        "ffv1",
        "pcm_s16le",
        "bitexact",
    ),
    "cfr-30000-1001-48000": (
        "testsrc2=size=160x90:rate=30000/1001:duration=2",
        "sine=frequency=770:sample_rate=48000:duration=2",
        "ffv1",
        "pcm_s16le",
        "bitexact",
    ),
    "vfr-pattern-44100": (
        "testsrc2=size=160x90:rate=24:duration=2",
        "sine=frequency=880:sample_rate=44100:duration=3",
        "settb=1/1000",
        "piecewise-setpts-24-12-30",
        "enc_time_base=1/1000",
        "ffv1",
        "pcm_s16le",
        "bitexact",
    ),
}

if TYPE_CHECKING:
    from aijian_api.media_probe import LocalMediaProbeData


class MediaFixtureError(RuntimeError):
    pass


class FixtureExpectationData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    frame_rate_num: Annotated[int, Field(strict=True, gt=0)]
    frame_rate_den: Annotated[int, Field(strict=True, gt=0)]
    frame_count: Annotated[int, Field(strict=True, gt=0, le=10_000)]
    audio_sample_rate_hz: Literal[44100, 48000]
    audio_sample_count: Annotated[int, Field(strict=True, gt=0)]
    variable_frame_rate: bool
    video_time_base_num: Annotated[int, Field(strict=True, gt=0)]
    video_time_base_den: Annotated[int, Field(strict=True, gt=0)]
    video_pts_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]


class GoldenMediaFixtureData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    fixture_id: Annotated[str, Field(pattern=FIXTURE_ID_PATTERN)]
    relative_path: str
    sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    media_kind: Literal["CFR", "VFR"]
    generation_arguments: tuple[Annotated[str, Field(min_length=1, max_length=512)], ...] = Field(
        min_length=1,
        max_length=128,
    )
    expected: FixtureExpectationData

    @model_validator(mode="after")
    def require_canonical_relative_path(self) -> Self:
        candidate = PurePosixPath(self.relative_path)
        windows_candidate = PureWindowsPath(self.relative_path)
        if (
            not self.relative_path
            or "\\" in self.relative_path
            or candidate.is_absolute()
            or windows_candidate.drive
            or windows_candidate.root
            or ".." in candidate.parts
            or candidate.as_posix() != self.relative_path
            or self.relative_path != f"{self.fixture_id}.mkv"
        ):
            raise ValueError("fixture path must be canonical and relative")
        if self.media_kind == "VFR" and not self.expected.variable_frame_rate:
            raise ValueError("VFR fixture expectation must be variable")
        if self.media_kind == "CFR" and self.expected.variable_frame_rate:
            raise ValueError("CFR fixture expectation cannot be variable")
        expected_recipe = CANONICAL_RECIPE_ARGUMENTS.get(self.fixture_id)
        if expected_recipe is None or self.generation_arguments != expected_recipe:
            raise ValueError("fixture generation recipe is not canonical")
        return self


class GoldenMediaManifestData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    ffmpeg_profile_id: str = "windows-x86_64-gyan-full-8.1.2-dev"
    fixtures: tuple[GoldenMediaFixtureData, ...] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def require_unique_fixtures(self) -> Self:
        identifiers = {fixture.fixture_id for fixture in self.fixtures}
        paths = {fixture.relative_path for fixture in self.fixtures}
        if len(identifiers) != len(self.fixtures) or len(paths) != len(self.fixtures):
            raise ValueError("fixture IDs and paths must be unique")
        return self


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_FIXTURE_BYTES:
                raise MediaFixtureError(f"fixture exceeds size limit: {path.name}")
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> GoldenMediaManifestData:
    try:
        return GoldenMediaManifestData.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise MediaFixtureError("golden media manifest is invalid") from error


def verify_fixture_files(
    manifest: GoldenMediaManifestData,
    fixture_root: Path,
) -> dict[str, str]:
    root = fixture_root.resolve(strict=True)
    verified: dict[str, str] = {}
    for fixture in manifest.fixtures:
        candidate = (root / fixture.relative_path).resolve(strict=True)
        if root not in candidate.parents or not candidate.is_file():
            raise MediaFixtureError(f"fixture escapes the corpus root: {fixture.fixture_id}")
        actual_hash = _sha256(candidate)
        if actual_hash != fixture.sha256:
            raise MediaFixtureError(f"fixture hash mismatch: {fixture.fixture_id}")
        verified[fixture.fixture_id] = f"sha256:{actual_hash}"
    return verified


def _generation_arguments(fixture_id: str, output_path: Path) -> tuple[str, ...]:
    try:
        video_source, audio_source = CANONICAL_RECIPE_ARGUMENTS[fixture_id][:2]
    except KeyError:
        raise MediaFixtureError(f"fixture has no generator: {fixture_id}") from None
    arguments = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-f",
        "lavfi",
        "-i",
        video_source,
        "-f",
        "lavfi",
        "-i",
        audio_source,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
    ]
    if fixture_id == "vfr-pattern-44100":
        arguments.extend(
            (
                "-vf",
                "settb=expr=1/1000,setpts='if(lt(N,16),N*42,if(lt(N,32),"
                "672+(N-16)*83,2000+(N-32)*33))'",
                "-fps_mode",
                "passthrough",
                "-enc_time_base:v",
                "1/1000",
            )
        )
    arguments.extend(
        (
            "-c:v",
            "ffv1",
            "-level",
            "3",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "pcm_s16le",
            "-threads",
            "1",
            "-shortest",
            "-fflags",
            "+bitexact",
            "-flags:v",
            "+bitexact",
            "-flags:a",
            "+bitexact",
            "-map_metadata",
            "-1",
            "-fs",
            str(MAX_FIXTURE_BYTES),
            str(output_path),
        )
    )
    return tuple(arguments)


def generate_fixture_files(
    manifest: GoldenMediaManifestData,
    fixture_root: Path,
) -> dict[str, str]:
    media_toolchain = import_module("aijian_api.media_toolchain")
    toolchain = media_toolchain.discover_media_toolchain(
        media_toolchain.load_media_toolchain_lock(
            REPOSITORY_ROOT / "config" / "media-toolchain-lock.json"
        )
    )
    if toolchain.profile_id != manifest.ffmpeg_profile_id:
        raise MediaFixtureError("active FFmpeg profile does not match the fixture manifest")
    fixture_root.mkdir(parents=True, exist_ok=True)
    resolved_root = fixture_root.resolve(strict=True)
    generated: dict[str, str] = {}
    with tempfile.TemporaryDirectory(
        prefix="aijian-media-generation-",
        dir=resolved_root.parent,
    ) as staging_directory:
        staging_root = Path(staging_directory)
        staged_paths: dict[str, Path] = {}
        for fixture in manifest.fixtures:
            destination = (resolved_root / fixture.relative_path).resolve(strict=False)
            if destination.parent != resolved_root:
                raise MediaFixtureError(f"fixture escapes generation root: {fixture.fixture_id}")
            staged = staging_root / fixture.relative_path
            try:
                subprocess.run(
                    [
                        str(toolchain.ffmpeg_path),
                        *_generation_arguments(fixture.fixture_id, staged),
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                    timeout=60,
                )
                generated_hash = _sha256(staged)
                if generated_hash != fixture.sha256:
                    raise MediaFixtureError(
                        f"generated fixture hash mismatch: {fixture.fixture_id}"
                    )
                generated[fixture.fixture_id] = f"sha256:{generated_hash}"
                staged_paths[fixture.fixture_id] = staged
            except (OSError, subprocess.SubprocessError):
                raise MediaFixtureError(
                    f"fixture generation failed: {fixture.fixture_id}"
                ) from None
        backup_root = staging_root / "backups"
        backup_root.mkdir()
        backups: dict[str, Path | None] = {}
        for fixture in manifest.fixtures:
            destination = resolved_root / fixture.relative_path
            backup = backup_root / fixture.relative_path
            if destination.exists():
                shutil.copy2(destination, backup)
                backups[fixture.fixture_id] = backup
            else:
                backups[fixture.fixture_id] = None
        committed: list[GoldenMediaFixtureData] = []
        try:
            for fixture in manifest.fixtures:
                destination = resolved_root / fixture.relative_path
                os.replace(staged_paths[fixture.fixture_id], destination)
                committed.append(fixture)
        except OSError:
            rollback_failed = False
            for fixture in reversed(committed):
                destination = resolved_root / fixture.relative_path
                stored_backup = backups[fixture.fixture_id]
                try:
                    if stored_backup is None:
                        destination.unlink(missing_ok=True)
                    else:
                        os.replace(stored_backup, destination)
                except OSError:
                    rollback_failed = True
            suffix = " and rollback was incomplete" if rollback_failed else ""
            raise MediaFixtureError(f"fixture corpus commit failed{suffix}") from None
    return generated


def _default_paths() -> tuple[Path, Path]:
    fixture_root = REPOSITORY_ROOT / "services" / "api" / "tests" / "fixtures" / "media"
    return fixture_root / "manifest.json", fixture_root


def _assert_probe_matches(
    fixture: GoldenMediaFixtureData,
    result: LocalMediaProbeData,
    verified_sha256: str,
) -> dict[str, object]:
    video = result.video
    audio = result.audio
    expected = fixture.expected
    pts_sha256 = hashlib.sha256(
        json.dumps([frame.pts.ticks for frame in video.frames], separators=(",", ":")).encode(
            "ascii"
        )
    ).hexdigest()
    actual = {
        "sourceAssetSha256": result.source_asset_sha256,
        "frameRate": {"num": video.average_frame_rate.num, "den": video.average_frame_rate.den},
        "videoTimeBase": {"num": video.time_base.num, "den": video.time_base.den},
        "videoPtsSha256": f"sha256:{pts_sha256}",
        "frameCount": len(video.frames),
        "variableFrameRate": video.is_variable_frame_rate,
        "audioSampleRateHz": audio.sample_rate_hz if audio else None,
        "audioSampleCount": audio.total_samples if audio else None,
    }
    required = {
        "sourceAssetSha256": verified_sha256,
        "frameRate": {"num": expected.frame_rate_num, "den": expected.frame_rate_den},
        "videoTimeBase": {
            "num": expected.video_time_base_num,
            "den": expected.video_time_base_den,
        },
        "videoPtsSha256": f"sha256:{expected.video_pts_sha256}",
        "frameCount": expected.frame_count,
        "variableFrameRate": expected.variable_frame_rate,
        "audioSampleRateHz": expected.audio_sample_rate_hz,
        "audioSampleCount": expected.audio_sample_count,
    }
    if any(actual[key] != value for key, value in required.items()):
        raise MediaFixtureError(f"probe expectation mismatch: {fixture.fixture_id}")
    return actual


def write_fixture_evidence(
    manifest: GoldenMediaManifestData,
    manifest_path: Path,
    fixture_root: Path,
    output_path: Path,
) -> None:
    media_toolchain = import_module("aijian_api.media_toolchain")
    media_probe = import_module("aijian_api.media_probe")
    lock = media_toolchain.load_media_toolchain_lock(
        REPOSITORY_ROOT / "config" / "media-toolchain-lock.json"
    )
    toolchain = media_toolchain.discover_media_toolchain(lock)
    if toolchain.profile_id != manifest.ffmpeg_profile_id:
        raise MediaFixtureError("active FFmpeg profile does not match the fixture manifest")

    verified = verify_fixture_files(manifest, fixture_root)
    results: dict[str, object] = {}
    for fixture in manifest.fixtures:
        result = media_probe.probe_local_media(
            (fixture_root / fixture.relative_path).resolve(strict=True),
            toolchain,
        )
        results[fixture.fixture_id] = _assert_probe_matches(
            fixture, result, verified[fixture.fixture_id]
        )

    development_root = REPOSITORY_ROOT / ".aijian-dev"
    development_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="media-fixture-smoke-", dir=development_root
    ) as temporary:
        temporary_root = Path(temporary)
        long_directory = temporary_root
        for index in range(10):
            long_directory /= f"深层路径验证-{index:02d}-abcdefghijkl"
        if os.name == "nt":
            long_directory = Path(f"\\\\?\\{long_directory}")
        long_directory.mkdir(parents=True)
        path_fixture = next(
            fixture for fixture in manifest.fixtures if fixture.fixture_id == "cfr-24-48000"
        )
        source_fixture = fixture_root / path_fixture.relative_path
        unicode_copy = long_directory / "媒体副本-角色镜头.mkv"
        shutil.copyfile(source_fixture, unicode_copy)
        unicode_result = media_probe.probe_local_media(unicode_copy.resolve(strict=True), toolchain)
        if unicode_result.source_asset_sha256 != verified[path_fixture.fixture_id]:
            raise MediaFixtureError("Unicode long-path copy changed the fixture hash")
        unicode_path_characters = len(str(unicode_copy).removeprefix("\\\\?\\"))
        if unicode_path_characters <= 260:
            raise MediaFixtureError("long-path smoke input did not exceed 260 characters")

        corrupt_copy = temporary_root / "truncated.mkv"
        corrupt_copy.write_bytes(source_fixture.read_bytes()[:128])
        corrupt_rejected = False
        try:
            media_probe.probe_local_media(corrupt_copy.resolve(strict=True), toolchain)
        except media_probe.MediaProbeError:
            corrupt_rejected = True
        if not corrupt_rejected:
            raise MediaFixtureError("truncated media was not rejected")
        if os.name == "nt":
            shutil.rmtree(Path(f"\\\\?\\{temporary_root}"))

    recipe_payload = json.dumps(
        {fixture.fixture_id: fixture.generation_arguments for fixture in manifest.fixtures},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    evidence = {
        "check": "phase0-golden-media-fixtures",
        "passed": True,
        "toolchainProfileId": toolchain.profile_id,
        "toolchainVersion": toolchain.version,
        "ffmpegSha256": f"sha256:{toolchain.ffmpeg_sha256}",
        "ffprobeSha256": f"sha256:{toolchain.ffprobe_sha256}",
        "manifestSha256": f"sha256:{_sha256(manifest_path.resolve(strict=True))}",
        "recipeFingerprintSha256": f"sha256:{hashlib.sha256(recipe_payload).hexdigest()}",
        "fixtures": results,
        "unicodeLongPathProbe": True,
        "unicodeLongPathCharacters": unicode_path_characters,
        "truncatedInputRejected": True,
        "externalMediaOrNetworkUsed": False,
        "distributionStatus": toolchain.distribution_status,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )
    with tempfile.NamedTemporaryFile(
        mode="wb",
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        dir=output_path.parent,
        delete=False,
    ) as stream:
        temporary_output = Path(stream.name)
        try:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary_output.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary_output, output_path)
    finally:
        temporary_output.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("generate", "verify", "evidence"))
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--root", type=Path)
    arguments = parser.parse_args()
    default_manifest, default_root = _default_paths()
    manifest_path = arguments.manifest or default_manifest
    fixture_root = arguments.root or default_root
    manifest = load_manifest(manifest_path)
    if arguments.command == "generate":
        generated = generate_fixture_files(manifest, fixture_root)
        print(
            json.dumps(
                {"schema_version": 1, "generated": generated},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 0
    verified = verify_fixture_files(manifest, fixture_root)
    if arguments.command == "evidence":
        write_fixture_evidence(
            manifest,
            manifest_path,
            fixture_root,
            REPOSITORY_ROOT / "docs" / "quality" / "evidence" / "media-fixtures.json",
        )
    print(
        json.dumps({"schema_version": 1, "verified": verified}, ensure_ascii=False, sort_keys=True)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
