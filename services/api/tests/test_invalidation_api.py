import sqlite3
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from uuid import UUID

import aijian_api.invalidation_routes as invalidation_routes
import pytest
from aijian_api.invalidation_contracts import (
    InvalidationOperationPageResponse,
    InvalidationOperationResponse,
)
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from httpx2 import Response
from pydantic import ValidationError
from test_artifact_invalidation_ledger import (
    _approve_source_replacement_with_episode,
    approve_artifact,
    create_repository,
    snapshot_immutable_graph,
)

TOKEN = "x" * 43
HOST = "127.0.0.1:43123"
ORIGIN = "app://aijian"


def _fixture(tmp_path: Path):
    repository = create_repository(tmp_path / "workspace.db")
    project, _source, _source_v2, operation = _approve_source_replacement_with_episode(repository)
    return repository, project.id, operation


def _url(project_id: str, operation_id: str) -> str:
    return f"/api/v1/projects/{project_id}/invalidation-operations/{operation_id}"


def _list_url(project_id: str, *, limit: int | None = None, cursor: str | None = None) -> str:
    query = []
    if limit is not None:
        query.append(f"limit={limit}")
    if cursor is not None:
        query.append(f"cursor={cursor}")
    suffix = f"?{'&'.join(query)}" if query else ""
    return f"/api/v1/projects/{project_id}/invalidation-operations{suffix}"


def _append_source_replacement(
    repository: StudioRepository, project_id: str, parent_id: str, index: int
):
    version = repository.create_artifact_version(
        project_id=project_id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": f"src_{index}"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary=f"来源修订 {index}",
        parent_version_id=parent_id,
        expected_revision=repository.get_artifact_head(project_id, "source_manifest").revision,
    )
    approve_artifact(repository, repository.get_project(project_id), version, "source_manifest")
    return version


def _history_fixture(tmp_path: Path, *, count: int = 5):
    repository = create_repository(tmp_path / "workspace.db")
    project, _source, source_v2, _operation = _approve_source_replacement_with_episode(repository)
    project_id = project.id
    parent_id = source_v2.version.id
    for index in range(2, count + 1):
        parent_id = _append_source_replacement(repository, project_id, parent_id, index).version.id
    operations = repository.list_invalidation_operations(project_id)
    assert len(operations) == count
    return repository, project_id, operations


def _tie_operation_timestamps(repository: StudioRepository, operation_ids: list[str]) -> None:
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        connection.executemany(
            "UPDATE invalidation_operations SET created_at = ? WHERE operation_id = ?",
            [("2026-08-18T12:00:00Z", operation_id) for operation_id in operation_ids],
        )
        connection.commit()


def _valid_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN, "Host": HOST}


def _protected_client(
    repository: StudioRepository, *, client_host: str = "127.0.0.1"
) -> TestClient:
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    return TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=(client_host, 50100),
    )


def _assert_error(response: Response, status_code: int, code: str) -> None:
    assert response.status_code == status_code
    payload = response.json()
    assert payload["error"]["code"] == code
    if code == "INVALIDATION_LEDGER_CORRUPT":
        assert payload["error"].get("details", {}) == {}
    assert payload["error"]["retryable"] is False
    assert UUID(payload["request_id"])


def test_get_invalidation_operation_returns_persisted_detail_without_mutation(
    tmp_path: Path,
) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    before = snapshot_immutable_graph(repository.database_path)
    before_counts = _counts(repository.database_path)
    client = TestClient(create_app(repository=repository))

    response = client.get(_url(project_id, operation.id))
    assert response.status_code == 200
    data = response.json()["data"]
    assert data == {
        "operation_id": operation.id,
        "project_id": operation.project_id,
        "changed_artifact_id": operation.changed_artifact_id,
        "old_accepted_version_id": operation.old_accepted_version_id,
        "new_accepted_version_id": operation.new_accepted_version_id,
        "gate_decision_id": operation.gate_decision_id,
        "assessment_hash": operation.assessment_hash,
        "created_at": operation.created_at.isoformat().replace("+00:00", "Z"),
        "paths": [
            {
                "path_id": path.id,
                "operation_id": path.operation_id,
                "project_id": path.project_id,
                "affected_artifact_id": path.affected_artifact_id,
                "affected_version_id": path.affected_version_id,
                "classification": path.classification,
                "aggregate_impact": path.aggregate_impact,
                "dependency_ids": list(path.dependency_ids),
                "relationships": list(path.relationships),
                "edge_impacts": list(path.edge_impacts),
                "effective_impact": path.effective_impact,
                "ordinal": path.ordinal,
                "created_at": path.created_at.isoformat().replace("+00:00", "Z"),
            }
            for path in operation.paths
        ],
    }
    assert UUID(response.json()["request_id"])
    assert snapshot_immutable_graph(repository.database_path) == before
    assert _counts(repository.database_path) == before_counts

    reopened = StudioRepository(repository.database_path)
    repeated = TestClient(create_app(repository=reopened)).get(_url(project_id, operation.id))
    assert repeated.status_code == 200
    assert repeated.json()["data"] == data


