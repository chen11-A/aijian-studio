"""Schema40 is additive/atomic; the schema39 credential cleanup stays installed."""

import sqlite3

import pytest
from aijian_api.repository import StudioRepository
from aijian_api.shot_plan_schema import SHOT_PLAN_MIGRATION
from test_migrations import migrate_through


@pytest.mark.parametrize("step", range(len(SHOT_PLAN_MIGRATION)))
def test_schema39_to40_partial_failure_rolls_back_and_preserves_security_schema(tmp_path, step):
    database = tmp_path / "studio.sqlite3"
    migrate_through(database, 39)
    with sqlite3.connect(database) as connection:
        before = tuple(connection.iterdump())
        assert "cleanup_pending" in {
            row[1] for row in connection.execute("PRAGMA table_info(provider_connections)")
        }

    def fail(version, current_step):
        if version == 40 and current_step == step:
            raise RuntimeError("Synthetic schema40 failure")

    with pytest.raises(RuntimeError, match="schema40 failure"):
        StudioRepository(database, migration_hook=fail)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 39
        assert tuple(connection.iterdump()) == before
    StudioRepository(database)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 40
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert {
            "shot_plan_write_requests",
            "shot_plan_adoptions",
            "shot_plan_adoption_requests",
        } <= tables
        assert "cleanup_pending" in {
            row[1] for row in connection.execute("PRAGMA table_info(provider_connections)")
        }
