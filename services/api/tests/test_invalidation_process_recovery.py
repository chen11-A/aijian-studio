"""Two real Gate process exits; synthetic fixture approvals, never film approval."""

import json
import multiprocessing
import os
import sqlite3
import sys
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from time import perf_counter
from typing import Any

import pytest
from aijian_api.main import create_app
from aijian_api.repository import ReviewInvalidError, StudioRepository
from fastapi.testclient import TestClient
from test_artifact_invalidation_ledger import (
    LOCAL_ACTOR,
    NOW,
    STORY_CONTENT,
    MutableClock,
    _prepare_source_replacement_decision,
    approve_artifact,
    create_source_and_story,
    source_dependency,
)


def _snapshot(database: Path) -> dict[str, list[dict[str, Any]]]:
    """Compare complete logical rows, including content, parents and exact dependencies."""
    with closing(sqlite3.connect(database)) as connection:
        connection.row_factory = sqlite3.Row
        tables = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        return {
            table["name"]: sorted(
                [dict(row) for row in connection.execute(f'SELECT * FROM "{table["name"]}"')],
                key=lambda row: json.dumps(row, sort_keys=True),
            )
            for table in tables
        }


def _fixture(database: Path) -> tuple[dict[str, Any], str]:
    # Keep the fixture clock across spawn, but never restart deterministic ID counters.
    repository = StudioRepository(database, clock=MutableClock())
    project, source, story = create_source_and_story(repository)
    accepted_story = approve_artifact(repository, project, story, "story_bible")
    repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content={**STORY_CONTENT, "logline": "人工修订：保留旧车站的线索。"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="必须保留的人工子版本",
        parent_version_id=story.version.id,
        expected_revision=accepted_story.head.revision,
        **source_dependency(source.version.id),
    )
    replacement = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_process_recovery_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="合成测试来源修订",
        parent_version_id=source.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    signed, prepared = _prepare_source_replacement_decision(repository, project, replacement)
    return {
        "project_id": project.id,
        "artifact_type": "source_manifest",
        "version_id": replacement.version.id,
        "decision": "approved",
        # This must remain bound to the payload prepared by the existing helper.
        "rationale": "闭合失败应回滚",
        "expected_revision": signed.head.revision,
        "challenge_id": prepared.challenge.id,
        "confirmation_token": prepared.confirmation_token,
        "actor": LOCAL_ACTOR,
        "actor_role": "producer",
    }, source.version.id


def _exit_before_commit(database: Path, decision: dict[str, Any]) -> None:
    def hard_exit(operation: str, step: str) -> None:
        if (operation, step) == ("decide_gate", "head_updated"):
            os._exit(73)

    repository = StudioRepository(database, clock=MutableClock(), transaction_hook=hard_exit)
    repository.decide_artifact_gate(**decision)


def _exit_after_commit(database: Path, decision: dict[str, Any]) -> None:
    repository = StudioRepository(database, clock=MutableClock())
    repository.decide_artifact_gate(**decision)
    # This is after the real method returns, not an HTTP lost-reply checkpoint.
    os._exit(74)


def _read_recovered(database: Path, project_id: str, output: Path) -> None:
    started = perf_counter()
    # SQLite performs its real crash recovery before any application initialization.
    # A repository that silently reconstructs missing rows must not pass durability checks.
    before_reads = _snapshot(database)
    repository = StudioRepository(database, clock=MutableClock())
    head = repository.get_artifact_head(project_id, "source_manifest")
    reopen_ms = (perf_counter() - started) * 1000
    assert _snapshot(database) == before_reads
    url = f"/api/v1/projects/{project_id}/invalidation-operations"
    with TestClient(create_app(repository=repository)) as client:
        response = client.get(url)
        assert response.status_code == 200
        history = response.json()["data"]
        reports = []
        # Discover identities via public project history, never by passing a DB operation ID.
        for item in history["items"]:
            detail = client.get(f"{url}/{item['operation_id']}")
            assert detail.status_code == 200
            reports.append(detail.json()["data"])
    assert _snapshot(database) == before_reads
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    output.write_text(
        json.dumps(
            {
                "head": head.accepted_version_id,
                "snapshot": before_reads,
                "reopen_ms": reopen_ms,
                "history": history,
                "reports": reports,
            }
        ),
        encoding="utf-8",
    )


