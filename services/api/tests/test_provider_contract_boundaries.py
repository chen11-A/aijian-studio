"""Pure origin and credential contracts: synthetic values, never network or vault I/O."""

import pytest
from aijian_api.provider_contracts import (
    CreateProviderConnectionRequest,
    EditSub2APIConnectionRequest,
    RotateSub2APIKeyRequest,
    sub2api_origin_binding,
    validate_sub2api_origin,
)
from pydantic import ValidationError


def create_payload(**changes):
    return {
        "provider_kind": "SUB2API",
        "display_name": "  Synthetic  ",
        "base_url": "https://gateway.example",
        "models": [{"model_id": "synthetic-text", "capabilities": ["TEXT"]}],
        "api_key": "synthetic-secret",
        **changes,
    }


@pytest.mark.parametrize(
    "url",
    [
        "https://localhost",
        "https://service.localhost",
        "https://intranet",
        "https://.invalid",
        "https://invalid.",
        "https://127.0.0.1",
        "https://10.0.0.1",
        "https://[::1]",
        "https://224.0.0.1",
        "https://gateway.example:0",
        "https://gateway.example/path",
        "https://u:p@gateway.example",
        "https://gateway.example?x=1",
        "https://gateway.example#fragment",
        "https://gateway.example:bad",
        "https://[invalid",
        "https://gate way.example",
        "https://gateway%2eexample",
        "http://gateway.example",
        "https://gateway.example\\other",
    ],
)
def test_public_origin_rejects_non_public_or_noncanonical_destinations(url):
    with pytest.raises(ValueError):
        validate_sub2api_origin(url)


@pytest.mark.parametrize("url", ["https://gateway.example", "https://8.8.8.8"])
def test_public_origin_binds_an_exact_nonsecret_identity_without_resolving_dns(url):
    assert sub2api_origin_binding(url, "PUBLIC_HTTPS", 2) == {
        "origin": url,
        "origin_mode": "PUBLIC_HTTPS",
        "connection_revision": 2,
    }


def test_origin_mode_and_revision_are_not_coerced_at_the_binding_boundary():
    with pytest.raises(ValueError, match="origin mode"):
        validate_sub2api_origin("https://gateway.example", "UNKNOWN")
    for revision in (0, -1, True, "1", 1.5):
        with pytest.raises(ValueError, match="revision"):
            sub2api_origin_binding("https://gateway.example", "PUBLIC_HTTPS", revision)


@pytest.mark.parametrize(
    "changes",
    [
        {"origin_mode": None},
        {"models": [{"model_id": "image", "capabilities": ["IMAGE"]}]},
        {"models": [{"model_id": "same", "capabilities": ["TEXT"]}] * 2},
        {"models": [{"model_id": "same", "capabilities": ["TEXT", "TEXT"]}]},
        {"api_key": None},
        {"provider_kind": "XAI", "base_url": "https://gateway.example"},
        {"provider_kind": "OPENAI", "base_url": "https://gateway.example"},
        {"provider_kind": "OLLAMA", "base_url": "https://remote.example"},
        {"provider_kind": "OPENAI_COMPATIBLE", "base_url": "http://localhost:80"},
        {"provider_kind": "OPENAI_COMPATIBLE", "base_url": "https://localhost"},
        {"provider_kind": "OPENAI_COMPATIBLE", "base_url": "https://10.0.0.1"},
        {"provider_kind": "OPENAI_COMPATIBLE", "origin_mode": "PUBLIC_HTTPS"},
        {"origin_mode": "LOCAL_LOOPBACK_HTTP", "base_url": "http://127.0.0.1:8000/"},
        {"origin_mode": "LOCAL_LOOPBACK_HTTP", "base_url": None},
        {"display_name": 7},
        {"base_url": 7},
    ],
)
def test_create_contract_rejects_invalid_policy_without_coercing_or_exposing_keys(changes):
    with pytest.raises(ValidationError):
        CreateProviderConnectionRequest.model_validate(create_payload(**changes))


def test_public_provider_ip_and_normalization_are_explicit():
    connection = CreateProviderConnectionRequest.model_validate(
        create_payload(provider_kind="OPENAI_COMPATIBLE", base_url=" https://8.8.8.8/ ")
    )
    assert connection.base_url == "https://8.8.8.8"
    assert connection.display_name == "Synthetic"
    assert "synthetic-secret" not in connection.model_dump_json()


@pytest.mark.parametrize(
    "changes",
    [
        {"origin_mode": "LOCAL_LOOPBACK_HTTP", "base_url": " http://127.0.0.1:8000"},
        {"origin_mode": "LOCAL_LOOPBACK_HTTP", "base_url": 7},
        {"models": [{"model_id": "image", "capabilities": ["IMAGE"]}]},
        {"models": [{"model_id": "duplicate", "capabilities": ["TEXT"]}] * 2},
        {"display_name": 7},
        {"base_url": 7},
    ],
)
def test_edit_contract_preserves_canonical_local_and_text_only_policy(changes):
    payload = create_payload()
    payload.pop("api_key")
    payload.pop("provider_kind")
    with pytest.raises(ValidationError):
        EditSub2APIConnectionRequest.model_validate(
            {**payload, "expected_revision": 1, "enabled": True, **changes}
        )


def test_rotation_key_whitespace_is_rejected_instead_of_silently_trimmed():
    with pytest.raises(ValidationError, match="whitespace"):
        RotateSub2APIKeyRequest(
            expected_revision=1,
            operation_id="pcop_" + "1" * 32,
            api_key="synthetic secret",
        )
