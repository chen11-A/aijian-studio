import base64
import json
import sqlite3
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api.artifacts import canonical_content_hash
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


def create_clocked_client(
    tmp_path: Path,
    clock: list[datetime],
) -> tuple[TestClient, StudioRepository, Path]:
    database = tmp_path / "workspace.db"
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    repository = StudioRepository(database, clock=lambda: clock[0])
    test_client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50101),
    )
    test_client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    return test_client, repository, database


def copy_draft(client: TestClient, project_id: str, version_id: str, etag: str):
    return client.post(
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}:copy-draft",
        headers={"If-Match": etag},
        json={},
    )


def review_audit_rows(database: Path) -> dict[str, list[tuple[object, ...]]]:
    connection = sqlite3.connect(database)
    try:
        return {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            for table in (
                "review_submissions",
                "role_signoffs",
                "gate_readiness_reports",
                "confirmation_challenges",
                "gate_decisions",
            )
        }
    finally:
        connection.close()


def copy_draft_persistent_state(database: Path) -> dict[str, list[tuple[object, ...]]]:
    connection = sqlite3.connect(database)
    try:
        return {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            for table in (
                "artifact_heads",
                "artifact_versions",
                "review_submissions",
                "role_signoffs",
                "gate_readiness_reports",
                "confirmation_challenges",
                "gate_decisions",
            )
        }
    finally:
        connection.close()


def artifact_version_ids(database: Path) -> set[str]:
    connection = sqlite3.connect(database)
    try:
        return {row[0] for row in connection.execute("SELECT version_id FROM artifact_versions")}
    finally:
        connection.close()


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
    tmp_path: Path,
) -> None:
    client, _repository, database = create_clocked_client(
        tmp_path, [datetime(2026, 9, 4, 9, 0, tzinfo=UTC)]
    )
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
    audit_before_copy = review_audit_rows(database)
    assert audit_before_copy["gate_decisions"]

    copied = copy_draft(client, project_id, version_id, decided.headers["etag"])
    assert copied.status_code == 201
    copied_version_id = copied.json()["data"]["latest_version"]["id"]
    assert copied.json()["data"]["head"]["accepted_version_id"] == version_id
    copied_base = (
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{copied_version_id}"
    )
    copied_submission_prepare = client.post(
        f"{copied_base}:prepare-submit", headers={"If-Match": copied.headers["etag"]}, json={}
    )
    copied_submitted = client.post(
        f"{copied_base}:submit",
        headers={"If-Match": copied.headers["etag"]},
        json=confirmation_payload(copied_submission_prepare),
    )
    assert copied_submitted.status_code == 200
    assert copied_submitted.json()["data"]["head"]["accepted_version_id"] == version_id
    assert review_audit_rows(database)["gate_decisions"] == audit_before_copy["gate_decisions"]

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
    assert latest.headers["etag"] == '"revision-7"'
    assert latest.json()["data"]["head"]["accepted_version_id"] == version_id
    assert latest.json()["data"]["head"]["latest_version_id"] != version_id
    assert latest.json()["data"]["review_version"]["id"] == copied_version_id
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


def test_g1_source_manifest_copy_draft_creates_a_new_latest_version(client: TestClient) -> None:
    project_id, version_id, etag = create_source_manifest(client)
    before = client.get(f"/api/v1/projects/{project_id}/source-manifest")

    copied = copy_draft(client, project_id, version_id, etag)

    assert copied.status_code == 201
    assert copied.headers["etag"] == '"revision-2"'
    data = copied.json()["data"]
    assert data["latest_version"]["id"] != version_id
    assert data["latest_version"]["parent_version_id"] == version_id
    before_latest = before.json()["data"]["latest_version"]
    assert data["latest_version"]["content"] == before_latest["content"]
    assert data["latest_version"]["content_hash"] == before_latest["content_hash"]
    assert data["head"]["review_version_id"] is None
    assert data["head"]["accepted_version_id"] is None


