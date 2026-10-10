"""Real accepted-draft reads and corrupt-read adapters, with no provider execution."""

import sqlite3
from contextlib import contextmanager
from unittest.mock import Mock

import pytest
from aijian_api.repository import ArtifactConflictError
from test_proposal_run_create_api import reviewable_proposal


@pytest.fixture
def accepted(tmp_path):
    client, repository, project, proposal, _ = reviewable_proposal(
        tmp_path, key="synthetic-read-run"
    )
    result = client.post(
        f"/api/v1/projects/{project}/proposals/{proposal}/acceptances",
        headers={"Idempotency-Key": "synthetic-draft-read"},
        json={"parent_version_id": None, "expected_head_revision": None},
    )
    assert result.status_code == 201
    return client, repository, project, result.json()["data"]["draft_version_id"]


def intercept_reads(repository, monkeypatch, transform):
    original = repository._connection
    statements = []

    @contextmanager
    def connection():
        with original() as opened:
            opened.set_trace_callback(statements.append)

            def factory(cursor, values):
                row = sqlite3.Row(cursor, values)
                return transform(row)

            opened.row_factory = factory
            yield opened
            assert opened.total_changes == 0

    monkeypatch.setattr(repository, "_connection", connection)
    return statements


def assert_read_only(statements):
    assert statements
    assert all(
        statement.lstrip().split()[0] in {"SELECT", "PRAGMA", "BEGIN", "COMMIT", "ROLLBACK"}
        for statement in statements
    )


def test_latest_and_exact_version_read_have_distinct_etags_and_no_writes(accepted, monkeypatch):
    client, repository, project, version = accepted
    statements = intercept_reads(repository, monkeypatch, lambda row: row)
    latest = client.get(f"/api/v1/projects/{project}/source-extraction")
    exact = client.get(f"/api/v1/projects/{project}/source-extraction/versions/{version}")
    assert latest.status_code == exact.status_code == 200
    data = latest.json()["data"]
    assert data == exact.json()["data"]
    assert data["version"]["id"] == version
    assert latest.headers["etag"] == f'"revision-{data["head"]["revision"]}"'
    assert exact.headers["etag"] == f'"{data["version"]["content_hash"]}"'
    assert data["head"]["accepted_version_id"] is None
    assert_read_only(statements)


@pytest.mark.parametrize("kind", ["project", "version"])
def test_unknown_identity_returns_nonretryable_not_found(accepted, kind):
    client, _, project, _ = accepted
    url = (
        f"/api/v1/projects/prj_{'f' * 32}/source-extraction"
        if kind == "project"
        else f"/api/v1/projects/{project}/source-extraction/versions/ver_{'f' * 32}"
    )
    result = client.get(url)
    assert result.status_code == 404
    assert result.json()["error"]["code"] == "SOURCE_EXTRACTION_NOT_FOUND"
    assert result.json()["error"]["retryable"] is False


@pytest.mark.parametrize(
    "failure", [ArtifactConflictError, RuntimeError, ValueError, TypeError, KeyError]
)
def test_repository_read_errors_are_stable_conflicts_not_internal_details(
    accepted, monkeypatch, failure
):
    client, repository, project, _ = accepted
    monkeypatch.setattr(
        repository,
        "_get_artifact_version_in_connection",
        Mock(side_effect=failure("synthetic private detail")),
    )
    result = client.get(f"/api/v1/projects/{project}/source-extraction")
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "SOURCE_EXTRACTION_INCONSISTENT"
    assert "synthetic private detail" not in result.text


@pytest.mark.parametrize(
    "field",
    [
        "version_attempt_id",
        "acceptance_project_id",
        "proposal_project_id",
        "proposal_attempt_id",
        "acceptance_proposal_hash",
        "target_artifact_type",
        "author_actor_type",
        "author_actor_id",
        "proposal_json",
    ],
)
def test_lineage_read_drift_never_exposes_a_valid_draft(accepted, monkeypatch, field):
    client, repository, project, version = accepted

    def corrupt(row):
        if "version_attempt_id" not in row.keys():
            return row
        changed = dict(row)
        changed[field] = "{}" if field == "proposal_json" else "mismatch"
        return changed

    statements = intercept_reads(repository, monkeypatch, corrupt)
    result = client.get(f"/api/v1/projects/{project}/source-extraction/versions/{version}")
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "SOURCE_EXTRACTION_INCONSISTENT"
    assert_read_only(statements)


@pytest.mark.parametrize(
    "field", ["project_id", "artifact_type", "artifact_id", "content_hash", "content_json"]
)
def test_upstream_manifest_read_drift_never_exposes_a_valid_draft(accepted, monkeypatch, field):
    client, repository, project, version = accepted

    def corrupt(row):
        if set(row.keys()) != {
            "project_id",
            "artifact_type",
            "artifact_id",
            "content_json",
            "content_hash",
        }:
            return row
        changed = dict(row)
        changed[field] = "[]" if field == "content_json" else "mismatch"
        return changed

    statements = intercept_reads(repository, monkeypatch, corrupt)
    result = client.get(f"/api/v1/projects/{project}/source-extraction/versions/{version}")
    assert result.status_code == 409
    assert_read_only(statements)


@pytest.mark.parametrize(
    "field", ["raw_sha256", "normalized_text", "normalized_start_byte", "normalized_end_byte"]
)
def test_original_source_read_drift_never_exposes_a_valid_draft(accepted, monkeypatch, field):
    client, repository, project, version = accepted

    def corrupt(row):
        if set(row.keys()) != {
            "normalized_text",
            "raw_sha256",
            "normalized_start_byte",
            "normalized_end_byte",
        }:
            return row
        changed = dict(row)
        changed[field] = {
            "raw_sha256": "f" * 64,
            "normalized_text": "changed",
            "normalized_start_byte": 10**9,
            "normalized_end_byte": 0,
        }[field]
        return changed

    statements = intercept_reads(repository, monkeypatch, corrupt)
    result = client.get(f"/api/v1/projects/{project}/source-extraction/versions/{version}")
    assert result.status_code == 409
    assert_read_only(statements)


def test_project_without_extraction_is_not_found_and_creates_no_artifact(tmp_path):
    from test_proposal_run_create_api import sidecar_client

    client, repository = sidecar_client(tmp_path)
    project = repository.create_project(
        name="empty", aspect_ratio="9:16", target_duration_seconds=10, source_language="zh-CN"
    )
    result = client.get(f"/api/v1/projects/{project.id}/source-extraction")
    assert result.status_code == 404
    with repository._connection() as connection:
        assert connection.execute("SELECT count(*) FROM artifacts").fetchone()[0] == 0
