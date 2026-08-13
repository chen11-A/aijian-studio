"""Electron-managed FastAPI sidecar entrypoint."""

import json
import os
import secrets
import socket
import sys
import threading
from collections.abc import Mapping
from pathlib import Path

import uvicorn

from aijian_api.fake_media_package import FakeMediaPackageGenerator
from aijian_api.fake_timeline_run import FakeTimelineRunFactory, LocalFakeTimelineWorker
from aijian_api.main import create_app, default_database_path
from aijian_api.media_toolchain import discover_media_toolchain, load_media_toolchain_lock
from aijian_api.repository import StudioRepository
from aijian_api.security import SIDECAR_ORIGIN, SidecarSecurity
from aijian_api.source_extract_worker import LocalFakeSourceExtractWorker

PROTOCOL_VERSION = 1
SIDECAR_HOST = "127.0.0.1"


def create_listener() -> tuple[socket.socket, int]:
    """Reserve an exclusive OS-assigned IPv4 loopback port."""

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    listener.bind((SIDECAR_HOST, 0))
    listener.listen()
    port = int(listener.getsockname()[1])
    return listener, port


def create_token() -> str:
    """Return 256 bits of process-local random material."""

    return secrets.token_urlsafe(32)


def create_handshake(*, port: int, token: str, pid: int) -> Mapping[str, object]:
    """Build the only secret-bearing message sent over the startup pipe."""

    return {
        "event": "ready",
        "host": SIDECAR_HOST,
        "pid": pid,
        "port": port,
        "protocol_version": PROTOCOL_VERSION,
        "token": token,
    }


def _stop_when_parent_pipe_closes(server: uvicorn.Server) -> None:
    sys.stdin.buffer.read()
    server.should_exit = True


def create_local_fake_worker(database_path: Path) -> LocalFakeSourceExtractWorker:
    """Build the only explicitly enabled background runtime for the Sidecar."""

    return LocalFakeSourceExtractWorker(database_path)


def create_local_fake_timeline_runtime(
    repository: StudioRepository,
) -> tuple[FakeTimelineRunFactory, LocalFakeTimelineWorker]:
    """Build the explicitly enabled development-evidence media runtime."""

    lock = load_media_toolchain_lock(Path.cwd() / "config" / "media-toolchain-lock.json")
    toolchain = discover_media_toolchain(lock)
    workspace = repository.database_path.parent
    generator = FakeMediaPackageGenerator.from_locked_tool_root(
        workspace,
        lock,
        toolchain.ffmpeg_path.parent,
    )
    return (
        FakeTimelineRunFactory(repository, generator),
        LocalFakeTimelineWorker(repository.database_path, generator),
    )


def run() -> None:
    """Start one authenticated API process and supervise its parent pipe."""

    listener, port = create_listener()
    worker: LocalFakeSourceExtractWorker | None = None
    timeline_worker: LocalFakeTimelineWorker | None = None
    worker_started = False
    timeline_worker_started = False
    try:
        token = create_token()
        security = SidecarSecurity(
            token=token,
            host=f"{SIDECAR_HOST}:{port}",
            origin=SIDECAR_ORIGIN,
        )
        repository = StudioRepository(default_database_path())
        worker = create_local_fake_worker(repository.database_path)
        timeline_factory: FakeTimelineRunFactory | None = None
        if os.environ.get("AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME") == "1":
            timeline_factory, timeline_worker = create_local_fake_timeline_runtime(repository)
        config = uvicorn.Config(
            app=create_app(
                sidecar_security=security,
                repository=repository,
                fake_timeline_run_factory=timeline_factory,
            ),
            host=SIDECAR_HOST,
            port=port,
            access_log=False,
            log_config=None,
            server_header=False,
        )
        server = uvicorn.Server(config)
        pipe_monitor = threading.Thread(
            target=_stop_when_parent_pipe_closes,
            args=(server,),
            name="sidecar-parent-pipe",
            daemon=True,
        )
        pipe_monitor.start()
        worker.start()
        worker_started = True
        if timeline_worker is not None:
            timeline_worker.start()
            timeline_worker_started = True

        handshake = create_handshake(port=port, token=token, pid=os.getpid())
        print(json.dumps(handshake, separators=(",", ":"), sort_keys=True), flush=True)
        server.run(sockets=[listener])
    finally:
        try:
            try:
                if timeline_worker_started and timeline_worker is not None:
                    timeline_worker.stop()
            finally:
                if worker_started and worker is not None:
                    worker.stop()
        finally:
            listener.close()


if __name__ == "__main__":  # pragma: no cover - exercised as a subprocess
    run()
