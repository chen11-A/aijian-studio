"""Fail-closed Windows execution of the exact development-only media pair.

This is deliberately separate from bundled/formal toolchain discovery. Hashing
is performed through write/delete-denying handles, with plain local ancestor
handles held until the process and its descendants have stopped. A hash match
alone is not a loader boundary: callers must also use the private session and
``hardened_external_media=True`` Job Object process creation.

Host-safe parser/mock tests do not establish Windows loader/race acceptance.
"""

from __future__ import annotations

import ctypes
import hashlib
import math
import os
import re
import secrets
import shutil
import struct
import subprocess
import threading
import time
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import ExitStack, contextmanager
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from types import MappingProxyType
from typing import BinaryIO, Final, cast

from aijian_api.product_export_windows_job import ProductExportJobManager

PINNED_PROFILE_ID: Final = "windows-x86_64-gyan-full-8.1.2-dev"
PINNED_VERSION: Final = "8.1.2"
PINNED_FFMPEG_SHA256: Final = "ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e"
PINNED_FFPROBE_SHA256: Final = "9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015"
_MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024
_REPARSE_POINT = 0x400
_DIRECTORY = 0x10
_INVALID_HANDLE = ctypes.c_void_p(-1).value
# Exactly the dependencies observed in the two pinned static Gyan PE images.
_SYSTEM_DEPENDENCIES = frozenset(
    {
        "api-ms-win-core-synch-l1-2-0.dll",
        "advapi32.dll",
        "avrt.dll",
        "bcrypt.dll",
        "cfgmgr32.dll",
        "crypt32.dll",
        "d2d1.dll",
        "dwrite.dll",
        "gdi32.dll",
        "iphlpapi.dll",
        "kernel32.dll",
        "msimg32.dll",
        "ncrypt.dll",
        "ntdll.dll",
        "ole32.dll",
        "oleaut32.dll",
        "shell32.dll",
        "shlwapi.dll",
        "user32.dll",
        "avicap32.dll",
        "winmm.dll",
        "ws2_32.dll",
        *(
            f"api-ms-win-crt-{part}-l1-1-0.dll"
            for part in (
                "conio",
                "convert",
                "environment",
                "filesystem",
                "heap",
                "locale",
                "math",
                "multibyte",
                "private",
                "process",
                "runtime",
                "stdio",
                "string",
                "time",
                "utility",
            )
        ),
    }
)


class ExternalMediaProcessError(OSError):
    """Selected external media material failed a local execution boundary."""


class ExternalMediaOutputLimitError(ExternalMediaProcessError):
    """Combined child output exceeded the caller's bounded allowance."""


@dataclass(frozen=True, slots=True)
class ExternalMediaPair:
    ffmpeg_path: Path
    ffprobe_path: Path
    ffmpeg_sha256: str = PINNED_FFMPEG_SHA256
    ffprobe_sha256: str = PINNED_FFPROBE_SHA256
    profile_id: str = PINNED_PROFILE_ID
    version: str = PINNED_VERSION


class _FileInformation(ctypes.Structure):
    _fields_ = [
        ("dwFileAttributes", wintypes.DWORD),
        ("ftCreationTime", wintypes.FILETIME),
        ("ftLastAccessTime", wintypes.FILETIME),
        ("ftLastWriteTime", wintypes.FILETIME),
        ("dwVolumeSerialNumber", wintypes.DWORD),
        ("nFileSizeHigh", wintypes.DWORD),
        ("nFileSizeLow", wintypes.DWORD),
        ("nNumberOfLinks", wintypes.DWORD),
        ("nFileIndexHigh", wintypes.DWORD),
        ("nFileIndexLow", wintypes.DWORD),
    ]


def _windows_dll(name: str) -> ctypes.CDLL:
    loader = getattr(ctypes, "WinDLL", None)
    if loader is None:
        raise ExternalMediaProcessError("External media execution requires Windows")
    return cast(ctypes.CDLL, loader(name, use_last_error=True))


