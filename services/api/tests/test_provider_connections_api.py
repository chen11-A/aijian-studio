import sqlite3
from pathlib import Path

import pytest
from aijian_api.credential_vault import (
    CredentialCleanupRequiredError,
    CredentialVaultUnavailableError,
)
from aijian_api.main import create_app
from aijian_api.provider_connection_repository import (
    ProviderConnectionNotFoundError,
    ProviderConnectionRepository,
)
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient


class MemoryCredentialVault:
    def __init__(self, *, unavailable: bool = False) -> None:
        self.secrets: dict[str, str] = {}
        self.unavailable = unavailable
        self.delete_calls: list[str] = []

    def set(self, connection_id: str, secret: str) -> None:
        if self.unavailable:
            raise CredentialVaultUnavailableError("unavailable")
        self.secrets[connection_id] = secret

    def get(self, connection_id: str) -> str | None:
        if self.unavailable:
            raise CredentialVaultUnavailableError("unavailable")
        return self.secrets.get(connection_id)

    def delete(self, connection_id: str) -> None:
        if self.unavailable:
            raise CredentialVaultUnavailableError("unavailable")
        self.delete_calls.append(connection_id)
        self.secrets.pop(connection_id, None)


class CleanupRequiredVault(MemoryCredentialVault):
    def set(self, connection_id: str, secret: str) -> None:
        self.secrets[connection_id] = secret
        raise CredentialCleanupRequiredError("cleanup required")


class UnexpectedFailureVault(MemoryCredentialVault):
    def set(self, connection_id: str, secret: str) -> None:
        self.secrets[connection_id] = secret
        raise RuntimeError("unexpected failure after write")


def _payload(*, display_name: str = "OpenAI 主连接") -> dict[str, object]:
    return {
        "provider_kind": "OPENAI",
        "display_name": display_name,
        "base_url": "https://api.openai.com/v1/",
        "enabled": True,
        "api_key": "test-only-never-log-this",
        "models": [
            {"model_id": "gpt-production", "capabilities": ["TEXT"]},
            {"model_id": "image-production", "capabilities": ["IMAGE"]},
        ],
    }


