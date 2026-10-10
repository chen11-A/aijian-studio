"""Synthetic parser/API boundaries only; no encoder or native loader acceptance."""

import ctypes
import hashlib
import io
import struct
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api import external_media_process as external
from test_external_media_process import _pe


@pytest.mark.parametrize("content", [b"", b"12345"])
def test_hash_rejects_empty_or_oversized_stream(monkeypatch, content):
    monkeypatch.setattr(external, "_MAX_EXECUTABLE_BYTES", 4)
    with pytest.raises(external.ExternalMediaProcessError):
        external._hash_stream(io.BytesIO(content))


def test_hash_rewinds_and_covers_all_bytes():
    stream = io.BytesIO(b"test material" * 100000)
    stream.seek(7)
    assert external._hash_stream(stream) == hashlib.sha256(stream.getvalue()).hexdigest()


@pytest.mark.parametrize(
    "field,value,message",
    [
        ("information", False, "identity"),
        ("size", 0, "size"),
        ("size", 512 * 1024 * 1024 + 1, "size"),
        ("length", 0, "canonical"),
        ("length", 32768, "canonical"),
        ("path", r"\\server\tools\ffmpeg.exe", "real local"),
        ("path", r"\\?\C:\elsewhere\ffmpeg.exe", "redirected"),
        ("drive", 4, "local disk"),
    ],
)
def test_held_executable_rejects_unverified_identity(field, value, message):
    state = {
        "information": True,
        "size": 10,
        "length": 25,
        "path": r"\\?\C:\tools\ffmpeg.exe",
        "drive": 3,
    }
    state[field] = value

    def information(_handle, output):
        info = ctypes.cast(output, ctypes.POINTER(external._FileInformation)).contents
        info.nNumberOfLinks = 1
        info.nFileSizeLow = state["size"]
        return state["information"]

    def final_path(_handle, output, _size, _flags):
        output.value = state["path"]
        return state["length"]

    api = SimpleNamespace(
        GetFileInformationByHandle=information,
        GetFileType=lambda _: 1,
        GetFinalPathNameByHandleW=final_path,
        GetDriveTypeW=lambda _: state["drive"],
    )
    with pytest.raises(external.ExternalMediaProcessError, match=message):
        external._check_handle(api, 1, Path(r"C:\tools\ffmpeg.exe"), directory=False)


@pytest.mark.parametrize("handle", [None, external._INVALID_HANDLE])
def test_failed_directory_open_never_closes_an_invalid_handle(handle):
    closed = []
    api = SimpleNamespace(CreateFileW=lambda *_: handle, CloseHandle=closed.append)
    with pytest.raises(external.ExternalMediaProcessError, match="protect"):
        with external._hold_directory(api, Path(r"C:\tools")):
            pytest.fail("invalid handle must not escape")
    assert closed == []


@pytest.mark.parametrize("read_security", [False, True])
def test_directory_closes_owned_handle_even_when_body_raises(monkeypatch, read_security):
    calls, closed = [], []

    def create(*args):
        calls.append(args)
        return 42

    api = SimpleNamespace(CreateFileW=create, CloseHandle=closed.append)
    monkeypatch.setattr(external, "_check_handle", lambda *_args, **_kwargs: None)
    with pytest.raises(RuntimeError, match="caller"):
        with external._hold_directory(api, Path(r"C:\tools"), read_security=read_security) as held:
            assert held == 42
            raise RuntimeError("caller")
    assert calls[0][1] == 0x81 | (0x20000 if read_security else 0)
    assert calls[0][2] == 1
    assert closed == [42]


@pytest.mark.parametrize(
    "offset,packing,value,message",
    [
        (0, "2s", b"NO", "not a PE"),
        (0x3C, "I", 63, "signature"),
        (0x3C, "I", 1024 * 1024 + 1, "signature"),
        (0x80, "4s", b"NOPE", "signature"),
        (0x86, "H", 0, "AMD64"),
        (0x86, "H", 97, "AMD64"),
        (0x94, "H", 239, "AMD64"),
        (0x96, "H", 0, "AMD64"),
        (0x96, "H", 0x2002, "AMD64"),
        (0x98, "H", 0x10B, "PE32"),
        (0x98 + 108, "I", 13, "directory table"),
        (0x98 + 108, "I", 17, "directory table"),
        (0x98 + 120, "I", 0, "import directory"),
        (0x98 + 124, "I", 19, "import directory"),
        (0x98 + 124, "I", 1024 * 1024 + 1, "import directory"),
        (0x30C, "I", 0, "import address"),
        (0x98 + 120, "I", 0xFFFFFFF0, "import address"),
        (0x98 + 124, "I", 20, "Unterminated.*table"),
    ],
)
def test_pe_header_and_table_bounds_fail_closed(offset, packing, value, message):
    data = _pe()
    # A live descriptor with a null name differs from the all-zero terminator.
    struct.pack_into("<I", data, 0x300, 1)
    struct.pack_into("<" + packing, data, offset, value)
    with pytest.raises(external.ExternalMediaProcessError, match=message):
        external._pe_dependencies(io.BytesIO(data))