def _api() -> ctypes.CDLL:
    if os.name != "nt":
        raise ExternalMediaProcessError("External media execution requires Windows")
    api = _windows_dll("kernel32")
    signatures = {
        "CreateFileW": (
            wintypes.HANDLE,
            [
                wintypes.LPCWSTR,
                wintypes.DWORD,
                wintypes.DWORD,
                ctypes.c_void_p,
                wintypes.DWORD,
                wintypes.DWORD,
                wintypes.HANDLE,
            ],
        ),
        "CloseHandle": (wintypes.BOOL, [wintypes.HANDLE]),
        "GetFileInformationByHandle": (
            wintypes.BOOL,
            [
                wintypes.HANDLE,
                ctypes.POINTER(_FileInformation),
            ],
        ),
        "GetFileType": (wintypes.DWORD, [wintypes.HANDLE]),
        "GetFinalPathNameByHandleW": (
            wintypes.DWORD,
            [
                wintypes.HANDLE,
                wintypes.LPWSTR,
                wintypes.DWORD,
                wintypes.DWORD,
            ],
        ),
        "GetDriveTypeW": (wintypes.UINT, [wintypes.LPCWSTR]),
        "GetVolumeInformationByHandleW": (
            wintypes.BOOL,
            [
                wintypes.HANDLE,
                wintypes.LPWSTR,
                wintypes.DWORD,
                ctypes.POINTER(wintypes.DWORD),
                ctypes.POINTER(wintypes.DWORD),
                ctypes.POINTER(wintypes.DWORD),
                wintypes.LPWSTR,
                wintypes.DWORD,
            ],
        ),
        "GetWindowsDirectoryW": (wintypes.UINT, [wintypes.LPWSTR, wintypes.UINT]),
        "CreateDirectoryW": (wintypes.BOOL, [wintypes.LPCWSTR, ctypes.c_void_p]),
        "LocalFree": (ctypes.c_void_p, [ctypes.c_void_p]),
    }
    for name, (restype, argtypes) in signatures.items():
        function = getattr(api, name)
        function.restype = restype
        function.argtypes = argtypes
    return api


def _validate_path_syntax(value: str) -> PureWindowsPath:
    # Validate the un-resolved spelling. Resolving first would hide junctions,
    # dot traversal, UNC/device prefixes and substituted/short-name aliases.
    if not re.match(r"^[A-Za-z]:[\\/]", value) or len(value) > 240:
        raise ExternalMediaProcessError("External media path must be an absolute local drive path")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ExternalMediaProcessError("External media path contains control characters")
    components = re.split(r"[\\/]", value[3:])
    if components == [""]:
        components = []  # Needed while validating held drive-root ancestors.
    for component in components:
        if (
            not component
            or component in {".", ".."}
            or component[-1] in {".", " "}
            or any(char in component for char in ':*?"<>|')
            or re.fullmatch(
                r"(?i)(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?",
                component,
            )
        ):
            raise ExternalMediaProcessError("External media path contains an unsafe component")
    return PureWindowsPath(value)


def _check_volume(api: ctypes.CDLL, path: Path) -> None:
    parsed = _validate_path_syntax(str(path))
    if int(api.GetDriveTypeW(parsed.anchor)) not in {2, 3}:  # removable/fixed only
        raise ExternalMediaProcessError("External media path is not on a local disk volume")


