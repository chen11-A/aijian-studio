"""Electron-managed FastAPI sidecar entrypoint."""

import json
import os
import secrets
import socket
import sys
import threading
from collections.abc import Mapping

import uvicorn

from aijian_api.main import create_app
from aijian_api.security import SIDECAR_ORIGIN, SidecarSecurity

PROTOCOL_VERSION = 1
SIDECAR_HOST = "127.0.0.1"


def create_listener() -> tuple[socket.socket, int]:
    """Reserve an exclusive OS-assigned IPv4 loopback port."""

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    listener.bind((SIDECAR_HOST, 0))
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


def run() -> None:
    """Start one authenticated API process and supervise its parent pipe."""

    listener, port = create_listener()
    token = create_token()
    security = SidecarSecurity(
        token=token,
        host=f"{SIDECAR_HOST}:{port}",
        origin=SIDECAR_ORIGIN,
    )
    config = uvicorn.Config(
        app=create_app(sidecar_security=security),
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

    handshake = create_handshake(port=port, token=token, pid=os.getpid())
    print(json.dumps(handshake, separators=(",", ":"), sort_keys=True), flush=True)
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":  # pragma: no cover - exercised as a subprocess
    run()
