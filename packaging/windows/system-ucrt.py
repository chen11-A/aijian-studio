"""Record native input provenance and omit OS-owned UCRT only for Windows 10+ DEV.

Microsoft's Universal CRT deployment documentation says Windows 10/11 always
load the system UCRT. PyInstaller 6.22.3 depend/dylib.py records the same boundary.
No VCRuntime DLL or unclassified source is excluded by this helper.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

OS_DLL = re.compile(r"(?:api-ms-win-(?:core|crt)-[a-z0-9-]+|ucrtbase)\.dll", re.IGNORECASE)
OBSERVED = json.loads(Path(__file__).with_name("system-ucrt-inputs.json").read_text())
OS_DLL_NAMES = frozenset(item["name"] for item in OBSERVED["files"])


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def source_origin(path: Path, roots: dict[str, Path]) -> dict[str, str]:
    resolved = path.resolve(strict=True)
    if any(p.is_symlink() or p.is_junction() for p in (path, *path.parents)):
        raise ValueError("Native build inputs cannot follow links or junctions")
    for name, root in roots.items():
        if root == resolved or root in resolved.parents:
            return {
                "kind": name.split(":", 1)[0],
                "root_label": name,
                "relative_path": resolved.relative_to(root).as_posix(),
            }
    return {"kind": "UNCLASSIFIED", "relative_path": path.name}


def pe_version(path: Path) -> str:
    import pefile

    image = pefile.PE(str(path), fast_load=True)
    try:
        image.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]]
        )
        info = getattr(image, "VS_FIXEDFILEINFO", [])
        if len(info) != 1:
            raise ValueError("Expected exact PE fixed version metadata for an OS DLL")
        value = info[0]
        return ".".join(
            str(part)
            for part in (
                value.FileVersionMS >> 16,
                value.FileVersionMS & 65535,
                value.FileVersionLS >> 16,
                value.FileVersionLS & 65535,
            )
        )
    finally:
        image.close()


def partition_inputs(binaries: list, roots: dict[str, Path]) -> tuple[list, dict]:
    kept, native, excluded = [], [], []
    for entry in binaries:
        destination, source, kind = entry
        path = Path(source)
        if path.suffix.lower() not in {".dll", ".pyd", ".exe"}:
            kept.append(entry)
            continue
        origin = source_origin(path, roots)
        record = {"destination": destination, "sha256": digest(path), "origin": origin}
        native.append(record)
        if OS_DLL.fullmatch(Path(destination).name):
            if (
                Path(destination).name.lower() not in OS_DLL_NAMES
                or Path(destination).name.lower() != path.name.lower()
                or kind != "BINARY"
                or origin["kind"] not in {"WINDOWS_SYSTEM32", "WINDOWS_SDK_UCRT"}
            ):
                raise ValueError("OS UCRT exclusion requires a classified Windows system/SDK input")
            record = {**record, "file_version": pe_version(path)}
            excluded.append(record)
        else:
            kept.append(entry)
    return kept, {
        "schema_version": 1,
        "profile": "DEVELOPMENT_CORE",
        "minimum_windows_major": 10,
        "ucrt_resolution": "OPERATING_SYSTEM",
        "native_inputs": native,
        "excluded_os_runtime_inputs": excluded,
        "release_approved": False,
    }


def prepare(binaries: list, output: Path) -> list:
    if sys.platform != "win32" or sys.getwindowsversion().major < 10:
        raise RuntimeError("Development core freezing requires Windows 10 or later")
    system = Path(os.environ["SystemRoot"]).resolve(strict=True)
    roots = {"WINDOWS_SYSTEM32": system / "System32"}
    sdk = Path(os.environ["ProgramFiles(x86)"]) / "Windows Kits/10/Redist"
    # Only the UCRT SDK subtree is eligible, not arbitrary files in Windows Kits.
    if sdk.is_dir():
        for candidate in [sdk / "ucrt/DLLs/x64", *sorted(sdk.glob("*/ucrt/DLLs/x64"))]:
            if candidate.is_dir():
                roots["WINDOWS_SDK_UCRT:" + candidate.parents[2].name] = candidate
    roots.update({"BUILD_ENVIRONMENT": Path(sys.prefix), "PINNED_PYTHON": Path(sys.base_prefix)})
    kept, evidence = partition_inputs(binaries, roots)
    version = sys.getwindowsversion()
    evidence["build_windows_version"] = {
        "major": version.major,
        "minor": version.minor,
        "build": version.build,
    }
    if not output.is_absolute() or output.exists():
        raise ValueError("Use a fresh absolute development-runtime evidence path")
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    return kept