def _check_handle(api: ctypes.CDLL, handle: int, path: Path, *, directory: bool) -> None:
    info = _FileInformation()
    if not api.GetFileInformationByHandle(handle, ctypes.byref(info)):
        raise ExternalMediaProcessError("External media file identity is unavailable")
    if (
        info.dwFileAttributes & _REPARSE_POINT
        or bool(info.dwFileAttributes & _DIRECTORY) != directory
        or int(api.GetFileType(handle)) != 1
        or (not directory and info.nNumberOfLinks != 1)
    ):
        raise ExternalMediaProcessError("External media path is not a plain single-link disk entry")
    file_size = (info.nFileSizeHigh << 32) | info.nFileSizeLow
    if not directory and not 0 < file_size <= _MAX_EXECUTABLE_BYTES:
        raise ExternalMediaProcessError("External media executable size is outside the limit")
    buffer = ctypes.create_unicode_buffer(32768)
    length = int(api.GetFinalPathNameByHandleW(handle, buffer, len(buffer), 0))
    if not 0 < length < len(buffer):
        raise ExternalMediaProcessError("External media canonical path is unavailable")
    actual = buffer.value
    if not re.match(r"^\\\\\?\\[A-Za-z]:\\", actual):
        raise ExternalMediaProcessError("External media handle is not on a real local drive")
    actual_path = _validate_path_syntax(actual[4:])
    if actual_path != _validate_path_syntax(str(path)):
        raise ExternalMediaProcessError(
            "External media path contains a redirected or aliased entry"
        )
    _check_volume(api, path)


@contextmanager
def _hold_directory(
    api: ctypes.CDLL,
    path: Path,
    *,
    read_security: bool = False,
) -> Iterator[int]:
    # FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES, share READ only. Directory
    # read-data access is essential: attribute-only handles do not participate
    # in normal read/write/delete sharing checks. Holding every ancestor blocks
    # rename/delete and writable reparse handles without blocking child creation.
    access = 0x81 | (0x20000 if read_security else 0)  # READ_CONTROL for descriptor readback.
    handle = api.CreateFileW(str(path), access, 1, None, 3, 0x02000000 | 0x00200000, None)
    if handle in (None, _INVALID_HANDLE):
        raise ExternalMediaProcessError("Cannot protect external media directory identity")
    try:
        _check_handle(api, handle, path, directory=True)
        yield int(handle)
    finally:
        api.CloseHandle(handle)


@contextmanager
def _hold_directory_chain(api: ctypes.CDLL, root: Path) -> Iterator[int]:
    _check_volume(api, root)
    with ExitStack() as stack:
        handle = 0
        for directory in (*reversed(root.parents), root):
            handle = stack.enter_context(_hold_directory(api, directory))
        yield handle


@contextmanager
def _hold_executable(api: ctypes.CDLL, path: Path) -> Iterator[BinaryIO]:
    import msvcrt

    # GENERIC_READ with FILE_SHARE_READ only excludes existing/future writable
    # or delete-capable handles. Reparse targets are opened, never traversed.
    handle = api.CreateFileW(str(path), 0x80000000, 1, None, 3, 0x00200000 | 0x08000000, None)
    if handle in (None, _INVALID_HANDLE):
        raise ExternalMediaProcessError("Cannot protect external media executable identity")
    descriptor: int | None = None
    try:
        _check_handle(api, handle, path, directory=False)
        convert_handle = getattr(msvcrt, "open_osfhandle", None)
        binary_flag = getattr(os, "O_BINARY", None)
        if convert_handle is None or binary_flag is None:
            raise ExternalMediaProcessError("Windows binary file handles are unavailable")
        descriptor = int(convert_handle(int(handle), os.O_RDONLY | binary_flag))
        handle = None
        stream = os.fdopen(descriptor, "rb", closefd=True)
        descriptor = None
        with stream:
            yield stream
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if handle not in (None, _INVALID_HANDLE):
            api.CloseHandle(handle)


def validate_external_root(root: Path) -> Path:
    """Validate selection for settings; execution always reopens held handles."""
    api = _api()
    _validate_path_syntax(str(root))
    with _hold_directory_chain(api, root):
        return root


def _hash_stream(stream: BinaryIO) -> str:
    stream.seek(0)
    digest = hashlib.sha256()
    total = 0
    while chunk := stream.read(1024 * 1024):
        total += len(chunk)
        if total > _MAX_EXECUTABLE_BYTES:
            raise ExternalMediaProcessError("External executable exceeds the size limit")
        digest.update(chunk)
    if total == 0:
        raise ExternalMediaProcessError("External executable is empty")
    return digest.hexdigest()


