import sqlite3
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.ingestion import ingest_text_file
from aijian_api.repository import ArtifactDependencyInvalidError, StudioRepository
from pydantic import ValidationError
from test_production_brief import adaptation_payload, original_payload
from test_review_repository import approve_artifact


def _project(repository: StudioRepository):
    return repository.create_project(
        name="Production brief",
        aspect_ratio="16:9",
        target_duration_seconds=90,
        source_language="zh-CN",
    )


def _write(
    repository: StudioRepository, project_id: str, content: dict[str, object], key: str, **kwargs
):
    return repository.write_production_brief(
        project_id=project_id,
        content=content,
        author_actor_id="local-user",
        change_summary="保存创作简报",
        idempotency_key_hash=canonical_content_hash({"key": key}),
        request_hash=canonical_content_hash({"content": content, **kwargs}),
        **kwargs,
    )


def test_original_brief_is_draft_and_same_request_replays_after_head_moves(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = _project(repository)
    content = original_payload()
    first = _write(repository, project.id, content, "first")
    revision = _write(
        repository,
        project.id,
        {**content, "creative": {**content["creative"], "intent": "修订后的意图。"}},  # type: ignore[index]
        "second",
        parent_version_id=first.version.id,
        expected_revision=first.head.revision,
    )
    replay = _write(repository, project.id, content, "first")

    assert first.version.parent_version_id is None
    assert first.head.accepted_version_id is None
    assert first.source_spans == () and first.dependencies == ()
    assert replay.version.id == first.version.id
    assert revision.head.latest_version_id == replay.head.latest_version_id


def test_adaptation_requires_current_accepted_manifest_and_persists_blocking_dependency(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = _project(repository)
    source = repository.import_source(
        project.id,
        ingest_text_file(filename="source.txt", content="第一章\n原文".encode()),
    )
    manifest = repository.get_latest_artifact(project.id, "source_manifest")
    approve_artifact(repository, project, manifest, "source_manifest")
    manifest = repository.get_latest_artifact(project.id, "source_manifest")
    payload = adaptation_payload()
    entry = payload["creative_entry"]
    assert isinstance(entry, dict)
    entry.update(
        source_manifest_version_id=manifest.version.id,
        source_document_id=source.id,
        source_block_ids=[source.blocks[0].id],
    )
    created = _write(repository, project.id, payload, "adapt")
    assert [
        (item.upstream_version_id, item.relationship, item.impact) for item in created.dependencies
    ] == [(manifest.version.id, "derived_from", "blocking")]

    stale = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content=manifest.version.content,
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="新来源草稿",
        parent_version_id=manifest.version.id,
        expected_revision=manifest.head.revision,
    )
    approve_artifact(repository, project, stale, "source_manifest")
    with pytest.raises(ArtifactDependencyInvalidError):
        _write(
            repository,
            project.id,
            payload,
            "new-key",
            parent_version_id=created.version.id,
            expected_revision=created.head.revision,
        )
    assert stale.head.latest_version_id != manifest.version.id


def test_direct_repository_write_rejects_invalid_content_without_artifact_or_receipt(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project = _project(repository)
    invalid = original_payload()
    entry = invalid["creative_entry"]
    assert isinstance(entry, dict)
    entry["source_document_id"] = "src_0123456789abcdef0123456789abcdef"

    with pytest.raises(ValidationError):
        _write(repository, project.id, invalid, "invalid")

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM artifacts WHERE artifact_type = 'production_brief'"
        ).fetchone() == (0,)
        assert connection.execute(
            "SELECT COUNT(*) FROM production_brief_write_requests"
        ).fetchone() == (0,)


def test_changed_imported_source_invalidation_and_reopened_receipt_replay(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project = _project(repository)
    source = repository.import_source(
        project.id,
        ingest_text_file(filename="first.txt", content="第一章\n旧来源".encode()),
    )
    first_manifest = repository.get_latest_artifact(project.id, "source_manifest")
    approve_artifact(repository, project, first_manifest, "source_manifest")
    first_manifest = repository.get_latest_artifact(project.id, "source_manifest")
    payload = adaptation_payload()
    entry = payload["creative_entry"]
    assert isinstance(entry, dict)
    entry.update(
        source_manifest_version_id=first_manifest.version.id,
        source_document_id=source.id,
        source_block_ids=[source.blocks[0].id],
    )
    brief = _write(repository, project.id, payload, "stable-receipt")

    repository.import_source(
        project.id,
        ingest_text_file(filename="second.txt", content="第一章\n真实新增来源".encode()),
    )
    changed_manifest = repository.get_latest_artifact(project.id, "source_manifest")
    assert changed_manifest.version.content_hash != first_manifest.version.content_hash
    approve_artifact(repository, project, changed_manifest, "source_manifest")

    operation = repository.list_invalidation_operations(project.id)[-1]
    path = next(item for item in operation.paths if item.affected_version_id == brief.version.id)
    assert path.classification == "INVALIDATE"
    assert path.relationships == ("derived_from",)
    assert path.edge_impacts == ("blocking",)

    reopened = StudioRepository(database)
    replay = _write(reopened, project.id, payload, "stable-receipt")
    exact = reopened.get_artifact_version(project.id, "production_brief", brief.version.id)
    assert replay.version.id == brief.version.id == exact.version.id


def test_receipt_insert_failure_rolls_back_adaptation_rows_then_retries(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"

    def fail_at_receipt(operation: str, step: str) -> None:
        if (operation, step) == ("write_production_brief", "receipt_written"):
            raise RuntimeError("injected receipt failure")

    failing = StudioRepository(database, transaction_hook=fail_at_receipt)
    project = _project(failing)
    source = failing.import_source(
        project.id,
        ingest_text_file(filename="source.txt", content="第一章\n受保护来源".encode()),
    )
    manifest = failing.get_latest_artifact(project.id, "source_manifest")
    approve_artifact(failing, project, manifest, "source_manifest")
    manifest = failing.get_latest_artifact(project.id, "source_manifest")
    payload = adaptation_payload()
    entry = payload["creative_entry"]
    assert isinstance(entry, dict)
    entry.update(
        source_manifest_version_id=manifest.version.id,
        source_document_id=source.id,
        source_block_ids=[source.blocks[0].id],
    )
    protected_tables = (
        "projects",
        "source_documents",
        "source_blocks",
        "artifacts",
        "artifact_versions",
        "artifact_heads",
        "gate_decisions",
    )
    with sqlite3.connect(database) as connection:
        before = {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
            for table in protected_tables
        }
    with pytest.raises(RuntimeError, match="injected receipt failure"):
        _write(failing, project.id, payload, "retryable")
    with sqlite3.connect(database) as connection:
        after = {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
            for table in protected_tables
        }
        assert after == before
        assert connection.execute(
            "SELECT COUNT(*) FROM artifacts WHERE artifact_type = 'production_brief'"
        ).fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM artifact_dependencies").fetchone() == (0,)
        assert connection.execute(
            "SELECT COUNT(*) FROM production_brief_write_requests"
        ).fetchone() == (0,)

    retried = _write(StudioRepository(database), project.id, payload, "retryable")
    assert retried.version.version_number == 1
    assert [
        (dependency.upstream_version_id, dependency.relationship, dependency.impact)
        for dependency in retried.dependencies
    ] == [(manifest.version.id, "derived_from", "blocking")]