def test_creates_and_lists_provider_without_returning_or_storing_secret(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    vault = MemoryCredentialVault()
    client = TestClient(create_app(repository=repository, credential_vault=vault))

    created = client.post("/api/v1/provider-connections", json=_payload())

    assert created.status_code == 201
    payload = created.json()["data"]
    assert payload["base_url"] == "https://api.openai.com/v1"
    assert payload["credential_status"] == "CONFIGURED"
    assert payload["models"][0] == {
        "model_id": "gpt-production",
        "capabilities": ["TEXT"],
    }
    assert vault.secrets[payload["id"]] == "test-only-never-log-this"
    assert "sk-test-only" not in created.text
    assert "api_key" not in created.text

    listed = client.get("/api/v1/provider-connections")
    assert listed.status_code == 200
    assert listed.json()["data"] == [payload]

    with sqlite3.connect(database) as connection:
        stored = connection.execute("SELECT * FROM provider_connections").fetchone()
    assert stored is not None
    assert "sk-test-only" not in " ".join(str(value) for value in stored)


def test_rejects_insecure_remote_urls_missing_keys_and_duplicate_models(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            repository=StudioRepository(tmp_path / "workspace.db"),
            credential_vault=MemoryCredentialVault(),
        )
    )

    insecure = _payload()
    insecure["base_url"] = "http://api.example.com/v1"
    assert client.post("/api/v1/provider-connections", json=insecure).status_code == 422

    wrong_openai_origin = _payload()
    wrong_openai_origin["base_url"] = "https://evil.example/v1"
    assert client.post("/api/v1/provider-connections", json=wrong_openai_origin).status_code == 422

    wrong_xai_origin = _payload()
    wrong_xai_origin["provider_kind"] = "XAI"
    assert client.post("/api/v1/provider-connections", json=wrong_xai_origin).status_code == 422

    remote_ollama = _payload()
    remote_ollama.update(
        provider_kind="OLLAMA",
        display_name="远程 Ollama",
        base_url="https://ollama.example/v1",
    )
    assert client.post("/api/v1/provider-connections", json=remote_ollama).status_code == 422

    local_compatible = _payload()
    local_compatible.update(
        provider_kind="OPENAI_COMPATIBLE",
        display_name="本地兼容接口",
        base_url="http://127.0.0.1:9000/v1",
    )
    assert client.post("/api/v1/provider-connections", json=local_compatible).status_code == 422

    for private_compatible_url in (
        "https://localhost/v1",
        "https://127.0.0.1/v1",
        "https://10.0.0.1/v1",
        "https://169.254.169.254/latest/meta-data",
        "https://224.0.0.1/v1",
        "https://239.255.255.250/v1",
        "https://[ff02::1]/v1",
    ):
        private_compatible = _payload(display_name=private_compatible_url)
        private_compatible.update(
            provider_kind="OPENAI_COMPATIBLE",
            base_url=private_compatible_url,
        )
        assert (
            client.post("/api/v1/provider-connections", json=private_compatible).status_code == 422
        )

    for malformed_url in (
        "https://api.openai.com:99999/v1",
        "https:///v1",
        "https://api.openai.com/v1?",
        "https://api.openai.com/v1#",
        "https://user@api.openai.com/v1",
        "https://api.openai.com/v 1",
    ):
        malformed = _payload(display_name=malformed_url)
        malformed["base_url"] = malformed_url
        assert client.post("/api/v1/provider-connections", json=malformed).status_code == 422

    non_string_url = _payload()
    non_string_url["base_url"] = 42
    assert client.post("/api/v1/provider-connections", json=non_string_url).status_code == 422

    missing_key = _payload()
    del missing_key["api_key"]
    assert client.post("/api/v1/provider-connections", json=missing_key).status_code == 422

    missing_models = _payload()
    missing_models["models"] = []
    assert client.post("/api/v1/provider-connections", json=missing_models).status_code == 422

    duplicate_models = _payload()
    duplicate_models["models"] = [
        {"model_id": "same-model", "capabilities": ["TEXT"]},
        {"model_id": "same-model", "capabilities": ["IMAGE"]},
    ]
    assert client.post("/api/v1/provider-connections", json=duplicate_models).status_code == 422

    duplicate_capabilities = _payload()
    duplicate_capabilities["models"] = [
        {"model_id": "duplicate-capability", "capabilities": ["TEXT", "TEXT"]},
    ]
    assert (
        client.post("/api/v1/provider-connections", json=duplicate_capabilities).status_code == 422
    )


def test_allows_keyless_loopback_ollama_and_marks_missing_credential(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            repository=StudioRepository(tmp_path / "workspace.db"),
            credential_vault=MemoryCredentialVault(),
        )
    )

    response = client.post(
        "/api/v1/provider-connections",
        json={
            "provider_kind": "OLLAMA",
            "display_name": "本机 Ollama",
            "base_url": "http://127.0.0.1:11434/v1",
            "models": [{"model_id": "qwen-local", "capabilities": ["TEXT"]}],
        },
    )

    assert response.status_code == 201
    assert response.json()["data"]["credential_status"] == "MISSING"

    compatible = client.post(
        "/api/v1/provider-connections",
        json={
            "provider_kind": "OPENAI_COMPATIBLE",
            "display_name": "HTTPS 兼容网关",
            "base_url": "https://gateway.example/v1",
            "api_key": "compatible-test-key",
            "models": [{"model_id": "compatible-model", "capabilities": ["TEXT"]}],
        },
    )
    assert compatible.status_code == 201

    public_ip_compatible = client.post(
        "/api/v1/provider-connections",
        json={
            "provider_kind": "OPENAI_COMPATIBLE",
            "display_name": "Public IP HTTPS gateway",
            "base_url": "https://8.8.8.8/v1",
            "api_key": "compatible-public-test-key",
            "models": [{"model_id": "public-compatible", "capabilities": ["TEXT"]}],
        },
    )
    assert public_ip_compatible.status_code == 201


