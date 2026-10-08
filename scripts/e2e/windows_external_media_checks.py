"""Real bounded Windows media proof/fixtures for the zero-upload hosted-runner test.

Never run this against a personal profile. No encoder fallback, downloads, mocks,
credentials, permission changes, installer staging or artifact upload are provided.
"""

from __future__ import annotations

import argparse
import array
import ctypes
import hashlib
import importlib.util
import json
import math
import os
import queue
import re
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
import zlib
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
_STAGE = "startup"
_COMPLETED_CHECKS: dict = {}
sys.path.insert(0, str(ROOT / "services/api/src"))
from aijian_api import external_media_process as media  # noqa: E402
from aijian_api.product_export_windows_job import ProductExportJobManager  # noqa: E402


def require_host() -> Path:
    if (
        sys.platform != "win32"
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != "chen11-A/aijian-studio"
        or os.environ.get("GITHUB_REF") != "refs/heads/codex/windows-installer-dev-20261008"
        or os.environ.get("AIVORA_ARTIFACT_UPLOAD_ALLOWED") != "false"
        or not re.fullmatch(r"[0-9a-f]{40}", os.environ.get("GITHUB_SHA", ""))
    ):
        raise RuntimeError("Requires the authorized zero-upload fresh Windows CI branch")
    temporary = plain(Path(os.environ["RUNNER_TEMP"]))
    expected_python = temporary / "aivora-frozen/build-env/Scripts/python.exe"
    if plain(Path(sys.executable)).resolve() != plain(expected_python).resolve():
        raise RuntimeError("Use the pinned frozen build-environment Python interpreter")
    return temporary


def plain(path: Path) -> Path:
    if not path.is_absolute() or ".." in path.parts or str(path).startswith("\\\\"):
        raise ValueError("Expected a plain absolute local path")
    for item in (path, *path.parents):
        if item.is_symlink() or getattr(item, "is_junction", lambda: False)():
            raise ValueError("Test paths cannot traverse links or junctions")
    if path.exists() and path.resolve() != path:
        raise ValueError("Test path spelling differs from its resolved path")
    return path


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def write_json(path: Path, value: dict) -> None:
    data = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(data) > 128 * 1024:
        raise ValueError("Nonbinary evidence exceeds its bound")
    with plain(path).open("xb") as stream:
        stream.write(data)


def tools(root: Path, temporary: Path) -> Path:
    expected = temporary / "aivora-external-media-tools/ffmpeg-8.1.2-full_build/bin"
    if plain(root) != expected:
        raise ValueError("Media test tools must remain in their separate test-only directory")
    with media.guarded_external_pair(root):
        pass
    return root


def command(
    root: Path, arguments: list[str], *, probe=False, limit=4 * 1024**2, timeout=60
) -> bytes:
    return media.run_external_command(
        root / ("ffprobe.exe" if probe else "ffmpeg.exe"),
        arguments,
        timeout,
        max_output_bytes=limit,
    )


def png(path: Path, rgb: tuple[int, int, int], marker: int | None = None) -> None:
    width, height = 1280, 720

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    normal = bytes(rgb) * width
    row = (
        normal
        if marker is None
        else normal[: marker * 3] + b"\xff" * 16 * 3 + normal[(marker + 16) * 3 :]
    )
    raw = b"".join(b"\0" + (row if 32 <= y < 112 else normal) for y in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 3))
        + chunk(b"IEND", b"")
    )


