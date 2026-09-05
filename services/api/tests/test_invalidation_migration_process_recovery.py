"""Real v15 DDL process exits; no production changes or simulated rollback."""

import os
import sqlite3
from contextlib import closing
from pathlib import Path
from time import perf_counter
from typing import Any

import pytest
from aijian_api.invalidation_schema import MIGRATION_15, expected_v15_objects
from aijian_api.repository import StudioRepository
from aijian_api.workflow_schema import MIGRATION_16
from test_invalidation_process_recovery import _run_child, _snapshot
from test_migrations import create_current_v14_database


def _state(database: Path) -> dict[str, Any]:
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        return {
            "version": connection.execute("PRAGMA user_version").fetchone()[0],
            # Ignore physical root pages, not indexes, triggers or auto-index identities.
            "schema": connection.execute(
                "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"
            ).fetchall(),
            "rows": _snapshot(database),
        }


def _fixture(database: Path, control: Path) -> dict[str, Any]:
    create_current_v14_database(database)
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            INSERT INTO projects VALUES (
                'prj_migration_keep', '迁移中断保留项目', '9:16', 90, 'zh-CN', 'active', 1,
                '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z'
            )
            """
        )
        connection.commit()
        # Clone the committed old state before the assessed crash, never a repaired copy.
        with closing(sqlite3.connect(control)) as destination:
            connection.backup(destination)
    before = _state(database)
    assert before["version"] == 14
    assert len(before["rows"]["projects"]) == 1
    assert not set(expected_v15_objects()) & {(row[0], row[1]) for row in before["schema"]}
    assert _state(control) == before
    return before


def _exit_during_migration(database: Path, checkpoint: int, exit_code: int) -> None:
    def hard_exit(version: int, step: int) -> None:
        if version == 15 and step == checkpoint:
            # The existing hook is after real DDL, before user_version and commit.
            os._exit(exit_code)

    StudioRepository(database, migration_hook=hard_exit)


def _read_then_retry(database: Path, control: Path, before: dict[str, Any]) -> None:
    started = perf_counter()
    # This fresh process opens raw SQLite before either repository is constructed.
    assert _state(database) == before, "raw v14 state changed before application recovery"
    raw_ms = (perf_counter() - started) * 1000
    StudioRepository(database)
    upgraded = _state(database)
    assert upgraded["version"] == 16
    for table, rows in before["rows"].items():
        assert upgraded["rows"][table] == rows, table
    assert upgraded["rows"].keys() - before["rows"].keys() == {
        "invalidation_operations",
        "invalidation_reason_paths",
    }
    assert upgraded["rows"]["invalidation_operations"] == []
    assert upgraded["rows"]["invalidation_reason_paths"] == []
    before_schema = {(row[0], row[1]): row for row in before["schema"]}
    upgraded_schema = {(row[0], row[1]): row for row in upgraded["schema"]}
    trigger_key = ("trigger", "artifact_proposal_draft_acceptances_chain_insert")
    assert trigger_key in before_schema
    assert trigger_key in upgraded_schema
    unchanged_keys = set(before_schema) - {trigger_key}
    assert unchanged_keys <= set(upgraded_schema)
    assert all(before_schema[key] == upgraded_schema[key] for key in unchanged_keys)
    assert " ".join(upgraded_schema[trigger_key][3].split()).rstrip(";") == " ".join(
        MIGRATION_16[1].split()
    ).rstrip(";")
    assert set(expected_v15_objects()) <= {(row[0], row[1]) for row in upgraded["schema"]}
    StudioRepository(control)
    assert _state(control) == upgraded
    replayed_steps: list[tuple[int, int]] = []
    StudioRepository(
        database, migration_hook=lambda version, step: replayed_steps.append((version, step))
    )
    assert replayed_steps == []
    assert _state(database) == upgraded
    retry_ms = (perf_counter() - started) * 1000
    print(f"raw_v14_read_ms={raw_ms:.3f}; complete_retry_check_ms={retry_ms:.3f}")


@pytest.mark.parametrize(
    "checkpoint,exit_code", [(0, 75), (len(MIGRATION_15) - 1, 76)], ids=["first-ddl", "last-ddl"]
)
def test_migration_hard_exit_preserves_v14_then_retries_without_repair(
    tmp_path: Path, checkpoint: int, exit_code: int
) -> None:
    database = tmp_path / "interrupted.db"
    control = tmp_path / "uninterrupted-control.db"
    before = _fixture(database, control)
    _run_child(_exit_during_migration, (database, checkpoint, exit_code), exit_code)
    _run_child(_read_then_retry, (database, control, before), 0)


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE projects SET name = 'unexpected changed row'",
        "CREATE INDEX test_only_unexpected_index ON projects(name)",
    ],
    ids=["changed-row", "extra-schema-object"],
)
def test_raw_state_guard_rejects_changes_before_any_retry(tmp_path: Path, mutation: str) -> None:
    database = tmp_path / "negative-control.db"
    control = tmp_path / "untouched-v14.db"
    before = _fixture(database, control)
    # Only this isolated negative-control database is changed, not the crash cases.
    with closing(sqlite3.connect(database)) as connection:
        connection.execute(mutation)
        connection.commit()
    changed = _state(database)
    assert changed != before
    with pytest.raises(AssertionError, match="raw v14 state changed"):
        _read_then_retry(database, control, before)
    assert _state(database) == changed
    assert changed["version"] == 14
    assert _state(control) == before
