"""Deterministic cleanup and descriptor checks, not native loader acceptance."""

import ctypes
import io
import os
import sys
import threading
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import external_media_process as external
from test_external_media_boundaries import ApiFunction
from test_external_media_process import FakeManager, FakeProcess


@pytest.fixture
def runner(monkeypatch, tmp_path):
    process = FakeProcess()
    manager = FakeManager(process)
    readers = []

    class Reader:
        def __init__(self, target, args, kwargs, **_):
            self.call = lambda: target(*args, **kwargs)
            self.ident = None
            self.alive = False
            self.on_join = False
            readers.append(self)

        def start(self):
            self.ident = 1
            if not self.on_join:
                self.call()

        def join(self, timeout):
            assert timeout >= 0
            if self.on_join:
                self.on_join = False
                self.call()

        def is_alive(self):
            return self.alive

    monkeypatch.setattr(
        external,
        "threading",
        SimpleNamespace(Thread=Reader, Lock=threading.Lock, Event=threading.Event),
    )
    monkeypatch.setattr(external, "guarded_external_pair", lambda _: nullcontext())
    monkeypatch.setattr(
        external, "external_process_session", lambda: nullcontext((tmp_path / "session", {}))
    )
    monkeypatch.setattr(external, "ProductExportJobManager", lambda: manager)
    return process, manager, readers, Reader


@pytest.mark.parametrize("owned", [False, True])
def test_spawn_failure_closes_only_owned_manager(runner, owned):
    _process, manager, _readers, _reader_type = runner
    manager.spawn = Mock(side_effect=OSError("synthetic launch failure"))
    with pytest.raises(OSError, match="synthetic launch failure"):
        external.run_external_command(
            Path("tools/ffmpeg.exe"), (), 1, manager=None if owned else manager
        )
    assert manager.shutdowns == int(owned)
    assert manager.releases == 0


def test_cancel_before_spawn_does_not_acquire_process(runner):
    _process, manager, _readers, _reader_type = runner
    with pytest.raises(external.ExternalMediaProcessError, match="interrupted"):
        external.run_external_command(Path("tools/ffmpeg.exe"), (), 1, stop_requested=lambda: True)
    assert manager.calls == [] and manager.shutdowns == manager.releases == 0


@pytest.mark.parametrize("nested", [False, True])
def test_session_cannot_overlap_selected_tools(runner, monkeypatch, tmp_path, nested):
    _process, manager, _readers, _reader_type = runner
    root = tmp_path / "tools"
    cwd = root / "child" if nested else root
    monkeypatch.setattr(external, "external_process_session", lambda: nullcontext((cwd, {})))
    with pytest.raises(external.ExternalMediaProcessError, match="overlaps"):
        external.run_external_command(root / "ffmpeg.exe", (), 1)
    assert manager.calls == []