def test_get_invalidation_operation_rejects_unknown_and_cross_project(tmp_path: Path) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    other = repository.create_project(
        name="other", aspect_ratio="9:16", target_duration_seconds=90, source_language="zh-CN"
    )
    client = TestClient(create_app(repository=repository))
    unknown = _url(project_id, "ivo_" + "f" * 32)
    assert client.get(unknown).status_code == 404
    _assert_error(client.get(unknown), 404, "INVALIDATION_OPERATION_NOT_FOUND")
    _assert_error(client.get(_url(other.id, operation.id)), 404, "INVALIDATION_OPERATION_NOT_FOUND")
    _assert_error(client.get(_url("prj_" + "f" * 32, operation.id)), 404, "PROJECT_NOT_FOUND")
    _assert_error(client.get(_url("bad-project-id", operation.id)), 422, "VALIDATION_ERROR")
    _assert_error(client.get(_url(project_id, "bad-operation-id")), 422, "VALIDATION_ERROR")


def test_openapi_exposes_only_typed_get_detail_route(tmp_path: Path) -> None:
    repository, _project_id, _operation = _fixture(tmp_path)
    schema = create_app(repository=repository).openapi()
    path = schema["paths"]["/api/v1/projects/{project_id}/invalidation-operations/{operation_id}"]
    assert set(path) == {"get"}
    assert path["get"]["operationId"] == "getInvalidationOperation"
    assert path["get"]["responses"]["200"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("InvalidationOperationResponse")


def test_read_corruption_handler_does_not_replace_shared_ledger_error_handler(
    tmp_path: Path,
) -> None:
    from aijian_api.artifact_invalidation_ledger import InvalidationLedgerError

    app = create_app(repository=StudioRepository(tmp_path / "workspace.db"))
    assert InvalidationLedgerError not in app.exception_handlers


@pytest.mark.parametrize(
    ("column", "value", "message"),
    [
        ("assessment_hash", "sha256:" + "0" * 64, "INVALIDATION_LEDGER_CORRUPT"),
        ("created_at", "not-a-timestamp", "INVALIDATION_LEDGER_CORRUPT"),
        ("created_at", "2026-08-17T12:00:00", "INVALIDATION_LEDGER_CORRUPT"),
    ],
)
def test_get_invalidation_operation_fails_closed_on_corrupt_operation(
    tmp_path: Path, column: str, value: str, message: str
) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        connection.execute(
            f"UPDATE invalidation_operations SET {column} = ? WHERE operation_id = ?",
            (value, operation.id),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    _assert_error(response, 500, message)


def test_get_invalidation_operation_fails_closed_on_corrupt_gate_ownership(tmp_path: Path) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    _approve_source_replacement_with_episode(repository)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        connection.execute("DROP TRIGGER invalidation_reason_paths_immutable_update")
        unrelated_decision = connection.execute(
            "SELECT decision_id FROM gate_decisions WHERE decision_id <> ? LIMIT 1",
            (operation.gate_decision_id,),
        ).fetchone()
        assert unrelated_decision is not None
        connection.execute(
            "UPDATE invalidation_operations SET gate_decision_id = ? WHERE operation_id = ?",
            (str(unrelated_decision[0]), operation.id),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")


def test_get_invalidation_operation_fails_closed_on_corrupt_path_ownership(tmp_path: Path) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    other, _source, _source_v2, _other_operation = _approve_source_replacement_with_episode(
        repository
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("DROP TRIGGER invalidation_reason_paths_immutable_update")
        connection.execute(
            "UPDATE invalidation_reason_paths SET project_id = ? WHERE operation_id = ?",
            (other.id, operation.id),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")


@pytest.mark.parametrize(
    "column,value",
    [
        ("dependency_ids_json", "[1]"),
        ("relationships_json", '["derived_from", "references"]'),
        ("edge_impacts_json", '["not-an-impact"]'),
        ("classification", "BROKEN"),
    ],
)
def test_get_invalidation_operation_fails_closed_on_corrupt_path_shape(
    tmp_path: Path, column: str, value: str
) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute("DROP TRIGGER invalidation_reason_paths_immutable_update")
        connection.execute(
            f"UPDATE invalidation_reason_paths SET {column} = ? WHERE operation_id = ?",
            (value, operation.id),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")


def test_sidecar_authentication_precedes_invalidation_detail(tmp_path: Path) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    client = _protected_client(repository)
    missing = client.get(_url(project_id, operation.id))
    _assert_error(missing, 401, "SIDECAR_AUTH_REQUIRED")
    wrong_origin = _valid_headers()
    wrong_origin["Origin"] = "http://127.0.0.1:5173"
    _assert_error(
        client.get(_url(project_id, operation.id), headers=wrong_origin),
        403,
        "SIDECAR_REQUEST_REJECTED",
    )
    _assert_error(
        _protected_client(repository, client_host="10.20.30.40").get(
            _url(project_id, operation.id), headers=_valid_headers()
        ),
        403,
        "SIDECAR_REQUEST_REJECTED",
    )
    accepted = client.get(_url(project_id, operation.id), headers=_valid_headers())
    assert accepted.status_code == 200


@pytest.mark.parametrize("path_count", [10_000, 10_001])
def test_get_invalidation_operation_enforces_path_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, path_count: int
) -> None:
    # Isolate the 10,000-path bound from the independent 4 MiB serialized-byte bound.
    monkeypatch.setattr(invalidation_routes, "MAX_REPORT_BYTES", 64 * 1024 * 1024)
    repository, project_id, operation = _fixture(tmp_path)
    path = operation.paths[0]
    paths = tuple(
        replace(path, id=f"ivp_{index:032x}", ordinal=index) for index in range(path_count)
    )
    mocked = replace(operation, paths=paths)
    monkeypatch.setattr(repository, "get_invalidation_operation", lambda *_args: mocked)
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    if path_count == 10_000:
        assert response.status_code == 200
    else:
        _assert_error(response, 413, "INVALIDATION_REPORT_TOO_LARGE")


def test_get_invalidation_operation_rejects_utf8_response_over_4mib(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from aijian_api.artifacts import canonical_content_bytes
    from aijian_api.invalidation_routes import MAX_REPORT_BYTES, _operation_data

    repository, project_id, operation = _fixture(tmp_path)
    path = operation.paths[0]

    def report_with_filler(filler: str):
        return replace(
            operation,
            paths=(replace(path, relationships=(filler,)),),
        )

    def report_size(filler: str) -> int:
        data = _operation_data(report_with_filler(filler)).model_dump(mode="json")
        return len(canonical_content_bytes(data))

    overhead = report_size("中") - 3
    remaining = MAX_REPORT_BYTES - overhead
    filler = "中" * (remaining // 3) + "x" * (remaining % 3)
    assert report_size(filler) == MAX_REPORT_BYTES
    monkeypatch.setattr(
        repository,
        "get_invalidation_operation",
        lambda *_args: report_with_filler(filler),
    )
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    assert response.status_code == 200

    monkeypatch.setattr(
        repository,
        "get_invalidation_operation",
        lambda *_args: report_with_filler(filler + "x"),
    )
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    _assert_error(response, 413, "INVALIDATION_REPORT_TOO_LARGE")


@pytest.mark.parametrize(
    "mutation",
    [
        "root_id",
        "project",
        "path_id",
        "path_owner",
        "ordinal",
        "dependency",
        "array",
        "empty_relation",
        "naive_time",
    ],
)
def test_get_invalidation_operation_validates_reader_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mutation: str
) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    path = operation.paths[0]
    invalid = {
        "root_id": replace(operation, id="ivo_" + "f" * 32),
        "project": replace(operation, project_id="prj_" + "f" * 32),
        "path_id": replace(operation, paths=(replace(path, id="invalid"),)),
        "path_owner": replace(operation, paths=(replace(path, operation_id="ivo_" + "f" * 32),)),
        "ordinal": replace(operation, paths=(replace(path, ordinal=2),)),
        "dependency": replace(operation, paths=(replace(path, dependency_ids=("dep_bad",)),)),
        "array": replace(operation, paths=(replace(path, relationships=("a", "b")),)),
        "empty_relation": replace(operation, paths=(replace(path, relationships=("",)),)),
        "naive_time": replace(
            operation, paths=(replace(path, created_at=path.created_at.replace(tzinfo=None)),)
        ),
    }[mutation]
    monkeypatch.setattr(repository, "get_invalidation_operation", lambda *_args: invalid)
    response = TestClient(create_app(repository=repository)).get(_url(project_id, operation.id))
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")
    assert "invalid invalidation ledger record" not in response.text


def test_invalidation_contract_forbids_unknown_fields_at_each_level(tmp_path: Path) -> None:
    repository, project_id, operation = _fixture(tmp_path)
    client = TestClient(create_app(repository=repository))
    for level in ("envelope", "operation", "path"):
        payload = client.get(_url(project_id, operation.id)).json()
        target = payload if level == "envelope" else payload["data"]
        if level == "path":
            target = target["paths"][0]
        target["unexpected_field"] = "must not cross this boundary"
        with pytest.raises(ValidationError, match="extra_forbidden"):
            InvalidationOperationResponse.model_validate(payload)


def test_list_invalidation_operations_returns_empty_strict_page(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="empty", aspect_ratio="9:16", target_duration_seconds=90, source_language="zh-CN"
    )
    response = TestClient(create_app(repository=repository)).get(_list_url(project.id))
    assert response.status_code == 200
    assert response.json()["data"] == {"items": [], "next_cursor": None}
    InvalidationOperationPageResponse.model_validate(response.json())


def test_list_invalidation_operations_reads_gate_summaries_without_detail_or_full_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path)
    before = snapshot_immutable_graph(repository.database_path)
    monkeypatch.setattr(
        repository,
        "list_invalidation_operations",
        lambda *_args: pytest.fail("collection route must not call the old full-list reader"),
    )
    monkeypatch.setattr(
        repository,
        "get_invalidation_operation",
        lambda *_args: pytest.fail("collection route must not call the detail reader"),
    )
    response = TestClient(create_app(repository=repository)).get(_list_url(project_id, limit=100))
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["next_cursor"] is None
    expected = {
        operation.id: {
            "operation_id": operation.id,
            "project_id": project_id,
            "changed_artifact_id": operation.changed_artifact_id,
            "old_accepted_version_id": operation.old_accepted_version_id,
            "new_accepted_version_id": operation.new_accepted_version_id,
            "gate_decision_id": operation.gate_decision_id,
            "assessment_hash": operation.assessment_hash,
            "created_at": operation.created_at.isoformat().replace("+00:00", "Z"),
            "reason_path_count": len(operation.paths),
        }
        for operation in operations
    }
    assert {item["operation_id"]: item for item in payload["items"]} == expected
    assert all(set(item) == set(next(iter(expected.values()))) for item in payload["items"])
    assert all("paths" not in item for item in payload["items"])
    assert snapshot_immutable_graph(repository.database_path) == before


def test_list_invalidation_operations_uses_exclusive_desc_keyset_with_tie_breaker(
    tmp_path: Path,
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path)
    _tie_operation_timestamps(repository, [operation.id for operation in operations])
    client = TestClient(create_app(repository=repository))
    expected_ids = sorted((operation.id for operation in operations), reverse=True)
    seen: list[str] = []
    cursor = None
    while True:
        response = client.get(_list_url(project_id, limit=2, cursor=cursor))
        assert response.status_code == 200
        page = response.json()["data"]
        page_ids = [item["operation_id"] for item in page["items"]]
        assert page_ids == sorted(page_ids, reverse=True)
        seen.extend(page_ids)
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == expected_ids
    assert len(seen) == len(set(seen))


def test_list_invalidation_operations_cursor_is_stable_across_insert_and_reopen(
    tmp_path: Path,
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path, count=3)
    client = TestClient(create_app(repository=repository))
    original_ids = [
        operation.id
        for operation in sorted(
            operations,
            key=lambda operation: (operation.created_at, operation.id),
            reverse=True,
        )
    ]
    first = client.get(_list_url(project_id, limit=2))
    assert first.status_code == 200
    first_data = first.json()["data"]
    first_ids = [item["operation_id"] for item in first_data["items"]]
    assert first_ids == original_ids[:2]
    cursor = first_data["next_cursor"]
    assert cursor is not None
    parent_id = max(operations, key=lambda operation: operation.created_at).new_accepted_version_id
    _append_source_replacement(repository, project_id, parent_id, 99)
    continued = client.get(_list_url(project_id, limit=2, cursor=cursor))
    assert continued.status_code == 200
    continued_data = continued.json()["data"]
    continued_ids = [item["operation_id"] for item in continued_data["items"]]
    all_after_insert = repository.list_invalidation_operations(project_id)
    inserted_ids = {operation.id for operation in all_after_insert} - set(original_ids)
    assert len(inserted_ids) == 1
    assert first_ids + continued_ids == original_ids
    assert not inserted_ids.intersection(continued_ids)
    assert continued_data["next_cursor"] is None
    refreshed = TestClient(create_app(repository=StudioRepository(repository.database_path))).get(
        _list_url(project_id, limit=2)
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["data"]["items"][0]["operation_id"] in inserted_ids


def test_list_invalidation_operations_validates_limits_cursor_and_project_ownership(
    tmp_path: Path,
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path)
    other = repository.create_project(
        name="other", aspect_ratio="9:16", target_duration_seconds=90, source_language="zh-CN"
    )
    client = TestClient(create_app(repository=repository))
    for limit in (None, 1, 100):
        assert client.get(_list_url(project_id, limit=limit)).status_code == 200
    for limit in (0, 101, "not-an-int"):
        _assert_error(client.get(_list_url(project_id, limit=limit)), 422, "VALIDATION_ERROR")
    _assert_error(
        client.get(_list_url(project_id, cursor="ivo_" + "A" * 32)),
        422,
        "VALIDATION_ERROR",
    )
    _assert_error(
        client.get(_list_url(project_id, cursor="ivo_" + "f" * 32 + "/..")),
        422,
        "VALIDATION_ERROR",
    )
    _assert_error(
        client.get(_list_url(project_id, cursor="ivo_" + "f" * 32)),
        404,
        "INVALIDATION_OPERATION_NOT_FOUND",
    )
    _assert_error(
        client.get(_list_url(other.id, cursor=operations[0].id)),
        404,
        "INVALIDATION_OPERATION_NOT_FOUND",
    )
    _assert_error(client.get(_list_url("prj_" + "f" * 32)), 404, "PROJECT_NOT_FOUND")
    assert client.get(_list_url(other.id)).json()["data"] == {"items": [], "next_cursor": None}


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("operation_id", "invalid-operation-id"),
        ("assessment_hash", "invalid-assessment-hash"),
        ("created_at", "not-a-timestamp"),
    ],
)
def test_list_invalidation_operations_fails_closed_on_corrupt_root_rows(
    tmp_path: Path, column: str, value: str
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        connection.execute(
            f"UPDATE invalidation_operations SET {column} = ? WHERE operation_id = ?",
            (value, operations[0].id),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository)).get(_list_url(project_id))
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")


def test_list_invalidation_operations_fails_closed_on_corrupt_gate_ownership(
    tmp_path: Path,
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        unrelated = connection.execute(
            """
            SELECT decision_id FROM gate_decisions
            WHERE decision_id NOT IN (SELECT gate_decision_id FROM invalidation_operations)
            LIMIT 1
            """
        ).fetchone()
        assert unrelated is not None
        connection.execute(
            "UPDATE invalidation_operations SET gate_decision_id = ? WHERE operation_id = ?",
            (str(unrelated[0]), operations[0].id),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository)).get(_list_url(project_id))
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("created_at", "not-a-timestamp"),
        ("created_at", "0001-01-01T00:00:00+14:00"),
        ("assessment_hash", "invalid-assessment-hash"),
        ("changed_artifact_id", "invalid-artifact-id"),
        ("old_accepted_version_id", "invalid-version-id"),
    ],
)
def test_list_invalidation_operations_fails_closed_on_corrupt_cursor_anchor(
    tmp_path: Path, column: str, value: str
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path)
    cursor = operations[0].id
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        connection.execute(
            f"UPDATE invalidation_operations SET {column} = ? WHERE operation_id = ?",
            (value, cursor),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository), raise_server_exceptions=False).get(
        _list_url(project_id, cursor=cursor)
    )
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")
    assert value not in response.text


def test_list_invalidation_operations_fails_closed_on_corrupt_cursor_gate_ownership(
    tmp_path: Path,
) -> None:
    repository, project_id, operations = _history_fixture(tmp_path)
    cursor = operations[0].id
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER invalidation_operations_immutable_update")
        unrelated = connection.execute(
            """
            SELECT decision_id FROM gate_decisions
            WHERE decision_id NOT IN (SELECT gate_decision_id FROM invalidation_operations)
            LIMIT 1
            """
        ).fetchone()
        assert unrelated is not None
        connection.execute(
            "UPDATE invalidation_operations SET gate_decision_id = ? WHERE operation_id = ?",
            (str(unrelated[0]), cursor),
        )
        connection.commit()
    response = TestClient(create_app(repository=repository)).get(
        _list_url(project_id, cursor=cursor)
    )
    _assert_error(response, 500, "INVALIDATION_LEDGER_CORRUPT")


def test_reason_path_count_query_plan_uses_production_page_sql(tmp_path: Path) -> None:
    repository, project_id, _operations = _history_fixture(tmp_path)
    statements: list[str] = []

    @contextmanager
    def traced_connection():
        connection = sqlite3.connect(repository.database_path)
        connection.row_factory = sqlite3.Row
        connection.set_trace_callback(statements.append)
        try:
            yield connection
        finally:
            connection.close()

    repository._connection = traced_connection  # type: ignore[method-assign]
    page = repository.list_invalidation_operation_page(project_id, limit=2, cursor=None)
    assert len(page.items) == 2
    page_sql = next(statement for statement in statements if "WITH page AS" in statement)
    assert "LIMIT 3" in page_sql
    assert "OFFSET" not in page_sql
    with sqlite3.connect(repository.database_path) as connection:
        plan = connection.execute(f"EXPLAIN QUERY PLAN {page_sql}").fetchall()
    detail = "\n".join(str(row[3]) for row in plan)
    assert "invalidation_operations_project_history" in detail
    assert "operation_id=?" in detail
    assert "project_affected" not in detail


def test_sidecar_authentication_precedes_invalidation_collection(tmp_path: Path) -> None:
    repository, project_id, _operations = _history_fixture(tmp_path)
    client = _protected_client(repository)
    _assert_error(client.get(_list_url(project_id)), 401, "SIDECAR_AUTH_REQUIRED")
    assert client.get(_list_url(project_id), headers=_valid_headers()).status_code == 200


def test_openapi_exposes_strict_get_only_invalidation_collection(tmp_path: Path) -> None:
    repository, project_id, _operations = _history_fixture(tmp_path)
    schema = create_app(repository=repository).openapi()
    collection = schema["paths"]["/api/v1/projects/{project_id}/invalidation-operations"]
    assert set(collection) == {"get"}
    get = collection["get"]
    assert get["operationId"] == "listInvalidationOperations"
    parameters = {parameter["name"]: parameter for parameter in get["parameters"]}
    assert (
        parameters["limit"]["schema"].items()
        >= {
            "type": "integer",
            "maximum": 100,
            "minimum": 1,
            "default": 20,
        }.items()
    )
    assert any(
        variant.get("pattern") == "^ivo_[0-9a-f]{32}$"
        for variant in parameters["cursor"]["schema"]["anyOf"]
    )
    assert get["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "InvalidationOperationPageResponse"
    )
    detail = schema["paths"]["/api/v1/projects/{project_id}/invalidation-operations/{operation_id}"]
    assert detail == {"get": detail["get"]}


def _counts(database: Path) -> tuple[int, int]:
    with sqlite3.connect(database) as connection:
        return tuple(
            int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in ("invalidation_operations", "invalidation_reason_paths")
        )  # type: ignore[return-value]