def generate_inputs(root: Path, work: Path) -> dict:
    inputs = work / "inputs"
    inputs.mkdir()
    result = {}
    for name, rgb in (("clip_a", (0, 0, 255)), ("clip_b", (255, 0, 0))):
        frames = inputs / (name + "-frames")
        frames.mkdir()
        for index in range(72):
            png(frames / f"frame-{index:03d}.png", rgb, 32 + 8 * index)
        output = inputs / (name + " 合成视频.mp4")
        command(
            root,
            [
                "-v",
                "error",
                "-nostdin",
                "-n",
                "-threads",
                "2",
                "-framerate",
                "24",
                "-start_number",
                "0",
                "-i",
                str(frames / "frame-%03d.png"),
                "-frames:v",
                "72",
                "-an",
                "-c:v",
                "libx264",
                "-threads",
                "2",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
                str(output),
            ],
            timeout=120,
        )
        result[name] = {
            "path": str(output),
            "sha256": digest(output),
            "bytes": output.stat().st_size,
        }
    bgm = inputs / "bgm 合成.wav"
    samples = array.array("h")
    for index in range(4 * 48000):
        amplitude = 2500 if index < 2 * 48000 else 8500
        value = int(amplitude * math.sin(2 * math.pi * 440 * index / 48000))
        samples.extend((value, value))
    if sys.byteorder != "little":
        samples.byteswap()
    with wave.open(str(bgm), "wb") as stream:
        stream.setparams((2, 2, 48000, 0, "NONE", "not compressed"))
        stream.writeframes(samples.tobytes())
    still = inputs / "cancel 合成.png"
    png(still, (0, 0, 255))
    for name, path in [("bgm", bgm), ("cancel_still", still)]:
        result[name] = {"path": str(path), "sha256": digest(path), "bytes": path.stat().st_size}
    if any(item["bytes"] > 8 * 1024**2 for item in result.values()):
        raise AssertionError("Synthetic media exceeded its per-file bound")
    return result


def observe_process(process, expected_exe: Path) -> dict:
    from ctypes import wintypes

    kernel = media._windows_dll("kernel32")
    kernel.GetProcessMitigationPolicy.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_size_t,
    ]
    kernel.GetProcessMitigationPolicy.restype = wintypes.BOOL
    policies = {}
    for name, policy, required in [("signature", 8, 1), ("image_load", 10, 7)]:
        flags = wintypes.DWORD()
        if not kernel.GetProcessMitigationPolicy(
            process._process, policy, ctypes.byref(flags), ctypes.sizeof(flags)
        ):
            raise RuntimeError("Actual child mitigation policy cannot be read")
        if flags.value & required != required:
            raise AssertionError("Actual child process mitigation differs from policy")
        policies[name] = flags.value
    in_job = wintypes.BOOL()
    if (
        not process._api.IsProcessInJob(process._process, process._job, ctypes.byref(in_job))
        or not in_job.value
    ):
        raise AssertionError("Actual encoder is outside its private job")
    psapi = media._windows_dll("psapi")
    psapi.EnumProcessModulesEx.argtypes = [
        wintypes.HANDLE,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        wintypes.DWORD,
    ]
    psapi.EnumProcessModulesEx.restype = wintypes.BOOL
    psapi.GetModuleFileNameExW.argtypes = [
        wintypes.HANDLE,
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.DWORD,
    ]
    psapi.GetModuleFileNameExW.restype = wintypes.DWORD
    modules = (wintypes.HMODULE * 1024)()
    required_bytes = wintypes.DWORD()
    if not psapi.EnumProcessModulesEx(
        process._process, modules, ctypes.sizeof(modules), ctypes.byref(required_bytes), 3
    ):
        raise RuntimeError("Actual child module inventory cannot be read")
    count = required_bytes.value // ctypes.sizeof(wintypes.HMODULE)
    if not 2 <= count <= 1024:
        raise AssertionError("Actual child module inventory is not bounded")
    windows = Path(os.environ["SystemRoot"]).resolve()
    names, main_seen = [], False
    for handle in modules[:count]:
        buffer = ctypes.create_unicode_buffer(32768)
        size = psapi.GetModuleFileNameExW(process._process, handle, buffer, len(buffer))
        if not 0 < size < len(buffer):
            raise RuntimeError("Actual module path cannot be read")
        path = Path(buffer.value).resolve()
        if path == expected_exe.resolve():
            main_seen = True
        elif windows not in path.parents:
            raise AssertionError("Actual encoder loaded a module outside Windows system storage")
        names.append(path.name)
    if not main_seen or not any(name.lower() == "kernel32.dll" for name in names):
        raise AssertionError("Actual encoder/system modules were not observed")
    return {
        "mitigation_flags": policies,
        "private_job_membership": True,
        "loaded_module_names": sorted(names),
        "loaded_dependencies_under_windows": True,
    }


