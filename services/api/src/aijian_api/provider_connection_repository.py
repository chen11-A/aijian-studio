"""SQLite provider metadata and durable credential-rotation outcomes.

Credential references identify Vault slots. Credential bytes never belong here.
Every metadata/credential mutation increments the revision used by approvals.
"""

import json
import os
import re
import sqlite3
from collections.abc import Callable, Iterator, Sequence
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock, RLock
from typing import Literal, cast
from weakref import WeakValueDictionary

from aijian_api.provider_contracts import (
    CPA_LOOPBACK_BASE_URL,
    MAX_EXPECTED_REVISION,
    PROVIDER_MUTATION_ID_PATTERN,
    Sub2APIOriginMode,
    validate_sub2api_origin,
)
from aijian_api.task_ledger_models import new_id, parse_datetime, timestamp, utc_now

type ProviderKind = Literal[
    "OPENAI", "XAI", "OPENAI_COMPATIBLE", "OLLAMA", "CPA_LOOPBACK", "SUB2API"
]
type ProviderCapability = Literal["TEXT", "IMAGE", "VIDEO", "SPEECH"]
type ProviderRotationStatus = Literal["PREPARED", "APPLIED", "CONFLICT", "UNKNOWN"]

# The sidecar owns one workspace process-wide. Share locks across repository
# instances, without keeping a SQLite writer transaction open during vault I/O.
_CREDENTIAL_LOCKS: WeakValueDictionary[tuple[str, str], RLock] = WeakValueDictionary()
_CREDENTIAL_LOCKS_GUARD = Lock()


class ProviderConnectionConflictError(RuntimeError):
    """Raised when provider metadata conflicts with persisted state."""


class ProviderConnectionNotFoundError(LookupError):
    """Raised when a provider connection or rotation operation does not exist."""


class ProviderConnectionVersionConflictError(ProviderConnectionConflictError):
    """Raised when a mutation no longer matches the approved connection revision."""


class ProviderConnectionWriteUnknownError(RuntimeError):
    """Raised when a write outcome requires readback, never an automatic retry."""


class ProviderRotationOperationExistsError(ProviderConnectionConflictError):
    """Raised when a rotation identity has already been used."""


@dataclass(frozen=True, slots=True)
class ProviderModel:
    model_id: str
    capabilities: tuple[ProviderCapability, ...]


@dataclass(frozen=True, slots=True)
class ProviderConnection:
    id: str
    provider_kind: ProviderKind
    display_name: str
    base_url: str
    enabled: bool
    models: tuple[ProviderModel, ...]
    revision: int
    created_at: datetime
    updated_at: datetime
    credential_ref: str
    origin_mode: Sub2APIOriginMode | None = None


@dataclass(frozen=True, slots=True)
class ProviderRotationOperation:
    operation_id: str
    connection_id: str
    expected_revision: int
    candidate_credential_ref: str
    status: ProviderRotationStatus
    applied_revision: int | None
    created_at: datetime
    updated_at: datetime


