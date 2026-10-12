"""Bounded inherited parent stdin/stdout dispatch; no HTTP/preload exposure."""

from __future__ import annotations

import base64
import json
import os
import re
import threading
from typing import BinaryIO

from aijian_api.native_preview_owner import NativePreviewOwner
from aijian_api.repository import StudioRepository

MAX_LINE = 262_144


def _unique_fields(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Private JSON contains duplicate fields")
        result[key] = value
    return result


class NativeParentPipe:
    def __init__(self, repository: StudioRepository, output: BinaryIO) -> None:
        self._output = output
        self._writer_lock = threading.RLock()
        self._seen: set[str] = set()
        self._closed = threading.Event()
        self.owner = NativePreviewOwner(repository, self._stream)
        self.peer_pid, self.parent_pid = os.getpid(), os.getppid()

    def _write(self, message: object) -> None:
        data = (
            json.dumps(message, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode(
                "utf-8"
            )
            + b"\n"
        )
        if len(data) > MAX_LINE:
            raise ValueError("Private reply is out of bounds")
        with self._writer_lock:
            if self._closed.is_set():
                raise OSError("Parent pipe is closed")
            self._output.write(data)
            self._output.flush()

    def _stream(self, lease_id: str, sequence: int, stream: str, data: bytes) -> None:
        self._write(
            {
                "event": "aivora_native_stream",
                "peer_pid": self.peer_pid,
                "lease_id": lease_id,
                "sequence": sequence,
                "stream": stream,
                "bytes": base64.b64encode(data).decode("ascii"),
            }
        )

    def serve(self, source: BinaryIO) -> None:
        try:
            while not self._closed.is_set():
                line = source.readline(MAX_LINE + 1)
                if not line:
                    return
                if len(line) > MAX_LINE or not line.endswith(b"\n") or b"\r" in line:
                    raise ValueError("Parent line is malformed or oversized")
                value = json.loads(line.decode("utf-8"), object_pairs_hook=_unique_fields)
                if (
                    not isinstance(value, dict)
                    or set(value)
                    != {"event", "request_id", "peer_pid", "parent_pid", "operation", "payload"}
                    or value["event"] != "aivora_native_request"
                    or type(value["peer_pid"]) is not int
                    or type(value["parent_pid"]) is not int
                    or value["peer_pid"] != self.peer_pid
                    or value["parent_pid"] != self.parent_pid
                    or not isinstance(value["request_id"], str)
                    or not re.fullmatch(r"npr_[0-9a-f]{32}", value["request_id"])
                    or not isinstance(value["operation"], str)
                    or value["operation"]
                    not in {"prepare", "read", "launch", "write", "stop", "release"}
                ):
                    raise ValueError("Parent pipe request is uncorrelated")
                request_id = value["request_id"]
                if request_id in self._seen or len(self._seen) >= 65_536:
                    raise ValueError("Parent pipe request cannot be replayed")
                self._seen.add(
                    request_id
                )  # Before dispatch; UNKNOWN is never automatically resent.
                try:
                    result = self.owner.dispatch(value["operation"], value["payload"])
                except ValueError:
                    result = {"kind": "REFUSED"}
                except Exception:
                    result = {"kind": "UNKNOWN"}
                self._write(
                    {
                        "event": "aivora_native_reply",
                        "peer_pid": self.peer_pid,
                        "request_id": request_id,
                        "result": result,
                    }
                )
        finally:
            self._closed.set()  # Sidecar finally performs owned cleanup before workspace release.

    def shutdown_and_wait(self) -> None:
        self._closed.set()
        self.owner.shutdown_and_wait()