def process_boundary(root: Path) -> dict:
    before = {name: digest(root / name) for name in ("ffmpeg.exe", "ffprobe.exe")}
    denied = []
    with media.guarded_external_pair(root), media.external_process_session() as (cwd, env):
        if root == cwd or root in cwd.parents:
            raise AssertionError("Private cwd overlaps tool storage")
        with media._hold_directory(media._api(), cwd, read_security=True) as handle:
            media._verify_private_directory_security(media._api(), handle)
        for path in (root / "ffmpeg.exe", root / "ffprobe.exe"):
            try:
                with path.open("r+b"):
                    pass
            except OSError:
                denied.append(path.name + ":write-open")
            else:
                raise AssertionError("Held tool accepted a writable handle")
            other = path.with_name(path.name + ".unexpected-rename")
            try:
                path.rename(other)
            except OSError:
                denied.append(path.name + ":rename")
            else:
                other.rename(path)
                raise AssertionError("Held tool accepted rename")
        other_root = root.with_name("bin-unexpected-rename")
        try:
            root.rename(other_root)
        except OSError:
            denied.append("bin:rename")
        else:
            other_root.rename(root)
            raise AssertionError("Held tool directory accepted rename")
        manager = ProductExportJobManager()
        process = manager.spawn(
            root / "ffmpeg.exe",
            [
                "-v",
                "error",
                "-nostdin",
                "-re",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64:r=24:d=12",
                "-t",
                "12",
                "-f",
                "null",
                "-",
            ],
            cwd=cwd,
            env=env,
            hardened_external_media=True,
        )
        try:
            time.sleep(0.5)
            if process.poll() is not None:
                raise AssertionError("Real guarded process exited before observation")
            observed = observe_process(process, root / "ffmpeg.exe")
            process.terminate()
            process.wait(timeout=5)
            if process._active_processes() != 0:
                raise AssertionError("Actual job cancellation left descendants")
        finally:
            manager.release(process)
            manager.shutdown_and_wait()
    # No writes occur: opening an existing write handle must make admission fail.
    with (root / "ffmpeg.exe").open("r+b"):
        try:
            with media.guarded_external_pair(root):
                raise AssertionError("Admission ignored an existing writable tool handle")
        except media.ExternalMediaProcessError:
            pass
    assert before == {name: digest(root / name) for name in before}
    return {
        "result": "PASS",
        "actual_windows_execution": True,
        "held_handle_mutations_denied": denied,
        "preexisting_write_handle_refused": True,
        "actual_protected_dacl_readback": True,
        "private_session_removed": not cwd.exists(),
        "minimal_launch_environment_keys": sorted(env),
        "actual_job_cancellation_no_descendants": True,
        **observed,
    }


def load_component_smoke():
    spec = importlib.util.spec_from_file_location(
        "component_smoke", ROOT / "packaging/windows/smoke-frozen-sidecar.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextmanager
def frozen_with_overrides(resources: Path, workspace: Path, override: dict):
    allowed = {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "COMSPEC",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "SYSTEMDRIVE",
        "PROCESSOR_ARCHITECTURE",
        "NUMBER_OF_PROCESSORS",
    }
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update(
        AIJIAN_RESOURCE_ROOT=str(resources),
        AIJIAN_DATA_DIR=str(workspace),
        AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME="0",
        **override,
    )
    executable = resources / "sidecar/aijian-sidecar.exe"
    with tempfile.TemporaryFile(mode="w+") as errors:
        process = subprocess.Popen(
            [str(executable)],
            cwd=executable.parent,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
        )
        try:
            ready = queue.Queue()
            threading.Thread(
                target=lambda: ready.put(process.stdout.readline()), daemon=True
            ).start()
            handshake = json.loads(ready.get(timeout=45))
            assert handshake["event"] == "ready" and handshake["pid"] == process.pid
            deadline = time.monotonic() + 20
            while True:
                try:
                    status, body = request(handshake, "GET", "/api/v1/health")
                    assert status == 200 and body["data"]["status"] == "ok"
                    break
                except (urllib.error.URLError, ConnectionError):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.1)
            yield handshake
        finally:
            process.stdin.close()
            try:
                code = process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                raise
            process.stdout.close()
            if code:
                errors.seek(0)
                raise RuntimeError(
                    f"Frozen test sidecar did not stop cleanly: {code}; {errors.read(4096)}"
                )


