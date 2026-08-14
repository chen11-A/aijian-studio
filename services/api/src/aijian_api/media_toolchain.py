"""Pinned FFmpeg/ffprobe discovery with explicit licensing diagnostics."""

import hashlib
import json
import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

SHA256_PATTERN = r"^[0-9a-f]{64}$"
VERSION_PATTERN = r"^[0-9]+\.[0-9]+\.[0-9]+$"
MAX_LOCK_BYTES = 1024 * 1024
MAX_VERSION_OUTPUT_BYTES = 64 * 1024
VERSION_TIMEOUT_SECONDS = 10.0

PathLookup = Callable[[str], str | None]
VersionReader = Callable[[Path], str]


class MediaToolchainErrorCode(StrEnum):
    NOT_FOUND = "NOT_FOUND"
    INVALID_TOOL_PAIR = "INVALID_TOOL_PAIR"
    UNLOCKED_BINARY = "UNLOCKED_BINARY"
    TIMEOUT = "TIMEOUT"
    EXECUTION_FAILED = "EXECUTION_FAILED"
    OUTPUT_LIMIT = "OUTPUT_LIMIT"
    INVALID_VERSION_OUTPUT = "INVALID_VERSION_OUTPUT"
    VERSION_MISMATCH = "VERSION_MISMATCH"
    UNPINNED_VERSION = "UNPINNED_VERSION"
    CONFIGURATION_MISMATCH = "CONFIGURATION_MISMATCH"
    LICENSE_MISMATCH = "LICENSE_MISMATCH"
    LOCK_INVALID = "LOCK_INVALID"
    RELEASE_PACKAGING_BLOCKED = "RELEASE_PACKAGING_BLOCKED"


class MediaToolchainError(RuntimeError):
    """Stable internal failure code plus a safe diagnostic message."""

    def __init__(self, code: MediaToolchainErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


class MediaToolchainProfileData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    profile_id: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9._-]{2,79}$")]
    ffmpeg_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    ffprobe_sha256: Annotated[str, Field(pattern=SHA256_PATTERN)]
    source_url: Annotated[str, Field(pattern=r"^https://[^\s]+$")]
    license_class: Literal["LGPL", "GPL", "NONFREE"]
    spdx_license: Annotated[str, Field(min_length=3, max_length=80)]
    distribution_status: Literal["DEV_GPL", "RELEASE_LGPL_REVIEWED"]

    @model_validator(mode="after")
    def separate_development_and_release_semantics(self) -> Self:
        if self.distribution_status == "DEV_GPL" and self.license_class != "GPL":
            raise ValueError("DEV_GPL profiles must be GPL development builds")
        if self.distribution_status == "RELEASE_LGPL_REVIEWED" and self.license_class != "LGPL":
            raise ValueError("release-reviewed profiles must be LGPL builds")
        return self


class MediaToolchainLockData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    expected_version: Annotated[str, Field(pattern=VERSION_PATTERN)]
    profiles: tuple[MediaToolchainProfileData, ...] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def require_unique_profiles(self) -> Self:
        profile_ids = {profile.profile_id for profile in self.profiles}
        hash_pairs = {(profile.ffmpeg_sha256, profile.ffprobe_sha256) for profile in self.profiles}
        if len(profile_ids) != len(self.profiles) or len(hash_pairs) != len(self.profiles):
            raise ValueError("profile IDs and hash pairs must be unique")
        return self


@dataclass(frozen=True, slots=True)
class MediaToolchain:
    profile_id: str
    version: str
    ffmpeg_path: Path
    ffprobe_path: Path
    ffmpeg_sha256: str
    ffprobe_sha256: str
    configuration_flags: tuple[str, ...]
    license_class: Literal["LGPL", "GPL", "NONFREE"]
    spdx_license: str
    distribution_status: Literal["DEV_GPL", "RELEASE_LGPL_REVIEWED"]


@dataclass(frozen=True, slots=True)
class _ParsedVersion:
    base_version: str
    configuration_flags: frozenset[str]


