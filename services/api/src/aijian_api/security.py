"""Security boundary for the Electron-managed local sidecar."""

import re
from dataclasses import dataclass
from hmac import compare_digest
from typing import Literal

from fastapi import Request

SIDECAR_ORIGIN = "app://aijian"
_HOST_PATTERN = re.compile(r"^127\.0\.0\.1:(?P<port>[1-9][0-9]{0,4})$")

type SecurityFailure = Literal["SIDECAR_AUTH_REQUIRED", "SIDECAR_REQUEST_REJECTED"]


@dataclass(frozen=True, slots=True)
class SidecarSecurity:
    """Immutable credentials and address constraints for one sidecar process."""

    token: str
    host: str
    origin: str = SIDECAR_ORIGIN

    def __post_init__(self) -> None:
        host_match = _HOST_PATTERN.fullmatch(self.host)
        port = int(host_match.group("port")) if host_match else 0
        if (
            len(self.token) < 43
            or not self.token.isascii()
            or any(character.isspace() for character in self.token)
            or host_match is None
            or port > 65535
            or self.origin != SIDECAR_ORIGIN
        ):
            raise ValueError("Invalid sidecar security configuration")

    def authorize(self, request: Request) -> SecurityFailure | None:
        """Validate credentials first, then constrain the local transport."""

        authorization = request.headers.get("Authorization", "")
        prefix = "Bearer "
        supplied_token = authorization[len(prefix) :] if authorization.startswith(prefix) else ""
        if not supplied_token or not compare_digest(supplied_token, self.token):
            return "SIDECAR_AUTH_REQUIRED"

        client_host = request.client.host if request.client else ""
        if (
            client_host != "127.0.0.1"
            or request.headers.get("Host") != self.host
            or request.headers.get("Origin") != self.origin
        ):
            return "SIDECAR_REQUEST_REJECTED"
        return None