def request(handshake: dict, method: str, path: str, body=None) -> tuple[int, dict]:
    host = f"127.0.0.1:{handshake['port']}"
    data = None if body is None else json.dumps(body).encode()
    headers = {
        "Authorization": "Bearer " + handshake["token"],
        "Origin": "app://aijian",
        "Content-Type": "application/json",
    }
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(
            urllib.request.Request("http://" + host + path, data, headers, method=method),
            timeout=120,
        )
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(2 * 1024**2 + 1)
        if len(raw) > 2 * 1024**2:
            raise ValueError("Frozen policy response exceeds limit")
        return response.status, json.loads(raw)


def assert_empty_formal_ledger(database: Path) -> None:
    # sqlite3.Connection.__exit__ ends transactions but does not close handles.
    # Close before the enclosing Windows TemporaryDirectory removes the DB.
    with closing(sqlite3.connect(database)) as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM product_export_operations").fetchone()[0] == 0
        )


def frozen_policy(resources: Path, root: Path) -> dict:
    helper = load_component_smoke()
    results = []
    for override in (
        {"AIJIAN_DRAFT_MEDIA_TOOL_ROOT": str(root)},
        {"AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK": str(resources / "config/media-toolchain-lock.json")},
    ):
        with helper.synthetic_packaged_workspace() as workspace:
            with frozen_with_overrides(resources, workspace, override) as session:
                status, body = request(session, "GET", "/api/v1/local-media-toolchain/status")
                assert status == 200 and body["state"] == "INVALID"
                assert not any(
                    body[key] for key in ("can_probe", "can_preview", "can_draft_export")
                )
                selected_status, selected = request(
                    session,
                    "PUT",
                    "/api/v1/local-media-toolchain/selection",
                    {"directory": str(root)},
                )
                assert selected_status == 200 and selected["state"] == "INVALID"
                results.append(next(iter(override)))
    with helper.synthetic_packaged_workspace() as workspace:
        with frozen_with_overrides(resources, workspace, {}) as session:
            status, project = request(
                session,
                "POST",
                "/api/v1/projects",
                {
                    "name": "Synthetic closed formal gate",
                    "aspect_ratio": "9:16",
                    "target_duration_seconds": 30,
                    "source_language": "zh-CN",
                },
            )
            assert status == 201
            project_id = project["data"]["id"]
            _, episodes = request(session, "GET", f"/api/v1/projects/{project_id}/episodes")
            episode_id = episodes["data"][0]["id"]
            status, body = request(
                session,
                "POST",
                f"/api/v1/projects/{project_id}/episodes/{episode_id}/product-exports",
                {
                    "operation_id": "peop_" + uuid4().hex,
                    "assembly": {
                        "artifact_id": "art_" + "1" * 32,
                        "version_id": "ver_" + "2" * 32,
                        "content_hash": "sha256:" + "3" * 64,
                        "head_revision": 1,
                    },
                    "media_rights": [],
                    "spec": {
                        "container": "MP4",
                        "width": 1280,
                        "height": 720,
                        "frame_rate_num": 24,
                        "frame_rate_den": 1,
                        "video_codec": "H264",
                        "audio_codec": "AAC",
                    },
                    "output_relative_path": "never-publish.mp4",
                },
            )
            assert status == 409 and body["error"]["code"] == "RELEASE_TOOLCHAIN_NOT_APPROVED"
        assert_empty_formal_ledger(workspace / "workspace.sqlite3")
    return {
        "result": "PASS",
        "frozen_override_variables_rejected": results,
        "formal_export": "RELEASE_TOOLCHAIN_NOT_APPROVED",
        "formal_ledger_rows": 0,
    }


