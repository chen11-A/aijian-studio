import io
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from typing import Never

import pytest
from aijian_api import fake_provider_worker as worker

REQUEST_HASH = f"sha256:{'a' * 64}"
OTHER_HASH = f"sha256:{'b' * 64}"


def request(
    database: Path,
    monkeypatch: pytest.MonkeyPatch,
    payload: object,
    *,
    expected_exit: int = 0,
) -> dict[str, object]:
    source = json.dumps(payload, separators=(",", ":")) if not isinstance(payload, str) else payload
    output = io.StringIO()
    monkeypatch.setattr(sys, "stdin", io.StringIO(source + "\n"))
    monkeypatch.setattr(sys, "stdout", output)

    assert worker.run(database) == expected_exit

    return json.loads(output.getvalue())


def test_worker_submit_query_idempotency_and_conflict(tmp_path: Path) -> None:
    database = tmp_path / "fake-provider.db"
    with closing(worker._open_database(database)) as connection:
        submitted = worker._submit(
            connection,
            {"idempotency_key": "project-1:render", "request_hash": REQUEST_HASH},
        )
        repeated = worker._submit(
            connection,
            {"idempotency_key": "project-1:render", "request_hash": REQUEST_HASH},
        )
        assert repeated == submitted
        assert worker._query(connection, {"job_id": submitted["job_id"]}) == submitted

        with pytest.raises(worker.RequestRejected, match="different request hash") as conflict:
            worker._submit(
                connection,
                {"idempotency_key": "project-1:render", "request_hash": OTHER_HASH},
            )
        assert conflict.value.code == "IDEMPOTENCY_CONFLICT"

        with pytest.raises(worker.RequestRejected, match="does not exist") as missing:
            worker._query(connection, {"job_id": f"job_{'0' * 32}"})
        assert missing.value.code == "JOB_NOT_FOUND"

        with pytest.raises(worker.RequestRejected, match="invalid job id") as invalid:
            worker._query(connection, {"job_id": "not-a-job-id"})
        assert invalid.value.code == "INVALID_REQUEST"


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"idempotency_key": "bad key", "request_hash": REQUEST_HASH}, "idempotency key"),
        ({"idempotency_key": "valid", "request_hash": "bad"}, "request hash"),
        (
            {"idempotency_key": "valid", "request_hash": REQUEST_HASH, "fault": "unknown"},
            "fault mode",
        ),
    ],
)
def test_worker_rejects_invalid_submit_fields(
    tmp_path: Path,
    payload: dict[str, object],
    message: str,
) -> None:
    with closing(worker._open_database(tmp_path / f"{message}.db")) as connection:
        with pytest.raises(worker.RequestRejected, match=message):
            worker._submit(connection, payload)


def test_worker_injects_controlled_error_and_both_crash_boundaries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "fake-provider.db"
    with closing(worker._open_database(database)) as connection:
        with pytest.raises(worker.RequestRejected, match="injected failure") as controlled:
            worker._submit(
                connection,
                {
                    "idempotency_key": "controlled",
                    "request_hash": REQUEST_HASH,
                    "fault": "before_persist_error",
                },
            )
        assert controlled.value.code == "INJECTED_ERROR"

        class InjectedExit(RuntimeError):
            pass

        def injected_exit(code: int) -> Never:
            raise InjectedExit(str(code))

        monkeypatch.setattr(worker.os, "_exit", injected_exit)
        with pytest.raises(InjectedExit, match="71"):
            worker._submit(
                connection,
                {
                    "idempotency_key": "before",
                    "request_hash": REQUEST_HASH,
                    "fault": "before_persist_crash",
                },
            )
        assert connection.execute("SELECT COUNT(*) FROM fake_provider_jobs").fetchone()[0] == 0

        with pytest.raises(InjectedExit, match="72"):
            worker._submit(
                connection,
                {
                    "idempotency_key": "after",
                    "request_hash": REQUEST_HASH,
                    "fault": "after_persist_crash",
                },
            )
        assert connection.execute("SELECT COUNT(*) FROM fake_provider_jobs").fetchone()[0] == 1


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ("{", "INVALID_JSON"),
        (["not-an-object"], "INVALID_REQUEST"),
        ({"request_id": 0, "operation": "query"}, "INVALID_REQUEST"),
        ({"request_id": True, "operation": "query"}, "INVALID_REQUEST"),
        ({"request_id": 1, "operation": "unknown"}, "UNKNOWN_OPERATION"),
        (
            {"request_id": 1, "operation": "query", "job_id": f"job_{'0' * 32}", "extra": 1},
            "INVALID_REQUEST",
        ),
    ],
)
def test_worker_protocol_rejections(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    payload: object,
    code: str,
) -> None:
    assert request(tmp_path / f"{code}.db", monkeypatch, payload)["code"] == code


