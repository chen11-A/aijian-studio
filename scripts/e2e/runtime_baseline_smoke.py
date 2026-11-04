"""Exercise authenticated sidecar creation and persistence using an isolated workspace.

This does not contact a provider, read real credentials, or validate desktop UI.
"""

import base64
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


@contextmanager
def sidecar(data_dir: Path) -> Iterator[dict[str, Any]]:
    environment = {
        **os.environ,
        "AIJIAN_DATA_DIR": str(data_dir),
        "AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME": "0",
        "PYTHONPATH": str(ROOT / "services/api/src"),
    }
    with tempfile.TemporaryFile(mode="w+") as errors:
        process = subprocess.Popen(
            [sys.executable, "-m", "aijian_api.sidecar"],
            cwd=ROOT,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
        )
        try:
            ready: queue.Queue[str] = queue.Queue()
            assert process.stdout is not None
            threading.Thread(
                target=lambda: ready.put(process.stdout.readline()),
                daemon=True,
            ).start()
            handshake = json.loads(ready.get(timeout=20))
            assert handshake["event"] == "ready"
            deadline = time.monotonic() + 15
            while True:
                try:
                    assert request(handshake, "GET", "/api/v1/health")["data"]["status"] == "ok"
                    break
                except (urllib.error.URLError, ConnectionError):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.05)
            yield handshake
        finally:
            assert process.stdin is not None
            process.stdin.close()
            try:
                returncode = process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                raise
            assert process.stdout is not None
            process.stdout.close()
            if returncode != 0:
                errors.seek(0)
                raise RuntimeError(f"Sidecar exited with code {returncode}: {errors.read()}")


def request(
    handshake: dict[str, Any],
    method: str,
    path: str,
    payload: object = None,
) -> dict[str, Any]:
    host = f"127.0.0.1:{handshake['port']}"
    headers = {
        "Authorization": f"Bearer {handshake['token']}",
        "Origin": "app://aijian",
        "Content-Type": "application/json",
    }
    body = None if payload is None else json.dumps(payload).encode()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(
            urllib.request.Request(f"http://{host}{path}", body, headers, method=method),
            timeout=10,
        )
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code}: {error.read().decode()}") from None
    with response:
        return json.loads(response.read())  # type: ignore[no-any-return]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="aivora-baseline-") as temporary:
        data_dir = Path(temporary)
        with sidecar(data_dir) as first:
            project = request(
                first,
                "POST",
                "/api/v1/projects",
                {
                    "name": "Baseline persistence smoke",
                    "aspect_ratio": "9:16",
                    "target_duration_seconds": 30,
                    "source_language": "zh-CN",
                },
            )["data"]
            path = f"/api/v1/projects/{project['id']}"
            source = request(
                first,
                "POST",
                path + "/sources",
                {
                    "filename": "synthetic.txt",
                    "media_type": "text/plain",
                    "content_base64": base64.b64encode("第一章\n临时测试来源。".encode()).decode(),
                },
            )["data"]
            episode = request(
                first,
                "POST",
                path + "/episodes",
                {
                    "title": "Second synthetic episode",
                    "target_duration_seconds": "15",
                },
            )["data"]
            project = request(first, "GET", path)["data"]
            first_pid = first["pid"]
        with sidecar(data_dir) as second:
            assert first_pid != second["pid"]
            assert request(second, "GET", path)["data"] == project
            assert request(second, "GET", "/api/v1/projects")["data"] == [project]
            assert request(second, "GET", path + f"/sources/{source['id']}")["data"] == source
            assert request(second, "GET", path + f"/episodes/{episode['id']}")["data"] == episode
            assert len(request(second, "GET", path + "/episodes")["data"]) == 2
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "transport": "authenticated loopback HTTP",
                    "workspace": "temporary synthetic workspace",
                    "verified": [
                        "sidecar startup",
                        "project create",
                        "source import",
                        "two episodes",
                        "clean process shutdown",
                        "fresh-process reopen",
                        "exact readback",
                    ],
                    "external_provider_requests": 0,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