def load_media_toolchain_lock(path: Path) -> MediaToolchainLockData:
    """Load a small strict lock document without accepting partial defaults."""

    try:
        if not path.is_file() or path.stat().st_size > MAX_LOCK_BYTES:
            raise MediaToolchainError(
                MediaToolchainErrorCode.LOCK_INVALID,
                "media toolchain lock is missing or exceeds the size limit",
            )
        payload = json.loads(path.read_text(encoding="utf-8"))
        return MediaToolchainLockData.model_validate(payload)
    except MediaToolchainError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError, ValidationError, TypeError) as error:
        raise MediaToolchainError(
            MediaToolchainErrorCode.LOCK_INVALID,
            "media toolchain lock is invalid",
        ) from error


def _find_in_root(root: Path, name: str) -> Path | None:
    for candidate_name in (name, f"{name}.exe"):
        candidate = root / candidate_name
        if candidate.is_file():
            return candidate
    return None


def _resolve_tool_pair(
    explicit_root: Path | None,
    path_lookup: PathLookup,
) -> tuple[Path, Path]:
    if explicit_root is not None:
        root = explicit_root.resolve()
        ffmpeg_candidate = _find_in_root(root, "ffmpeg")
        ffprobe_candidate = _find_in_root(root, "ffprobe")
    else:
        ffmpeg_location = path_lookup("ffmpeg")
        ffprobe_location = path_lookup("ffprobe")
        ffmpeg_candidate = Path(ffmpeg_location) if ffmpeg_location else None
        ffprobe_candidate = Path(ffprobe_location) if ffprobe_location else None

    if ffmpeg_candidate is None or ffprobe_candidate is None:
        raise MediaToolchainError(
            MediaToolchainErrorCode.NOT_FOUND,
            "both ffmpeg and ffprobe are required",
        )

    try:
        ffmpeg_path = ffmpeg_candidate.resolve(strict=True)
        ffprobe_path = ffprobe_candidate.resolve(strict=True)
    except OSError as error:
        raise MediaToolchainError(
            MediaToolchainErrorCode.NOT_FOUND,
            "ffmpeg or ffprobe could not be resolved",
        ) from error

    if (
        not ffmpeg_path.is_file()
        or not ffprobe_path.is_file()
        or ffmpeg_path == ffprobe_path
        or ffmpeg_path.parent != ffprobe_path.parent
    ):
        raise MediaToolchainError(
            MediaToolchainErrorCode.INVALID_TOOL_PAIR,
            "ffmpeg and ffprobe must be distinct files in the same resolved directory",
        )
    return ffmpeg_path, ffprobe_path


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    except OSError as error:
        raise MediaToolchainError(
            MediaToolchainErrorCode.EXECUTION_FAILED,
            "media tool binary could not be read",
        ) from error
    return digest.hexdigest()


