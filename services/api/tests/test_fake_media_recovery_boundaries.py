"""Recovery and bounded IO use synthetic files/platform adapters, not media tools."""

import ctypes
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import fake_media_package as media


@pytest.mark.parametrize(
    "reader", [media._file_hash, media._binary_sha256, media._validate_image, media._validate_voice]
)
def test_missing_media_or_tool_is_rejected_without_creation(tmp_path, reader):
    path = tmp_path / "missing"
    with pytest.raises(media.FakeMediaPackageError):
        reader(path)
    assert not path.exists()


@pytest.mark.parametrize(
    "entry",
    [
        "_safe_workspace_root",
        "_safe_tool_root",
        "_require_internal_directory",
        "_require_plain_path",
    ],
)
def test_directory_admission_rejects_missing_paths(tmp_path, entry):
    function = getattr(media, entry)
    args = (tmp_path / "missing",)
    kwargs = {}
    if entry == "_require_internal_directory":
        args += (tmp_path,)
    elif entry == "_require_plain_path":
        kwargs = {"parent": tmp_path, "kind": "file"}
    with pytest.raises(media.FakeMediaPackageError):
        function(*args, **kwargs)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("stage", ["open", "times", "exit", "active", "exited"])
def test_windows_process_identity_closes_each_opened_handle(monkeypatch, stage):
    kernel = SimpleNamespace(
        OpenProcess=Mock(return_value=0 if stage == "open" else 123),
        GetProcessTimes=Mock(),
        GetExitCodeProcess=Mock(),
        CloseHandle=Mock(),
    )

    def get_times(handle, creation, *args):
        ticks = 116_444_736_000_000_000 + 12345
        creation._obj.dwHighDateTime = ticks >> 32
        creation._obj.dwLowDateTime = ticks & 0xFFFFFFFF
        return stage != "times"

    def get_exit(handle, code):
        code._obj.value = 259 if stage == "active" else 0
        return stage != "exit"

    kernel.GetProcessTimes.side_effect = get_times
    kernel.GetExitCodeProcess.side_effect = get_exit
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(kernel32=kernel))
    monkeypatch.setattr(media, "sys", SimpleNamespace(platform="win32"))
    result = media._windows_process_identity(321)
    if stage in {"open", "times", "exit"}:
        assert result is None
    else:
        assert result == (1_234_500, stage == "active")
    if stage == "open":
        kernel.CloseHandle.assert_not_called()
    else:
        kernel.CloseHandle.assert_called_once_with(123)


