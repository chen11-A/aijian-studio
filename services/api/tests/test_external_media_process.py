"""Host-safe security tests; real Windows race/loader acceptance is separate."""

import io
import struct
from pathlib import Path, PureWindowsPath

import pytest
from aijian_api import external_media_process as external


@pytest.mark.parametrize(
    "path",
    [
        "ffmpeg",
        "C:relative",
        r"\\server\tools",
        r"\\?\C:\tools",
        r"\\.\C:\tools",
        r"C:\tools\..\bin",
        r"C:\tools:stream",
        "C:\\tools\\bad. ",
        r"C:\NUL\bin",
        r"C:\tools\file.exe:stream",
        "C:\\tools\\a\x01",
        r"C:\tools\?bad",
        r"C:\tools\CON.txt",
    ],
)
def test_external_root_syntax_rejects_ambiguous_or_special_paths(path):
    with pytest.raises(external.ExternalMediaProcessError):
        external._validate_path_syntax(path)


def test_external_root_syntax_allows_unicode_and_spaces():
    path = r"D:\本地 媒体\ffmpeg\bin"
    assert external._validate_path_syntax(path) == PureWindowsPath(path)


def _pe(imports=("KERNEL32.dll",), delayed=()):
    data = bytearray(4096)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<HH", data, 0x84, 0x8664, 1)
    struct.pack_into("<H", data, 0x94, 240)
    struct.pack_into("<H", data, 0x96, 0x22)
    optional = 0x98
    struct.pack_into("<H", data, optional, 0x20B)
    struct.pack_into("<Q", data, optional + 24, 0x140000000)
    struct.pack_into("<I", data, optional + 60, 0x200)
    struct.pack_into("<I", data, optional + 108, 16)
    section = optional + 240
    struct.pack_into("<IIII", data, section + 8, 0xE00, 0x1000, 0xE00, 0x200)
    next_name = 0x900
    for names, index, start, size in [(imports, 1, 0x300, 20), (delayed, 13, 0x600, 32)]:
        if not names:
            continue
        struct.pack_into(
            "<II", data, optional + 112 + index * 8, start + 0xE00, (len(names) + 1) * size
        )
        for i, name in enumerate(names):
            offset = start + i * size
            name_bytes = name.encode("ascii") + b"\0"
            data[next_name : next_name + len(name_bytes)] = name_bytes
            if index == 13:
                struct.pack_into("<I", data, offset, 1)
            struct.pack_into("<I", data, offset + (12 if index == 1 else 4), next_name + 0xE00)
            next_name += len(name_bytes)
    return data


def test_pe_imports_and_delay_imports_are_both_checked():
    assert external._pe_dependencies(io.BytesIO(_pe(delayed=("bcrypt.dll",)))) == {
        "kernel32.dll",
        "bcrypt.dll",
    }
    with pytest.raises(external.ExternalMediaProcessError, match="dependency"):
        external._validate_pe_dependencies(io.BytesIO(_pe(delayed=("evil.dll",))))


@pytest.mark.parametrize("mutation", ["truncated", "x86", "bad_rva", "path_name", "delay_va"])
def test_pe_parser_fails_closed(mutation):
    data = _pe(delayed=("bcrypt.dll",))
    if mutation == "truncated":
        data = data[:200]
    elif mutation == "x86":
        struct.pack_into("<H", data, 0x84, 0x14C)
    elif mutation == "bad_rva":
        struct.pack_into("<I", data, 0x300 + 12, 0xFFFFF000)
    elif mutation == "path_name":
        data = _pe(imports=(r"C:\evil.dll",))
    elif mutation == "delay_va":
        struct.pack_into("<I", data, 0x600, 0)
    with pytest.raises(external.ExternalMediaProcessError):
        external._validate_pe_dependencies(io.BytesIO(data))


@pytest.mark.parametrize("name", ["KERNEL32.DLL", "ffmpeg.exe.local", "ffprobe.exe.manifest"])
def test_app_local_loader_inputs_rejected(tmp_path, name):
    (tmp_path / name).touch()
    with pytest.raises(external.ExternalMediaProcessError, match="app-local"):
        external._reject_app_local_dependencies(tmp_path)


