import base64
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api.contracts import PreparedReviewActionResponse
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from pydantic import create_model

from scripts import export_openapi

TOKEN = "g" * 43
HOST = "127.0.0.1:43124"
ORIGIN = "app://aijian"
PRIVATE_COMPONENTS = {
    "EmptyActionRequest",
    "ConfirmationRequest",
    "PrepareGateDecisionRequest",
    "GateDecisionRequest",
    "PreparedReviewActionResponse",
    "ReviewSubmissionResponse",
    "ReviewSignoffResponse",
    "GateDecisionResponse",
}


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    test_client = TestClient(
        create_app(
            repository=StudioRepository(tmp_path / "workspace.db"),
            sidecar_security=security,
        ),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50101),
    )
    test_client.headers.update(
        {
            "Authorization": f"Bearer {TOKEN}",
            "Origin": ORIGIN,
        }
    )
    return test_client


def create_source_manifest(client: TestClient) -> tuple[str, str, str]:
    project_response = client.post(
        "/api/v1/projects",
        json={
            "name": "雾城来信",
            "aspect_ratio": "9:16",
            "target_duration_seconds": 90,
            "source_language": "zh-CN",
        },
    )
    project_id = project_response.json()["data"]["id"]
    import_response = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={
            "filename": "雾城来信.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode("第一章\n雨夜来信".encode()).decode(),
        },
    )
    assert import_response.status_code == 201
    manifest_response = client.get(f"/api/v1/projects/{project_id}/source-manifest")
    data = manifest_response.json()["data"]
    assert data["project_id"] == project_id
    return project_id, data["latest_version"]["id"], manifest_response.headers["etag"]


def confirmation_payload(prepared_response) -> dict[str, str]:
    prepared = prepared_response.json()["data"]
    return {
        "challenge_id": prepared["challenge"]["id"],
        "confirmation_token": prepared["confirmation_token"],
    }


def assert_component_references_are_closed(value: object, components: dict[str, object]) -> None:
    if isinstance(value, dict):
        reference = value.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
            assert reference.removeprefix("#/components/schemas/") in components
        for nested_value in value.values():
            assert_component_references_are_closed(nested_value, components)
    elif isinstance(value, list):
        for nested_value in value:
            assert_component_references_are_closed(nested_value, components)


def test_g1_source_manifest_requires_etag_and_trusted_prepare_action(
    client: TestClient,
) -> None:
    project_id, version_id, etag = create_source_manifest(client)
    path = (
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/"
        f"{version_id}:prepare-submit"
    )

    missing = client.post(path, json={})
    malformed = client.post(path, headers={"If-Match": "revision-1"}, json={})
    unauthenticated = client.post(
        path,
        headers={"Authorization": "", "If-Match": etag},
        json={},
    )
    wrong_origin = client.post(
        path,
        headers={"Origin": "http://127.0.0.1:5173", "If-Match": etag},
        json={},
    )
    spoofed_actor = client.post(
        path,
        headers={"If-Match": etag},
        json={"actor_id": "renderer", "roles": ["producer"]},
    )

    assert missing.status_code == 428
    assert missing.json()["error"]["code"] == "PRECONDITION_REQUIRED"
    assert malformed.status_code == 412
    assert malformed.json()["error"]["code"] == "PRECONDITION_FAILED"
    assert unauthenticated.status_code == 401
    assert "confirmation_token" not in unauthenticated.text
    assert wrong_origin.status_code == 403
    assert "confirmation_token" not in wrong_origin.text
    assert spoofed_actor.status_code == 422
    assert "renderer" not in spoofed_actor.text