def _pe_dependencies(stream: BinaryIO) -> frozenset[str]:
    """Read bounded PE32+ import and delay-import tables without loading code."""
    stream.seek(0, os.SEEK_END)
    file_size = stream.tell()

    def read(offset: int, size: int) -> bytes:
        if offset < 0 or size < 0 or size > 1024 * 1024 or offset + size > file_size:
            raise ExternalMediaProcessError("Invalid external PE bounds")
        stream.seek(offset)
        result = stream.read(size)
        if len(result) != size:
            raise ExternalMediaProcessError("Truncated external PE image")
        return result

    if not 64 <= file_size <= _MAX_EXECUTABLE_BYTES or read(0, 2) != b"MZ":
        raise ExternalMediaProcessError("External executable is not a PE image")
    pe_offset = struct.unpack("<I", read(0x3C, 4))[0]
    if not 64 <= pe_offset <= 1024 * 1024 or read(pe_offset, 4) != b"PE\0\0":
        raise ExternalMediaProcessError("Invalid external PE signature")
    coff = read(pe_offset + 4, 20)
    machine, section_count = struct.unpack_from("<HH", coff)
    optional_size, characteristics = struct.unpack_from("<HH", coff, 16)
    if (
        machine != 0x8664
        or not 1 <= section_count <= 96
        or optional_size < 240
        or not characteristics & 0x2
        or characteristics & 0x2000
    ):
        raise ExternalMediaProcessError("External executable must be an AMD64 executable PE")
    optional = read(pe_offset + 24, optional_size)
    if struct.unpack_from("<H", optional)[0] != 0x20B:
        raise ExternalMediaProcessError("External executable must use PE32+")
    directory_count = struct.unpack_from("<I", optional, 108)[0]
    if not 14 <= directory_count <= (optional_size - 112) // 8:
        raise ExternalMediaProcessError("Invalid external PE directory table")
    headers_size = struct.unpack_from("<I", optional, 60)[0]
    sections = [
        struct.unpack_from("<IIII", read(pe_offset + 24 + optional_size + index * 40, 40), 8)
        for index in range(section_count)
    ]

    def offset_of(rva: int, size: int) -> int:
        if not rva or size < 0 or rva + size > 0x1_0000_0000:
            raise ExternalMediaProcessError("Invalid external PE import address")
        candidates = []
        if rva + size <= headers_size:
            candidates.append(rva)
        for _virtual_size, address, raw_size, raw_offset in sections:
            if address <= rva and rva + size <= address + raw_size:
                candidates.append(raw_offset + rva - address)
        if len(candidates) != 1 or candidates[0] + size > file_size:
            raise ExternalMediaProcessError("External PE import address is outside file data")
        return candidates[0]

    def dependency_name(rva: int) -> str:
        content = bytearray()
        for index in range(128):
            byte = read(offset_of(rva + index, 1), 1)
            if byte == b"\0":
                try:
                    name = content.decode("ascii").lower()
                except UnicodeDecodeError as error:
                    raise ExternalMediaProcessError("Invalid PE dependency name") from error
                if not re.fullmatch(r"[a-z0-9_-]+\.dll", name):
                    raise ExternalMediaProcessError("Unsafe PE dependency name")
                return name
            content.extend(byte)
        raise ExternalMediaProcessError("Unterminated external PE dependency name")

    dependencies: set[str] = set()
    for directory_index, descriptor_size, name_offset in ((1, 20, 12), (13, 32, 4)):
        rva, size = struct.unpack_from("<II", optional, 112 + directory_index * 8)
        if rva == size == 0:
            continue
        if not rva or not descriptor_size <= size <= 1024 * 1024:
            raise ExternalMediaProcessError("Invalid external PE import directory")
        # Validate the entire described table is present, but walk only bounded
        # descriptors: the directory size can include thunks and strings too.
        offset_of(rva, size)
        for index in range(min(size // descriptor_size, 257)):
            descriptor = read(
                offset_of(rva + index * descriptor_size, descriptor_size), descriptor_size
            )
            if not any(descriptor):
                break
            if index == 256:
                raise ExternalMediaProcessError("External PE has too many dependencies")
            if directory_index == 13 and struct.unpack_from("<I", descriptor)[0] != 1:
                raise ExternalMediaProcessError("External PE delay imports must use RVAs")
            dependencies.add(dependency_name(struct.unpack_from("<I", descriptor, name_offset)[0]))
        else:
            raise ExternalMediaProcessError("Unterminated external PE import table")
    if not dependencies:
        raise ExternalMediaProcessError("External PE has no recognized dependency table")
    return frozenset(dependencies)


def _validate_pe_dependencies(stream: BinaryIO) -> None:
    if not _pe_dependencies(stream) <= _SYSTEM_DEPENDENCIES:
        raise ExternalMediaProcessError("External PE dependency is not in the pinned system set")


def _reject_app_local_dependencies(root: Path) -> None:
    # Static audit is defense in depth. Startup mitigation remains necessary:
    # holding a directory against rename does not prevent adding new files.
    for index, entry in enumerate(root.iterdir()):
        if index >= 4096:
            raise ExternalMediaProcessError("External media folder exceeds the entry limit")
        if entry.name.casefold().endswith((".dll", ".manifest", ".local")):
            raise ExternalMediaProcessError(
                "External media folder contains app-local loader inputs"
            )


@contextmanager
def guarded_external_pair(root: Path) -> Iterator[ExternalMediaPair]:
    api = _api()
    _validate_path_syntax(str(root))
    pair = ExternalMediaPair(root / "ffmpeg.exe", root / "ffprobe.exe")
    with ExitStack() as stack:
        stack.enter_context(_hold_directory_chain(api, root))
        ffmpeg = stack.enter_context(_hold_executable(api, pair.ffmpeg_path))
        ffprobe = stack.enter_context(_hold_executable(api, pair.ffprobe_path))
        # Both hashes are complete before any caller can launch either image.
        actual_hashes = (_hash_stream(ffmpeg), _hash_stream(ffprobe))
        if actual_hashes != (PINNED_FFMPEG_SHA256, PINNED_FFPROBE_SHA256):
            raise ExternalMediaProcessError("External media binaries do not match the pinned pair")
        _validate_pe_dependencies(ffmpeg)
        _validate_pe_dependencies(ffprobe)
        _reject_app_local_dependencies(root)
        yield pair


def _known_local_app_data() -> Path:
    # Do not trust LOCALAPPDATA, USERPROFILE, TEMP, TMP, or PATH from the parent.
    shell = _windows_dll("shell32")
    ole = _windows_dll("ole32")
    shell.SHGetKnownFolderPath.argtypes = [
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.HANDLE,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    shell.SHGetKnownFolderPath.restype = ctypes.c_long
    ole.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    ole.CoTaskMemFree.restype = None
    folder_id = ctypes.create_string_buffer(
        uuid.UUID("F1B32785-6FBA-4FCF-9D55-7B8E7F157091").bytes_le
    )
    result = ctypes.c_void_p()
    status = shell.SHGetKnownFolderPath(folder_id, 0, None, ctypes.byref(result))
    try:
        if status != 0 or not result.value:
            raise ExternalMediaProcessError("Private local media session location is unavailable")
        return Path(ctypes.wstring_at(result))
    finally:
        if result.value:
            ole.CoTaskMemFree(result)


def _create_private_directory(api: ctypes.CDLL, directory: Path) -> None:
    class SecurityAttributes(ctypes.Structure):
        _fields_ = [
            ("nLength", wintypes.DWORD),
            ("lpSecurityDescriptor", ctypes.c_void_p),
            ("bInheritHandle", wintypes.BOOL),
        ]

    advapi = _windows_dll("advapi32")
    convert = advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW
    convert.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
    ]
    convert.restype = wintypes.BOOL
    descriptor = ctypes.c_void_p()
    # Protected DACL, only the directory owner and SYSTEM. Child temp files
    # inherit these rules. Creation is atomic; never fix permissions afterward.
    if not convert("D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)", 1, ctypes.byref(descriptor), None):
        raise ExternalMediaProcessError("Cannot establish private media session permissions")
    try:
        security = SecurityAttributes(ctypes.sizeof(SecurityAttributes), descriptor, False)
        if not api.CreateDirectoryW(str(directory), ctypes.byref(security)):
            raise ExternalMediaProcessError("Cannot create private media process directory")
    finally:
        api.LocalFree(descriptor)


def _require_persistent_acls(api: ctypes.CDLL, handle: int) -> None:
    """Check the held object's real volume; FAT/exFAT must never host private sessions."""
    flags = wintypes.DWORD()
    if (
        not api.GetVolumeInformationByHandleW(
            handle,
            None,
            0,
            None,
            None,
            ctypes.byref(flags),
            None,
            0,
        )
        or not flags.value & 0x00000008
    ):  # FILE_PERSISTENT_ACLS
        raise ExternalMediaProcessError("Private media storage must enforce persistent ACLs")


def _validate_private_dacl_sddl(value: str) -> None:
    # This accepts only the two requested inheritable full-access ACEs. It is
    # not a general SDDL parser and rejects extra/inherited/conditional entries.
    match = re.fullmatch(r"D:(P(?:AI)?)(\([^()]+\))\s*(\([^()]+\))", value)
    if match is None or len(value) > 1024:
        raise ExternalMediaProcessError("Private media directory DACL differs from its policy")
    principals: set[str] = set()
    for entry in match.group(2, 3):
        fields = entry[1:-1].split(";")
        if len(fields) != 6:
            raise ExternalMediaProcessError("Private media directory has an unexpected ACE")
        kind, flags, access, object_guid, inherited_guid, principal = fields
        flag_parts = {flags[index : index + 2] for index in range(0, len(flags), 2)}
        if (
            kind != "A"
            or flag_parts != {"OI", "CI"}
            or len(flags) != 4
            or access.lower() not in {"fa", "0x1f01ff"}
            or object_guid
            or inherited_guid
            or principal not in {"OW", "SY", "S-1-3-4", "S-1-5-18"}
        ):
            raise ExternalMediaProcessError("Private media directory grants unexpected access")
        principals.add({"S-1-3-4": "OW", "S-1-5-18": "SY"}.get(principal, principal))
    if principals != {"OW", "SY"}:
        raise ExternalMediaProcessError("Private media directory owner/SYSTEM grants are missing")


def _verify_private_directory_security(api: ctypes.CDLL, handle: int) -> None:
    """Read the actual protected DACL from the held newly-created directory."""
    _require_persistent_acls(api, handle)
    advapi = _windows_dll("advapi32")
    signatures = {
        "GetSecurityInfo": (
            wintypes.DWORD,
            [
                wintypes.HANDLE,
                ctypes.c_int,
                wintypes.DWORD,
                ctypes.POINTER(ctypes.c_void_p),
                ctypes.POINTER(ctypes.c_void_p),
                ctypes.POINTER(ctypes.c_void_p),
                ctypes.POINTER(ctypes.c_void_p),
                ctypes.POINTER(ctypes.c_void_p),
            ],
        ),
        "GetSecurityDescriptorControl": (
            wintypes.BOOL,
            [
                ctypes.c_void_p,
                ctypes.POINTER(wintypes.WORD),
                ctypes.POINTER(wintypes.DWORD),
            ],
        ),
        "IsValidSid": (wintypes.BOOL, [ctypes.c_void_p]),
        "ConvertSecurityDescriptorToStringSecurityDescriptorW": (
            wintypes.BOOL,
            [
                ctypes.c_void_p,
                wintypes.DWORD,
                wintypes.DWORD,
                ctypes.POINTER(ctypes.c_void_p),
                ctypes.POINTER(wintypes.DWORD),
            ],
        ),
    }
    for name, (restype, argtypes) in signatures.items():
        function = getattr(advapi, name)
        function.restype = restype
        function.argtypes = argtypes
    owner, dacl, descriptor, serialized = (ctypes.c_void_p() for _ in range(4))
    try:
        # SE_FILE_OBJECT + OWNER_SECURITY_INFORMATION + DACL_SECURITY_INFORMATION.
        if (
            advapi.GetSecurityInfo(
                handle,
                1,
                0x1 | 0x4,
                ctypes.byref(owner),
                None,
                ctypes.byref(dacl),
                None,
                ctypes.byref(descriptor),
            )
            != 0
            or not descriptor.value
            or not dacl.value
            or not owner.value
        ):
            raise ExternalMediaProcessError("Private media directory security cannot be read")
        if not advapi.IsValidSid(owner):
            raise ExternalMediaProcessError("Private media directory owner is invalid")
        control, revision = wintypes.WORD(), wintypes.DWORD()
        if (
            not advapi.GetSecurityDescriptorControl(
                descriptor,
                ctypes.byref(control),
                ctypes.byref(revision),
            )
            or control.value & 0x1004 != 0x1004
            or revision.value != 1
        ):
            raise ExternalMediaProcessError("Private media directory DACL is not present/protected")
        length = wintypes.DWORD()
        if (
            not advapi.ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor,
                1,
                0x4,
                ctypes.byref(serialized),
                ctypes.byref(length),
            )
            or not serialized.value
            or not 1 <= length.value <= 1024
        ):
            raise ExternalMediaProcessError("Private media directory DACL cannot be verified")
        _validate_private_dacl_sddl(ctypes.wstring_at(serialized))
    finally:
        if serialized.value:
            api.LocalFree(serialized)
        if descriptor.value:
            api.LocalFree(descriptor)


def _minimal_environment(windows: PureWindowsPath, directory: Path) -> Mapping[str, str]:
    return MappingProxyType(
        {
            "SYSTEMROOT": str(windows),
            "WINDIR": str(windows),
            "SYSTEMDRIVE": windows.drive,
            "TEMP": str(directory),
            "TMP": str(directory),
        }
    )


@contextmanager
def external_process_session() -> Iterator[tuple[Path, Mapping[str, str]]]:
    """Fresh private cwd/temp, outside project data and chosen tool directories."""
    api = _api()
    parent = _known_local_app_data()
    windows_buffer = ctypes.create_unicode_buffer(32768)
    length = int(api.GetWindowsDirectoryW(windows_buffer, len(windows_buffer)))
    if not 0 < length < len(windows_buffer):
        raise ExternalMediaProcessError("OS Windows directory is unavailable")
    windows = _validate_path_syntax(windows_buffer.value)
    with _hold_directory_chain(api, parent) as parent_handle:
        _require_persistent_acls(api, parent_handle)
        directory = parent / ("Aivora-media-session-" + secrets.token_hex(16))
        _create_private_directory(api, directory)
        try:
            with _hold_directory(api, directory, read_security=True) as directory_handle:
                _verify_private_directory_security(api, directory_handle)
                if any(directory.iterdir()):
                    raise ExternalMediaProcessError("Private media process directory is not empty")
                yield directory, _minimal_environment(windows, directory)
        finally:
            shutil.rmtree(directory)


def run_external_command(
    executable: Path,
    arguments: Sequence[str],
    timeout: float,
    *,
    manager: ProductExportJobManager | None = None,
    stop_requested: Callable[[], bool] | None = None,
    max_output_bytes: int = 2 * 1024 * 1024,
) -> bytes:
    """Recheck both pins, run in a private job, and bound both output streams."""
    if (
        isinstance(timeout, bool)
        or not isinstance(timeout, int | float)
        or not math.isfinite(timeout)
        or timeout <= 0
        or isinstance(max_output_bytes, bool)
        or not isinstance(max_output_bytes, int)
        or not 0 < max_output_bytes <= 16 * 1024 * 1024
        or executable.name.casefold() not in {"ffmpeg.exe", "ffprobe.exe"}
    ):
        raise ExternalMediaProcessError("Invalid external media command limits or executable")
    with guarded_external_pair(executable.parent), external_process_session() as (cwd, env):
        if executable.parent in cwd.parents or cwd == executable.parent:
            raise ExternalMediaProcessError(
                "Private process directory overlaps selected tool folder"
            )
        if stop_requested is not None and stop_requested():
            raise ExternalMediaProcessError("External media command was interrupted")
        owned_manager = manager is None
        manager = manager or ProductExportJobManager()
        try:
            process = manager.spawn(
                executable, arguments, cwd=cwd, env=env, hardened_external_media=True
            )
        except BaseException:
            if owned_manager:
                manager.shutdown_and_wait()
            raise
        stdout = bytearray()
        total = 0
        output_lock = threading.Lock()
        exceeded = threading.Event()
        read_failed = threading.Event()
        stderr_seen = threading.Event()
        informational = tuple(arguments) in {
            ("-version",),
            ("-hide_banner", "-encoders"),
            ("-hide_banner", "-filters"),
        }

        def read_output(stream: BinaryIO, *, retain: bool) -> None:
            nonlocal total
            try:
                while chunk := stream.read(64 * 1024):
                    with output_lock:
                        remaining = max_output_bytes - total
                        if len(chunk) > remaining:
                            exceeded.set()
                            return
                        total += len(chunk)
                        if retain:
                            stdout.extend(chunk)
                        elif chunk:
                            stderr_seen.set()
            except (OSError, ValueError):
                read_failed.set()

        readers = [
            threading.Thread(
                target=read_output,
                args=(stream,),
                kwargs={"retain": retain},
                name="aivora-external-media-output",
                daemon=True,
            )
            for stream, retain in ((process.stdout, True), (process.stderr, False))
        ]
        deadline = time.monotonic() + timeout
        try:
            for reader in readers:
                reader.start()
            while True:
                if exceeded.is_set():
                    raise ExternalMediaOutputLimitError("External media output exceeds the limit")
                if read_failed.is_set():
                    raise ExternalMediaProcessError("External media output could not be read")
                if stop_requested is not None and stop_requested():
                    raise ExternalMediaProcessError("External media command was interrupted")
                if time.monotonic() >= deadline:
                    raise subprocess.TimeoutExpired(str(executable), timeout)
                return_code = process.poll()
                if return_code is not None:
                    break
                time.sleep(0.02)
            for reader in readers:
                reader.join(timeout=max(0.0, deadline - time.monotonic()))
            if any(reader.is_alive() for reader in readers):
                raise ExternalMediaProcessError("External media output readers did not stop")
            if exceeded.is_set():
                raise ExternalMediaOutputLimitError("External media output exceeds the limit")
            if read_failed.is_set():
                raise ExternalMediaProcessError("External media output could not be read")
            if return_code != 0:
                # Do not attach user paths or arbitrary child output to errors.
                raise subprocess.CalledProcessError(return_code, executable.name)
            if stderr_seen.is_set() and not informational:
                raise ExternalMediaProcessError("External media command reported diagnostics")
            return bytes(stdout)
        finally:
            try:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=2.0)
            finally:
                try:
                    for reader in readers:
                        if reader.ident is not None:
                            reader.join(timeout=2.0)
                finally:
                    manager.release(process)
                    if owned_manager:
                        manager.shutdown_and_wait()
