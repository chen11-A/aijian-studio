"""Project metadata CAS and durable operation receipts in the workspace database."""

from __future__ import annotations

import json
import sqlite3
from typing import cast

from pydantic import ValidationError

from aijian_api.artifacts import canonical_content_hash
from aijian_api.project_settings_contracts import (
    ProjectSettingsDataV1,
    ProjectSettingsWriteReceiptV1,
    UpdateProjectSettingsRequestV1,
)
from aijian_api.repository import ProjectNotFoundError, StudioRepository
from aijian_api.task_ledger_models import timestamp


class SettingsConflictError(ValueError):
    """Current revision or operation identity differs from the explicit request."""


class SettingsStorageError(RuntimeError):
    """Stored metadata or operation receipt cannot be verified."""


class SettingsReceiptNotFoundError(LookupError):
    """No committed receipt is currently visible; this does not authorize resend."""


def _data(row: sqlite3.Row) -> ProjectSettingsDataV1:
    value = {
        key: row[key]
        for key in (
            "name",
            "status",
            "description",
            "aspect_ratio",
            "target_duration_seconds",
            "source_language",
            "revision",
            "created_at",
            "updated_at",
        )
    }
    value["project_id"] = row["id"]
    value["sequence_timebase"] = (
        json.loads(row["sequence_timebase_json"])
        if row["sequence_timebase_json"] is not None
        else None
    )
    return ProjectSettingsDataV1.model_validate_json(json.dumps(value, ensure_ascii=False))


def _receipt(row: sqlite3.Row) -> ProjectSettingsWriteReceiptV1:
    return ProjectSettingsWriteReceiptV1.model_validate_json(
        json.dumps(
            {
                "project_id": row["project_id"],
                "operation_id": row["operation_id"],
                "request_hash": row["request_hash"],
                "base_revision": row["base_revision"],
                "result_revision": row["result_revision"],
                "result": json.loads(row["result_json"]),
                "created_at": row["created_at"],
            },
            ensure_ascii=False,
        )
    )


class ProjectSettingsStore:
    def __init__(self, repository: StudioRepository) -> None:
        self.repository = repository

    @staticmethod
    def _require(connection: sqlite3.Connection, project_id: str) -> sqlite3.Row:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise ProjectNotFoundError("Project was not found")
        return cast(sqlite3.Row, row)

    def read(self, project_id: str) -> ProjectSettingsDataV1:
        try:
            with self.repository._connection() as connection:
                return _data(self._require(connection, project_id))
        except (sqlite3.Error, ValueError, TypeError, KeyError, RuntimeError) as error:
            raise SettingsStorageError from error

    def receipt(self, project_id: str, operation_id: str) -> ProjectSettingsWriteReceiptV1:
        try:
            with self.repository._connection() as connection:
                self._require(connection, project_id)
                row = connection.execute(
                    "SELECT * FROM project_settings_write_receipts "
                    "WHERE project_id = ? AND operation_id = ?",
                    (project_id, operation_id),
                ).fetchone()
                if row is None:
                    raise SettingsReceiptNotFoundError
                return _receipt(row)
        except (sqlite3.Error, ValueError, TypeError, KeyError, RuntimeError) as error:
            raise SettingsStorageError from error

    def write(
        self, project_id: str, payload: UpdateProjectSettingsRequestV1
    ) -> ProjectSettingsWriteReceiptV1:
        request_hash = canonical_content_hash(
            {"project_id": project_id, **payload.identity_payload()}
        )
        try:
            with self.repository._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = self._require(connection, project_id)
                prior = connection.execute(
                    "SELECT * FROM project_settings_write_receipts "
                    "WHERE project_id = ? AND operation_id = ?",
                    (project_id, payload.operation_id),
                ).fetchone()
                if prior is not None:
                    receipt = _receipt(prior)
                    if receipt.request_hash != request_hash:
                        raise SettingsConflictError("Operation identity conflict")
                    connection.commit()
                    return receipt
                current = _data(row)
                if current.revision != payload.expected_project_revision:
                    raise SettingsConflictError("Project revision changed")
                changes = payload.changes.model_dump(mode="json", exclude_unset=True)
                value = current.model_dump(mode="json") | changes
                changed = any(value[key] != current.model_dump(mode="json")[key] for key in changes)
                now = timestamp(self.repository._clock())
                if changed:
                    value.update(revision=current.revision + 1, updated_at=now)
                    result = ProjectSettingsDataV1.model_validate_json(
                        json.dumps(value, ensure_ascii=False)
                    )
                    updated = connection.execute(
                        "UPDATE projects SET name = ?, status = ?, description = ?, "
                        "sequence_timebase_json = ?, revision = ?, updated_at = ? "
                        "WHERE id = ? AND revision = ?",
                        (
                            result.name,
                            result.status,
                            result.description,
                            result.sequence_timebase.model_dump_json()
                            if result.sequence_timebase
                            else None,
                            result.revision,
                            now,
                            project_id,
                            current.revision,
                        ),
                    )
                    if updated.rowcount != 1:
                        raise SettingsStorageError
                else:
                    result = current
                self.repository._transaction_step("project_settings", "project_updated")
                connection.execute(
                    "INSERT INTO project_settings_write_receipts "
                    "(project_id, operation_id, request_hash, base_revision, result_revision, "
                    "result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        project_id,
                        payload.operation_id,
                        request_hash,
                        current.revision,
                        result.revision,
                        result.model_dump_json(),
                        now,
                    ),
                )
                self.repository._transaction_step("project_settings", "receipt_inserted")
                stored = connection.execute(
                    "SELECT * FROM project_settings_write_receipts "
                    "WHERE project_id = ? AND operation_id = ?",
                    (project_id, payload.operation_id),
                ).fetchone()
                assert stored is not None
                receipt = _receipt(stored)
                connection.commit()
                return receipt
        except (SettingsConflictError, SettingsStorageError):
            raise
        except (
            sqlite3.Error,
            ValidationError,
            ValueError,
            TypeError,
            KeyError,
            RuntimeError,
        ) as error:
            raise SettingsStorageError from error