@pytest.mark.parametrize("data", [b"", b"MZ", bytes(63)])
def test_short_stream_is_not_an_executable(data):
    with pytest.raises(external.ExternalMediaProcessError, match="not a PE"):
        external._pe_dependencies(io.BytesIO(data))


@pytest.mark.parametrize("name,message", [(b"\xff\0", "Invalid PE"), (b"a" * 128, "Unterminated")])
def test_pe_dependency_name_is_bounded_ascii(name, message):
    data = _pe()
    data[0x900 : 0x900 + len(name)] = name
    with pytest.raises(external.ExternalMediaProcessError, match=message):
        external._pe_dependencies(io.BytesIO(data))


def test_empty_dependency_tables_are_not_accepted():
    with pytest.raises(external.ExternalMediaProcessError, match="no recognized"):
        external._pe_dependencies(io.BytesIO(_pe(imports=())))


def test_overlapping_rva_regions_are_ambiguous():
    data = _pe()
    struct.pack_into("<I", data, 0x98 + 60, 0x2000)
    with pytest.raises(external.ExternalMediaProcessError, match="outside file data"):
        external._pe_dependencies(io.BytesIO(data))


@pytest.mark.parametrize(
    "timeout,limit,name",
    [
        (True, 1, "ffmpeg.exe"),
        ("1", 1, "ffmpeg.exe"),
        (0, 1, "ffmpeg.exe"),
        (-1, 1, "ffmpeg.exe"),
        (float("inf"), 1, "ffmpeg.exe"),
        (float("nan"), 1, "ffmpeg.exe"),
        (1, True, "ffmpeg.exe"),
        (1, 1.1, "ffmpeg.exe"),
        (1, 0, "ffmpeg.exe"),
        (1, 16 * 1024 * 1024 + 1, "ffmpeg.exe"),
        (1, 1, "other.exe"),
    ],
)
def test_invalid_limits_fail_before_opening_any_material(monkeypatch, timeout, limit, name):
    def forbidden(*_):
        pytest.fail("invalid request cannot open material")

    monkeypatch.setattr(external, "guarded_external_pair", forbidden)
    with pytest.raises(external.ExternalMediaProcessError, match="limits"):
        external.run_external_command(Path(name), (), timeout, max_output_bytes=limit)


class ApiFunction:
    """Callable supporting ctypes signature assignment without loading a DLL."""

    def __init__(self, callback):
        self.callback = callback

    def __call__(self, *args):
        return self.callback(*args)


@pytest.mark.parametrize("status,allocated", [(0, True), (1, True), (1, False), (0, False)])
def test_known_folder_frees_allocated_memory_on_success_or_failure(monkeypatch, status, allocated):
    memory = ctypes.create_unicode_buffer(r"C:\Users\Test\AppData\Local")
    freed = []

    def known(_folder, flags, token, output):
        assert flags == 0 and token is None
        if allocated:
            ctypes.cast(output, ctypes.POINTER(ctypes.c_void_p)).contents.value = ctypes.addressof(
                memory
            )
        return status

    shell = SimpleNamespace(SHGetKnownFolderPath=ApiFunction(known))
    ole = SimpleNamespace(CoTaskMemFree=ApiFunction(lambda p: freed.append(p.value)))
    monkeypatch.setattr(
        external, "_windows_dll", lambda name: {"shell32": shell, "ole32": ole}[name]
    )
    if status == 0 and allocated:
        assert external._known_local_app_data() == Path(memory.value)
    else:
        with pytest.raises(external.ExternalMediaProcessError, match="location"):
            external._known_local_app_data()
    assert freed == ([ctypes.addressof(memory)] if allocated else [])


@pytest.mark.parametrize("converted,created", [(True, True), (True, False), (False, False)])
def test_private_directory_atomic_policy_and_descriptor_cleanup(monkeypatch, converted, created):
    events = []

    def convert(policy, version, output, reserved):
        assert policy == "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)"
        assert version == 1 and reserved is None
        events.append("convert")
        if converted:
            ctypes.cast(output, ctypes.POINTER(ctypes.c_void_p)).contents.value = 55
        return converted

    def create(path, security):
        assert path == str(Path(r"C:\private-test"))
        assert security is not None
        events.append("create")
        return created

    advapi = SimpleNamespace(
        ConvertStringSecurityDescriptorToSecurityDescriptorW=ApiFunction(convert)
    )
    api = SimpleNamespace(
        CreateDirectoryW=create, LocalFree=lambda p: events.append(("free", p.value))
    )
    monkeypatch.setattr(external, "_windows_dll", lambda _: advapi)
    if converted and created:
        external._create_private_directory(api, Path(r"C:\private-test"))
    else:
        with pytest.raises(external.ExternalMediaProcessError):
            external._create_private_directory(api, Path(r"C:\private-test"))
    assert events == (["convert", "create", ("free", 55)] if converted else ["convert"])