class ProviderConnectionRepository:
    def __init__(
        self,
        database_path: Path,
        *,
        clock: Callable[[], datetime] = utc_now,
        id_factory: Callable[[str], str] = new_id,
        credential_lock_timeout_seconds: float = 5,
    ) -> None:
        if not 0 < credential_lock_timeout_seconds <= 5:
            raise ValueError("credential lock timeout must be positive and at most five seconds")
        self._database_path = database_path
        self._clock = clock
        self._id_factory = id_factory
        self._credential_lock_timeout_seconds = credential_lock_timeout_seconds

    @contextmanager
    def credential_lifecycle(self, connection_id: str) -> Iterator[None]:
        """Serialize this provider's vault I/O within the single-owner sidecar."""
        identity = (os.path.normcase(str(self._database_path.resolve())), connection_id)
        with _CREDENTIAL_LOCKS_GUARD:
            lock = _CREDENTIAL_LOCKS.get(identity)
            if lock is None:
                lock = RLock()
                _CREDENTIAL_LOCKS[identity] = lock
        if not lock.acquire(timeout=self._credential_lock_timeout_seconds):
            raise ProviderConnectionWriteUnknownError(
                "provider credential mutation is still active"
            )
        try:
            yield
        finally:
            lock.release()

    def require_credential_write(self, connection_id: str, expected_revision: int) -> None:
        """Check admission while the caller holds this provider's lifecycle lock."""
        with self._connection() as connection:
            current = _get_connection(connection, connection_id)
            _require_mutable(connection, connection_id)
            if current.revision != expected_revision:
                raise ProviderConnectionVersionConflictError("provider revision changed")

    def list(self) -> tuple[ProviderConnection, ...]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT * FROM provider_connections
                ORDER BY enabled DESC, display_name COLLATE NOCASE
                """
            ).fetchall()
        return tuple(_connection_from_row(row) for row in rows)

    def get(self, connection_id: str) -> ProviderConnection:
        with self._connection() as connection:
            return _get_connection(connection, connection_id)

    def create(
        self,
        *,
        provider_kind: ProviderKind,
        display_name: str,
        base_url: str,
        enabled: bool,
        models: Sequence[ProviderModel],
        origin_mode: Sub2APIOriginMode | None = None,
    ) -> ProviderConnection:
        models = tuple(models)
        if provider_kind == "SUB2API" and origin_mode is None:
            origin_mode = "PUBLIC_HTTPS"
        _validate_metadata(provider_kind, display_name, base_url, enabled, models, origin_mode)
        connection_id = self._id_factory("pcn")
        now_text = timestamp(self._clock())
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO provider_connections (
                        connection_id, provider_kind, display_name, base_url, enabled,
                        models_json, revision, created_at, updated_at, credential_ref, origin_mode
                    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                    """,
                    (
                        connection_id,
                        provider_kind,
                        display_name,
                        base_url,
                        int(enabled),
                        _models_json(models),
                        now_text,
                        now_text,
                        connection_id,
                        origin_mode,
                    ),
                )
                result = _get_connection(connection, connection_id)
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError("provider metadata conflicts") from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError("provider write requires readback") from error
        return result

    def update_metadata_cas(
        self,
        *,
        connection_id: str,
        expected_revision: int,
        display_name: str,
        base_url: str,
        enabled: bool,
        models: Sequence[ProviderModel],
        origin_mode: Sub2APIOriginMode | None = None,
    ) -> ProviderConnection:
        _validate_revision(expected_revision)
        models = tuple(models)
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                current = _get_connection(connection, connection_id)
                _require_mutable(connection, connection_id)
                if current.revision != expected_revision:
                    raise ProviderConnectionVersionConflictError("provider revision changed")
                if current.provider_kind == "SUB2API":
                    if current.origin_mode == "LOCAL_LOOPBACK_HTTP" and origin_mode is None:
                        raise ValueError("editing a local Sub2API connection requires origin_mode")
                    if origin_mode is None:
                        origin_mode = "PUBLIC_HTTPS"
                _validate_metadata(
                    current.provider_kind, display_name, base_url, enabled, models, origin_mode
                )
                cursor = connection.execute(
                    """
                    UPDATE provider_connections
                    SET display_name = ?, base_url = ?, enabled = ?, models_json = ?,
                        origin_mode = ?, revision = revision + 1, updated_at = ?
                    WHERE connection_id = ? AND revision = ?
                    """,
                    (
                        display_name,
                        base_url,
                        int(enabled),
                        _models_json(models),
                        origin_mode,
                        timestamp(self._clock()),
                        connection_id,
                        expected_revision,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ProviderConnectionVersionConflictError("provider revision changed")
                result = _get_connection(connection, connection_id)
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError("provider metadata conflicts") from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError("provider write requires readback") from error
        return result

    def prepare_rotation(
        self,
        *,
        operation_id: str,
        connection_id: str,
        expected_revision: int,
        candidate_credential_ref: str,
    ) -> ProviderRotationOperation:
        _validate_rotation_identity(
            operation_id, connection_id, expected_revision, candidate_credential_ref
        )
        now_text = timestamp(self._clock())
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                if (
                    connection.execute(
                        "SELECT 1 FROM provider_credential_rotation_operations "
                        "WHERE operation_id = ?",
                        (operation_id,),
                    ).fetchone()
                    is not None
                ):
                    raise ProviderRotationOperationExistsError("rotation operation already exists")
                current = _get_connection(connection, connection_id)
                _require_mutable(connection, connection_id)
                if current.provider_kind != "SUB2API" or current.revision != expected_revision:
                    raise ProviderConnectionVersionConflictError("provider revision changed")
                if current.credential_ref == candidate_credential_ref:
                    raise ValueError("rotation requires a new credential reference")
                connection.execute(
                    """
                    INSERT INTO provider_credential_rotation_operations (
                        operation_id, connection_id, expected_revision, candidate_credential_ref,
                        status, applied_revision, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'PREPARED', NULL, ?, ?)
                    """,
                    (
                        operation_id,
                        connection_id,
                        expected_revision,
                        candidate_credential_ref,
                        now_text,
                        now_text,
                    ),
                )
                result = _get_rotation(connection, operation_id)
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError("rotation metadata conflicts") from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError(
                "rotation preparation requires readback"
            ) from error
        return result

    def get_rotation_operation(self, operation_id: str) -> ProviderRotationOperation:
        with self._connection() as connection:
            return _get_rotation(connection, operation_id)

    def apply_rotation_cas(
        self,
        *,
        operation_id: str,
        connection_id: str,
        expected_revision: int,
        old_credential_ref: str,
        candidate_credential_ref: str,
    ) -> ProviderConnection:
        _validate_rotation_identity(
            operation_id, connection_id, expected_revision, candidate_credential_ref
        )
        conflict = False
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                operation = _get_rotation(connection, operation_id)
                if (
                    operation.connection_id != connection_id
                    or operation.expected_revision != expected_revision
                    or operation.candidate_credential_ref != candidate_credential_ref
                ):
                    raise ValueError("rotation identity does not match its prepared operation")
                if operation.status == "APPLIED":
                    raise ProviderRotationOperationExistsError("rotation operation already applied")
                if operation.status == "CONFLICT":
                    raise ProviderConnectionVersionConflictError("provider revision changed")
                current = _get_connection(connection, connection_id)
                now_text = timestamp(self._clock())
                if (
                    current.provider_kind != "SUB2API"
                    or current.revision != expected_revision
                    or current.credential_ref != old_credential_ref
                    or _cleanup_pending(connection, connection_id)
                ):
                    connection.execute(
                        """
                        UPDATE provider_credential_rotation_operations
                        SET status = 'CONFLICT', updated_at = ? WHERE operation_id = ?
                        """,
                        (now_text, operation_id),
                    )
                    conflict = True
                else:
                    connection.execute(
                        """
                        UPDATE provider_connections
                        SET credential_ref = ?, revision = revision + 1, updated_at = ?
                        WHERE connection_id = ? AND revision = ? AND credential_ref = ?
                        """,
                        (
                            candidate_credential_ref,
                            now_text,
                            connection_id,
                            expected_revision,
                            old_credential_ref,
                        ),
                    )
                    connection.execute(
                        """
                        UPDATE provider_credential_rotation_operations
                        SET status = 'APPLIED', applied_revision = ?, updated_at = ?
                        WHERE operation_id = ?
                        """,
                        (expected_revision + 1, now_text, operation_id),
                    )
                result = _get_connection(connection, connection_id)
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError("rotation metadata conflicts") from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError(
                "rotation result requires readback"
            ) from error
        # Persist the conflict outcome before raising; raising inside the transaction
        # context would roll it back and leave an indefinitely PREPARED operation.
        if conflict:
            raise ProviderConnectionVersionConflictError("provider revision changed")
        return result

    def mark_rotation_unknown(self, operation_id: str) -> None:
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                _get_rotation(connection, operation_id)
                connection.execute(
                    """
                    UPDATE provider_credential_rotation_operations
                    SET status = 'UNKNOWN', updated_at = ?
                    WHERE operation_id = ? AND status = 'PREPARED'
                    """,
                    (timestamp(self._clock()), operation_id),
                )
                connection.commit()
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError(
                "rotation result requires readback"
            ) from error

    def delete(self, connection_id: str, *, expected_revision: int | None = None) -> None:
        """Remove metadata for an unsuccessful creation, never a pending cleanup."""
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                current = _get_connection(connection, connection_id)
                _require_mutable(connection, connection_id)
                if expected_revision is not None and current.revision != expected_revision:
                    raise ProviderConnectionVersionConflictError("provider revision changed")
                _delete_connection(connection, connection_id)
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError(
                "provider connection is still referenced"
            ) from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError(
                "provider deletion requires readback"
            ) from error

    def prepare_delete(self, connection_id: str) -> None:
        """Persist irreversible disablement before waiting on any vault writer."""
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                _get_connection(connection, connection_id)
                _assert_unreferenced(connection, connection_id)
                if not _cleanup_pending(connection, connection_id):
                    connection.execute(
                        """
                        UPDATE provider_connections
                        SET cleanup_pending = 1, enabled = 0,
                            revision = revision + 1, updated_at = ?
                        WHERE connection_id = ?
                        """,
                        (timestamp(self._clock()), connection_id),
                    )
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError(
                "provider connection is still referenced"
            ) from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError(
                "provider deletion requires readback"
            ) from error

    def cleanup_credential_refs(self, connection_id: str) -> tuple[str, ...]:
        """Return every persisted slot, after admission and before vault cleanup."""
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                _get_connection(connection, connection_id)
                _require_cleanup_pending(connection, connection_id)
                _assert_unreferenced(connection, connection_id)
                references = _credential_refs(connection, connection_id)
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError(
                "provider connection is still referenced"
            ) from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError(
                "provider deletion requires readback"
            ) from error
        return references

    def finish_delete(self, connection_id: str, *, credential_refs: Sequence[str]) -> None:
        """Forget metadata only after the caller verifies all vault slots absent."""
        try:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                _get_connection(connection, connection_id)
                _require_cleanup_pending(connection, connection_id)
                if _credential_refs(connection, connection_id) != tuple(credential_refs):
                    raise ProviderConnectionVersionConflictError(
                        "provider credential references changed"
                    )
                _delete_connection(connection, connection_id)
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise ProviderConnectionConflictError(
                "provider connection is still referenced"
            ) from error
        except sqlite3.Error as error:
            raise ProviderConnectionWriteUnknownError(
                "provider deletion requires readback"
            ) from error

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        # SQLite's transaction context does not close its connection. Keep
        # handles bounded on Windows as well as on reference-counted runtimes.
        with closing(self._open()) as connection, connection:
            yield connection

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection


def _validate_revision(expected_revision: int) -> None:
    if type(expected_revision) is not int or not 1 <= expected_revision <= MAX_EXPECTED_REVISION:
        raise ValueError("provider expected revision is invalid")


def _cleanup_pending(connection: sqlite3.Connection, connection_id: str) -> bool:
    row = connection.execute(
        "SELECT cleanup_pending FROM provider_connections WHERE connection_id = ?", (connection_id,)
    ).fetchone()
    if row is None:
        raise ProviderConnectionNotFoundError("provider connection not found")
    return bool(row[0])


def _require_mutable(connection: sqlite3.Connection, connection_id: str) -> None:
    if _cleanup_pending(connection, connection_id):
        raise ProviderConnectionVersionConflictError("provider credential cleanup is pending")


def _require_cleanup_pending(connection: sqlite3.Connection, connection_id: str) -> None:
    if not _cleanup_pending(connection, connection_id):
        raise ProviderConnectionConflictError("provider credential cleanup has not been admitted")


def _delete_connection(connection: sqlite3.Connection, connection_id: str) -> None:
    connection.execute("PRAGMA defer_foreign_keys = ON")
    connection.execute("DELETE FROM provider_connections WHERE connection_id = ?", (connection_id,))
    # History's delete trigger permits removal only while its parent is absent.
    connection.execute(
        "DELETE FROM provider_credential_rotation_operations WHERE connection_id = ?",
        (connection_id,),
    )


def _credential_refs(connection: sqlite3.Connection, connection_id: str) -> tuple[str, ...]:
    current = _get_connection(connection, connection_id)
    rows = connection.execute(
        "SELECT candidate_credential_ref FROM provider_credential_rotation_operations "
        "WHERE connection_id = ? ORDER BY created_at, operation_id",
        (connection_id,),
    ).fetchall()
    return tuple(
        dict.fromkeys((current.id, current.credential_ref, *(str(row[0]) for row in rows)))
    )


def _assert_unreferenced(connection: sqlite3.Connection, connection_id: str) -> None:
    # Probe the actual schema's FK constraints in a savepoint. Roll back even on
    # success, so this cannot lose history or a cleanup retry target.
    connection.execute("SAVEPOINT provider_delete_admission")
    try:
        _delete_connection(connection, connection_id)
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ProviderConnectionConflictError("provider connection is still referenced")
    finally:
        connection.execute("ROLLBACK TO provider_delete_admission")
        connection.execute("RELEASE provider_delete_admission")


def _validate_rotation_identity(
    operation_id: str,
    connection_id: str,
    expected_revision: int,
    candidate_credential_ref: str,
) -> None:
    _validate_revision(expected_revision)
    if re.fullmatch(PROVIDER_MUTATION_ID_PATTERN, operation_id) is None:
        raise ValueError("rotation operation ID is invalid")
    if (
        re.fullmatch(r"pcn_[0-9a-f]{32}", connection_id) is None
        or re.fullmatch(re.escape(connection_id) + r":crd_[0-9a-f]{32}", candidate_credential_ref)
        is None
    ):
        raise ValueError("rotation credential reference is invalid")


def _validate_metadata(
    provider_kind: ProviderKind,
    display_name: str,
    base_url: str,
    enabled: bool,
    models: Sequence[ProviderModel],
    origin_mode: Sub2APIOriginMode | None,
) -> None:
    if provider_kind not in {
        "OPENAI",
        "XAI",
        "OPENAI_COMPATIBLE",
        "OLLAMA",
        "CPA_LOOPBACK",
        "SUB2API",
    }:
        raise ValueError("provider kind is invalid")
    if not 1 <= len(display_name.strip()) <= 80 or not 1 <= len(base_url) <= 2048:
        raise ValueError("provider metadata is invalid")
    if type(enabled) is not bool:
        raise ValueError("provider enabled flag must be boolean")
    if not 1 <= len(models) <= 100 or len({model.model_id for model in models}) != len(models):
        raise ValueError("provider models must be nonempty and unique")
    for model in models:
        if (
            not 1 <= len(model.model_id) <= 200
            or model.model_id != model.model_id.strip()
            or not 1 <= len(model.capabilities) <= 4
            or len(set(model.capabilities)) != len(model.capabilities)
            or not set(model.capabilities) <= {"TEXT", "IMAGE", "VIDEO", "SPEECH"}
        ):
            raise ValueError("provider model is invalid")
    if provider_kind == "SUB2API":
        if origin_mode is None:
            raise ValueError("Sub2API requires an origin mode")
        validate_sub2api_origin(base_url, origin_mode)
        if any(model.capabilities != ("TEXT",) for model in models):
            raise ValueError("Sub2API requires text-only models")
    elif origin_mode is not None:
        raise ValueError("origin_mode is only valid for Sub2API")
    if provider_kind == "CPA_LOOPBACK" and (
        base_url != CPA_LOOPBACK_BASE_URL
        or any(model.capabilities != ("TEXT",) for model in models)
    ):
        raise ValueError("CPA loopback requires its fixed origin and text-only models")


def _models_json(models: Sequence[ProviderModel]) -> str:
    return json.dumps(
        [
            {"model_id": model.model_id, "capabilities": list(model.capabilities)}
            for model in models
        ],
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _get_connection(connection: sqlite3.Connection, connection_id: str) -> ProviderConnection:
    row = connection.execute(
        "SELECT * FROM provider_connections WHERE connection_id = ?", (connection_id,)
    ).fetchone()
    if row is None:
        raise ProviderConnectionNotFoundError("provider connection not found")
    return _connection_from_row(row)


def _get_rotation(connection: sqlite3.Connection, operation_id: str) -> ProviderRotationOperation:
    row = connection.execute(
        "SELECT * FROM provider_credential_rotation_operations WHERE operation_id = ?",
        (operation_id,),
    ).fetchone()
    if row is None:
        raise ProviderConnectionNotFoundError("rotation operation not found")
    return ProviderRotationOperation(
        operation_id=str(row["operation_id"]),
        connection_id=str(row["connection_id"]),
        expected_revision=int(row["expected_revision"]),
        candidate_credential_ref=str(row["candidate_credential_ref"]),
        status=cast(ProviderRotationStatus, str(row["status"])),
        applied_revision=int(row["applied_revision"])
        if row["applied_revision"] is not None
        else None,
        created_at=parse_datetime(str(row["created_at"])),
        updated_at=parse_datetime(str(row["updated_at"])),
    )


def _connection_from_row(row: sqlite3.Row) -> ProviderConnection:
    raw_models = json.loads(str(row["models_json"]))
    models = tuple(
        ProviderModel(
            model_id=str(item["model_id"]),
            capabilities=tuple(item["capabilities"]),
        )
        for item in raw_models
    )
    return ProviderConnection(
        id=str(row["connection_id"]),
        provider_kind=cast(ProviderKind, str(row["provider_kind"])),
        display_name=str(row["display_name"]),
        base_url=str(row["base_url"]),
        enabled=bool(row["enabled"]),
        models=models,
        revision=int(row["revision"]),
        created_at=parse_datetime(str(row["created_at"])),
        updated_at=parse_datetime(str(row["updated_at"])),
        credential_ref=str(row["credential_ref"]),
        origin_mode=cast(Sub2APIOriginMode | None, row["origin_mode"]),
    )
