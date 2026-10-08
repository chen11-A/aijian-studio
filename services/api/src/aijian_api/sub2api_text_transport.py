"""One-shot text transport for an explicitly configured external Sub2API origin.

The caller owns authorization, budget reservation, connection/model binding, and
result reconciliation. Constructing this transport never probes a provider.
"""

from __future__ import annotations

import http.client
import hashlib
import json
import math
import queue
import socket
import ssl
import subprocess
import sys
from dataclasses import dataclass, field
from ipaddress import ip_address
from threading import Thread
from time import monotonic
from urllib.parse import urlsplit

from aijian_api.gateway_transport import (
    GatewayChatMessage,
    GatewayNotDispatched,
    GatewayRemoteError,
    GatewayRemoteUnknown,
    GatewayTextRequest,
    GatewayTextResult,
    GatewayTextSuccess,
)
from aijian_api.provider_contracts import Sub2APIOriginMode, validate_sub2api_origin

SUB2API_CHAT_PATH = "/v1/chat/completions"
_MAX_RESPONSE_BYTES = 1024 * 1024
_READ_CHUNK_BYTES = 64 * 1024


@dataclass(frozen=True, slots=True)
class Sub2APITextSuccess(GatewayTextSuccess):
    """Bounded provider body evidence; token counts are never a charge receipt."""

    raw_response_body: bytes = field(repr=False)
    raw_response_sha256: str
    usage_tokens: tuple[int | None, int | None, int | None] | None = None


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to one vetted DNS result while verifying TLS against the URL host."""

    def __init__(self, hostname: str, port: int, address: str, timeout: float) -> None:
        super().__init__(hostname, port, timeout=timeout, context=ssl.create_default_context())
        self._address = address

    def connect(self) -> None:
        raw_socket = socket.create_connection((self._address, self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)
        except BaseException:
            raw_socket.close()
            raise


class _LiteralLoopbackHTTPConnection(http.client.HTTPConnection):
    """Connect to an already validated numeric loopback address without DNS."""

    def connect(self) -> None:
        family = socket.AF_INET6 if self.host == "::1" else socket.AF_INET
        raw_socket = socket.socket(family, socket.SOCK_STREAM)
        try:
            raw_socket.settimeout(self.timeout)
            raw_socket.connect((self.host, self.port))
            self.sock = raw_socket
        except BaseException:
            raw_socket.close()
            raise


def local_loopback_route_clear(base_url: str) -> bool:
    """Reject Windows portproxy mappings before a local bearer token can be sent."""
    try:
        validate_sub2api_origin(base_url, "LOCAL_LOOPBACK_HTTP")
        port = urlsplit(base_url).port
        if port is None:
            return False
        if sys.platform != "win32":
            return True
        result = subprocess.run(
            ["netsh", "interface", "portproxy", "show", "all"],
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0:
            return False
        for line in result.stdout.splitlines():
            fields = line.split()
            if len(fields) == 4 and fields[1].isdigit() and fields[3].isdigit():
                if int(fields[1]) == port:
                    return False
        return True
    except (OSError, UnicodeError, ValueError, subprocess.TimeoutExpired):
        return False


class _ResponseTooLarge(Exception):
    pass


class Sub2APITextTransport:
    """Send at most one text POST; no proxy, redirect, fallback, or retry."""

    def __init__(
        self,
        *,
        connect_timeout_seconds: float = 3.0,
        read_timeout_seconds: float = 10.0,
        total_timeout_seconds: float = 20.0,
    ) -> None:
        for name, value in {
            "connect_timeout_seconds": connect_timeout_seconds,
            "read_timeout_seconds": read_timeout_seconds,
            "total_timeout_seconds": total_timeout_seconds,
        }.items():
            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
                or value <= 0
                or value > 60
            ):
                raise ValueError(f"{name} must be a finite positive value at most 60")
        if total_timeout_seconds < min(connect_timeout_seconds, read_timeout_seconds):
            raise ValueError("total timeout must cover one transport phase")
        self._connect_timeout = float(connect_timeout_seconds)
        self._read_timeout = float(read_timeout_seconds)
        self._total_timeout = float(total_timeout_seconds)

    def dispatch(
        self, *, base_url: str, request: GatewayTextRequest,
        origin_mode: Sub2APIOriginMode = "PUBLIC_HTTPS",
    ) -> GatewayTextResult:
        """Return an explicit outcome; ambiguity after sending is never a retry signal."""
        try:
            validate_sub2api_origin(base_url, origin_mode)
            parsed = urlsplit(base_url)
            hostname = parsed.hostname
            port = parsed.port or 443
            if hostname is None:
                raise ValueError("Sub2API hostname is missing")
            if not isinstance(request, GatewayTextRequest) or not isinstance(request.messages, list):
                raise ValueError("Sub2API request is invalid")
            snapshot = GatewayTextRequest(
                model=request.model,
                messages=list(request.messages),
                bearer_token=request.bearer_token,
            )
            if any(not isinstance(message, GatewayChatMessage) for message in snapshot.messages):
                raise ValueError("Sub2API messages are invalid")
            body = json.dumps(
                {
                    "model": snapshot.model,
                    "messages": [message.model_dump() for message in snapshot.messages],
                    "stream": False,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        except (TypeError, ValueError, UnicodeError):
            return GatewayNotDispatched(kind="NOT_DISPATCHED", code="REQUEST_INVALID")

        deadline = monotonic() + self._total_timeout
        try:
            if origin_mode == "LOCAL_LOOPBACK_HTTP":
                if not local_loopback_route_clear(base_url):
                    return GatewayNotDispatched(kind="NOT_DISPATCHED", code="CONNECTION_FAILED")
                connection: http.client.HTTPConnection = _LiteralLoopbackHTTPConnection(
                    hostname, port,
                    timeout=min(self._connect_timeout, self._remaining(deadline)),
                )
            else:
                address = self._resolve_public_address(hostname, port, deadline)
                connection = _PinnedHTTPSConnection(
                    hostname, port, address,
                    timeout=min(self._connect_timeout, self._remaining(deadline)),
                )
        except (TimeoutError, OSError, ValueError):
            return GatewayNotDispatched(kind="NOT_DISPATCHED", code="CONNECTION_FAILED")
        try:
            try:
                connection.connect()
                if connection.sock is not None:
                    connection.sock.settimeout(min(self._read_timeout, self._remaining(deadline)))
            except (TimeoutError, OSError, ssl.SSLError, http.client.HTTPException):
                return GatewayNotDispatched(kind="NOT_DISPATCHED", code="CONNECTION_FAILED")

            try:
                connection.putrequest("POST", SUB2API_CHAT_PATH, skip_accept_encoding=True)
                connection.putheader("Accept", "application/json")
                connection.putheader("Content-Type", "application/json; charset=utf-8")
                connection.putheader(
                    "Authorization", f"Bearer {snapshot.bearer_token.get_secret_value()}"
                )
                connection.putheader("Content-Length", str(len(body)))
                connection.endheaders(body)
            except (TimeoutError, OSError, http.client.HTTPException):
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="DISPATCH_INTERRUPTED")

            try:
                if connection.sock is not None:
                    connection.sock.settimeout(min(self._read_timeout, self._remaining(deadline)))
                response = connection.getresponse()
            except TimeoutError:
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="RESPONSE_TIMEOUT")
            except (OSError, http.client.HTTPException):
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="RESPONSE_INTERRUPTED")

            if 300 <= response.status < 400:
                return GatewayRemoteError(
                    kind="REMOTE_ERROR", code="REDIRECT_REJECTED", status_code=response.status
                )
            if response.status == 429:
                return GatewayRemoteError(kind="REMOTE_ERROR", code="RATE_LIMITED", status_code=429)
            if response.status != 200:
                return GatewayRemoteError(
                    kind="REMOTE_ERROR", code="REMOTE_REJECTED", status_code=response.status
                )
            if (response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower() != "application/json":
                return GatewayRemoteError(
                    kind="REMOTE_ERROR", code="RESPONSE_INVALID", status_code=200
                )
            try:
                payload_bytes = self._read_limited(response, connection, deadline)
            except _ResponseTooLarge:
                return GatewayRemoteError(
                    kind="REMOTE_ERROR", code="RESPONSE_TOO_LARGE", status_code=200
                )
            except TimeoutError:
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="RESPONSE_TIMEOUT")
            except (OSError, http.client.HTTPException):
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="RESPONSE_INTERRUPTED")
            return self._parse_success(payload_bytes, snapshot.model)
        finally:
            connection.close()

    @staticmethod
    def _remaining(deadline: float) -> float:
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise TimeoutError("Sub2API request deadline elapsed")
        return remaining

    @classmethod
    def _resolve_public_address(cls, hostname: str, port: int, deadline: float) -> str:
        results: queue.Queue[object] = queue.Queue(maxsize=1)

        def resolve() -> None:
            try:
                answer: object = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
            except (OSError, ValueError, UnicodeError) as error:
                answer = error
            results.put(answer)

        Thread(target=resolve, name="sub2api-dns", daemon=True).start()
        try:
            answer = results.get(timeout=cls._remaining(deadline))
        except queue.Empty as error:
            raise TimeoutError("Sub2API DNS resolution timed out") from error
        if isinstance(answer, (OSError, ValueError, UnicodeError)):
            raise answer
        addresses = [item[4][0] for item in answer]
        if not addresses or any(
            not ip_address(address).is_global or ip_address(address).is_multicast
            for address in addresses
        ):
            raise ValueError("Sub2API DNS must resolve exclusively to public addresses")
        return addresses[0]

    def _read_limited(
        self,
        response: http.client.HTTPResponse,
        connection: http.client.HTTPConnection,
        deadline: float,
    ) -> bytes:
        declared_length = response.getheader("Content-Length")
        if declared_length is not None:
            try:
                length = int(declared_length)
            except ValueError as error:
                raise http.client.HTTPException("invalid response content length") from error
            if length < 0 or length > _MAX_RESPONSE_BYTES:
                raise _ResponseTooLarge
        chunks: list[bytes] = []
        size = 0
        while True:
            if connection.sock is not None:
                connection.sock.settimeout(min(self._read_timeout, self._remaining(deadline)))
            chunk = response.read(_READ_CHUNK_BYTES)
            if not chunk:
                return b"".join(chunks)
            size += len(chunk)
            if size > _MAX_RESPONSE_BYTES:
                raise _ResponseTooLarge
            chunks.append(chunk)

    @staticmethod
    def _parse_success(response_bytes: bytes, expected_model: str) -> GatewayTextResult:
        try:
            payload = json.loads(response_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            payload = None
        if isinstance(payload, dict):
            response_id = payload.get("id")
            model = payload.get("model")
            choices = payload.get("choices")
            if (
                isinstance(response_id, str)
                and 0 < len(response_id) <= 512
                and model == expected_model
                and isinstance(choices, list)
                and len(choices) == 1
                and isinstance(choices[0], dict)
            ):
                message = choices[0].get("message")
                finish_reason = choices[0].get("finish_reason")
                if (
                    isinstance(message, dict)
                    and isinstance(message.get("content"), str)
                    and len(message["content"]) <= _MAX_RESPONSE_BYTES
                    and (finish_reason is None or isinstance(finish_reason, str))
                ):
                    usage = payload.get("usage")
                    usage_tokens = None
                    if isinstance(usage, dict):
                        values = (
                            usage.get("prompt_tokens"),
                            usage.get("completion_tokens"),
                            usage.get("total_tokens"),
                        )
                        if all(
                            value is None or (type(value) is int and 0 <= value <= 10**12)
                            for value in values
                        ):
                            usage_tokens = values
                    return Sub2APITextSuccess(
                        kind="SUCCEEDED",
                        response_id=response_id,
                        model=model,
                        text=message["content"],
                        finish_reason=finish_reason,
                        raw_response_body=response_bytes,
                        raw_response_sha256=(
                            "sha256:" + hashlib.sha256(response_bytes).hexdigest()
                        ),
                        usage_tokens=usage_tokens,
                    )
        return GatewayRemoteError(kind="REMOTE_ERROR", code="RESPONSE_INVALID", status_code=200)
