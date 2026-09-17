"""Bounded, loopback-only CPA text transport with explicit uncertain dispatch outcomes."""

from __future__ import annotations

import http.client
import json
import math
from dataclasses import dataclass
from time import monotonic
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

CPA_GATEWAY_HOST = "127.0.0.1"
CPA_GATEWAY_PORT = 8317
CPA_GATEWAY_PATH = "/v1/chat/completions"

_MAX_REQUEST_BYTES = 512 * 1024
_MAX_RESPONSE_BYTES = 1024 * 1024
_READ_CHUNK_BYTES = 64 * 1024


class GatewayChatMessage(BaseModel):
    """One bounded OpenAI-compatible chat message; its content is never repr-visible."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=256 * 1024, repr=False)


class GatewayTextRequest(BaseModel):
    """Caller-selected model and dedicated bearer credential for one text-only dispatch."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    messages: list[GatewayChatMessage] = Field(min_length=1, max_length=64, repr=False)
    bearer_token: SecretStr = Field(min_length=8, max_length=8192, repr=False)

    @field_validator("model", mode="before")
    @classmethod
    def normalize_model(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("bearer_token")
    @classmethod
    def validate_bearer_token(cls, value: SecretStr) -> SecretStr:
        token = value.get_secret_value()
        if any(character.isspace() for character in token):
            raise ValueError("bearer token cannot contain whitespace")
        return value

    @model_validator(mode="after")
    def bound_serialized_input(self) -> GatewayTextRequest:
        payload = {
            "model": self.model,
            "messages": [message.model_dump() for message in self.messages],
            "stream": False,
        }
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > _MAX_REQUEST_BYTES:
            raise ValueError("gateway request exceeds the byte limit")
        return self


@dataclass(frozen=True, slots=True)
class GatewayTextSuccess:
    kind: Literal["SUCCEEDED"]
    response_id: str
    model: str
    text: str
    finish_reason: str | None


@dataclass(frozen=True, slots=True)
class GatewayNotDispatched:
    kind: Literal["NOT_DISPATCHED"]
    code: Literal["CONNECTION_FAILED", "REQUEST_INVALID"]


@dataclass(frozen=True, slots=True)
class GatewayRemoteError:
    kind: Literal["REMOTE_ERROR"]
    code: Literal[
        "RATE_LIMITED",
        "REDIRECT_REJECTED",
        "REMOTE_REJECTED",
        "RESPONSE_INVALID",
        "RESPONSE_TOO_LARGE",
    ]
    status_code: int


@dataclass(frozen=True, slots=True)
class GatewayRemoteUnknown:
    kind: Literal["REMOTE_UNKNOWN"]
    code: Literal["DISPATCH_INTERRUPTED", "RESPONSE_TIMEOUT", "RESPONSE_INTERRUPTED"]


GatewayTextResult = (
    GatewayTextSuccess | GatewayNotDispatched | GatewayRemoteError | GatewayRemoteUnknown
)


class GatewayTextTransport:
    """Dispatch exactly one non-streaming POST to the fixed CPA loopback endpoint.

    The transport owns neither gateway process startup nor OAuth credentials.  It has no URL, host,
    path, proxy, redirect, model-selection, retry, or cancellation fallback surface.
    """

    MAX_RESPONSE_BYTES = _MAX_RESPONSE_BYTES

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

    def dispatch(self, request: GatewayTextRequest) -> GatewayTextResult:
        """Send one request.  A post-dispatch fault is deliberately never retried."""
        try:
            snapshot = self._validated_snapshot(request)
            body = self._serialize(snapshot)
        except (TypeError, ValueError, UnicodeError):
            return GatewayNotDispatched(kind="NOT_DISPATCHED", code="REQUEST_INVALID")

        deadline = monotonic() + self._total_timeout
        connection = http.client.HTTPConnection(
            CPA_GATEWAY_HOST,
            CPA_GATEWAY_PORT,
            timeout=min(self._connect_timeout, self._remaining(deadline)),
        )
        try:
            try:
                connection.connect()
                if connection.sock is not None:
                    connection.sock.settimeout(min(self._read_timeout, self._remaining(deadline)))
            except (TimeoutError, OSError, http.client.HTTPException):
                return GatewayNotDispatched(kind="NOT_DISPATCHED", code="CONNECTION_FAILED")

            try:
                self._send_once(connection, body, request.bearer_token.get_secret_value())
            except (TimeoutError, OSError, http.client.HTTPException):
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="DISPATCH_INTERRUPTED")

            try:
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
            if not self._is_json_content_type(response.getheader("Content-Type")):
                return GatewayRemoteError(
                    kind="REMOTE_ERROR", code="RESPONSE_INVALID", status_code=response.status
                )
            try:
                response_bytes = self._read_limited(response, deadline)
            except _ResponseTooLarge:
                return GatewayRemoteError(
                    kind="REMOTE_ERROR", code="RESPONSE_TOO_LARGE", status_code=response.status
                )
            except TimeoutError:
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="RESPONSE_TIMEOUT")
            except (OSError, http.client.HTTPException):
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="RESPONSE_INTERRUPTED")
            return self._parse_success(response_bytes, request.model, response.status)
        finally:
            connection.close()

    @staticmethod
    def _validated_snapshot(request: GatewayTextRequest) -> GatewayTextRequest:
        if not isinstance(request, GatewayTextRequest) or not isinstance(request.messages, list):
            raise ValueError("gateway request has an invalid message collection")
        messages = tuple(request.messages)
        if not 1 <= len(messages) <= 64 or any(
            not isinstance(message, GatewayChatMessage) for message in messages
        ):
            raise ValueError("gateway request has invalid messages")
        return GatewayTextRequest(
            model=request.model,
            messages=list(messages),
            bearer_token=request.bearer_token,
        )

    @staticmethod
    def _serialize(request: GatewayTextRequest) -> bytes:
        return json.dumps(
            {
                "model": request.model,
                "messages": [message.model_dump() for message in request.messages],
                "stream": False,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

    @staticmethod
    def _send_once(connection: http.client.HTTPConnection, body: bytes, bearer_token: str) -> None:
        connection.putrequest("POST", CPA_GATEWAY_PATH, skip_accept_encoding=True)
        connection.putheader("Accept", "application/json")
        connection.putheader("Content-Type", "application/json; charset=utf-8")
        connection.putheader("Authorization", f"Bearer {bearer_token}")
        connection.putheader("Content-Length", str(len(body)))
        connection.endheaders(body)

    def _read_limited(self, response: http.client.HTTPResponse, deadline: float) -> bytes:
        declared_length = response.getheader("Content-Length")
        if declared_length is not None:
            try:
                if int(declared_length) < 0 or int(declared_length) > _MAX_RESPONSE_BYTES:
                    raise _ResponseTooLarge
            except ValueError as error:
                raise http.client.HTTPException("invalid response content length") from error
        chunks: list[bytes] = []
        total = 0
        while True:
            self._remaining(deadline)
            chunk = response.read(_READ_CHUNK_BYTES)
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > _MAX_RESPONSE_BYTES:
                raise _ResponseTooLarge
            chunks.append(chunk)

    @staticmethod
    def _is_json_content_type(content_type: str | None) -> bool:
        if content_type is None:
            return False
        return content_type.split(";", 1)[0].strip().lower() == "application/json"

    @staticmethod
    def _remaining(deadline: float) -> float:
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise TimeoutError("gateway deadline elapsed")
        return remaining

    @staticmethod
    def _parse_success(
        response_bytes: bytes, expected_model: str, status_code: int
    ) -> GatewayTextResult:
        try:
            decoded = response_bytes.decode("utf-8")
            payload = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return GatewayRemoteError(
                kind="REMOTE_ERROR", code="RESPONSE_INVALID", status_code=status_code
            )
        if not isinstance(payload, dict):
            return GatewayRemoteError(
                kind="REMOTE_ERROR", code="RESPONSE_INVALID", status_code=status_code
            )
        response_id = payload.get("id")
        model = payload.get("model")
        choices = payload.get("choices")
        if (
            not isinstance(response_id, str)
            or not response_id
            or len(response_id) > 512
            or model != expected_model
            or not isinstance(choices, list)
            or len(choices) != 1
            or not isinstance(choices[0], dict)
        ):
            return GatewayRemoteError(
                kind="REMOTE_ERROR", code="RESPONSE_INVALID", status_code=status_code
            )
        message = choices[0].get("message")
        finish_reason = choices[0].get("finish_reason")
        if (
            not isinstance(message, dict)
            or not isinstance(message.get("content"), str)
            or len(message["content"]) > _MAX_RESPONSE_BYTES
            or (finish_reason is not None and not isinstance(finish_reason, str))
        ):
            return GatewayRemoteError(
                kind="REMOTE_ERROR", code="RESPONSE_INVALID", status_code=status_code
            )
        return GatewayTextSuccess(
            kind="SUCCEEDED",
            response_id=response_id,
            model=model,
            text=message["content"],
            finish_reason=finish_reason,
        )


class _ResponseTooLarge(Exception):
    pass
