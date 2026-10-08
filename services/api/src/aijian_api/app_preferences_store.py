"""Atomic local preferences storage with an explicit unsaved read state."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from pydantic import ValidationError

from aijian_api.app_preferences_contracts import AppPreferencesData, SaveAppPreferencesRequest
from aijian_api.task_ledger_models import timestamp, utc_now

_PREFERENCE_ID = "local-user"


class AppPreferencesRevisionConflictError(ValueError):
    """Another save changed the singleton before this request."""


class AppPreferencesCorruptError(ValueError):
    """Persisted preference truth is not a valid local settings record."""


class AppPreferencesStore:
    def __init__(
        self,
        database_path: Path,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._database_path = database_path
        self._clock = clock

    def read(self) -> AppPreferencesData:
        connection = self._open()
        try:
            row = connection.execute(
                "SELECT * FROM app_preferences WHERE preference_id = ?", (_PREFERENCE_ID,)
            ).fetchone()
            if row is None:
                return _unsaved_preferences()
            return _from_row(row)
        finally:
            connection.close()

    def save(self, request: SaveAppPreferencesRequest) -> AppPreferencesData:
        request = SaveAppPreferencesRequest.model_validate(request)
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM app_preferences WHERE preference_id = ?", (_PREFERENCE_ID,)
            ).fetchone()
            revision = _from_row(row).revision if row is not None else 0
            if revision != request.expected_revision:
                raise AppPreferencesRevisionConflictError("Preferences revision has changed")
            now_text = timestamp(self._clock())
            if row is None:
                connection.execute(
                    """INSERT INTO app_preferences (
                           preference_id, user_name, display_bio, ui_language, ui_theme,
                           revision, created_at, updated_at
                       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                    (
                        _PREFERENCE_ID,
                        request.user_name,
                        request.display_bio,
                        request.ui_language,
                        request.ui_theme,
                        now_text,
                        now_text,
                    ),
                )
            else:
                if revision >= 9223372036854775807:
                    raise AppPreferencesRevisionConflictError("Preferences revision is exhausted")
                cursor = connection.execute(
                    """UPDATE app_preferences
                       SET user_name = ?, display_bio = ?, ui_language = ?, ui_theme = ?,
                           revision = revision + 1, updated_at = ?
                       WHERE preference_id = ? AND revision = ?""",
                    (
                        request.user_name,
                        request.display_bio,
                        request.ui_language,
                        request.ui_theme,
                        now_text,
                        _PREFERENCE_ID,
                        revision,
                    ),
                )
                if cursor.rowcount != 1:
                    raise AppPreferencesRevisionConflictError("Preferences revision has changed")
            saved = connection.execute(
                "SELECT * FROM app_preferences WHERE preference_id = ?", (_PREFERENCE_ID,)
            ).fetchone()
            if saved is None:
                raise AppPreferencesCorruptError("Saved preferences disappeared")
            result = _from_row(saved)
            connection.commit()
            return result
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection


def _unsaved_preferences() -> AppPreferencesData:
    return AppPreferencesData(
        saved=False,
        revision=0,
        user_name="",
        display_bio="",
        ui_language="zh-CN",
        ui_theme="dark-cinematic",
        created_at=None,
        updated_at=None,
    )


def _persisted_timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise TypeError("Persisted timestamp must be text")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _from_row(row: sqlite3.Row) -> AppPreferencesData:
    try:
        if row["preference_id"] != _PREFERENCE_ID:
            raise ValueError("Unexpected preferences identity")
        return AppPreferencesData.model_validate(
            {
                "saved": True,
                "revision": row["revision"],
                "user_name": row["user_name"],
                "display_bio": row["display_bio"],
                "ui_language": row["ui_language"],
                "ui_theme": row["ui_theme"],
                "created_at": _persisted_timestamp(row["created_at"]),
                "updated_at": _persisted_timestamp(row["updated_at"]),
            }
        )
    except (KeyError, TypeError, ValueError, ValidationError) as error:
        raise AppPreferencesCorruptError("Persisted preferences are inconsistent") from error
