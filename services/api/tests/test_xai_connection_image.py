"""Tests for controlled XAI saved-connection image generation adapter."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import pytest
from aijian_api.credential_vault import CredentialVaultUnavailableError
from aijian_api.generation_failure_store import GenerationFailureStore
from aijian_api.main import create_app
from aijian_api.provider_connection_repository import ProviderConnectionRepository, ProviderModel
from aijian_api.repository import StudioRepository
from aijian_api.xai_connection_image import (
    XaiConnectionImageRequest,
    XaiConnectionImageService,
)
from aijian_api.xai_media import XaiHttpRequest, XaiHttpResponse, XaiMediaError
from fastapi.testclient import TestClient

_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc`\x00\x00"
    b"\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
)


class _MemoryVault:
    def __init__(self, *, unavailable: bool = False) -> None:
        self._items: dict[str, str] = {}
        self.unavailable = unavailable

    def set(self, connection_id: str, secret: str) -> None:
        if self.unavailable:
            raise CredentialVaultUnavailableError("vault unavailable")
        self._items[connection_id] = secret

    def get(self, connection_id: str) -> str | None:
        if self.unavailable:
            raise CredentialVaultUnavailableError("vault unavailable")
        return self._items.get(connection_id)

    def delete(self, connection_id: str) -> None:
        if self.unavailable:
            raise CredentialVaultUnavailableError("vault unavailable")
        self._items.pop(connection_id, None)


class _ScriptedTransport:
    def __init__(self, responses: list[XaiHttpResponse | Exception]) -> None:
        self._responses = list(responses)
        self.requests: list[XaiHttpRequest] = []

    def send(self, request: XaiHttpRequest) -> XaiHttpResponse:
        self.requests.append(request)
        if not self._responses:
            raise AssertionError("unexpected outbound HTTP request")
        outcome = self._responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _setup(
    tmp_path: Path,
    *,
    provider_kind: str = "XAI",
    base_url: str = "https://api.x.ai/v1",
    enabled: bool = True,
    models: tuple[ProviderModel, ...] = (
        ProviderModel(model_id="grok-imagine-image-2.0", capabilities=("IMAGE",)),
        ProviderModel(model_id="grok-4.7", capabilities=("TEXT",)),
    ),
    secret: str | None = "xai-test-secret-key-987654321",
    failure_limit: int | None = 2,
):
    repo = StudioRepository(tmp_path / "studio.db")
    project = repo.create_project(
        name="晚照书店",
        aspect_ratio="16:9",
        target_duration_seconds=60,
        source_language="zh-CN",
    )
    connections = ProviderConnectionRepository(repo.database_path)
    conn = connections.create(
        provider_kind=provider_kind,  # type: ignore[arg-type]
        display_name="xAI Key",
        base_url=base_url,
        enabled=enabled,
        models=models,
    )
    vault = _MemoryVault()
    if secret is not None:
        vault.set(conn.credential_ref, secret)
    if failure_limit is not None:
        GenerationFailureStore(repo, scope="story_creation").configure(
            project.id, expected_revision=0, failure_limit=failure_limit
        )
    return repo, project.id, conn.id, vault


def _ok_image_response() -> XaiHttpResponse:
    body = json.dumps({"data": [{"b64_json": base64.b64encode(_PNG_BYTES).decode("ascii")}]})
    return XaiHttpResponse(status=200, body=body.encode("utf-8"), content_type="application/json")


def test_succeeds_with_vault_secret_and_never_overwrites_existing_file(tmp_path: Path) -> None:
    repo, project_id, conn_id, vault = _setup(tmp_path)
    out_dir = tmp_path / "out"
    existing_dir = out_dir / project_id
    existing_dir.mkdir(parents=True)
    existing_file = existing_dir / "kept-still.png"
    existing_file.write_bytes(b"ORIGINAL-STILL-BYTES")

    transport = _ScriptedTransport([_ok_image_response()])
    service = XaiConnectionImageService(
        repo, vault, transport_factory=lambda: transport, output_root=out_dir
    )
    result = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="夕阳下的旧书店木门",
            idempotency_key="attempt-001",
            aspect_ratio="16:9",
        ),
    )

    assert result.status == "SUCCEEDED"
    assert result.code == "SUCCEEDED"
    assert result.asset_path is not None
    saved = Path(result.asset_path)
    assert saved.is_file()
    assert saved != existing_file
    assert saved.read_bytes() == _PNG_BYTES
    assert result.asset_sha256 == hashlib.sha256(_PNG_BYTES).hexdigest()
    assert result.mime_type == "image/png"
    assert result.byte_size == len(_PNG_BYTES)
    assert existing_file.read_bytes() == b"ORIGINAL-STILL-BYTES"
    assert len(transport.requests) == 1
    assert transport.requests[0].url == "https://api.x.ai/v1/images/generations"
    assert transport.requests[0].headers["Authorization"] == "Bearer xai-test-secret-key-987654321"
    assert "xai-test-secret-key-987654321" not in result.message


def test_cancellation_before_transport_makes_zero_http_calls_and_preserves_quota(
    tmp_path: Path,
) -> None:
    repo, project_id, conn_id, vault = _setup(tmp_path, failure_limit=1)
    transport = _ScriptedTransport([_ok_image_response()])
    service = XaiConnectionImageService(repo, vault, transport_factory=lambda: transport)

    # Cancel immediately before reservation.
    first = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="雨夜街角",
            idempotency_key="cancel-1",
        ),
        cancel_check=lambda: True,
    )
    assert first.status == "CANCELLED"
    assert len(transport.requests) == 0

    # Cancel between reservation and transport entry -> reservation must be discarded cleanly.
    checks = iter([False, True])
    second = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="雨夜街角",
            idempotency_key="cancel-2",
        ),
        cancel_check=lambda: next(checks),
    )
    assert second.status == "CANCELLED"
    assert len(transport.requests) == 0

    # Because cancelled holds were discarded before transport, quota=1 still allows a real call.
    third = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="雨夜街角",
            idempotency_key="real-after-cancel",
        ),
    )
    assert third.status == "SUCCEEDED"
    assert len(transport.requests) == 1


def test_blocks_unconfigured_budget_and_exhausted_failure_limit_with_zero_calls(
    tmp_path: Path,
) -> None:
    repo, project_id, conn_id, vault = _setup(tmp_path, failure_limit=None)
    transport = _ScriptedTransport([])
    service = XaiConnectionImageService(repo, vault, transport_factory=lambda: transport)

    unconfigured = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="书店窗台",
            idempotency_key="budget-unconfigured",
        ),
    )
    assert unconfigured.status == "BLOCKED"
    assert unconfigured.code == "BUDGET_UNCONFIGURED"
    assert len(transport.requests) == 0

    GenerationFailureStore(repo, scope="story_creation").configure(
        project_id, expected_revision=0, failure_limit=0
    )
    exhausted = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="书店窗台",
            idempotency_key="budget-zero",
        ),
    )
    assert exhausted.status == "BLOCKED"
    assert exhausted.code == "FAILURE_LIMIT_REACHED"
    assert len(transport.requests) == 0


def test_unknown_transport_failure_blocks_duplicate_retry_and_consumes_limit(
    tmp_path: Path,
) -> None:
    repo, project_id, conn_id, vault = _setup(tmp_path, failure_limit=1)
    transport = _ScriptedTransport([XaiMediaError("UPSTREAM_UNREACHABLE", "network timeout")])
    service = XaiConnectionImageService(repo, vault, transport_factory=lambda: transport)

    req = XaiConnectionImageRequest(
        connection_id=conn_id,
        model_id="grok-imagine-image-2.0",
        prompt="灯光闪烁的书架",
        idempotency_key="uncertain-key",
    )
    first = service.generate(project_id, req)
    assert first.status == "UNKNOWN"
    assert first.code == "TRANSPORT_UNKNOWN"
    assert len(transport.requests) == 1

    # Re-sending the exact same idempotency key must not re-dispatch.
    replay = service.generate(project_id, req)
    assert replay.status == "BLOCKED"
    assert replay.code == "ATTEMPT_DUPLICATE_BLOCKED"
    assert len(transport.requests) == 1

    # Even with a brand-new idempotency key, the UNKNOWN outcome occupies failure_limit=1.
    new_key = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="灯光闪烁的书架",
            idempotency_key="different-key-after-unknown",
        ),
    )
    assert new_key.status == "BLOCKED"
    assert new_key.code == "FAILURE_LIMIT_REACHED"
    assert len(transport.requests) == 1


def test_provider_failure_and_invalid_bytes_leave_existing_files_untouched(tmp_path: Path) -> None:
    repo, project_id, conn_id, vault = _setup(tmp_path, failure_limit=3)
    out_dir = tmp_path / "out"
    existing = out_dir / project_id / "still-v1.png"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(_PNG_BYTES)

    transport = _ScriptedTransport(
        [
            XaiHttpResponse(
                status=401, body=b'{"error":"bad key"}', content_type="application/json"
            ),
            XaiHttpResponse(
                status=200,
                body=json.dumps(
                    {"data": [{"b64_json": base64.b64encode(b"not-an-image").decode()}]}
                ).encode(),
                content_type="application/json",
            ),
        ]
    )
    service = XaiConnectionImageService(
        repo, vault, transport_factory=lambda: transport, output_root=out_dir
    )

    auth_fail = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="旧台灯",
            idempotency_key="fail-401",
        ),
    )
    assert auth_fail.status == "FAILED"
    assert auth_fail.code == "PROVIDER_AUTH_FAILED"

    bad_bytes = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="旧台灯",
            idempotency_key="fail-bytes",
        ),
    )
    assert bad_bytes.status == "FAILED"
    assert bad_bytes.code == "IMAGE_INVALID_BYTES"
    assert existing.read_bytes() == _PNG_BYTES
    assert list(existing.parent.iterdir()) == [existing]


@pytest.mark.parametrize(
    ("overrides", "expected_code"),
    [
        ({"enabled": False}, "CONNECTION_DISABLED"),
        ({"provider_kind": "OPENAI"}, "PROVIDER_KIND_UNSUPPORTED"),
        ({"base_url": "https://evil.example/v1"}, "CONNECTION_ORIGIN_UNSUPPORTED"),
        ({"secret": None}, "CREDENTIAL_MISSING"),
    ],
)
def test_rejects_invalid_connection_or_missing_secret_with_zero_calls(
    tmp_path: Path, overrides: dict[str, object], expected_code: str
) -> None:
    repo, project_id, conn_id, vault = _setup(tmp_path, **overrides)  # type: ignore[arg-type]
    transport = _ScriptedTransport([])
    service = XaiConnectionImageService(repo, vault, transport_factory=lambda: transport)
    result = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="书店橱窗",
            idempotency_key="reject-case",
        ),
    )
    assert result.status == "BLOCKED"
    assert result.code == expected_code
    assert len(transport.requests) == 0


def test_rejects_non_image_model_and_unavailable_vault(tmp_path: Path) -> None:
    repo, project_id, conn_id, vault = _setup(tmp_path)
    transport = _ScriptedTransport([])
    service = XaiConnectionImageService(repo, vault, transport_factory=lambda: transport)

    wrong_model = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-4.7",
            prompt="书店橱窗",
            idempotency_key="wrong-model",
        ),
    )
    assert wrong_model.status == "BLOCKED"
    assert wrong_model.code == "MODEL_NOT_ELIGIBLE"

    vault.unavailable = True
    no_vault = service.generate(
        project_id,
        XaiConnectionImageRequest(
            connection_id=conn_id,
            model_id="grok-imagine-image-2.0",
            prompt="书店橱窗",
            idempotency_key="no-vault",
        ),
    )
    assert no_vault.status == "BLOCKED"
    assert no_vault.code == "CREDENTIAL_UNAVAILABLE"
    assert len(transport.requests) == 0


def test_route_requires_sidecar_auth_and_blocks_when_live_media_flag_unset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from aijian_api.security import SIDECAR_ORIGIN, SidecarSecurity

    monkeypatch.delenv("AIJIAN_ALLOW_LIVE_MEDIA", raising=False)
    repo, project_id, conn_id, vault = _setup(tmp_path)
    token = "sidecar-test-token-" + "a" * 32
    host = "127.0.0.1:43210"
    app = create_app(
        repository=repo,
        credential_vault=vault,
        sidecar_security=SidecarSecurity(token, host),
    )
    body = {
        "connection_id": conn_id,
        "model_id": "grok-imagine-image-2.0",
        "prompt": "黄昏书店",
        "idempotency_key": "route-live-gate",
        "aspect_ratio": "16:9",
    }
    with TestClient(app, base_url=f"http://{host}", client=("127.0.0.1", 12345)) as client:
        unauth = client.post(
            f"/api/v1/projects/{project_id}/xai-connection-images",
            json=body,
        )
        assert unauth.status_code == 401
        wrong_origin = client.post(
            f"/api/v1/projects/{project_id}/xai-connection-images",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert wrong_origin.status_code == 403
        response = client.post(
            f"/api/v1/projects/{project_id}/xai-connection-images",
            json=body,
            headers={"Authorization": f"Bearer {token}", "Origin": SIDECAR_ORIGIN},
        )
    assert response.status_code == 200, response.text
    payload = response.json()["data"]
    assert payload["status"] == "BLOCKED"
    assert payload["code"] == "LIVE_MEDIA_DISABLED"