@pytest.mark.parametrize("error", [AttributeError, OSError, OverflowError])
def test_unknown_windows_process_identity_preserves_staging(monkeypatch, error):
    monkeypatch.setattr(media, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(media, "_windows_process_identity", Mock(side_effect=error("synthetic")))
    assert media._process_is_active(123, 456) is True


def test_missing_current_windows_identity_cannot_issue_lease(monkeypatch):
    monkeypatch.setattr(media, "os", SimpleNamespace(name="nt", getpid=lambda: 123))
    monkeypatch.setattr(media, "_windows_process_identity", lambda _: None)
    with pytest.raises(media.FakeMediaPackageError, match="start time is unavailable"):
        media._current_process_started_at_ns()


def posix_adapter(monkeypatch, *, kill_error=None, stat_error=None, boot="btime 100\n"):
    kill = Mock(side_effect=kill_error)
    monkeypatch.setattr(media, "os", SimpleNamespace(name="posix", getpid=lambda: 123, kill=kill))

    def path(value):
        if value == "/proc/stat":
            return Mock(read_text=Mock(return_value=boot))
        return Mock(
            read_text=Mock(
                return_value="123 (synthetic process) " + " ".join(["0"] * 19 + ["200"]),
                side_effect=stat_error,
            )
        )

    monkeypatch.setattr(media, "Path", path)
    monkeypatch.setattr(media, "_clock_ticks_per_second", lambda: 100)
    return kill


def test_posix_process_start_is_bound_to_boot_and_clock_ticks(monkeypatch):
    kill = posix_adapter(monkeypatch)
    assert media._current_process_started_at_ns() == 102_000_000_000
    assert media._process_is_active(123, 102_000_000_000) is True
    assert media._process_is_active(123, 103_000_000_000) is False
    assert kill.call_count == 2


@pytest.mark.parametrize(
    ("error", "active"), [(ProcessLookupError, False), (PermissionError, True)]
)
def test_posix_process_permission_is_not_mistaken_for_exit(monkeypatch, error, active):
    posix_adapter(monkeypatch, kill_error=error("synthetic"))
    assert media._process_is_active(123, 102_000_000_000) is active


@pytest.mark.parametrize("error", [OSError, ValueError, UnicodeError])
def test_posix_unreadable_identity_is_not_cleanup_authority(monkeypatch, error):
    posix_adapter(monkeypatch, stat_error=error("synthetic"))
    assert media._process_is_active(123, 102_000_000_000) is True
    with pytest.raises(media.FakeMediaPackageError, match="start time is unavailable"):
        media._current_process_started_at_ns()


def test_posix_missing_boot_time_is_not_cleanup_authority(monkeypatch):
    posix_adapter(monkeypatch, boot="cpu 0 0 0\n")
    assert media._process_is_active(123, 102_000_000_000) is True
    with pytest.raises(media.FakeMediaPackageError, match="start time is unavailable"):
        media._current_process_started_at_ns()


@pytest.mark.parametrize("kind", ["staging", "publish", "tree"])
def test_flush_failure_is_explicit_and_never_publishes(tmp_path, monkeypatch, kind):
    sentinel = tmp_path / "sentinel.bin"
    sentinel.write_bytes(b"preserve")
    monkeypatch.setattr(media, "_current_process_started_at_ns", lambda: 12345)
    monkeypatch.setattr(media.os, "fsync", Mock(side_effect=OSError("synthetic flush")))
    with pytest.raises(media.FakeMediaPackageError):
        if kind == "staging":
            media._write_staging_lease(tmp_path)
        elif kind == "publish":
            media._write_publish_lease(tmp_path, tmp_path / (media.STAGING_PREFIX + "sample"))
        else:
            media._flush_staging_tree(tmp_path)
    assert sentinel.read_bytes() == b"preserve"


@pytest.mark.parametrize("payload", [b"{bad", b"{}"])
def test_corrupt_lease_has_no_active_identity(tmp_path, payload):
    path = tmp_path / media.STAGING_LEASE_NAME
    path.write_bytes(payload)
    assert media._read_active_lease(path, tmp_path) is None
    assert path.read_bytes() == payload


@pytest.mark.parametrize("kind", ["listing", "lease_unlink", "tree_remove"])
def test_cleanup_io_failure_preserves_unrelated_files(tmp_path, monkeypatch, kind):
    sentinel = tmp_path / "unrelated.txt"
    sentinel.write_bytes(b"preserve")
    if kind == "listing":
        root = Mock(iterdir=Mock(side_effect=OSError("synthetic listing")))
    elif kind == "lease_unlink":
        root = tmp_path
        lease = root / (media.STAGING_PREFIX + "sample" + media.PUBLISH_LEASE_SUFFIX)
        lease.write_bytes(b"{}")
        original = Path.unlink

        def unlink(path, *args, **kwargs):
            if path == lease:
                raise OSError("synthetic lease deletion failure")
            return original(path, *args, **kwargs)

        monkeypatch.setattr(Path, "unlink", unlink)
    else:
        root = tmp_path
        staging = root / (media.STAGING_PREFIX + "sample")
        staging.mkdir()
        (staging / media.STAGING_LEASE_NAME).write_bytes(b"{bad")
        os.utime(staging, (1, 1))
        monkeypatch.setattr(media.shutil, "rmtree", Mock(side_effect=OSError("synthetic deletion")))
    with pytest.raises(media.FakeMediaPackageError):
        media._cleanup_stale_staging_in_lock(root)
    assert sentinel.read_bytes() == b"preserve"


@pytest.mark.parametrize("failure", ["spawn", "terminate_timeout"])
def test_encoder_process_boundary_is_bounded_without_starting_encoder(monkeypatch, failure):
    process = Mock(returncode=None)
    process.poll.return_value = None
    process.wait.side_effect = [subprocess.TimeoutExpired("synthetic", 0.5), 0]
    spawn = Mock(
        return_value=process, side_effect=OSError("synthetic") if failure == "spawn" else None
    )
    monkeypatch.setattr(media.subprocess, "Popen", spawn)
    with pytest.raises(media.FakeMediaPackageError):
        media._run_ffmpeg(SimpleNamespace(ffmpeg_path=Path("not-an-executable")), [], lambda: True)
    spawn.assert_called_once()
    if failure == "terminate_timeout":
        process.terminate.assert_called_once()
        process.kill.assert_called_once()
        assert process.wait.call_count == 2