def verify_output(root: Path, path: Path) -> dict:
    metadata = json.loads(
        command(
            root,
            [
                "-v",
                "error",
                "-count_frames",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ],
            probe=True,
        )
    )
    streams = metadata["streams"]
    video = next(item for item in streams if item["codec_type"] == "video")
    audio = next(item for item in streams if item["codec_type"] == "audio")
    assert len(streams) == 2 and video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
    assert (video["width"], video["height"], int(video["nb_read_frames"])) == (1280, 720, 96)
    assert video["avg_frame_rate"] == "24/1"
    assert (
        audio["codec_name"] == "aac" and audio["channels"] == 2 and audio["sample_rate"] == "48000"
    )
    assert abs(float(metadata["format"]["duration"]) - 4) < 0.08
    tags = metadata["format"]["tags"]
    assert tags["title"] == "AIVORA DRAFT" and "No release approval" in tags["comment"]

    def frame(index):
        raw = command(
            root,
            [
                "-v",
                "error",
                "-nostdin",
                "-i",
                str(path),
                "-vf",
                f"select=eq(n\\,{index})",
                "-vsync",
                "0",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ],
        )
        assert len(raw) == 1280 * 720 * 3
        return raw

    def pixel(raw, x, y):
        position = (y * 1280 + x) * 3
        return tuple(raw[position : position + 3])

    first, middle, second = frame(0), frame(36), frame(48)
    assert pixel(first, 20, 20)[0] > 200 and pixel(first, 20, 20)[2] < 70
    assert pixel(second, 20, 20)[2] > 200 and pixel(second, 20, 20)[0] < 70
    assert min(pixel(first, 32 + 12 * 8 + 8, 60)) > 180
    assert min(pixel(second, 32 + 24 * 8 + 8, 60)) > 180
    assert min(pixel(first, 40, 60)) < 80 and min(pixel(second, 40, 60)) < 80
    bright = sum(
        1 for y in range(600, 695) for x in range(160, 1120) if min(pixel(middle, x, y)) > 180
    )
    assert bright > 500, "Actual subtitle glyph pixels were not observed"
    pcm = command(
        root,
        [
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "pipe:1",
        ],
    )
    samples = array.array("h", pcm)
    if sys.byteorder != "little":
        samples.byteswap()

    def rms(start, end):
        values = samples[int(start * 48000) * 2 : int(end * 48000) * 2]
        return math.sqrt(sum(value * value for value in values) / len(values))

    quiet, loud = rms(0.4, 1.6), rms(2.4, 3.6)
    assert quiet > 500 and loud / quiet > 2.5
    return {
        "schema_version": 1,
        "result": "PASS",
        "scope": "actual-guarded-output-decode",
        "filename": path.name,
        "sha256": digest(path),
        "bytes": path.stat().st_size,
        "frames": 96,
        "duration_seconds": 4,
        "width": 1280,
        "height": 720,
        "video_codec": "h264",
        "pixel_format": "yuv420p",
        "audio_codec": "aac",
        "sample_rate_hz": 48000,
        "channels": 2,
        "draft_metadata": True,
        "red_then_blue": True,
        "source_in_frames_verified": [12, 24],
        "subtitle_bright_pixels": bright,
        "bgm_rms": [round(quiet, 2), round(loud, 2)],
        "release_approved": False,
    }