def test_local_redirection_directory_rejected(tmp_path):
    (tmp_path / "ffmpeg.exe.local").mkdir()
    with pytest.raises(external.ExternalMediaProcessError):
        external._reject_app_local_dependencies(tmp_path)


def test_environment_is_os_derived_and_does_not_inherit(monkeypatch):
    for name in ("PATH", "COMSPEC", "PATHEXT", "FFREPORT", "HOME", "USERPROFILE", "SYSTEMROOT"):
        monkeypatch.setenv(name, "ATTACKER")
    env = external._minimal_environment(PureWindowsPath(r"C:\Windows"), Path("private-session"))
    assert set(env) == {"SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "TEMP", "TMP"}
    assert "ATTACKER" not in env.values()
    assert env["SYSTEMROOT"] == r"C:\Windows"
    assert env["TEMP"] == env["TMP"] == "private-session"


def test_non_windows_execution_fails_before_spawning(monkeypatch):
    if external.os.name == "nt":
        pytest.skip("Host-specific negative check")
    with pytest.raises(external.ExternalMediaProcessError, match="Windows"):
        with external.guarded_external_pair(Path("/tmp/tools")):
            pytest.fail("must never yield")


class FakeProcess:
    def __init__(self, output=b"result", stderr=b"", running=False, returncode=0):
        self.stdout = io.BytesIO(output)
        self.stderr = io.BytesIO(stderr)
        self.running = running
        self.returncode = returncode
        self.terminated = False
        self.closed = False

    def poll(self):
        return None if self.running else self.returncode

    def terminate(self):
        self.running = False
        self.terminated = True

    def wait(self, timeout=None):
        assert not self.running
        return self.returncode

    def close(self):
        assert not self.running
        self.stdout.close()
        self.stderr.close()
        self.closed = True


class FakeManager:
    def __init__(self, process):
        self.process = process
        self.calls = []
        self.shutdowns = 0
        self.releases = 0

    def spawn(self, executable, arguments, **kwargs):
        self.calls.append((executable, arguments, kwargs))
        return self.process

    def release(self, process):
        assert process is self.process
        self.releases += 1
        process.close()

    def shutdown_and_wait(self):
        self.shutdowns += 1


@pytest.fixture
def fake_boundaries(monkeypatch, tmp_path):
    from contextlib import contextmanager

    state = []
    cwd = tmp_path / "private"
    cwd.mkdir()

    @contextmanager
    def pair(root):
        state.append("pair-held")
        try:
            yield
        finally:
            state.append("pair-released")

    @contextmanager
    def session():
        assert state[-1] == "pair-held"
        state.append("session-open")
        try:
            yield cwd, {"TEMP": str(cwd)}
        finally:
            state.append("session-closed")

    monkeypatch.setattr(external, "guarded_external_pair", pair)
    monkeypatch.setattr(external, "external_process_session", session)
    return state


def test_runner_keeps_guards_until_process_release(fake_boundaries):
    process = FakeProcess(stderr=b"normal informational banner")
    manager = FakeManager(process)
    assert (
        external.run_external_command(Path("/tools/ffprobe.exe"), ("-version",), 1, manager=manager)
        == b"result"
    )
    assert manager.calls[0][2]["hardened_external_media"] is True
    assert process.closed and manager.releases == 1 and manager.shutdowns == 0
    assert fake_boundaries == ["pair-held", "session-open", "session-closed", "pair-released"]


@pytest.mark.parametrize("stream", ["stdout", "stderr", "combined"])
def test_runner_bounds_both_streams_before_return(fake_boundaries, stream):
    process = FakeProcess(
        output=b"x" * (9 if stream != "stderr" else 0),
        stderr=b"x" * (9 if stream != "stdout" else 0),
        running=True,
    )
    manager = FakeManager(process)
    limit = 16 if stream == "combined" else 8
    with pytest.raises(external.ExternalMediaOutputLimitError):
        external.run_external_command(
            Path("/tools/ffprobe.exe"), (), 1, manager=manager, max_output_bytes=limit
        )
    assert process.terminated and process.closed and manager.releases == 1


def test_runner_timeout_terminates_job_and_releases(fake_boundaries):
    import subprocess

    process = FakeProcess(running=True)
    manager = FakeManager(process)
    with pytest.raises(subprocess.TimeoutExpired):
        external.run_external_command(Path("/tools/ffprobe.exe"), (), 0.001, manager=manager)
    assert process.terminated and process.closed


def test_runner_cancellation_terminates_job_and_releases(fake_boundaries):
    checks = iter((False, True))
    process = FakeProcess(running=True)
    manager = FakeManager(process)
    with pytest.raises(external.ExternalMediaProcessError, match="interrupted"):
        external.run_external_command(
            Path("/tools/ffprobe.exe"), (), 1, manager=manager, stop_requested=lambda: next(checks)
        )
    assert process.terminated and process.closed


def test_runner_nonzero_does_not_disclose_output(fake_boundaries):
    import subprocess

    process = FakeProcess(output=b"SECRET source path", stderr=b"SECRET diagnostics", returncode=3)
    manager = FakeManager(process)
    with pytest.raises(subprocess.CalledProcessError) as error:
        external.run_external_command(Path("/tools/ffprobe.exe"), (), 1, manager=manager)
    assert "SECRET" not in str(error.value)
    assert error.value.output is None and error.value.stderr is None
    assert process.closed


def test_runner_owned_manager_shutdown(fake_boundaries, monkeypatch):
    manager = FakeManager(FakeProcess())
    monkeypatch.setattr(external, "ProductExportJobManager", lambda: manager)
    assert external.run_external_command(Path("/tools/ffmpeg.exe"), ("-version",), 1) == b"result"
    assert manager.releases == manager.shutdowns == 1


def test_pair_hashes_both_before_yield_and_holds_all_handles(monkeypatch):
    from contextlib import contextmanager

    state = []

    @contextmanager
    def directories(_api, root):
        state.append("ancestors-held")
        try:
            yield
        finally:
            state.append("ancestors-released")

    @contextmanager
    def executable(_api, path):
        state.append(path.name + "-held")
        try:
            yield io.BytesIO(path.name.encode())
        finally:
            state.append(path.name + "-released")

    def hash_stream(stream):
        state.append(stream.getvalue().decode() + "-hashed")
        return {
            b"ffmpeg.exe": external.PINNED_FFMPEG_SHA256,
            b"ffprobe.exe": external.PINNED_FFPROBE_SHA256,
        }[stream.getvalue()]

    monkeypatch.setattr(external, "_api", lambda: object())
    monkeypatch.setattr(external, "_hold_directory_chain", directories)
    monkeypatch.setattr(external, "_hold_executable", executable)
    monkeypatch.setattr(external, "_hash_stream", hash_stream)
    monkeypatch.setattr(external, "_validate_pe_dependencies", lambda stream: None)
    monkeypatch.setattr(external, "_reject_app_local_dependencies", lambda root: None)
    with external.guarded_external_pair(Path(r"C:\tools")) as pair:
        assert pair.profile_id == external.PINNED_PROFILE_ID
        assert state == [
            "ancestors-held",
            "ffmpeg.exe-held",
            "ffprobe.exe-held",
            "ffmpeg.exe-hashed",
            "ffprobe.exe-hashed",
        ]
    assert state[-3:] == ["ffprobe.exe-released", "ffmpeg.exe-released", "ancestors-released"]


def test_mismatched_pair_never_yields(monkeypatch):
    from contextlib import nullcontext

    monkeypatch.setattr(external, "_api", lambda: object())
    monkeypatch.setattr(external, "_hold_directory_chain", lambda *_: nullcontext())
    monkeypatch.setattr(external, "_hold_executable", lambda *_: nullcontext(io.BytesIO(b"wrong")))
    with pytest.raises(external.ExternalMediaProcessError, match="pinned pair"):
        with external.guarded_external_pair(Path(r"C:\tools")):
            pytest.fail("must not run version before verification")


@pytest.mark.parametrize(
    "attributes,links,file_type", [(0x400, 1, 1), (0x10, 1, 1), (0, 2, 1), (0, 1, 3)]
)
def test_executable_handle_rejects_reparse_directory_hardlink_or_pipe(attributes, links, file_type):
    import ctypes

    class API:
        def GetFileInformationByHandle(self, handle, information):
            info = ctypes.cast(information, ctypes.POINTER(external._FileInformation)).contents
            info.dwFileAttributes = attributes
            info.nNumberOfLinks = links
            info.nFileSizeLow = 10
            return True

        def GetFileType(self, handle):
            return file_type

    with pytest.raises(external.ExternalMediaProcessError, match="plain single-link"):
        external._check_handle(API(), 10, Path(r"C:\tools\ffmpeg.exe"), directory=False)


def test_directory_lock_denies_delete_and_releases_on_failure(monkeypatch):
    calls = []

    class API:
        def CreateFileW(self, *args):
            calls.append(args)
            return 15

        def CloseHandle(self, handle):
            calls.append(("close", handle))

    def reject(*args, **kwargs):
        raise external.ExternalMediaProcessError("unsafe directory")

    monkeypatch.setattr(external, "_check_handle", reject)
    with pytest.raises(external.ExternalMediaProcessError):
        with external._hold_directory(API(), Path(r"C:\tools")):
            pytest.fail("must not yield")
    assert calls[0][1] & 1  # FILE_LIST_DIRECTORY participates in sharing checks.
    assert calls[0][2] == 1  # Read-only sharing excludes WRITE (2) and DELETE (4).
    assert calls[0][5] & 0x00200000  # OPEN_REPARSE_POINT
    assert calls[-1] == ("close", 15)


@pytest.mark.parametrize("drive_type", [0, 1, 4, 5, 6])
def test_root_rejects_nonlocal_or_unknown_volume(drive_type):
    from types import SimpleNamespace

    api = SimpleNamespace(GetDriveTypeW=lambda path: drive_type)
    with pytest.raises(external.ExternalMediaProcessError, match="local disk"):
        external._check_volume(api, Path(r"C:\tools"))


def _job_api(monkeypatch, tmp_path, reject_mitigation=False):
    import ctypes
    import os
    import sys
    from types import SimpleNamespace

    from aijian_api import product_export_windows_job as jobs

    events = []

    class API:
        def CreateJobObjectW(self, *_):
            return 100

        def SetInformationJobObject(self, *_):
            return True

        def InitializeProcThreadAttributeList(self, attrs, count, flags, size):
            events.append(("attributes", count))
            ctypes.cast(size, ctypes.POINTER(ctypes.c_size_t)).contents.value = 256
            return True

        def UpdateProcThreadAttribute(self, attrs, flags, attribute, value, size, *_):
            if attribute == jobs._MITIGATION_POLICY:
                mitigation = ctypes.cast(value, ctypes.POINTER(ctypes.c_uint64)).contents.value
                events.append(("mitigation", mitigation))
                return not reject_mitigation
            return True

        def CreateProcessW(self, *args):
            events.append(("create",))
            info = ctypes.cast(args[-1], ctypes.POINTER(jobs._ProcessInfo)).contents
            info.hProcess, info.hThread, info.dwProcessId = 101, 102, 999
            return True

        def IsProcessInJob(self, process, job, result):
            ctypes.cast(result, ctypes.POINTER(jobs.wintypes.BOOL)).contents.value = True
            return True

        def ResumeThread(self, thread):
            events.append(("resume",))
            return 1

        def CloseHandle(self, handle):
            events.append(("close", handle))
            return True

        def DeleteProcThreadAttributeList(self, *_):
            pass

        def WaitForSingleObject(self, *_):
            return 0

        def QueryInformationJobObject(self, job, kind, accounting, size, written):
            ctypes.cast(accounting, ctypes.POINTER(jobs._Accounting)).contents.ActiveProcesses = 0
            return True

        def GetExitCodeProcess(self, process, code):
            ctypes.cast(code, ctypes.POINTER(jobs.wintypes.DWORD)).contents.value = 0
            return True

    fake_os = SimpleNamespace(
        **{
            name: getattr(os, name)
            for name in ("devnull", "open", "O_RDONLY", "pipe", "close", "fdopen")
        },
        name="nt",
        set_handle_inheritable=os.set_inheritable,
    )
    monkeypatch.setattr(jobs, "os", fake_os)
    monkeypatch.setattr(jobs, "_api", lambda: API())
    monkeypatch.setattr(jobs, "_winerror", lambda stage: jobs.ProductExportJobError(stage))
    monkeypatch.setitem(sys.modules, "msvcrt", SimpleNamespace(get_osfhandle=lambda fd: fd))
    executable = tmp_path / "ffmpeg.exe"
    executable.touch()
    return jobs, executable, events


@pytest.mark.parametrize("hardened", [False, True])
def test_job_mitigation_is_opt_in_and_before_create_and_resume(monkeypatch, tmp_path, hardened):
    jobs, executable, events = _job_api(monkeypatch, tmp_path)
    process = jobs.spawn_product_export_job(
        executable, (), cwd=tmp_path, env={}, hardened_external_media=hardened
    )
    process.close()
    assert ("attributes", 3 if hardened else 2) in events
    if hardened:
        mitigation = ("mitigation", (1 << 44) | (1 << 52) | (1 << 56) | (1 << 60))
        assert events.index(mitigation) < events.index(("create",)) < events.index(("resume",))
    else:
        assert not any(event[0] == "mitigation" for event in events)


def test_job_unsupported_mitigation_fails_before_process_creation(monkeypatch, tmp_path):
    jobs, executable, events = _job_api(monkeypatch, tmp_path, reject_mitigation=True)
    with pytest.raises(jobs.ProductExportJobError, match="image loading"):
        jobs.spawn_product_export_job(
            executable, (), cwd=tmp_path, env={}, hardened_external_media=True
        )
    assert ("create",) not in events and ("resume",) not in events
    assert ("close", 100) in events


def test_manager_only_forwards_new_keyword_when_enabled(monkeypatch, tmp_path):
    from aijian_api import product_export_windows_job as jobs

    calls = []
    process = FakeProcess()

    def spawn(*args, **kwargs):
        calls.append(kwargs)
        return process

    monkeypatch.setattr(jobs, "spawn_product_export_job", spawn)
    manager = jobs.ProductExportJobManager()
    for hardened in (False, True):
        manager.spawn(
            tmp_path / "ffmpeg.exe", (), cwd=tmp_path, env={}, hardened_external_media=hardened
        )
    assert "hardened_external_media" not in calls[0]
    assert calls[1]["hardened_external_media"] is True
    manager.release(process)


@pytest.mark.parametrize(
    "arguments", [("-v", "error", "-show_streams"), ("-version", "-i", "user-media"), ()]
)
def test_runner_rejects_success_with_probe_diagnostics(fake_boundaries, arguments):
    manager = FakeManager(FakeProcess(output=b'{"streams": []}', stderr=b"decode error"))
    with pytest.raises(external.ExternalMediaProcessError, match="diagnostics"):
        external.run_external_command(Path("/tools/ffprobe.exe"), arguments, 1, manager=manager)
    assert manager.process.closed


@pytest.mark.parametrize(
    "arguments", [("-version",), ("-hide_banner", "-encoders"), ("-hide_banner", "-filters")]
)
def test_runner_allows_only_exact_informational_command_stderr(fake_boundaries, arguments):
    manager = FakeManager(FakeProcess(stderr=b"build information"))
    assert (
        external.run_external_command(Path("/tools/ffmpeg.exe"), arguments, 1, manager=manager)
        == b"result"
    )


@pytest.mark.parametrize("flags,success", [(0, True), (4, True), (8, False)])
def test_private_session_rejects_missing_or_unreadable_persistent_acls(flags, success):
    import ctypes
    from types import SimpleNamespace

    def volume(handle, _name, _size, _serial, _maximum, output, *_rest):
        assert handle == 501
        ctypes.cast(output, ctypes.POINTER(external.wintypes.DWORD)).contents.value = flags
        return success

    api = SimpleNamespace(GetVolumeInformationByHandleW=volume)
    with pytest.raises(external.ExternalMediaProcessError, match="persistent ACLs"):
        external._require_persistent_acls(api, 501)


@pytest.mark.parametrize(
    "value",
    [
        "D:(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)",
        "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;WD)",
        "D:P(A;OICIID;FA;;;OW)(A;OICI;FA;;;SY)",
        "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;SY)",
        "D:P(A;OI;FA;;;OW)(A;OICI;FA;;;SY)",
        "D:P(A;OICI;FR;;;OW)(A;OICI;FA;;;SY)",
        "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)(A;OICI;FA;;;WD)",
        "D:NO_ACCESS_CONTROL",
    ],
)
def test_private_dacl_requires_only_protected_owner_and_system(value):
    with pytest.raises(external.ExternalMediaProcessError):
        external._validate_private_dacl_sddl(value)


def test_private_dacl_accepts_only_equivalent_expected_policy():
    external._validate_private_dacl_sddl("D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)")
    external._validate_private_dacl_sddl("D:PAI(A;CIOI;0x1f01ff;;;S-1-5-18)(A;OICI;FA;;;S-1-3-4)")


@pytest.mark.parametrize(
    "control,policy,accepted",
    [
        (0x1004, "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)", True),
        (0x0004, "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)", False),
        (0x1000, "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)", False),
        (0x1004, "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;WD)", False),
    ],
)
def test_private_directory_reads_actual_handle_descriptor(monkeypatch, control, policy, accepted):
    import ctypes
    from types import SimpleNamespace

    class Function:
        def __init__(self, call):
            self.call = call

        def __call__(self, *args):
            return self.call(*args)

    freed, read = [], []
    text = ctypes.create_unicode_buffer(policy)

    def security(handle, kind, information, owner, _group, dacl, _sacl, descriptor):
        read.append((handle, kind, information))
        for target, address in ((owner, 11), (dacl, 12), (descriptor, 13)):
            ctypes.cast(target, ctypes.POINTER(ctypes.c_void_p)).contents.value = address
        return 0

    def descriptor_control(_descriptor, flags, revision):
        ctypes.cast(flags, ctypes.POINTER(external.wintypes.WORD)).contents.value = control
        ctypes.cast(revision, ctypes.POINTER(external.wintypes.DWORD)).contents.value = 1
        return True

    def serialize(_descriptor, _revision, information, output, length):
        assert information == 4
        ctypes.cast(output, ctypes.POINTER(ctypes.c_void_p)).contents.value = ctypes.addressof(text)
        ctypes.cast(length, ctypes.POINTER(external.wintypes.DWORD)).contents.value = (
            len(policy) + 1
        )
        return True

    advapi = SimpleNamespace(
        GetSecurityInfo=Function(security),
        IsValidSid=Function(lambda _sid: True),
        GetSecurityDescriptorControl=Function(descriptor_control),
        ConvertSecurityDescriptorToStringSecurityDescriptorW=Function(serialize),
    )
    monkeypatch.setattr(external, "_windows_dll", lambda _name: advapi)
    volume_handles = []
    monkeypatch.setattr(
        external, "_require_persistent_acls", lambda _api, h: volume_handles.append(h)
    )
    api = SimpleNamespace(LocalFree=lambda pointer: freed.append(pointer.value))
    if accepted:
        external._verify_private_directory_security(api, 501)
    else:
        with pytest.raises(external.ExternalMediaProcessError):
            external._verify_private_directory_security(api, 501)
    assert read == [(501, 1, 5)] and volume_handles == [501]
    assert 13 in freed


def test_private_session_dacl_rejection_precedes_any_resource_use(monkeypatch, tmp_path):
    from contextlib import contextmanager
    from types import SimpleNamespace

    events = []

    def windows(buffer, _length):
        buffer.value = r"C:\Windows"
        return len(buffer.value)

    api = SimpleNamespace(GetWindowsDirectoryW=windows)

    @contextmanager
    def directory(_api, _path, **kwargs):
        assert kwargs == {"read_security": True}
        yield 502

    @contextmanager
    def chain(_api, _path):
        yield 501

    def reject(_api, handle):
        assert handle == 502
        events.append("descriptor-read")
        raise external.ExternalMediaProcessError("unprotected directory")

    monkeypatch.setattr(external, "_api", lambda: api)
    monkeypatch.setattr(external, "_known_local_app_data", lambda: tmp_path)
    monkeypatch.setattr(external, "_hold_directory_chain", chain)
    monkeypatch.setattr(external, "_hold_directory", directory)
    monkeypatch.setattr(external, "_require_persistent_acls", lambda _api, h: events.append(h))
    monkeypatch.setattr(external, "_create_private_directory", lambda _api, p: p.mkdir())
    monkeypatch.setattr(external, "_verify_private_directory_security", reject)
    with pytest.raises(external.ExternalMediaProcessError, match="unprotected"):
        with external.external_process_session():
            pytest.fail("unsafe directory cannot become cwd or receive subtitle resources")
    assert events == [501, "descriptor-read"]
    assert list(tmp_path.iterdir()) == []
