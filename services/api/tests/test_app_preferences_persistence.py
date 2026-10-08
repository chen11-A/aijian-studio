"""Preference readback rejects corrupt SQLite types without normalizing persisted truth."""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aijian_api.app_preferences_contracts import SaveAppPreferencesRequest
from aijian_api.app_preferences_schema import migration_25_statements
from aijian_api.app_preferences_store import (
    AppPreferencesCorruptError,
    AppPreferencesRevisionConflictError,
    AppPreferencesStore,
)

NOW = datetime(2026, 10, 8, 10, 0, tzinfo=UTC)


def _request(expected_revision: int) -> SaveAppPreferencesRequest:
    return SaveAppPreferencesRequest(
        expected_revision=expected_revision,
        user_name="创作者 🎬",
        display_bio="第一行\nSecond line",
        ui_language="zh-CN",
        ui_theme="dark-cinematic",
    )


@pytest.fixture
def preferences(tmp_path: Path) -> tuple[AppPreferencesStore, Path]:
    database = tmp_path / "preferences.db"
    with sqlite3.connect(database) as connection:
        for statement in migration_25_statements():
            connection.execute(statement)
    return AppPreferencesStore(database, clock=lambda: NOW), database


def _stored_row(database: Path) -> tuple[object, ...]:
    with sqlite3.connect(database) as connection:
        row = connection.execute("SELECT * FROM app_preferences").fetchone()
        assert row is not None
        return tuple(row)


def test_valid_preferences_roundtrip_and_revision_conflict_are_preserved(
    preferences: tuple[AppPreferencesStore, Path],
) -> None:
    store, database = preferences
    unsaved = store.read()
    assert not unsaved.saved and unsaved.revision == 0
    created = store.save(_request(0))
    assert created.saved and created.revision == 1
    assert created.user_name == "创作者 🎬"
    assert created.display_bio == "第一行\nSecond line"
    assert created.created_at == created.updated_at == NOW
    assert AppPreferencesStore(database).read() == created
    updated = store.save(_request(1))
    assert updated.revision == 2
    assert store.read() == updated
    with pytest.raises(AppPreferencesRevisionConflictError):
        store.save(_request(1))
    assert store.read() == updated


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("user_name", b"Writer"),
        ("display_bio", b"Biography"),
        ("revision", 1.5),
        ("created_at", "not-a-timestamp"),
        ("updated_at", b"2026-10-08T10:00:00Z"),
    ],
)
def test_corrupt_persisted_preferences_are_rejected_without_rewriting(
    preferences: tuple[AppPreferencesStore, Path],
    column: str,
    value: object,
) -> None:
    store, database = preferences
    store.save(_request(0))
    with sqlite3.connect(database) as connection:
        connection.execute(f"UPDATE app_preferences SET {column} = ?", (value,))
    before = _stored_row(database)
    with pytest.raises(AppPreferencesCorruptError, match="Persisted preferences are inconsistent"):
        store.read()
    with pytest.raises(AppPreferencesCorruptError, match="Persisted preferences are inconsistent"):
        store.save(_request(1))
    assert _stored_row(database) == before
