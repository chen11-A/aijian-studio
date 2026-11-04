"""Check the bundled runtime using a disposable, empty local workspace."""

import json
import os
import selectors
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent
    # Node mode only checks CommonJS runtime loading; it does not create a renderer.
    subprocess.run(
        [
            str(root / "runtime/electron/electron"),
            "-e",
            "require('@aijian/contracts/artifact-proposal');"
            "require('@aijian/contracts/invalidation-operation');"
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
                    f"http://127.0.0.1:{handshake['port']}/api/v1/projects",
                    headers={
                        "Authorization": f"Bearer {handshake['token']}",
                        "Origin": "app://aijian",
                    },
                )
                deadline = time.monotonic() + 10
                while True:
                    try:
                        with urllib.request.urlopen(request, timeout=3) as response:
                            projects = json.load(response)
                        break
                    except urllib.error.URLError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.1)
                assert projects["data"] == [], f"Unexpected initial project response: {projects!r}"
                print("PASS: bundled Python sidecar, authenticated loopback API, empty workspace")
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
    print("Native window, editing, and save/reopen still need graphical desktop verification.")


if __name__ == "__main__":
    main()