def test_g1_source_manifest_submit_signoff_and_decision_are_confirmed_and_versioned(
    client: TestClient,
) -> None:
    project_id, version_id, etag = create_source_manifest(client)
    base = f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}"

    prepared_submit = client.post(
        f"{base}:prepare-submit",
        headers={"If-Match": etag},
        json={},
    )
    assert prepared_submit.status_code == 200
    assert prepared_submit.headers["etag"] == '"revision-1"'
    assert prepared_submit.json()["data"]["report"]["gate"] == "G1"
    prepared_contract = PreparedReviewActionResponse.model_validate(prepared_submit.json())
    assert prepared_contract.data.report.gate == "G1"
    submitted = client.post(
        f"{base}:submit",
        headers={"If-Match": etag},
        json=confirmation_payload(prepared_submit),
    )
    assert submitted.status_code == 200
    assert submitted.headers["etag"] == '"revision-2"'
    assert submitted.json()["data"]["head"]["review_version_id"] == version_id
    review_read = client.get(f"/api/v1/projects/{project_id}/source-manifest")
    assert review_read.json()["data"]["review_version"]["id"] == version_id

    replayed = client.post(
        f"{base}:submit",
        headers={"If-Match": '"revision-2"'},
        json=confirmation_payload(prepared_submit),
    )
    assert replayed.status_code == 409
    assert replayed.json()["error"]["code"] == "REVIEW_INVALID"

    prepared_signoff = client.post(
        f"{base}:prepare-signoff",
        headers={"If-Match": '"revision-2"'},
        json={},
    )
    assert prepared_signoff.status_code == 200
    signoff_report_id = prepared_signoff.json()["data"]["report"]["id"]
    signed = client.post(
        f"{base}/signoffs",
        headers={"If-Match": '"revision-2"'},
        json=confirmation_payload(prepared_signoff),
    )
    assert signed.status_code == 200
    assert signed.headers["etag"] == '"revision-3"'
    assert {signoff["role"] for signoff in signed.json()["data"]["signoffs"]} == {
        "writer",
        "producer",
    }

    rationale = "来源、哈希和块范围均已人工确认"
    prepared_decision = client.post(
        f"{base}:prepare-decision",
        headers={"If-Match": '"revision-3"'},
        json={
            "decision": "approved",
            "rationale": rationale,
            "readiness_report_id": signoff_report_id,
        },
    )
    assert prepared_decision.status_code == 200
    decided = client.post(
        f"{base}/decisions",
        headers={"If-Match": '"revision-3"'},
        json={
            **confirmation_payload(prepared_decision),
            "decision": "approved",
            "rationale": rationale,
        },
    )
    assert decided.status_code == 200
    assert decided.headers["etag"] == '"revision-4"'
    assert decided.json()["data"]["head"]["accepted_version_id"] == version_id
    assert decided.json()["data"]["decision"]["actor_id"] == "local-user"
    assert decided.json()["data"]["decision"]["actor_role"] == "producer"

    imported_revision = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={
            "filename": "第二章.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode("第二章\n旧站重逢".encode()).decode(),
        },
    )
    assert imported_revision.status_code == 201
    latest = client.get(f"/api/v1/projects/{project_id}/source-manifest")
    assert latest.headers["etag"] == '"revision-5"'
    assert latest.json()["data"]["head"]["accepted_version_id"] == version_id
    assert latest.json()["data"]["head"]["latest_version_id"] != version_id
    assert latest.json()["data"]["review_version"] is None
    assert latest.json()["data"]["accepted_version"]["id"] == version_id
    assert len(latest.json()["data"]["accepted_version"]["content"]["documents"]) == 1
    assert len(latest.json()["data"]["latest_version"]["content"]["documents"]) == 2


def test_public_openapi_and_unprotected_app_exclude_all_gate_capabilities(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()
    serialized_schema = str(schema)
    unprotected_client = TestClient(
        create_app(repository=StudioRepository(tmp_path / "unprotected.db"))
    )

    assert all("/api/v1/internal/" not in path for path in schema["paths"])
    assert "confirmation_token" not in serialized_schema
    assert "PreparedReviewActionResponse" not in schema["components"]["schemas"]
    assert (
        unprotected_client.post(
            "/api/v1/internal/projects/prj_missing/source-manifest/"
            "versions/ver_missing:prepare-submit",
            json={},
        ).status_code
        == 404
    )


def test_source_manifest_review_export_is_private_closed_and_deterministic(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    public_output = tmp_path / "packages" / "contracts" / "openapi.json"
    private_output = tmp_path / "apps" / "desktop" / "src" / "source-manifest-review.openapi.json"
    monkeypatch.setattr(export_openapi, "ROOT", tmp_path)
    monkeypatch.setattr(export_openapi, "OUTPUT", public_output)
    monkeypatch.setattr(sys, "argv", ["export_openapi.py", "--source-manifest-review"])

    export_openapi.main()

    assert not public_output.exists()
    schema = json.loads(private_output.read_text(encoding="utf-8"))
    assert schema["paths"] == {}
    components = schema["components"]["schemas"]
    assert PRIVATE_COMPONENTS <= set(components)
    assert components["ConfirmationRequest"]["additionalProperties"] is False
    assert components["ConfirmationRequest"]["properties"]["confirmation_token"]["minLength"] == 20
    assert_component_references_are_closed(schema, components)

    first = private_output.read_bytes()
    export_openapi.main()
    assert private_output.read_bytes() == first


def test_default_contract_export_remains_public_and_excludes_review_secrets(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    public_output = tmp_path / "packages" / "contracts" / "openapi.json"
    private_output = tmp_path / "apps" / "desktop" / "src" / "source-manifest-review.openapi.json"
    monkeypatch.setattr(export_openapi, "ROOT", tmp_path)
    monkeypatch.setattr(export_openapi, "OUTPUT", public_output)
    monkeypatch.setattr(sys, "argv", ["export_openapi.py"])

    export_openapi.main()

    schema = json.loads(public_output.read_text(encoding="utf-8"))
    assert not private_output.exists()
    assert all("/api/v1/internal/" not in path for path in schema["paths"])
    assert "confirmation_token" not in str(schema)
    assert "PreparedReviewActionResponse" not in schema["components"]["schemas"]


def test_source_manifest_review_export_rejects_reachable_nested_name_collisions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    duplicate_text = create_model("DuplicateNested", text=(str, ...))
    duplicate_count = create_model("DuplicateNested", count=(int, ...))
    first_root = create_model("FirstRoot", nested=(duplicate_text, ...))
    second_root = create_model("SecondRoot", nested=(duplicate_count, ...))
    contracts = SimpleNamespace(FirstRoot=first_root, SecondRoot=second_root)
    original_import_module = export_openapi.import_module

    def import_contracts(name: str):
        if name == "aijian_api.contracts":
            return contracts
        return original_import_module(name)

    monkeypatch.setattr(
        export_openapi,
        "SOURCE_MANIFEST_REVIEW_MODEL_NAMES",
        ("FirstRoot", "SecondRoot"),
    )
    monkeypatch.setattr(export_openapi, "import_module", import_contracts)

    with pytest.raises(ValueError, match="conflicting source manifest review schema name"):
        export_openapi._source_manifest_review_openapi()