def _default_version_reader(path: Path) -> str:
    completed = subprocess.run(
        [str(path), "-version"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
        timeout=VERSION_TIMEOUT_SECONDS,
    )
    if len(completed.stdout) > MAX_VERSION_OUTPUT_BYTES:
        raise MediaToolchainError(
            MediaToolchainErrorCode.OUTPUT_LIMIT,
            "media tool version output exceeds the size limit",
        )
    return completed.stdout.decode("utf-8", errors="replace")


def _parse_version_output(output: str, tool_name: str) -> _ParsedVersion:
    if len(output.encode("utf-8")) > MAX_VERSION_OUTPUT_BYTES:
        raise MediaToolchainError(
            MediaToolchainErrorCode.OUTPUT_LIMIT,
            "media tool version output exceeds the size limit",
        )
    lines = output.splitlines()
    first_line = lines[0] if lines else ""
    match = re.match(rf"^{re.escape(tool_name)} version (?P<token>\S+)", first_line)
    if match is None:
        raise MediaToolchainError(
            MediaToolchainErrorCode.INVALID_VERSION_OUTPUT,
            f"{tool_name} returned an invalid version banner",
        )
    base_match = re.match(r"^(?P<base>[0-9]+\.[0-9]+\.[0-9]+)", match.group("token"))
    configuration_line = next(
        (
            line.removeprefix("configuration:").strip()
            for line in lines
            if line.startswith("configuration:")
        ),
        None,
    )
    if base_match is None or not configuration_line:
        raise MediaToolchainError(
            MediaToolchainErrorCode.INVALID_VERSION_OUTPUT,
            f"{tool_name} did not report a version and configure flags",
        )
    return _ParsedVersion(
        base_version=base_match.group("base"),
        configuration_flags=frozenset(configuration_line.split()),
    )


def _classify_license(
    configuration_flags: frozenset[str],
) -> Literal["LGPL", "GPL", "NONFREE"]:
    if "--enable-nonfree" in configuration_flags:
        return "NONFREE"
    if "--enable-gpl" in configuration_flags:
        return "GPL"
    return "LGPL"


def discover_media_toolchain(
    lock: MediaToolchainLockData,
    explicit_root: Path | None = None,
    *,
    path_lookup: PathLookup = shutil.which,
    version_reader: VersionReader = _default_version_reader,
) -> MediaToolchain:
    """Resolve, hash, execute, and validate one exact locked tool pair."""

    ffmpeg_path, ffprobe_path = _resolve_tool_pair(explicit_root, path_lookup)
    ffmpeg_sha256 = _file_sha256(ffmpeg_path)
    ffprobe_sha256 = _file_sha256(ffprobe_path)
    profile = next(
        (
            candidate
            for candidate in lock.profiles
            if candidate.ffmpeg_sha256 == ffmpeg_sha256
            and candidate.ffprobe_sha256 == ffprobe_sha256
        ),
        None,
    )
    if profile is None:
        raise MediaToolchainError(
            MediaToolchainErrorCode.UNLOCKED_BINARY,
            "the resolved media tool binaries are not present in the lock",
        )

    try:
        ffmpeg_output = version_reader(ffmpeg_path)
        ffprobe_output = version_reader(ffprobe_path)
    except MediaToolchainError:
        raise
    except subprocess.TimeoutExpired as error:
        raise MediaToolchainError(
            MediaToolchainErrorCode.TIMEOUT,
            "media tool version check timed out",
        ) from error
    except (subprocess.SubprocessError, OSError) as error:
        raise MediaToolchainError(
            MediaToolchainErrorCode.EXECUTION_FAILED,
            "media tool version check failed",
        ) from error

    ffmpeg_version = _parse_version_output(ffmpeg_output, "ffmpeg")
    ffprobe_version = _parse_version_output(ffprobe_output, "ffprobe")
    if ffmpeg_version.base_version != ffprobe_version.base_version:
        raise MediaToolchainError(
            MediaToolchainErrorCode.VERSION_MISMATCH,
            "ffmpeg and ffprobe report different versions",
        )
    if ffmpeg_version.base_version != lock.expected_version:
        raise MediaToolchainError(
            MediaToolchainErrorCode.UNPINNED_VERSION,
            "media tool version does not match the lock",
        )
    if ffmpeg_version.configuration_flags != ffprobe_version.configuration_flags:
        raise MediaToolchainError(
            MediaToolchainErrorCode.CONFIGURATION_MISMATCH,
            "ffmpeg and ffprobe report different configure flags",
        )
    license_class = _classify_license(ffmpeg_version.configuration_flags)
    if license_class != profile.license_class:
        raise MediaToolchainError(
            MediaToolchainErrorCode.LICENSE_MISMATCH,
            "media tool license classification does not match the lock",
        )

    return MediaToolchain(
        profile_id=profile.profile_id,
        version=ffmpeg_version.base_version,
        ffmpeg_path=ffmpeg_path,
        ffprobe_path=ffprobe_path,
        ffmpeg_sha256=ffmpeg_sha256,
        ffprobe_sha256=ffprobe_sha256,
        configuration_flags=tuple(sorted(ffmpeg_version.configuration_flags)),
        license_class=license_class,
        spdx_license=profile.spdx_license,
        distribution_status=profile.distribution_status,
    )


def assert_media_toolchain_release_packaging_allowed(toolchain: MediaToolchain) -> None:
    """Default-deny release packaging unless an LGPL profile has completed review."""

    if (
        toolchain.license_class != "LGPL"
        or toolchain.distribution_status != "RELEASE_LGPL_REVIEWED"
    ):
        raise MediaToolchainError(
            MediaToolchainErrorCode.RELEASE_PACKAGING_BLOCKED,
            "media toolchain cannot be bundled in a release without LGPL review evidence",
        )