def test_duplicate_name_conflicts_and_delete_removes_metadata_and_secret(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    vault = MemoryCredentialVault()
    client = TestClient(create_app(repository=repository, credential_vault=vault))
    first = client.post("/api/v1/provider-connections", json=_payload())
    connection_id = first.json()["data"]["id"]

    conflict = client.post("/api/v1/provider-connections", json=_payload())
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "PROVIDER_CONNECTION_CONFLICT"

    deleted = client.delete(f"/api/v1/provider-connections/{connection_id}")
    assert deleted.status_code == 204
    assert connection_id not in vault.secrets
    assert client.get("/api/v1/provider-connections").json()["data"] == []

    missing = client.delete(f"/api/v1/provider-connections/{connection_id}")
    assert missing.status_code == 404
    assert vault.delete_calls == [connection_id]

    malformed = client.delete("/api/v1/provider-connections/pcn_unsafe")
    assert malformed.status_code == 422
    assert vault.delete_calls == [connection_id]


def test_vault_failure_rolls_back_creation_and_list_reports_unavailable(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    working_vault = MemoryCredentialVault()
    working = TestClient(create_app(repository=repository, credential_vault=working_vault))
    assert working.post("/api/v1/provider-connections", json=_payload()).status_code == 201

    unavailable = TestClient(
        create_app(repository=repository, credential_vault=MemoryCredentialVault(unavailable=True))
    )
    listed = unavailable.get("/api/v1/provider-connections")
    assert listed.status_code == 200
    assert listed.json()["data"][0]["credential_status"] == "UNAVAILABLE"

    failed = unavailable.post(
        "/api/v1/provider-connections",
        json=_payload(display_name="xAI 备用连接"),
    )
    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "CREDENTIAL_VAULT_UNAVAILABLE"
    assert len(working.get("/api/v1/provider-connections").json()["data"]) == 1


def test_failed_credential_cleanup_keeps_metadata_visible_for_recovery(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    vault = CleanupRequiredVault()
    client = TestClient(create_app(repository=repository, credential_vault=vault))

    response = client.post("/api/v1/provider-connections", json=_payload())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "CREDENTIAL_CLEANUP_REQUIRED"
    listed = client.get("/api/v1/provider-connections").json()["data"]
    assert len(listed) == 1
    assert listed[0]["credential_status"] == "CONFIGURED"
    assert listed[0]["id"] in vault.secrets


def test_unexpected_vault_failure_preserves_metadata_identity(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    vault = UnexpectedFailureVault()
    client = TestClient(
        create_app(repository=repository, credential_vault=vault),
        raise_server_exceptions=False,
    )

    response = client.post("/api/v1/provider-connections", json=_payload())

    assert response.status_code == 500
    listed = client.get("/api/v1/provider-connections").json()["data"]
    assert len(listed) == 1
    assert listed[0]["credential_status"] == "CONFIGURED"
    assert listed[0]["id"] in vault.secrets


def test_provider_openapi_contract_is_typed_and_write_only(tmp_path: Path) -> None:
    schema = create_app(
        repository=StudioRepository(tmp_path / "workspace.db"),
        credential_vault=MemoryCredentialVault(),
    ).openapi()

    assert (
        schema["paths"]["/api/v1/provider-connections"]["post"]["operationId"]
        == "createProviderConnection"
    )
    response_schema = schema["components"]["schemas"]["ProviderConnectionData"]
    assert "api_key" not in response_schema["properties"]
    assert "credential_status" in response_schema["properties"]


def test_repository_delete_rejects_a_missing_connection(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    StudioRepository(database)
    repository = ProviderConnectionRepository(database)

    with pytest.raises(ProviderConnectionNotFoundError, match="not found"):
        repository.delete("pcn_00000000000000000000000000000000")