def test_g1_source_manifest_copy_draft_recovers_expired_signoff_with_new_review(
    tmp_path: Path,
) -> None:
    clock = [datetime(2026, 9, 4, 9, 0, tzinfo=UTC)]
    client, _repository, database = create_clocked_client(tmp_path, clock)
    project_id, version_id, etag = create_source_manifest(client)
    base = f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}"

    prepared_submit = client.post(f"{base}:prepare-submit", headers={"If-Match": etag}, json={})
    submitted = client.post(
        f"{base}:submit",
        headers={"If-Match": etag},
        json=confirmation_payload(prepared_submit),
    )
    submitted_etag = submitted.headers["etag"]
    old_submission_id = submitted.json()["data"]["submission"]["id"]
    prepared_signoff = client.post(
        f"{base}:prepare-signoff",
        headers={"If-Match": submitted_etag},
        json={},
    )
    signed = client.post(
        f"{base}/signoffs",
        headers={"If-Match": submitted_etag},
        json=confirmation_payload(prepared_signoff),
    )
    signed_etag = signed.headers["etag"]
    old_report_id = prepared_signoff.json()["data"]["report"]["id"]
    clock[0] += timedelta(minutes=6)
    expired_decision = client.post(
        f"{base}:prepare-decision",
        headers={"If-Match": signed_etag},
        json={
            "decision": "approved",
            "rationale": "来源基线重新确认",
            "readiness_report_id": old_report_id,
        },
    )
    refreshed_signoff = client.post(
        f"{base}:prepare-signoff",
        headers={"If-Match": signed_etag},
        json={},
    )
    repeated_signoff = client.post(
        f"{base}/signoffs",
        headers={"If-Match": signed_etag},
        json=confirmation_payload(refreshed_signoff),
    )
    assert expired_decision.status_code == 409
    assert refreshed_signoff.status_code == 200
    assert repeated_signoff.status_code == 409
    audit_before_copy = review_audit_rows(database)

    copied = copy_draft(client, project_id, version_id, signed_etag)
    assert copied.status_code == 201
    copied_data = copied.json()["data"]
    copied_version_id = copied_data["latest_version"]["id"]
    copied_etag = copied.headers["etag"]
    assert copied_data["head"]["review_version_id"] == version_id
    assert review_audit_rows(database) == audit_before_copy

    copied_base = (
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{copied_version_id}"
    )
    new_submit_prepare = client.post(
        f"{copied_base}:prepare-submit", headers={"If-Match": copied_etag}, json={}
    )
    new_submitted = client.post(
        f"{copied_base}:submit",
        headers={"If-Match": copied_etag},
        json=confirmation_payload(new_submit_prepare),
    )
    assert new_submitted.status_code == 200
    new_submission = new_submitted.json()["data"]["submission"]
    assert new_submission["supersedes_submission_id"] == old_submission_id
    audit_after_submit = review_audit_rows(database)
    for table, rows in audit_before_copy.items():
        assert audit_after_submit[table][: len(rows)] == rows

    new_submit_etag = new_submitted.headers["etag"]
    new_signoff_prepare = client.post(
        f"{copied_base}:prepare-signoff", headers={"If-Match": new_submit_etag}, json={}
    )
    new_signed = client.post(
        f"{copied_base}/signoffs",
        headers={"If-Match": new_submit_etag},
        json=confirmation_payload(new_signoff_prepare),
    )
    new_decision_prepare = client.post(
        f"{copied_base}:prepare-decision",
        headers={"If-Match": new_signed.headers["etag"]},
        json={
            "decision": "approved",
            "rationale": "新来源基线已确认",
            "readiness_report_id": new_signoff_prepare.json()["data"]["report"]["id"],
        },
    )
    new_decided = client.post(
        f"{copied_base}/decisions",
        headers={"If-Match": new_signed.headers["etag"]},
        json={
            **confirmation_payload(new_decision_prepare),
            "decision": "approved",
            "rationale": "新来源基线已确认",
        },
    )
    assert new_signed.status_code == 200
    assert new_decision_prepare.status_code == 200
    assert new_decided.status_code == 200
    assert new_decided.json()["data"]["head"]["accepted_version_id"] == copied_version_id
    audit_after_decision = review_audit_rows(database)
    for table, rows in audit_before_copy.items():
        assert audit_after_decision[table][: len(rows)] == rows


def test_g1_source_manifest_copy_draft_rejects_stale_targets_and_untrusted_input(
    tmp_path: Path,
) -> None:
    client, _repository, database = create_clocked_client(
        tmp_path, [datetime(2026, 9, 4, 9, 0, tzinfo=UTC)]
    )
    project_id, version_id, etag = create_source_manifest(client)
    other_project_id, _other_version_id, other_etag = create_source_manifest(client)
    baseline = copy_draft_persistent_state(database)
    missing = client.post(
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}:copy-draft",
        json={},
    )
    malformed = copy_draft(client, project_id, version_id, "revision-1")
    assert copy_draft_persistent_state(database) == baseline
    extra = client.post(
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}:copy-draft",
        headers={"If-Match": etag},
        json={"actor_id": "renderer"},
    )
    assert copy_draft_persistent_state(database) == baseline
    cross_project = copy_draft(client, other_project_id, version_id, other_etag)
    assert copy_draft_persistent_state(database) == baseline
    unprotected_database = tmp_path / "unprotected.db"
    unprotected_client = TestClient(create_app(repository=StudioRepository(unprotected_database)))
    no_sidecar = unprotected_client.post(
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}:copy-draft",
        headers={"If-Match": etag},
        json={},
    )
    assert copy_draft_persistent_state(database) == baseline
    assert artifact_version_ids(unprotected_database) == set()
    copied = copy_draft(client, project_id, version_id, etag)
    latest_etag = copied.headers["etag"]
    after_copy = copy_draft_persistent_state(database)
    stale = copy_draft(client, project_id, version_id, etag)
    old_target = copy_draft(client, project_id, version_id, latest_etag)
    unauthenticated = client.post(
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}:copy-draft",
        headers={"Authorization": "", "If-Match": latest_etag},
        json={},
    )
    wrong_origin = client.post(
        f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}:copy-draft",
        headers={"Origin": "http://127.0.0.1:5173", "If-Match": latest_etag},
        json={},
    )
    assert missing.status_code == 428
    assert malformed.status_code == 412
    assert extra.status_code == 422
    assert cross_project.status_code == 412
    assert no_sidecar.status_code == 404
    assert no_sidecar.json() == {"detail": "Not Found"}
    assert copied.status_code == 201
    assert stale.status_code == 412
    assert old_target.status_code == 412
    assert unauthenticated.status_code == 401
    assert wrong_origin.status_code == 403
    assert copy_draft_persistent_state(database) == after_copy