def _run_child(target: Callable[..., None], args: tuple[Any, ...], exit_code: int) -> None:
    process = multiprocessing.get_context("spawn").Process(target=target, args=args)
    try:
        process.start()
        process.join(timeout=30)
        assert process.exitcode == exit_code, (
            f"{target.__name__}: expected exit {exit_code}, got {process.exitcode}"
        )
    finally:
        failure = sys.exc_info()[1]
        try:
            if process.is_alive():
                process.terminate()
                process.join(timeout=5)
            if process.is_alive():
                process.kill()
                process.join(timeout=5)
            if process.is_alive():
                raise AssertionError(f"Owned child {process.pid} survived bounded cleanup")
            process.close()
        except Exception as cleanup_error:
            if failure is None:
                raise
            failure.add_note(f"Child cleanup also failed: {cleanup_error!r}")


def _recover(database: Path, project_id: str, label: str) -> dict[str, Any]:
    output = database.with_name(f"{label}.json")
    _run_child(_read_recovered, (database, project_id, output), 0)
    recovered = json.loads(output.read_text(encoding="utf-8"))
    print(f"{label} reopen_ms={recovered['reopen_ms']:.3f}")
    return recovered


def _assert_committed(
    before: dict[str, Any], recovered: dict[str, Any], decision: dict[str, Any], old_version: str
) -> None:
    after = recovered["snapshot"]
    changed_tables = {
        "artifact_heads",
        "confirmation_challenges",
        "gate_decisions",
        "invalidation_operations",
        "invalidation_reason_paths",
    }
    assert after.keys() == before.keys()
    for table in before.keys() - changed_tables:
        assert after[table] == before[table], table
    # These nonempty full rows prove human content/hash, parents and dependencies survive.
    humans = [row for row in before["artifact_versions"] if row["author_actor_type"] == "human"]
    assert len(humans) == 2
    assert any(row["parent_version_id"] is not None for row in humans)
    assert len(before["artifact_dependencies"]) == 2
    assert before["task_ledger"] == before["workflow_attempts"] == []

    consumed_at = NOW.isoformat().replace("+00:00", "Z")
    challenge = next(
        row
        for row in before["confirmation_challenges"]
        if row["challenge_id"] == decision["challenge_id"]
    )
    assert challenge["consumed_at"] is None
    assert {row["challenge_id"]: row for row in after["confirmation_challenges"]} == {
        row["challenge_id"]: ({**row, "consumed_at": consumed_at} if row == challenge else row)
        for row in before["confirmation_challenges"]
    }
    old_head = next(
        row for row in before["artifact_heads"] if row["artifact_id"] == challenge["artifact_id"]
    )
    assert old_head["accepted_version_id"] == old_version
    assert recovered["head"] == decision["version_id"]
    assert {row["artifact_id"]: row for row in after["artifact_heads"]} == {
        row["artifact_id"]: (
            {
                **row,
                "accepted_version_id": decision["version_id"],
                "review_version_id": None,
                "review_submission_id": None,
                "revision": row["revision"] + 1,
                "updated_at": consumed_at,
            }
            if row == old_head
            else row
        )
        for row in before["artifact_heads"]
    }
    assert all(row in after["gate_decisions"] for row in before["gate_decisions"])
    [gate] = [row for row in after["gate_decisions"] if row not in before["gate_decisions"]]
    assert gate == {
        "decision_id": gate["decision_id"],
        "artifact_id": challenge["artifact_id"],
        "version_id": decision["version_id"],
        "submission_id": old_head["review_submission_id"],
        "gate": challenge["gate"],
        "decision": "approved",
        "readiness_report_id": challenge["readiness_report_id"],
        "actor_id": LOCAL_ACTOR.subject_id,
        "actor_role": "producer",
        "self_review": 0,
        "rationale": decision["rationale"],
        "decided_at": consumed_at,
        "confirmation_challenge_id": decision["challenge_id"],
        "head_revision": decision["expected_revision"],
    }
    [operation] = after["invalidation_operations"]
    assert operation == {
        "operation_id": operation["operation_id"],
        "project_id": decision["project_id"],
        "changed_artifact_id": challenge["artifact_id"],
        "old_accepted_version_id": old_version,
        "new_accepted_version_id": decision["version_id"],
        "gate_decision_id": gate["decision_id"],
        "assessment_hash": operation["assessment_hash"],
        "created_at": consumed_at,
    }
    [report] = recovered["reports"]
    paths = sorted(after["invalidation_reason_paths"], key=lambda row: row["ordinal"])
    expected_paths = [
        {
            key.removesuffix("_json"): json.loads(value) if key.endswith("_json") else value
            for key, value in row.items()
        }
        for row in paths
    ]
    assert report == {**operation, "paths": expected_paths}
    assert recovered["history"] == {
        "items": [{**operation, "reason_path_count": 2}],
        "next_cursor": None,
    }
    assert [path["ordinal"] for path in expected_paths] == [0, 1]
    dependencies = {row["downstream_version_id"]: row for row in before["artifact_dependencies"]}
    assert {path["affected_version_id"] for path in expected_paths} == {
        row["version_id"] for row in humans
    }
    accepted = {row["accepted_version_id"] for row in before["artifact_heads"]}
    for path in expected_paths:
        dependency = dependencies[path["affected_version_id"]]
        assert path == {
            "path_id": path["path_id"],
            "operation_id": operation["operation_id"],
            "project_id": decision["project_id"],
            "affected_artifact_id": dependency["downstream_artifact_id"],
            "affected_version_id": dependency["downstream_version_id"],
            "classification": "STALE" if path["affected_version_id"] in accepted else "INVALIDATE",
            "aggregate_impact": "blocking",
            "dependency_ids": [dependency["dependency_id"]],
            "relationships": ["derived_from"],
            "edge_impacts": ["blocking"],
            "effective_impact": "blocking",
            "ordinal": path["ordinal"],
            "created_at": consumed_at,
        }


