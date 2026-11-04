"""Prepare the exact external media pair for zero-upload Windows CI tests only.

This is not a packaging input. It never runs FFmpeg/FFprobe, changes application
resources, or copies media binaries into evidence. Success prints only the bin
path; the separate JSON receipt is the machine-readable preparation contract.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WINDOWS = ROOT / "packaging/windows"
MEDIA_LOCK = ROOT / "config/media-toolchain-lock.json"
USAGE = "TEST_ONLY_NOT_FOR_DISTRIBUTION"
ARCHIVE_ROOT = "ffmpeg-8.1.2-full_build"
PROFILE_ID = "windows-x86_64-gyan-full-8.1.2-dev"
PINNED_ARCHIVES = {
    "ffmpeg-development": {
        "version": "8.1.2",
        "path": "downloads/ffmpeg-8.1.2-full_build.7z",
        "url": "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-full_build.7z",
        "sha256": "0fff188997a499b5382e0f66e845d4556c48c54f0113ebed4853d556dbdd7059",
        "usage": "DEVELOPMENT_ONLY_NOT_FOR_DISTRIBUTION",
    },
    "7zip-win-x64": {
        "version": "1.0.0",
        "path": "downloads/7zip-win-x64.tar.gz",
        "url": "https://github.com/electron-userland/electron-builder-binaries/releases/download/7zip%401.0.0/7zip-win-x64.tar.gz",
        "sha256": "be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3",
        "usage": "BUILD_TOOL_ONLY",
    },
}
PINNED_BINARIES = {
    "ffmpeg.exe": "ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e",
    "ffprobe.exe": "9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015",
}
RESERVED = re.compile(r"^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)", re.I)


def load_helper(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, WINDOWS / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load checked-in Windows preparation helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_host() -> None:
    if sys.platform != "win32":
        raise RuntimeError("External media preparation requires the authorized Windows CI runner")
    required = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": "chen11-A/aijian-studio",
        "GITHUB_REF": "refs/heads/codex/windows-installer-dev-20261008",
        "AIVORA_ARTIFACT_UPLOAD_ALLOWED": "false",
    }
    for key, expected in required.items():
        if os.environ.get(key) != expected:
            raise RuntimeError(f"External media preparation requires {key}={expected}")


def safe_component(value: str) -> bool:
    return (
        bool(value)
        and value not in {".", ".."}
        and not value.endswith((" ", "."))
        and not RESERVED.match(value)
        and not any(ord(char) < 32 or char in '<>:"/\\|?*~' for char in value)
    )


def plain_path(path: Path, helper) -> Path:
    helper.plain_path(path)
    if os.name == "nt" and not re.fullmatch(r"[A-Za-z]:", path.drive):
        raise ValueError("Only a local drive path is allowed")
    for part in path.parts[1:]:
        if not safe_component(part):
            raise ValueError("Windows path aliases and special names are not allowed")
    for part in (path, *path.parents):
        if part.exists():
            info = part.lstat()
            if getattr(info, "st_file_attributes", 0) & 0x400:
                raise ValueError("Reparse points are not allowed")
            if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise ValueError("Hard-linked files are not allowed")
    if os.path.normcase(str(path.resolve())) != os.path.normcase(str(path)):
        raise ValueError("Aliased paths are not allowed")
    return path


def overlaps(left: Path, right: Path) -> bool:
    return left == right or left.is_relative_to(right) or right.is_relative_to(left)


def validate_paths(cache: Path, tools: Path, output: Path, report: Path, helper) -> None:
    runner_temp = plain_path(Path(os.environ.get("RUNNER_TEMP", "")), helper)
    if not runner_temp.is_dir():
        raise ValueError("RUNNER_TEMP must be an existing local directory")
    for path in (cache, tools, output, report):
        plain_path(path, helper)
    if cache != runner_temp / "aivora-tool-cache" or not cache.is_dir():
        raise ValueError("--cache must be the existing RUNNER_TEMP/aivora-tool-cache")
    if tools != runner_temp / "aivora-tools" or not tools.is_dir():
        raise ValueError("--tools must be the existing RUNNER_TEMP/aivora-tools")
    if output != runner_temp / "aivora-external-media-tools" or output.exists():
        raise ValueError("--output must be a fresh RUNNER_TEMP/aivora-external-media-tools")
    if not report.is_relative_to(runner_temp) or report.suffix != ".json" or report.exists():
        raise ValueError("--report must be a fresh JSON file beneath RUNNER_TEMP")
    protected = [cache, tools, ROOT]
    workspace = os.environ.get("GITHUB_WORKSPACE")
    if workspace:
        protected.append(plain_path(Path(workspace), helper))
    # Keep this test fixture out of all existing installer, app, evidence and
    # delivery inputs, even when the report is placed in its own subdirectory.
    protected.extend(
        runner_temp / name
        for name in (
            "aivora-frozen",
            "aivora-stage",
            "aivora-evidence",
            "aivora-delivery",
            "aivora-installed",
            "aivora-workspace",
        )
    )
    if overlaps(output, report) or any(
        overlaps(path, boundary) for path in (output, report) for boundary in protected
    ):
        raise ValueError("External test paths overlap a protected source/build/output directory")


def pinned_inputs(helper) -> tuple[dict, dict]:
    lock = json.loads(helper.LOCK.read_text(encoding="utf-8"))
    helper.validate_lock(lock)
    helper.verify_source_locks(lock)
    selected = {}
    for name, expected in PINNED_ARCHIVES.items():
        matches = [item for item in lock["downloads"] if item.get("id") == name]
        if len(matches) != 1 or any(matches[0].get(k) != v for k, v in expected.items()):
            raise ValueError(f"The approved fixed archive lock changed: {name}")
        selected[name] = matches[0]
    media = json.loads(MEDIA_LOCK.read_text(encoding="utf-8"))
    profiles = media.get("profiles", [])
    if media.get("schema_version") != 1 or media.get("expected_version") != "8.1.2":
        raise ValueError("The external media version lock changed")
    if len(profiles) != 1:
        raise ValueError("Expected exactly one locked development-only media profile")
    profile = profiles[0]
    expected_profile = {
        "profile_id": PROFILE_ID,
        "ffmpeg_sha256": PINNED_BINARIES["ffmpeg.exe"],
        "ffprobe_sha256": PINNED_BINARIES["ffprobe.exe"],
        "source_url": "https://www.gyan.dev/ffmpeg/builds/",
        "license_class": "GPL",
        "spdx_license": "GPL-3.0-or-later",
        "distribution_status": "DEVELOPMENT_ONLY",
    }
    if profile != expected_profile:
        raise ValueError("The exact development-only media binary profile changed")
    return selected["ffmpeg-development"], selected["7zip-win-x64"]


def archive_name(name: str, core) -> str:
    # 7-Zip uses host separators in technical listings; normalize them before
    # applying the existing archive safety convention and stricter Windows rules.
    normalized = name.replace("\\", "/")
    if not core.safe_archive_name(normalized) or any(
        not safe_component(part) for part in normalized.rstrip("/").split("/")
    ):
        raise ValueError("Unsafe or aliased archive member")
    return normalized.rstrip("/")


def verify_sevenzip(cache: Path, tools: Path, item: dict, helper, core) -> tuple[Path, str]:
    source = plain_path(cache / item["path"], helper)
    if not source.is_file() or helper.digest(source) != item["sha256"]:
        raise ValueError("The existing pinned 7-Zip archive is missing or differs")
    receipt_path = plain_path(tools / "DEV-TOOLS.json", helper)
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    executable = plain_path(tools / "sevenzip/7zip/bin/7za.exe", helper)
    if (
        receipt.get("schema_version") != 1
        or receipt.get("kind") != "development-core-build-tools"
        or receipt.get("release_approved") is not False
        or receipt.get("media_cli_included") is not False
        or receipt.get("cache") != str(cache)
        or receipt.get("environment", {}).get("ELECTRON_BUILDER_7ZIP_PATH") != str(executable)
    ):
        raise ValueError("DEV-TOOLS.json does not identify the existing fixed build tools")
    archived = [entry for entry in receipt.get("files", []) if entry.get("path") == item["path"]]
    if len(archived) != 1 or archived[0].get("sha256") != item["sha256"]:
        raise ValueError("DEV-TOOLS.json lacks the pinned 7-Zip archive receipt")
    if not executable.is_file():
        raise ValueError("The prepared 7za.exe is missing")
    found = None
    seen = set()
    with tarfile.open(source) as archive:
        for entry in archive.getmembers():
            if not core.safe_archive_name(entry.name):
                raise ValueError("Unsafe member in the fixed 7-Zip archive")
            name = archive_name(entry.name, core)
            if not (entry.isfile() or entry.isdir()) or name.casefold() in seen:
                raise ValueError("Unsafe member in the fixed 7-Zip archive")
            seen.add(name.casefold())
            if name == "7zip/bin/7za.exe":
                if not entry.isfile() or not 0 < entry.size <= 64 * 1024 * 1024:
                    raise ValueError("Invalid 7za.exe archive member")
                with archive.extractfile(entry) as stream:
                    found = hashlib.file_digest(stream, "sha256").hexdigest()
    if found is None or helper.digest(executable) != found:
        raise ValueError("Prepared 7za.exe differs from its pinned archive bytes")
    return executable, found


def validate_listing(listing: str, core) -> dict[str, int]:
    if len(listing) > 4 * 1024 * 1024 or "\x00" in listing:
        raise ValueError("Unexpected archive listing size or encoding")
    records = []
    entry = {}
    for line in [*listing.splitlines(), ""]:
        if not line.strip():
            if entry:
                records.append(entry)
                entry = {}
            continue
        key, separator, value = line.partition(" = ")
        if not separator or key in entry:
            raise ValueError("Malformed technical archive listing")
        entry[key] = value
    if not records or len(records) > 4096:
        raise ValueError("Unexpected archive member count")
    seen = {}
    required = {f"{ARCHIVE_ROOT}/bin/{name}" for name in PINNED_BINARIES}
    for record in records:
        name = archive_name(record.get("Path", ""), core)
        if not (name == ARCHIVE_ROOT or name.startswith(ARCHIVE_ROOT + "/")):
            raise ValueError("Archive member is outside the fixed version root")
        if name.casefold() in seen:
            raise ValueError("Duplicate or case-aliased archive member")
        if any(token in key.lower() for key in record for token in ("link", "stream", "reparse")):
            raise ValueError("Links, reparse points and alternate streams are not allowed")
        attributes = record.get("Attributes", "")
        if not re.fullmatch(r"[DRAHS_ ]+", attributes):
            raise ValueError("Unexpected archive member attributes")
        folder = record.get("Folder")
        is_directory = "D" in attributes
        if folder not in {None, "+", "-"} or (
            folder is not None and (folder == "+") != is_directory
        ):
            raise ValueError("Inconsistent archive member kind")
        if record.get("Encrypted", "-") != "-" or record.get("Anti", "-") != "-":
            raise ValueError("Encrypted or anti-items are not allowed")
        size_text = record.get("Size", "")
        if not re.fullmatch(r"[0-9]+", size_text):
            raise ValueError("Invalid archive member size")
        size = int(size_text)
        if size > 1024 * 1024 * 1024 or (is_directory and size != 0):
            raise ValueError("Unexpected archive member size")
        seen[name.casefold()] = (name, is_directory, size)
    for name, _, _ in seen.values():
        parents = Path(name).parents
        if any(
            parent.as_posix().casefold() in seen and not seen[parent.as_posix().casefold()][1]
            for parent in parents
        ):
            raise ValueError("File/directory alias in archive")
    result = {}
    for name in required:
        match = seen.get(name.casefold())
        if match is None or match[0] != name or match[1] or match[2] <= 0:
            raise ValueError("The archive lacks the exact same-bin media pair")
        result[name] = match[2]
    return result


def run_sevenzip(executable: Path, arguments: list[str], runner_temp: Path) -> str:
    # Avoid unrelated executables/DLLs on the runner PATH or checkout working dir.
    windows = Path(os.environ["SystemRoot"])
    return subprocess.run(
        [str(executable), *arguments],
        check=True,
        timeout=300,
        cwd=runner_temp,
        env={
            "SystemRoot": str(windows),
            "WINDIR": str(windows),
            "PATH": os.pathsep.join((str(windows / "System32"), str(windows))),
            "TEMP": str(runner_temp),
            "TMP": str(runner_temp),
        },
        stdin=subprocess.DEVNULL,
        capture_output=True,
        encoding="utf-8",
        errors="strict",
        shell=False,
    ).stdout


def verify_output(output: Path, members: dict[str, int], helper) -> Path:
    expected = set(members)
    found = set()
    for path in output.rglob("*"):
        plain_path(path, helper)
        name = path.relative_to(output).as_posix()
        if path.is_dir():
            if name not in {ARCHIVE_ROOT, f"{ARCHIVE_ROOT}/bin"}:
                raise ValueError("Unexpected extraction directory")
            continue
        if not path.is_file() or name not in expected:
            raise ValueError("Unexpected file in external test-only extraction")
        if (
            path.stat().st_size != members[name]
            or helper.digest(path) != PINNED_BINARIES[path.name]
        ):
            raise ValueError("Extracted media executable differs from its exact pinned bytes")
        found.add(name)
    if found != expected:
        raise ValueError("Incomplete external test-only media extraction")
    return plain_path(output / ARCHIVE_ROOT / "bin", helper)


def prepare(cache: Path, tools: Path, output: Path, report: Path, *, offline: bool) -> Path:
    validate_host()
    helper = load_helper("external_media_prerequisites", "prepare-prerequisites.py")
    core = load_helper("external_media_core", "prepare-dev-core.py")
    validate_paths(cache, tools, output, report, helper)
    media, sevenzip_item = pinned_inputs(helper)
    sevenzip, sevenzip_sha = verify_sevenzip(cache, tools, sevenzip_item, helper, core)
    # This is the only permitted download. The fixed 7-Zip input must already
    # exist from the ordinary build-tool step; no custom URL/version is accepted.
    receipt = helper.fetch(media, cache, offline=offline)
    archive = plain_path(cache / media["path"], helper)
    runner_temp = Path(os.environ["RUNNER_TEMP"])
    members = validate_listing(
        run_sevenzip(sevenzip, ["l", "-slt", "-ba", "-sccUTF-8", str(archive)], runner_temp),
        core,
    )
    # Recheck immediately before extraction; do not trust an earlier invocation
    # or the DEV-TOOLS receipt as evidence of the actual executable bytes.
    verify_sevenzip(cache, tools, sevenzip_item, helper, core)
    if helper.digest(archive) != media["sha256"]:
        raise ValueError("Media archive changed after listing")
    validate_paths(cache, tools, output, report, helper)
    output.mkdir()
    run_sevenzip(
        sevenzip,
        ["x", str(archive), "-o" + str(output), "-y", "-bd", "-bb0", "-sccUTF-8", *sorted(members)],
        runner_temp,
    )
    toolchain_root = verify_output(output, members, helper)
    result = {
        "schema_version": 1,
        "result": "EXTERNAL_MEDIA_TEST_INPUTS_PREPARED",
        "usage": USAGE,
        "target": "win32-x64",
        "toolchain_root": str(toolchain_root),
        "extraction_root": str(output),
        "profile_id": PROFILE_ID,
        "release_approved": False,
        "formal_release_approved": False,
        "release_distribution_permitted": False,
        "artifact_upload_allowed": False,
        "media_execution": "NOT_RUN",
        "archive": {"id": media["id"], "version": media["version"], **receipt},
        "binaries": dict(PINNED_BINARIES),
        "extractor": {"archive_sha256": sevenzip_item["sha256"], "executable_sha256": sevenzip_sha},
        "source_sha256": {
            "downloads.lock.json": helper.digest(helper.LOCK),
            "media-toolchain-lock.json": helper.digest(MEDIA_LOCK),
            "prepare-windows-external-media.py": helper.digest(Path(__file__)),
        },
    }
    plain_path(report, helper)
    report.parent.mkdir(parents=True, exist_ok=True)
    with report.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(result, indent=2) + "\n")
    return toolchain_root


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("cache", "tools", "output", "report"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--offline", action="store_true", help="Use only the existing pinned cache")
    args = parser.parse_args()
    print(prepare(args.cache, args.tools, args.output, args.report, offline=args.offline))


if __name__ == "__main__":
    main()
