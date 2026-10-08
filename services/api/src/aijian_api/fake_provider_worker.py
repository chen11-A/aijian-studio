"""Line-delimited JSON worker process backing the local Fake Provider."""

import json
import os
import re
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Never
from uuid import uuid4

from aijian_api.fake_provider_paths import validate_fake_provider_database_path

_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_HASH_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_JOB_PATTERN = re.compile(r"^job_[0-9a-f]{32}$")
_MAX_MESSAGE_BYTES = 16 * 1024
_COMMON_FIELDS = frozenset({"request_id", "operation"})


class RequestRejected(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _open_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=1, isolation_level=None)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 1000")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS fake_provider_jobs (
                job_id TEXT PRIMARY KEY CHECK (
                    length(job_id) = 36 AND substr(job_id, 1, 4) = 'job_'
                    AND substr(job_id, 5) NOT GLOB '*[^0-9a-f]*'
                ),
                idempotency_key TEXT NOT NULL UNIQUE CHECK (
                    length(idempotency_key) BETWEEN 1 AND 256
                    AND substr(idempotency_key, 1, 1) GLOB '[A-Za-z0-9]'
                    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
                ),
                request_hash TEXT NOT NULL CHECK (
                    length(request_hash) = 71 AND substr(request_hash, 1, 7) = 'sha256:'
                    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
                ),
                status TEXT NOT NULL CHECK (status IN ('ACCEPTED')),
                accepted_at TEXT NOT NULL CHECK (length(accepted_at) BETWEEN 20 AND 35)
            ) STRICT
            """
        )
        columns = tuple(
            (str(row[1]), str(row[2]), int(row[3]), int(row[5]))
            for row in connection.execute("PRAGMA table_info(fake_provider_jobs)")
        )
        expected = (
            ("job_id", "TEXT", 1, 1),
            ("idempotency_key", "TEXT", 1, 0),
            ("request_hash", "TEXT", 1, 0),
            ("status", "TEXT", 1, 0),
            ("accepted_at", "TEXT", 1, 0),
        )
        if columns != expected:
            raise sqlite3.DatabaseError("Fake Provider schema is incompatible")
        indexes: dict[str, tuple[tuple[str, str, int], ...]] = {}
        index_shape_is_valid = True
        for row in connection.execute("PRAGMA index_list(fake_provider_jobs)"):
            origin = str(row[3])
            if int(row[2]) != 1 or int(row[4]) != 0 or origin in indexes:
                index_shape_is_valid = False
            details = tuple(
                connection.execute(
                    "SELECT seqno, cid, name, desc, coll, key "
                    "FROM pragma_index_xinfo(?) ORDER BY seqno",
                    (str(row[1]),),
                )
            )
            indexes[origin] = tuple(
                (str(column[2]), str(column[4]), int(column[3]))
                for column in details
                if int(column[5]) == 1
            )
            auxiliary = tuple(column for column in details if int(column[5]) == 0)
            if len(auxiliary) != 1 or (
                int(auxiliary[0][1]),
                int(auxiliary[0][3]),
                str(auxiliary[0][4]),
            ) != (-1, 0, "BINARY"):
                index_shape_is_valid = False
        schema_row = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fake_provider_jobs'"
        ).fetchone()
        schema_sql = "" if schema_row is None else str(schema_row[0])
        trigger_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM sqlite_master "
                "WHERE type = 'trigger' AND tbl_name = 'fake_provider_jobs'"
            ).fetchone()[0]
        )
        if (
            not index_shape_is_valid
            or trigger_count != 0
            or indexes
            != {
                "u": (("idempotency_key", "BINARY", 0),),
                "pk": (("job_id", "BINARY", 0),),
            }
            or not all(
                marker in schema_sql
                for marker in (
                    "STRICT",
                    "length(job_id) = 36",
                    "length(idempotency_key) BETWEEN 1 AND 256",
                    "length(request_hash) = 71",
                    "CHECK (status IN ('ACCEPTED'))",
                    "length(accepted_at) BETWEEN 20 AND 35",
                )
            )
        ):
            raise sqlite3.DatabaseError("Fake Provider schema constraints are incompatible")
    except BaseException:
        connection.close()
        raise
    return connection


def _job(row: sqlite3.Row) -> dict[str, object]:
    payload: dict[str, object] = {
        "job_id": str(row["job_id"]),
        "idempotency_key": str(row["idempotency_key"]),
        "request_hash": str(row["request_hash"]),
        "status": str(row["status"]),
        "accepted_at": str(row["accepted_at"]),
    }
    if (
        not isinstance(payload["job_id"], str)
        or _JOB_PATTERN.fullmatch(payload["job_id"]) is None
        or not isinstance(payload["idempotency_key"], str)
        or _KEY_PATTERN.fullmatch(payload["idempotency_key"]) is None
        or not isinstance(payload["request_hash"], str)
        or _HASH_PATTERN.fullmatch(payload["request_hash"]) is None
        or payload["status"] != "ACCEPTED"
        or not isinstance(payload["accepted_at"], str)
        or not 20 <= len(payload["accepted_at"]) <= 35
    ):
        raise sqlite3.DatabaseError("Fake Provider job record is invalid")
    try:
        accepted_at = datetime.fromisoformat(payload["accepted_at"].replace("Z", "+00:00"))
    except ValueError as error:
        raise sqlite3.DatabaseError("Fake Provider job record is invalid") from error
    if accepted_at.tzinfo is None or accepted_at.utcoffset() is None:
        raise sqlite3.DatabaseError("Fake Provider job record is invalid")
    return payload


def _submit(connection: sqlite3.Connection, request: dict[str, object]) -> dict[str, object]:
    key = request.get("idempotency_key")
    request_hash = request.get("request_hash")
    fault = request.get("fault")
    if not isinstance(key, str) or _KEY_PATTERN.fullmatch(key) is None:
        raise RequestRejected("INVALID_REQUEST", "invalid idempotency key")
    if not isinstance(request_hash, str) or _HASH_PATTERN.fullmatch(request_hash) is None:
        raise RequestRejected("INVALID_REQUEST", "invalid request hash")
    if fault == "before_persist_error":
        raise RequestRejected("INJECTED_ERROR", "injected failure before persistence")
    if fault == "before_persist_crash":
        os._exit(71)
    if fault not in (None, "after_persist_crash"):
        raise RequestRejected("INVALID_REQUEST", "unsupported fault mode")

    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT * FROM fake_provider_jobs WHERE idempotency_key = ?", (key,)
        ).fetchone()
        if existing is not None:
            if str(existing["request_hash"]) != request_hash:
                raise RequestRejected(
                    "IDEMPOTENCY_CONFLICT",
                    "idempotency key was already used with a different request hash",
                )
            connection.commit()
            result = _job(existing)
        else:
            job_id = f"job_{uuid4().hex}"
            accepted_at = (
                datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
            )
            connection.execute(
                "INSERT INTO fake_provider_jobs VALUES (?, ?, ?, 'ACCEPTED', ?)",
                (job_id, key, request_hash, accepted_at),
            )
            connection.commit()
            result = {
                "job_id": job_id,
                "idempotency_key": key,
                "request_hash": request_hash,
                "status": "ACCEPTED",
                "accepted_at": accepted_at,
            }
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    if fault == "after_persist_crash":
        os._exit(72)
    return result


def _query(connection: sqlite3.Connection, request: dict[str, object]) -> dict[str, object]:
    job_id = request.get("job_id")
    if not isinstance(job_id, str) or _JOB_PATTERN.fullmatch(job_id) is None:
        raise RequestRejected("INVALID_REQUEST", "invalid job id")
    row = connection.execute(
        "SELECT * FROM fake_provider_jobs WHERE job_id = ?", (job_id,)
    ).fetchone()
    if row is None:
        raise RequestRejected("JOB_NOT_FOUND", "job does not exist")
    return _job(row)


def _respond(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _reject_unknown_fields(request: dict[str, object], allowed: frozenset[str]) -> None:
    unknown = request.keys() - (_COMMON_FIELDS | allowed)
    if unknown:
        raise RequestRejected("INVALID_REQUEST", "request contains unknown fields")


def run(database_path: Path) -> int:
    connection: sqlite3.Connection | None = None
    try:
        while True:
            line = sys.stdin.readline(_MAX_MESSAGE_BYTES + 2)
            if not line:
                break
            request_id: object = None
            try:
                if not line.endswith("\n") and len(line) >= _MAX_MESSAGE_BYTES + 2:
                    raise RequestRejected("MESSAGE_TOO_LARGE", "request exceeds protocol limit")
                if len(line.encode("utf-8")) > _MAX_MESSAGE_BYTES:
                    raise RequestRejected("MESSAGE_TOO_LARGE", "request exceeds protocol limit")
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise RequestRejected("INVALID_REQUEST", "request must be an object")
                request_id = request.get("request_id")
                if type(request_id) is not int or not 1 <= request_id <= 2**63 - 1:
                    raise RequestRejected("INVALID_REQUEST", "request id must be positive")
                operation = request.get("operation")
                if operation != "shutdown" and connection is None:
                    connection = _open_database(database_path)
                if operation == "submit":
                    assert connection is not None
                    _reject_unknown_fields(
                        request,
                        frozenset({"idempotency_key", "request_hash", "fault"}),
                    )
                    result = _submit(connection, request)
                elif operation == "query":
                    assert connection is not None
                    _reject_unknown_fields(request, frozenset({"job_id"}))
                    result = _query(connection, request)
                elif operation == "shutdown":
                    _reject_unknown_fields(request, frozenset())
                    _respond({"request_id": request_id, "ok": True, "result": {}})
                    return 0
                else:
                    raise RequestRejected("UNKNOWN_OPERATION", "operation is not supported")
                _respond({"request_id": request_id, "ok": True, "result": result})
            except RequestRejected as error:
                _respond(
                    {
                        "request_id": request_id,
                        "ok": False,
                        "code": error.code,
                        "message": str(error),
                    }
                )
                if error.code == "MESSAGE_TOO_LARGE":
                    return 2
            except (ValueError, UnicodeError, RecursionError):
                _respond(
                    {
                        "request_id": request_id,
                        "ok": False,
                        "code": "INVALID_JSON",
                        "message": "request is not valid UTF-8 JSON",
                    }
                )
            except sqlite3.Error:
                if connection is not None:
                    connection.close()
                    connection = None
                _respond(
                    {
                        "request_id": request_id,
                        "ok": False,
                        "code": "STORAGE_UNAVAILABLE",
                        "message": "Fake Provider storage is unavailable",
                    }
                )
    finally:
        if connection is not None:
            connection.close()
    return 0


def main() -> Never:
    if len(sys.argv) != 3:
        raise SystemExit(
            "usage: fake_provider_worker.py ABSOLUTE_DATABASE_PATH ABSOLUTE_TRUSTED_ROOT"
        )
    try:
        database_path = validate_fake_provider_database_path(
            Path(sys.argv[1]),
            trusted_root=Path(sys.argv[2]),
        )
    except ValueError as error:
        raise SystemExit(str(error)) from None
    raise SystemExit(run(database_path))


if __name__ == "__main__":
    main()