def test_exit_before_commit_rolls_back_then_explicit_fixture_retry_succeeds_once(
    tmp_path: Path,
) -> None:
    database = tmp_path / "before-commit.db"
    decision, old_version = _fixture(database)
    before = _snapshot(database)
    assert before["invalidation_operations"] == before["invalidation_reason_paths"] == []
    assert (
        next(
            row
            for row in before["confirmation_challenges"]
            if row["challenge_id"] == decision["challenge_id"]
        )["consumed_at"]
        is None
    )

    _run_child(_exit_before_commit, (database, decision), 73)
    recovered = _recover(database, decision["project_id"], "pre-commit")
    assert recovered["head"] == old_version
    assert recovered["snapshot"] == before
    assert recovered["history"] == {"items": [], "next_cursor": None}
    assert recovered["reports"] == []

    # An explicit synthetic approval retry is the sole write after recovery.
    repository = StudioRepository(database, clock=MutableClock())
    result = repository.decide_artifact_gate(**decision)
    committed = _snapshot(database)
    with pytest.raises(ReviewInvalidError, match="current open submission"):
        repository.decide_artifact_gate(**decision)
    assert _snapshot(database) == committed
    retried = _recover(database, decision["project_id"], "explicit-retry")
    _assert_committed(before, retried, decision, old_version)
    assert retried["reports"][0]["gate_decision_id"] == result.decision.id
    repeated = _recover(database, decision["project_id"], "retry-read-again")
    assert repeated["snapshot"] == retried["snapshot"]
    assert repeated["reports"] == retried["reports"]
    assert repeated["history"] == retried["history"]


def test_exit_after_commit_preserves_complete_gate_without_automatic_resubmission(
    tmp_path: Path,
) -> None:
    database = tmp_path / "after-commit.db"
    decision, old_version = _fixture(database)
    before = _snapshot(database)
    assert before["invalidation_operations"] == before["invalidation_reason_paths"] == []

    _run_child(_exit_after_commit, (database, decision), 74)
    recovered = _recover(database, decision["project_id"], "post-commit")
    _assert_committed(before, recovered, decision, old_version)
    repeated = _recover(database, decision["project_id"], "post-commit-read-again")
    assert repeated["snapshot"] == recovered["snapshot"]
    assert repeated["reports"] == recovered["reports"]
    assert repeated["history"] == recovered["history"]
