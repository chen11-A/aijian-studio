import hashlib
import json
import subprocess
from pathlib import Path

import aijian_api.media_toolchain as media_toolchain
import pytest
from aijian_api.media_toolchain import (
    MediaToolchainError,
    MediaToolchainErrorCode,
    MediaToolchainLockData,
    discover_media_toolchain,
    load_media_toolchain_lock,
)
from pydantic import ValidationError


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_fake_tools(root: Path) -> tuple[Path, Path]:
    root.mkdir(parents=True)
    ffmpeg = root / "ffmpeg"
    ffprobe = root / "ffprobe"
    ffmpeg.write_bytes(b"fake-ffmpeg-8.1.2")
    ffprobe.write_bytes(b"fake-ffprobe-8.1.2")
    return ffmpeg, ffprobe


def _lock_for(
    ffmpeg: Path,
    ffprobe: Path,
    *,
    license_class: str = "GPL",
    distribution_status: str = "DEVELOPMENT_ONLY",
) -> MediaToolchainLockData:
    return MediaToolchainLockData.model_validate(
        {
            "schema_version": 1,
            "expected_version": "8.1.2",
            "profiles": [
                {
                    "profile_id": "test-fixture",
                    "ffmpeg_sha256": _sha256(ffmpeg),
                    "ffprobe_sha256": _sha256(ffprobe),
                    "source_url": "https://example.invalid/ffmpeg",
                    "license_class": license_class,
                    "spdx_license": (
                        "LGPL-2.1-or-later" if license_class == "LGPL" else "GPL-3.0-or-later"
                    ),
                    "distribution_status": distribution_status,
                }
            ],
        }
    )


def _version_reader(
    *,
    ffmpeg_version: str = "8.1.2-full_build-test",
    ffprobe_version: str = "8.1.2-full_build-test",
    configuration: str = "--enable-gpl --enable-version3 --enable-libvpx",
):
    def read(path: Path) -> str:
        tool_version = ffprobe_version if path.name.startswith("ffprobe") else ffmpeg_version
        return (
            f"{path.stem} version {tool_version} Copyright test\n"
            f"configuration: {configuration}\n"
            "libavutil 60.26.102\n"
        )

    return read


def test_repository_lock_identifies_the_current_development_profile() -> None:
    repository_root = Path(__file__).resolve().parents[3]

    lock = load_media_toolchain_lock(repository_root / "config" / "media-toolchain-lock.json")

    assert lock.schema_version == 1
    assert lock.expected_version == "8.1.2"
    assert lock.profiles[0].profile_id == "windows-x86_64-gyan-full-8.1.2-dev"
    assert lock.profiles[0].license_class == "GPL"
    assert lock.profiles[0].distribution_status == "DEVELOPMENT_ONLY"