def test_worker_protocol_submit_query_and_shutdown(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "fake-provider.db"
    submitted = request(
        database,
        monkeypatch,
        {
            "request_id": 1,
            "operation": "submit",
            "idempotency_key": "protocol-submit",
            "request_hash": REQUEST_HASH,
        },
    )
    job = submitted["result"]
    assert isinstance(job, dict)
    queried = request(
        database,
        monkeypatch,
        {"request_id": 2, "operation": "query", "job_id": job["job_id"]},
    )
    assert queried["result"] == job
    stopped = request(database, monkeypatch, {"request_id": 3, "operation": "shutdown"})
    assert stopped == {"request_id": 3, "ok": True, "result": {}}


def test_worker_protocol_rejects_oversized_line_without_unbounded_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = request(
        tmp_path / "oversized.db",
        monkeypatch,
        "x" * (16 * 1024 + 100),
        expected_exit=2,
    )
    assert response["code"] == "MESSAGE_TOO_LARGE"


def test_worker_protocol_maps_excessive_json_integer_to_invalid_json(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = '{"request_id":' + "9" * 5000 + ',"operation":"query"}'
    response = request(tmp_path / "large-integer.db", monkeypatch, payload)
    assert response["code"] == "INVALID_JSON"


def test_worker_maps_corrupt_storage_to_stable_protocol_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "corrupt.db"
    database.write_bytes(b"not sqlite")
    response = request(
        database,
        monkeypatch,
        {"request_id": 1, "operation": "query", "job_id": f"job_{'0' * 32}"},
    )
    assert response == {
        "request_id": 1,
        "ok": False,
        "code": "STORAGE_UNAVAILABLE",
        "message": "Fake Provider storage is unavailable",
    }


def test_worker_maps_locked_storage_to_stable_protocol_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "locked.db"
    with closing(worker._open_database(database)) as blocker:
        blocker.execute("BEGIN IMMEDIATE")
        response = request(
            database,
            monkeypatch,
            {
                "request_id": 1,
                "operation": "submit",
                "idempotency_key": "locked",
                "request_hash": REQUEST_HASH,
            },
        )
        blocker.rollback()
    assert response["code"] == "STORAGE_UNAVAILABLE"


def test_worker_rejects_incompatible_existing_schema(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "old-schema.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("CREATE TABLE fake_provider_jobs (job_id TEXT PRIMARY KEY)")
    response = request(
        database,
        monkeypatch,
        {"request_id": 1, "operation": "query", "job_id": f"job_{'0' * 32}"},
    )
    assert response["code"] == "STORAGE_UNAVAILABLE"


def test_worker_rejects_unique_constraint_on_wrong_column(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "wrong-unique.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute(
            """
            CREATE TABLE fake_provider_jobs (
                job_id TEXT PRIMARY KEY CHECK (
                    length(job_id) = 36 AND substr(job_id, 1, 4) = 'job_'
                    AND substr(job_id, 5) NOT GLOB '*[^0-9a-f]*'
                ),
                idempotency_key TEXT NOT NULL CHECK (
                    length(idempotency_key) BETWEEN 1 AND 256
                    AND substr(idempotency_key, 1, 1) GLOB '[A-Za-z0-9]'
                    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
                ),
                request_hash TEXT NOT NULL UNIQUE CHECK (
                    length(request_hash) = 71 AND substr(request_hash, 1, 7) = 'sha256:'
                    AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
                ),
                status TEXT NOT NULL CHECK (status IN ('ACCEPTED')),
                accepted_at TEXT NOT NULL CHECK (length(accepted_at) BETWEEN 20 AND 35)
            ) STRICT
            """
        )
    response = request(
        database,
        monkeypatch,
        {"request_id": 1, "operation": "query", "job_id": f"job_{'0' * 32}"},
    )
    assert response["code"] == "STORAGE_UNAVAILABLE"


def test_worker_rejects_nocase_idempotency_index(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "nocase-index.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute(
            """
            CREATE TABLE fake_provider_jobs (
                job_id TEXT PRIMARY KEY CHECK (
                    length(job_id) = 36 AND substr(job_id, 1, 4) = 'job_'
                    AND substr(job_id, 5) NOT GLOB '*[^0-9a-f]*'
                ),
                idempotency_key TEXT COLLATE NOCASE NOT NULL UNIQUE CHECK (
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
    response = request(
        database,
        monkeypatch,
        {"request_id": 1, "operation": "query", "job_id": f"job_{'0' * 32}"},
    )
    assert response["code"] == "STORAGE_UNAVAILABLE"


def test_worker_rejects_trigger_that_changes_job_persistence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "trigger.db"
    with closing(worker._open_database(database)) as connection:
        connection.execute(
            """
            CREATE TRIGGER delete_fake_job_after_insert
            AFTER INSERT ON fake_provider_jobs
            BEGIN
                DELETE FROM fake_provider_jobs WHERE job_id = NEW.job_id;
            END
            """
        )
    response = request(
        database,
        monkeypatch,
        {
            "request_id": 1,
            "operation": "submit",
            "idempotency_key": "trigger",
            "request_hash": REQUEST_HASH,
        },
    )
    assert response["code"] == "STORAGE_UNAVAILABLE"


def test_worker_rejects_invalid_existing_record_before_serialization(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "invalid-record.db"
    with closing(worker._open_database(database)) as connection:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute(
            "INSERT INTO fake_provider_jobs VALUES (?, ?, ?, 'ACCEPTED', ?)",
            (f"job_{'1' * 32}", "corrupt", REQUEST_HASH, "x" * 100_000),
        )
    response = request(
        database,
        monkeypatch,
        {"request_id": 1, "operation": "query", "job_id": f"job_{'1' * 32}"},
    )
    assert response["code"] == "STORAGE_UNAVAILABLE"


def test_worker_main_rejects_invalid_invocation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", ["fake_provider_worker.py"])
    with pytest.raises(SystemExit, match="usage"):
        worker.main()

    monkeypatch.setattr(sys, "argv", ["fake_provider_worker.py", "relative.db", str(tmp_path)])
    with pytest.raises(SystemExit, match="absolute"):
        worker.main()

    monkeypatch.setattr(
        sys,
        "argv",
        ["fake_provider_worker.py", str(tmp_path / "valid.db"), str(tmp_path)],
    )
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    with pytest.raises(SystemExit) as stopped:
        worker.main()
    assert stopped.value.code == 0
