"""Reproduce the Phase 0 Fake Provider crash and idempotency evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))

from aijian_api.fake_provider import (  # noqa: E402
    FakeProviderProcess,
    FakeProviderProcessCrashed,
    FakeProviderRejected,
)
from aijian_api.fault_injection import DeterministicFaultInjector  # noqa: E402

EVIDENCE_PATH = REPOSITORY_ROOT / "docs" / "quality" / "evidence" / "fault-injection.json"
REQUEST_HASH = f"sha256:{'a' * 64}"


def _row_count(database: Path) -> int:
    with closing(sqlite3.connect(database)) as connection:
        return int(connection.execute("SELECT COUNT(*) FROM fake_provider_jobs").fetchone()[0])


def measure() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="aijian-fault-evidence-") as temporary:
        root = Path(temporary)

        error_database = root / "controlled-error.db"
        with FakeProviderProcess(error_database, trusted_root=root) as provider:
            try:
                provider.submit("evidence:error", REQUEST_HASH, fault="before_persist_error")
            except FakeProviderRejected as error:
                controlled_error = "INJECTED_ERROR" in str(error)
            else:
                controlled_error = False
            error_process_survived = provider.is_running
        error_exit_code = provider.last_exit_code
        error_rows = _row_count(error_database)

        before_database = root / "before-persist-crash.db"
        before_provider = FakeProviderProcess(before_database, trusted_root=root)
        with before_provider:
            try:
                before_provider.submit(
                    "evidence:before-crash",
                    REQUEST_HASH,
                    fault="before_persist_crash",
                )
            except FakeProviderProcessCrashed:
                before_crash_detected = True
            else:
                before_crash_detected = False
            before_crash_exit_code = before_provider.last_exit_code
            before_crash_rows = _row_count(before_database)
            before_provider.start()
            before_provider.submit("evidence:before-crash", REQUEST_HASH)
        before_rows = _row_count(before_database)
        before_cleanup_exit_code = before_provider.last_exit_code

        after_database = root / "after-persist-crash.db"
        after_provider = FakeProviderProcess(after_database, trusted_root=root)
        with after_provider:
            try:
                after_provider.submit(
                    "evidence:after-crash",
                    REQUEST_HASH,
                    fault="after_persist_crash",
                )
            except FakeProviderProcessCrashed:
                after_crash_detected = True
            else:
                after_crash_detected = False
            after_crash_exit_code = after_provider.last_exit_code
            original_job_id = _job_id(after_database)
            after_provider.start()
            recovered = after_provider.submit("evidence:after-crash", REQUEST_HASH)
            queried = after_provider.query(recovered.job_id)
        after_rows = _row_count(after_database)
        after_cleanup_exit_code = after_provider.last_exit_code

    injector = DeterministicFaultInjector(seed=42)
    decisions = [
        injector.should_inject("after_remote_submit", occurrence, rate=(1, 2))
        for occurrence in range(100)
    ]
    decision_bytes = json.dumps(decisions, separators=(",", ":")).encode()
    passed = all(
        (
            controlled_error,
            error_process_survived,
            error_rows == 0,
            before_crash_detected,
            before_crash_rows == 0,
            before_rows == 1,
            after_crash_detected,
            after_rows == 1,
            recovered.job_id == original_job_id,
            recovered == queried,
            error_exit_code == 0,
            before_crash_exit_code == 71,
            before_cleanup_exit_code == 0,
            after_crash_exit_code == 72,
            after_cleanup_exit_code == 0,
            any(decisions),
            not all(decisions),
        )
    )
    return {
        "schemaVersion": 1,
        "status": "PASS" if passed else "FAIL",
        "transport": "stdin-stdout-ndjson",
        "networkListener": False,
        "providerState": "sqlite",
        "controlledError": {
            "detected": controlled_error,
            "processSurvived": error_process_survived,
            "persistedJobs": error_rows,
        },
        "beforePersistCrash": {
            "detected": before_crash_detected,
            "persistedJobsBeforeRestart": before_crash_rows,
            "persistedJobsAfterRestartAndRetry": before_rows,
        },
        "afterPersistCrash": {
            "detectedAsUnknownOutcome": after_crash_detected,
            "persistedJobsAfterRestartAndRetry": after_rows,
            "retryReturnedOriginalJob": recovered.job_id == original_job_id,
        },
        "processCleanup": {
            "controlledErrorWorkerExitCode": error_exit_code,
            "beforePersistCrashExitCode": before_crash_exit_code,
            "beforePersistRestartExitCode": before_cleanup_exit_code,
            "afterPersistCrashExitCode": after_crash_exit_code,
            "afterPersistRestartExitCode": after_cleanup_exit_code,
        },
        "deterministicSeed": {
            "seed": 42,
            "occurrences": 100,
            "decisionSha256": hashlib.sha256(decision_bytes).hexdigest(),
        },
        "scope": {
            "milestone": "F06",
            "q03SixProductionKillPointsComplete": False,
        },
    }


def _job_id(database: Path) -> str:
    with closing(sqlite3.connect(database)) as connection:
        row = connection.execute("SELECT job_id FROM fake_provider_jobs").fetchone()
    if row is None:
        raise RuntimeError("persisted Fake Provider job was not found")
    return str(row[0])


def _atomic_write(payload: str) -> None:
    EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\n",
        prefix=f".{EVIDENCE_PATH.name}.",
        suffix=".tmp",
        dir=EVIDENCE_PATH.parent,
        delete=False,
    ) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, EVIDENCE_PATH)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("measure", "verify", "evidence"))
    arguments = parser.parse_args()
    measured = measure()
    if measured["status"] != "PASS":
        print("fault injection evidence failed", file=sys.stderr)
        return 1
    payload = json.dumps(measured, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if arguments.command == "evidence":
        _atomic_write(payload)
    elif arguments.command == "verify":
        if not EVIDENCE_PATH.is_file() or EVIDENCE_PATH.read_text(encoding="utf-8") != payload:
            print("fault injection evidence differs from checked-in evidence", file=sys.stderr)
            return 1
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