def test_discovery_accepts_only_the_exact_locked_tool_pair(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    toolchain = discover_media_toolchain(
        lock,
        explicit_root=ffmpeg.parent,
        version_reader=_version_reader(),
    )

    assert toolchain.profile_id == "test-fixture"
    assert toolchain.version == "8.1.2"
    assert toolchain.ffmpeg_path == ffmpeg.resolve()
    assert toolchain.ffprobe_path == ffprobe.resolve()
    assert toolchain.license_class == "GPL"
    assert toolchain.distribution_status == "DEVELOPMENT_ONLY"
    assert "--enable-gpl" in toolchain.configuration_flags


def test_discovery_can_resolve_the_locked_pair_from_path(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    toolchain = discover_media_toolchain(
        lock,
        path_lookup=lambda name: str(ffprobe if name == "ffprobe" else ffmpeg),
        version_reader=_version_reader(),
    )

    assert toolchain.ffmpeg_sha256 == _sha256(ffmpeg)
    assert toolchain.ffprobe_sha256 == _sha256(ffprobe)


def test_discovery_rejects_a_missing_or_incomplete_tool_pair(tmp_path: Path) -> None:
    empty_root = tmp_path / "empty"
    empty_root.mkdir()
    placeholder_ffmpeg, placeholder_ffprobe = _write_fake_tools(tmp_path / "placeholder")
    lock = _lock_for(placeholder_ffmpeg, placeholder_ffprobe)

    with pytest.raises(MediaToolchainError) as explicit_error:
        discover_media_toolchain(lock, explicit_root=empty_root)
    assert explicit_error.value.code is MediaToolchainErrorCode.NOT_FOUND

    with pytest.raises(MediaToolchainError) as path_error:
        discover_media_toolchain(lock, path_lookup=lambda _name: None)
    assert path_error.value.code is MediaToolchainErrorCode.NOT_FOUND


def test_discovery_rejects_tools_that_resolve_to_different_directories(tmp_path: Path) -> None:
    ffmpeg, _ = _write_fake_tools(tmp_path / "one")
    _, ffprobe = _write_fake_tools(tmp_path / "two")
    lock = _lock_for(ffmpeg, ffprobe)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(
            lock,
            path_lookup=lambda name: str(ffprobe if name == "ffprobe" else ffmpeg),
        )

    assert error.value.code is MediaToolchainErrorCode.INVALID_TOOL_PAIR


def test_discovery_rejects_a_pair_that_resolves_to_the_same_file(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(lock, path_lookup=lambda _name: str(ffmpeg))

    assert error.value.code is MediaToolchainErrorCode.INVALID_TOOL_PAIR


def test_discovery_normalizes_a_resolve_race(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)
    original_resolve = Path.resolve

    def failed_resolve(path: Path, *, strict: bool = False) -> Path:
        if path.name == "ffprobe":
            raise FileNotFoundError("simulated race")
        return original_resolve(path, strict=strict)

    monkeypatch.setattr(Path, "resolve", failed_resolve)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(
            lock,
            path_lookup=lambda name: str(ffprobe if name == "ffprobe" else ffmpeg),
        )

    assert error.value.code is MediaToolchainErrorCode.NOT_FOUND


def test_discovery_normalizes_a_binary_read_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)
    original_open = Path.open

    def failed_open(path: Path, *args, **kwargs):
        if path.name == "ffmpeg":
            raise PermissionError("simulated denial")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", failed_open)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(lock, explicit_root=ffmpeg.parent)

    assert error.value.code is MediaToolchainErrorCode.EXECUTION_FAILED


def test_discovery_rejects_an_unlocked_binary_before_executing_it(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)
    ffmpeg.write_bytes(b"tampered")
    executed = False

    def should_not_run(_path: Path) -> str:
        nonlocal executed
        executed = True
        return ""

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(lock, explicit_root=ffmpeg.parent, version_reader=should_not_run)

    assert error.value.code is MediaToolchainErrorCode.UNLOCKED_BINARY
    assert executed is False


@pytest.mark.parametrize(
    ("ffmpeg_version", "ffprobe_version", "expected_code"),
    [
        ("8.1.2-test", "8.0.3-test", MediaToolchainErrorCode.VERSION_MISMATCH),
        ("8.0.3-test", "8.0.3-test", MediaToolchainErrorCode.UNPINNED_VERSION),
        ("not-a-version", "not-a-version", MediaToolchainErrorCode.INVALID_VERSION_OUTPUT),
    ],
)
def test_discovery_rejects_mismatched_unpinned_or_invalid_versions(
    tmp_path: Path,
    ffmpeg_version: str,
    ffprobe_version: str,
    expected_code: MediaToolchainErrorCode,
) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(
            lock,
            explicit_root=ffmpeg.parent,
            version_reader=_version_reader(
                ffmpeg_version=ffmpeg_version,
                ffprobe_version=ffprobe_version,
            ),
        )

    assert error.value.code is expected_code


def test_discovery_rejects_a_license_profile_mismatch(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(
        ffmpeg,
        ffprobe,
        license_class="LGPL",
        distribution_status="RELEASE_REVIEW_REQUIRED",
    )

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(
            lock,
            explicit_root=ffmpeg.parent,
            version_reader=_version_reader(configuration="--enable-gpl --enable-version3"),
        )

    assert error.value.code is MediaToolchainErrorCode.LICENSE_MISMATCH


@pytest.mark.parametrize(
    ("license_class", "distribution_status", "configuration"),
    [
        ("LGPL", "RELEASE_REVIEW_REQUIRED", "--disable-gpl --enable-libvpx"),
        ("NONFREE", "DEVELOPMENT_ONLY", "--enable-gpl --enable-nonfree"),
    ],
)
def test_discovery_classifies_lgpl_and_nonfree_profiles(
    tmp_path: Path,
    license_class: str,
    distribution_status: str,
    configuration: str,
) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(
        ffmpeg,
        ffprobe,
        license_class=license_class,
        distribution_status=distribution_status,
    )

    toolchain = discover_media_toolchain(
        lock,
        explicit_root=ffmpeg.parent,
        version_reader=_version_reader(configuration=configuration),
    )

    assert toolchain.license_class == license_class


def test_discovery_rejects_different_configure_flags(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    def mismatched_reader(path: Path) -> str:
        configuration = "--enable-gpl --enable-version3"
        if path.name == "ffprobe":
            configuration += " --enable-libvpx"
        return _version_reader(configuration=configuration)(path)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(
            lock, explicit_root=ffmpeg.parent, version_reader=mismatched_reader
        )

    assert error.value.code is MediaToolchainErrorCode.CONFIGURATION_MISMATCH


@pytest.mark.parametrize(
    ("raised", "expected_code"),
    [
        (subprocess.TimeoutExpired(cmd=["ffmpeg"], timeout=10), MediaToolchainErrorCode.TIMEOUT),
        (
            subprocess.CalledProcessError(returncode=1, cmd=["ffmpeg"]),
            MediaToolchainErrorCode.EXECUTION_FAILED,
        ),
    ],
)
def test_discovery_normalizes_version_process_failures(
    tmp_path: Path,
    raised: Exception,
    expected_code: MediaToolchainErrorCode,
) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    def failed_reader(_path: Path) -> str:
        raise raised

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(lock, explicit_root=ffmpeg.parent, version_reader=failed_reader)

    assert error.value.code is expected_code


def test_discovery_rejects_oversized_version_output(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(
            lock,
            explicit_root=ffmpeg.parent,
            version_reader=lambda _path: "x" * (64 * 1024 + 1),
        )

    assert error.value.code is MediaToolchainErrorCode.OUTPUT_LIMIT


def test_discovery_rejects_a_version_banner_without_a_tool_name(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(
            lock,
            explicit_root=ffmpeg.parent,
            version_reader=lambda _path: "unexpected banner\nconfiguration: --enable-gpl\n",
        )

    assert error.value.code is MediaToolchainErrorCode.INVALID_VERSION_OUTPUT


def test_default_version_reader_uses_a_bounded_noninteractive_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)
    calls: list[tuple[list[str], dict[str, object]]] = []

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append((command, kwargs))
        tool_name = Path(command[0]).stem
        output = (
            f"{tool_name} version 8.1.2-test Copyright test\n"
            "configuration: --enable-gpl --enable-version3 --enable-libvpx\n"
        ).encode()
        return subprocess.CompletedProcess(command, 0, stdout=output)

    monkeypatch.setattr(media_toolchain.subprocess, "run", fake_run)

    discover_media_toolchain(lock, explicit_root=ffmpeg.parent)

    assert len(calls) == 2
    assert all(call[0][1] == "-version" for call in calls)
    assert all(call[1]["stdin"] is subprocess.DEVNULL for call in calls)
    assert all(call[1]["check"] is True for call in calls)


def test_default_version_reader_rejects_output_before_parsing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    lock = _lock_for(ffmpeg, ffprobe)

    def oversized_run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(command, 0, stdout=b"x" * (64 * 1024 + 1))

    monkeypatch.setattr(media_toolchain.subprocess, "run", oversized_run)

    with pytest.raises(MediaToolchainError) as error:
        discover_media_toolchain(lock, explicit_root=ffmpeg.parent)

    assert error.value.code is MediaToolchainErrorCode.OUTPUT_LIMIT


def test_lock_rejects_duplicate_profiles_and_gpl_release_claims(tmp_path: Path) -> None:
    ffmpeg, ffprobe = _write_fake_tools(tmp_path / "bin")
    valid = _lock_for(ffmpeg, ffprobe).model_dump(mode="json")
    valid["profiles"].append(dict(valid["profiles"][0]))

    with pytest.raises(ValidationError, match="profile IDs and hash pairs must be unique"):
        MediaToolchainLockData.model_validate(valid)

    invalid_release = _lock_for(ffmpeg, ffprobe).model_dump(mode="json")
    invalid_release["profiles"][0]["distribution_status"] = "RELEASE_REVIEW_REQUIRED"
    with pytest.raises(ValidationError, match="GPL and nonfree profiles are development-only"):
        MediaToolchainLockData.model_validate(invalid_release)


def test_lock_loader_rejects_oversized_or_invalid_json(tmp_path: Path) -> None:
    missing = tmp_path / "missing.json"
    with pytest.raises(MediaToolchainError) as missing_error:
        load_media_toolchain_lock(missing)
    assert missing_error.value.code is MediaToolchainErrorCode.LOCK_INVALID

    oversized = tmp_path / "oversized.json"
    oversized.write_text(" " * (1024 * 1024 + 1), encoding="utf-8")
    with pytest.raises(MediaToolchainError) as oversized_error:
        load_media_toolchain_lock(oversized)
    assert oversized_error.value.code is MediaToolchainErrorCode.LOCK_INVALID

    invalid = tmp_path / "invalid.json"
    invalid.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")
    with pytest.raises(MediaToolchainError) as invalid_error:
        load_media_toolchain_lock(invalid)
    assert invalid_error.value.code is MediaToolchainErrorCode.LOCK_INVALID
