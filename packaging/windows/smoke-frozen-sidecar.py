"""Windows-only component smoke using synthetic data; never contact a provider."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@contextmanager
def synthetic_packaged_workspace():
    """Use the same constrained workspace location as the installed application."""
    configured = os.environ.get("LOCALAPPDATA", "")
    root = Path(configured)
    if (
        not configured
        or configured != configured.strip()
        or not root.is_absolute()
        or not root.is_dir()
        or root.resolve(strict=True) != root
        or any(path.is_symlink() or path.is_junction() for path in (root, *root.parents))
    ):
        raise RuntimeError("Expected a plain absolute LOCALAPPDATA directory for synthetic smoke")
    with tempfile.TemporaryDirectory(prefix="aivora-frozen-smoke-", dir=root) as temporary:
        workspace = Path(temporary) / "workspace"
        workspace.mkdir()
        yield workspace


def load_baseline():
    spec = importlib.util.spec_from_file_location(
        "baseline", ROOT / "scripts/e2e/runtime_baseline_smoke.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextmanager
def frozen_sidecar(resources: Path, data_dir: Path, baseline):
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith(("AIJIAN_", "PYTHON"))
    }
    environment.update(
        {
            "AIJIAN_RESOURCE_ROOT": str(resources),
            "AIJIAN_DATA_DIR": str(data_dir),
            "AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME": "0",
        }
    )
    executable = resources / "sidecar/aijian-sidecar.exe"
    with tempfile.TemporaryFile(mode="w+") as errors:
        process = subprocess.Popen(
            [str(executable)],
            cwd=executable.parent,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
        )
        try:
            ready = queue.Queue()
            assert process.stdout is not None
            threading.Thread(
                target=lambda: ready.put(process.stdout.readline()), daemon=True
            ).start()
            handshake = json.loads(ready.get(timeout=30))
            assert handshake["event"] == "ready" and handshake["pid"] == process.pid
            deadline = time.monotonic() + 20
            while True:
                try:
                    assert (
                        baseline.request(handshake, "GET", "/api/v1/health")["data"]["status"]
                        == "ok"
                    )
                    break
                except (urllib.error.URLError, ConnectionError):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.1)
            yield handshake
        finally:
            assert process.stdin is not None
            process.stdin.close()
            try:
                code = process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                raise
            assert process.stdout is not None
            process.stdout.close()
            if code:
                errors.seek(0)
                raise RuntimeError(f"Frozen sidecar exited {code}: {errors.read()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("This smoke must run on Windows; Linux execution is not equivalent")
    resources = args.resources.resolve(strict=True)
    if not (resources / "sidecar/aijian-sidecar.exe").is_file():
        parser.error("Expected resources/sidecar/aijian-sidecar.exe")
    baseline = load_baseline()
    # Reuse the exact create/import/two-episode/close/reopen/readback assertions,
    # but keep both process launches in one fresh packaged-safe workspace. The
    # baseline's generic temp directory remains unused by the packaged process.
    with synthetic_packaged_workspace() as workspace:
        baseline.sidecar = lambda _data_dir: frozen_sidecar(resources, workspace, baseline)
        baseline.main()


if __name__ == "__main__":
    main()