@pytest.mark.parametrize("late", [False, True])
@pytest.mark.parametrize("kind", ["read_oserror", "read_valueerror", "output_limit"])
def test_reader_failure_is_checked_before_and_after_process_exit(runner, late, kind):
    process, manager, _readers, reader_type = runner
    original_init = reader_type.__init__

    def initialize(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.on_join = late

    reader_type.__init__ = initialize
    if kind == "output_limit":
        process.stdout = io.BytesIO(b"12345")
        error_type = external.ExternalMediaOutputLimitError
    else:
        process.stdout = Mock()
        process.stdout.read.side_effect = (
            OSError("private detail") if kind == "read_oserror" else ValueError("private detail")
        )
        error_type = external.ExternalMediaProcessError
    with pytest.raises(error_type) as error:
        external.run_external_command(Path("tools/ffmpeg.exe"), (), 1, max_output_bytes=4)
    assert "private detail" not in str(error.value)
    assert process.closed and manager.releases == manager.shutdowns == 1


def test_unfinished_output_reader_rejects_success(runner):
    process, manager, _readers, reader_type = runner
    original_init = reader_type.__init__

    def initialize(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.alive = True

    reader_type.__init__ = initialize
    with pytest.raises(external.ExternalMediaProcessError, match="readers did not stop"):
        external.run_external_command(Path("tools/ffmpeg.exe"), (), 1)
    assert process.closed and manager.releases == manager.shutdowns == 1


def test_thread_start_failure_still_releases_process(runner):
    process, manager, _readers, reader_type = runner
    reader_type.start = Mock(side_effect=RuntimeError("thread unavailable"))
    with pytest.raises(RuntimeError, match="thread unavailable"):
        external.run_external_command(Path("tools/ffmpeg.exe"), (), 1)
    assert process.closed and manager.releases == manager.shutdowns == 1


@pytest.mark.parametrize(
    "fault",
    [
        "status",
        "descriptor",
        "dacl",
        "owner",
        "sid",
        "control_api",
        "revision",
        "serialize",
        "null_text",
        "zero_length",
        "long_length",
    ],
)
def test_unverifiable_security_descriptor_rejects_and_frees_allocations(monkeypatch, fault):
    freed = []
    text = ctypes.create_unicode_buffer("D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)")

    def assign(pointer, value, ctype=ctypes.c_void_p):
        ctypes.cast(pointer, ctypes.POINTER(ctype)).contents.value = value

    def security(handle, kind, information, owner, group, dacl, sacl, descriptor):
        assert (handle, kind, information, group, sacl) == (501, 1, 5, None, None)
        for name, pointer, value in (
            ("owner", owner, 11),
            ("dacl", dacl, 12),
            ("descriptor", descriptor, 13),
        ):
            assign(pointer, 0 if fault == name else value)
        return 1 if fault == "status" else 0

    def control(_descriptor, flags, revision):
        assign(flags, 0x1004, external.wintypes.WORD)
        assign(revision, 2 if fault == "revision" else 1, external.wintypes.DWORD)
        return fault != "control_api"

    def serialize(_descriptor, revision, information, pointer, length):
        assert (revision, information) == (1, 4)
        assign(pointer, 0 if fault == "null_text" else ctypes.addressof(text))
        size = {"zero_length": 0, "long_length": 1025}.get(fault, len(text))
        assign(length, size, external.wintypes.DWORD)
        return fault != "serialize"

    api = SimpleNamespace(LocalFree=lambda p: freed.append(p.value))
    advapi = SimpleNamespace(
        GetSecurityInfo=ApiFunction(security),
        IsValidSid=ApiFunction(lambda _: fault != "sid"),
        GetSecurityDescriptorControl=ApiFunction(control),
        ConvertSecurityDescriptorToStringSecurityDescriptorW=ApiFunction(serialize),
    )
    monkeypatch.setattr(external, "_windows_dll", lambda _: advapi)
    monkeypatch.setattr(external, "_require_persistent_acls", lambda *_: None)
    with pytest.raises(external.ExternalMediaProcessError):
        external._verify_private_directory_security(api, 501)
    serialized = fault in {"serialize", "zero_length", "long_length"}
    assert freed == ([ctypes.addressof(text)] if serialized else []) + (
        [] if fault == "descriptor" else [13]
    )


@pytest.mark.parametrize("available", [False, True])
def test_windows_loader_is_required_and_receives_last_error_mode(monkeypatch, available):
    loader = Mock(return_value=object())
    monkeypatch.setattr(
        external,
        "ctypes",
        SimpleNamespace(WinDLL=loader, CDLL=ctypes.CDLL) if available else SimpleNamespace(),
    )
    if available:
        assert external._windows_dll("kernel32") is loader.return_value
        loader.assert_called_once_with("kernel32", use_last_error=True)
    else:
        with pytest.raises(external.ExternalMediaProcessError, match="requires Windows"):
            external._windows_dll("kernel32")


def test_api_initializes_signatures_only_on_windows(monkeypatch):
    loader = Mock()
    monkeypatch.setattr(external, "_windows_dll", loader)
    monkeypatch.setattr(external, "os", SimpleNamespace(name="posix"))
    with pytest.raises(external.ExternalMediaProcessError, match="requires Windows"):
        external._api()
    loader.assert_not_called()
    monkeypatch.setattr(external, "os", SimpleNamespace(name="nt"))
    assert external._api() is loader.return_value
    assert loader.return_value.CreateFileW.argtypes[0] is external.wintypes.LPCWSTR


@pytest.mark.parametrize("kind", ["invalid", "missing_conversion", "fdopen_failure", "success"])
def test_executable_handle_ownership_closes_exactly_once(monkeypatch, tmp_path, kind):
    source = tmp_path / "stand-in.bin"
    source.write_bytes(b"synthetic bytes only")
    descriptor = None
    converted = Mock()
    if kind in {"fdopen_failure", "success"}:
        descriptor = os.open(source, os.O_RDONLY | os.O_BINARY)
        converted.return_value = descriptor
    monkeypatch.setitem(
        sys.modules,
        "msvcrt",
        SimpleNamespace(open_osfhandle=converted if kind != "missing_conversion" else None),
    )
    api = SimpleNamespace(
        CreateFileW=Mock(return_value=None if kind == "invalid" else 55), CloseHandle=Mock()
    )
    monkeypatch.setattr(external, "_check_handle", lambda *_args, **_kwargs: None)
    if kind == "fdopen_failure":
        monkeypatch.setattr(
            external,
            "os",
            SimpleNamespace(
                O_BINARY=os.O_BINARY,
                O_RDONLY=os.O_RDONLY,
                close=os.close,
                fdopen=Mock(side_effect=OSError("synthetic fdopen failure")),
            ),
        )
    if kind == "success":
        with external._hold_executable(api, source) as stream:
            assert stream.read() == b"synthetic bytes only"
    else:
        with pytest.raises(OSError):
            with external._hold_executable(api, source):
                pytest.fail("invalid handle cannot escape")
    assert api.CloseHandle.call_count == int(kind == "missing_conversion")
    if descriptor is not None:
        with pytest.raises(OSError):
            os.fstat(descriptor)


@pytest.mark.parametrize("kind", ["windows_path", "nonempty", "success"])
def test_private_session_rejects_unverified_directory_and_cleans_only_own_temp(
    monkeypatch, tmp_path, kind
):
    from contextlib import contextmanager

    def windows(buffer, _size):
        buffer.value = r"C:\Windows"
        return 0 if kind == "windows_path" else len(buffer.value)

    @contextmanager
    def held(_api, _path, **_kwargs):
        yield 1

    def create(_api, path):
        path.mkdir()
        if kind == "nonempty":
            (path / "unexpected").write_bytes(b"synthetic")

    monkeypatch.setattr(external, "_api", lambda: SimpleNamespace(GetWindowsDirectoryW=windows))
    monkeypatch.setattr(external, "_known_local_app_data", lambda: tmp_path)
    monkeypatch.setattr(external, "_hold_directory_chain", held)
    monkeypatch.setattr(external, "_hold_directory", held)
    monkeypatch.setattr(external, "_require_persistent_acls", lambda *_: None)
    monkeypatch.setattr(external, "_verify_private_directory_security", lambda *_: None)
    monkeypatch.setattr(external, "_create_private_directory", create)
    sentinel = tmp_path / "preserve"
    sentinel.write_bytes(b"unrelated synthetic bytes")
    if kind == "success":
        with external.external_process_session() as (directory, env):
            assert directory.parent == tmp_path and directory.is_dir()
            assert env["TEMP"] == env["TMP"] == str(directory)
    else:
        with pytest.raises(external.ExternalMediaProcessError):
            with external.external_process_session():
                pytest.fail("unsafe session cannot escape")
    assert list(tmp_path.iterdir()) == [sentinel]
