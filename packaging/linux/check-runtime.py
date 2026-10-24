"""Check the bundled sidecar and the pinned FFmpeg pair. No window is opened."""

from __future__ import annotations

import hashlib
import json
import os
import selectors
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    root = Path(__file__).resolve().parent
    media = root / "runtime/ffmpeg/bin"
    lock = json.loads((root / "config/linux-desktop-media-lock.json").read_text(encoding="utf-8"))
    profile = lock["profiles"][0]
    ffmpeg = media / "ffmpeg"
    ffprobe = media / "ffprobe"
    if digest(ffmpeg) != profile["ffmpeg_sha256"] or digest(ffprobe) != profile["ffprobe_sha256"]:
        raise RuntimeError("Bundled FFmpeg does not match the package lock")
    version = subprocess.run(
        [str(ffmpeg), "-version"],
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    banner = version.stdout.splitlines()[0]
    if lock["expected_version"] not in banner or "--enable-gpl" not in version.stdout:
        raise RuntimeError(f"Bundled FFmpeg banner was not the pinned GPL build: {banner}")
    print(f"PASS: bundled FFmpeg {lock['expected_version']} {profile['profile_id']}")
    subprocess.run(
        [
            str(root / "runtime/electron/electron"),
            "-e",
            "require('@aijian/contracts/artifact-proposal');"
            "console.log('PASS: bundled Electron CommonJS contracts');",
        ],
        cwd=root / "apps/desktop",
        env={**os.environ, "ELECTRON_RUN_AS_NODE": "1", "NODE_OPTIONS": ""},
        check=True,
        timeout=20,
    )
    with tempfile.TemporaryDirectory(prefix="aivora-check-") as temporary:
        environment = {
            key: value for key, value in os.environ.items() if not key.startswith("AIJIAN_")
        }
        environment.update(
            AIJIAN_DATA_DIR=str(Path(temporary) / "workspace"),
            AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME="0",
            AIJIAN_DRAFT_MEDIA_TOOL_ROOT=str(media),
            AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK=str(root / "config/linux-desktop-media-lock.json"),
            PYTHONPATH=str(root / "services/api/src"),
            PYTHONIOENCODING="utf-8",
        )
        with tempfile.TemporaryFile(mode="w+") as error_log:
            process = subprocess.Popen(
                [str(root / ".venv/bin/python"), "-m", "aijian_api.sidecar"],
                cwd=root,
                env=environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=error_log,
                text=True,
            )
            try:
                assert process.stdout is not None
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    if not selector.select(timeout=25):
                        raise RuntimeError("Bundled sidecar did not become ready within 25 seconds")
                    handshake = json.loads(process.stdout.readline())
                assert handshake["event"] == "ready" and handshake["host"] == "127.0.0.1"
                request = urllib.request.Request(
                    f"http://127.0.0.1:{handshake['port']}/api/v1/health",
                    headers={
                        "Authorization": f"Bearer {handshake['token']}",
                        "Origin": "app://aijian",
                    },
                )
                deadline = time.monotonic() + 10
                while True:
                    try:
                        with urllib.request.urlopen(request, timeout=3) as response:
                            health = json.load(response)
                        break
                    except urllib.error.URLError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.1)
                status = health.get("data", health).get("status")
                if status != "ok":
                    raise RuntimeError(f"Unexpected health response: {health!r}")
                print("PASS: bundled Python sidecar health")
            finally:
                if process.stdin is not None:
                    process.stdin.close()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=5)
                if process.returncode != 0:
                    error_log.seek(0)
                    raise RuntimeError(
                        f"Bundled sidecar exited {process.returncode}: {error_log.read()}"
                    )
    print("PASS: sidecar shuts down after its parent pipe closes")


if __name__ == "__main__":
    main()