def main() -> None:
    global _STAGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "verify"))
    parser.add_argument("--tool-root", type=Path, required=True)
    parser.add_argument("--work", type=Path)
    parser.add_argument("--resources", type=Path)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    temporary = require_host()
    work = temporary / "aivora-external-media-test"
    if (
        work not in plain(args.report).parents
        or args.report.exists()
        or args.report.suffix != ".json"
    ):
        raise ValueError("Use a new bounded JSON report under the separate media test directory")
    if args.mode == "prepare":
        if args.work != work or work.exists() or args.resources is None:
            raise ValueError(
                "Preparation needs its fresh exact test directory and installed resources"
            )
        resources = plain(args.resources)
        if resources != temporary / "AivoraDevCoreInstall/resources":
            raise ValueError("Use only this run installed resources")
        work.mkdir()
        _STAGE = "admit_pinned_pair"
        root = tools(args.tool_root, temporary)
        from aijian_api.local_media_toolchain import machine_settings_path

        setting = machine_settings_path()
        if setting is None or setting.exists():
            raise ValueError("Refuse pre-existing machine media settings")
        _STAGE = "actual_windows_process_boundary"
        boundary = process_boundary(root)
        _COMPLETED_CHECKS["process_boundary"] = boundary
        _STAGE = "actual_frozen_policy_refusal"
        policy = frozen_policy(resources, root)
        _COMPLETED_CHECKS["frozen_policy_refusal"] = policy
        _STAGE = "generate_synthetic_inputs"
        files = generate_inputs(root, work)
        value = {
            "schema_version": 1,
            "kind": "windows-external-media-synthetic-inputs",
            "candidate_head": os.environ["GITHUB_SHA"],
            "work_directory": str(work),
            "toolchain_root": str(root),
            "profile_id": media.PINNED_PROFILE_ID,
            "ffmpeg_sha256": media.PINNED_FFMPEG_SHA256,
            "ffprobe_sha256": media.PINNED_FFPROBE_SHA256,
            "python_executable": str(Path(sys.executable)),
            "files": files,
            "process_boundary": boundary,
            "frozen_policy_refusal": policy,
            "release_approved": False,
        }
    else:
        if args.input is None or not work.is_dir():
            raise ValueError("Verification needs an existing synthetic test and exact output")
        _STAGE = "admit_pinned_pair"
        root = tools(args.tool_root, temporary)
        path = plain(args.input)
        preview = plain(Path(os.environ["APPDATA"]) / "AIVORA Dev Core/composition-previews")
        if (
            not path.is_file()
            or path.suffix.lower() != ".mp4"
            or not (work in path.parents or preview in path.parents)
            or path.stat().st_size > 64 * 1024**2
        ):
            raise ValueError("Only bounded current-test MP4 outputs may be verified")
        _STAGE = "actual_output_decode"
        value = verify_output(root, path)
    write_json(args.report, value)
    print(
        json.dumps(
            {
                "result": value.get("result", "PREPARED"),
                "report": args.report.name,
                "release_approved": False,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Only this task's new JSON path may receive failure evidence. Never
        # dump the authenticated handshake, environment, media or subprocess pipes.
        try:
            position = sys.argv.index("--report") + 1
            target = plain(Path(sys.argv[position]))
            temporary = plain(Path(os.environ["RUNNER_TEMP"]))
            work = temporary / "aivora-external-media-test"
            if (
                sys.platform == "win32"
                and os.environ.get("GITHUB_ACTIONS") == "true"
                and os.environ.get("AIVORA_ARTIFACT_UPLOAD_ALLOWED") == "false"
                and work in target.parents
                and target.parent.is_dir()
                and not target.exists()
            ):
                write_json(
                    target,
                    {
                        "schema_version": 1,
                        "result": "FAIL",
                        "stage": _STAGE,
                        "failure_type": type(error).__name__,
                        "message": str(error)[:500],
                        "completed_checks": _COMPLETED_CHECKS,
                        "candidate_head": os.environ.get("GITHUB_SHA"),
                        "release_approved": False,
                    },
                )
        except (ValueError, OSError, KeyError, IndexError):
            pass
        print(
            json.dumps(
                {
                    "result": "FAIL",
                    "stage": _STAGE,
                    "failure_type": type(error).__name__,
                    "message": str(error)[:500],
                }
            ),
            file=sys.stderr,
        )
        raise