def test_g1_source_manifest_copy_draft_rejects_a_head_advance_after_snapshot_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = [datetime(2026, 9, 4, 9, 0, tzinfo=UTC)]
    client, repository, database = create_clocked_client(tmp_path, clock)
    project_id, version_id, etag = create_source_manifest(client)
    original_create = repository.create_artifact_version

    competitor_version_id: str | None = None

    def create_after_competing_write(**kwargs):
        nonlocal competitor_version_id
        competitor = original_create(
            **{**kwargs, "change_summary": "Concurrent source manifest draft"}
        )
        competitor_version_id = competitor.version.id
        return original_create(**kwargs)

    monkeypatch.setattr(repository, "create_artifact_version", create_after_competing_write)

    copied = copy_draft(client, project_id, version_id, etag)

    assert copied.status_code == 412
    refreshed = client.get(f"/api/v1/projects/{project_id}/source-manifest")
    assert refreshed.headers["etag"] == '"revision-2"'
    assert refreshed.json()["data"]["latest_version"]["id"] != version_id
    assert competitor_version_id is not None
    assert artifact_version_ids(database) == {version_id, competitor_version_id}


def test_g1_source_manifest_copy_draft_rejects_pre_read_revision_target_after_competitor(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = [datetime(2026, 9, 4, 9, 0, tzinfo=UTC)]
    client, repository, database = create_clocked_client(tmp_path, clock)
    project_id, version_id, _etag = create_source_manifest(client)
    original_read = repository.get_latest_artifact
    competitor_version_id: str | None = None

    def stale_read(requested_project_id: str, artifact_type: str):
        nonlocal competitor_version_id
        record = original_read(requested_project_id, artifact_type)
        if requested_project_id == project_id and artifact_type == "source_manifest":
            competitor = repository.create_artifact_version(
                project_id=project_id,
                artifact_type="source_manifest",
                schema_version="1.0.0",
                content=record.version.content,
                author_actor_type="human",
                author_actor_id="local-user",
                change_summary="Concurrent source manifest draft",
                parent_version_id=record.version.id,
                expected_revision=record.head.revision,
            )
            competitor_version_id = competitor.version.id
        return record

    monkeypatch.setattr(repository, "get_latest_artifact", stale_read)
    copied = copy_draft(client, project_id, version_id, '"revision-2"')

    assert copied.status_code == 412
    assert competitor_version_id is not None
    assert artifact_version_ids(database) == {version_id, competitor_version_id}


@pytest.mark.parametrize(
    ("mutate", "with_matching_hash"),
    [
        (
            lambda content: {
                **content,
                "documents": [{**content["documents"][0], "chapter_count": "1"}],
            },
            False,
        ),
        (
            lambda content: {
                **content,
                "documents": [{**content["documents"][0], "chapter_count": 0}],
            },
            True,
        ),
        (
            lambda content: {
                **content,
                "documents": [{**content["documents"][0], "chapter_count": float("nan")}],
            },
            False,
        ),
    ],
    ids=("coercible_raw_hash_mismatch", "schema_invalid", "nonfinite_raw_hash"),
)
def test_g1_source_manifest_copy_draft_rejects_corrupt_in_memory_snapshots_without_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mutate, with_matching_hash: bool
) -> None:
    client, repository, database = create_clocked_client(
        tmp_path, [datetime(2026, 9, 4, tzinfo=UTC)]
    )
    project_id, version_id, etag = create_source_manifest(client)
    baseline = copy_draft_persistent_state(database)
    original_read = repository.get_latest_artifact

    def corrupt_read(requested_project_id: str, artifact_type: str):
        record = original_read(requested_project_id, artifact_type)
        if requested_project_id != project_id or artifact_type != "source_manifest":
            return record
        content = mutate(record.version.content)
        content_hash = (
            canonical_content_hash(content) if with_matching_hash else record.version.content_hash
        )
        return replace(
            record, version=replace(record.version, content=content, content_hash=content_hash)
        )

    monkeypatch.setattr(repository, "get_latest_artifact", corrupt_read)
    copied = copy_draft(client, project_id, version_id, etag)
    assert copied.status_code == 412
    assert copied.json()["error"]["code"] == "PRECONDITION_FAILED"
    assert "validation" not in copied.text.lower()
    assert "nan" not in copied.text.lower()
    assert copy_draft_persistent_state(database) == baseline
