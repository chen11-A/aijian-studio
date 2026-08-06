import os
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from aijian_api import fake_provider, fake_provider_paths
from aijian_api.fake_provider import (
    FakeProviderError,
    FakeProviderProcess,
    FakeProviderProcessCrashed,
    FakeProviderRejected,
)

REQUEST_HASH = f"sha256:{'a' * 64}"
OTHER_HASH = f"sha256:{'b' * 64}"


def job_count(database: Path) -> int:
    with closing(sqlite3.connect(database)) as connection:
        return int(connection.execute("SELECT COUNT(*) FROM fake_provider_jobs").fetchone()[0])


def persisted_job_id(database: Path) -> str:
    with closing(sqlite3.connect(database)) as connection:
        row = connection.execute("SELECT job_id FROM fake_provider_jobs").fetchone()
    assert row is not None
    return str(row[0])


def test_submit_is_persistent_and_idempotent_across_process_restart(tmp_path: Path) -> None:
    database = tmp_path / "fake-provider.db"
    provider = FakeProviderProcess(database, trusted_root=tmp_path)
    with provider:
        first = provider.submit("project-1:render-1", REQUEST_HASH)
        assert provider.query(first.job_id) == first
        first_pid = provider.pid

    assert not provider.is_running
    with provider:
        assert provider.pid != first_pid
        repeated = provider.submit("project-1:render-1", REQUEST_HASH)
        assert repeated == first
        assert provider.query(first.job_id) == first

    assert job_count(database) == 1


def test_same_idempotency_key_rejects_changed_request_without_mutation(tmp_path: Path) -> None:
    database = tmp_path / "fake-provider.db"
    with FakeProviderProcess(database, trusted_root=tmp_path) as provider:
        original = provider.submit("project-1:render-1", REQUEST_HASH)
        with pytest.raises(FakeProviderRejected, match="IDEMPOTENCY_CONFLICT"):
            provider.submit("project-1:render-1", OTHER_HASH)
        assert provider.query(original.job_id) == original

    assert job_count(database) == 1


def test_controlled_error_happens_before_persistence_without_killing_provider(
    tmp_path: Path,
) -> None:
    database = tmp_path / "fake-provider.db"
    with FakeProviderProcess(database, trusted_root=tmp_path) as provider:
        with pytest.raises(FakeProviderRejected, match="INJECTED_ERROR"):
            provider.submit(
                "project-1:render-1",
                REQUEST_HASH,
                fault="before_persist_error",
            )
        assert provider.is_running
        accepted = provider.submit("project-1:render-1", REQUEST_HASH)
        assert provider.query(accepted.job_id) == accepted

    assert job_count(database) == 1


def test_crash_before_persistence_is_restartable_and_creates_no_job(tmp_path: Path) -> None:
    database = tmp_path / "fake-provider.db"
    provider = FakeProviderProcess(database, trusted_root=tmp_path)
    with provider:
        with pytest.raises(FakeProviderProcessCrashed, match="before_persist_crash"):
            provider.submit(
                "project-1:render-1",
                REQUEST_HASH,
                fault="before_persist_crash",
            )
        assert not provider.is_running
        assert provider.last_exit_code == 71
        assert job_count(database) == 0
        provider.start()
        accepted = provider.submit("project-1:render-1", REQUEST_HASH)
        assert provider.query(accepted.job_id) == accepted

    assert job_count(database) == 1


def test_crash_after_persistence_retries_to_exactly_one_remote_job(tmp_path: Path) -> None:
    database = tmp_path / "fake-provider.db"
    provider = FakeProviderProcess(database, trusted_root=tmp_path)
    with provider:
        with pytest.raises(FakeProviderProcessCrashed, match="after_persist_crash"):
            provider.submit(
                "project-1:render-1",
                REQUEST_HASH,
                fault="after_persist_crash",
            )
        assert not provider.is_running
        assert provider.last_exit_code == 72
        original_job_id = persisted_job_id(database)

        provider.start()
        recovered = provider.submit("project-1:render-1", REQUEST_HASH)
        assert recovered.job_id == original_job_id
        assert provider.query(recovered.job_id) == recovered

    assert job_count(database) == 1


def test_provider_rejects_unknown_jobs_and_unbounded_protocol_values(tmp_path: Path) -> None:
    with FakeProviderProcess(tmp_path / "fake-provider.db", trusted_root=tmp_path) as provider:
        with pytest.raises(FakeProviderRejected, match="JOB_NOT_FOUND"):
            provider.query(f"job_{'0' * 32}")
        with pytest.raises(ValueError, match="job id"):
            provider.query("job_missing")
        with pytest.raises(ValueError, match="idempotency key"):
            provider.submit("x" * 257, REQUEST_HASH)
        with pytest.raises(ValueError, match="request hash"):
            provider.submit("valid-key", "not-a-hash")
        with pytest.raises(ValueError, match="fault"):
            provider.submit("valid-key", REQUEST_HASH, fault="unknown")  # type: ignore[arg-type]


def test_provider_validates_lifecycle_paths_and_record_shape(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="parent"):
        FakeProviderProcess(tmp_path / "missing" / "provider.db", trusted_root=tmp_path)
    with pytest.raises(ValueError, match="must be a file"):
        FakeProviderProcess(tmp_path, trusted_root=tmp_path)
    with pytest.raises(ValueError, match="timeout"):
        FakeProviderProcess(
            tmp_path / "provider.db", trusted_root=tmp_path, request_timeout_seconds=0
        )

    provider = FakeProviderProcess(tmp_path / "provider.db", trusted_root=tmp_path)
    provider.stop()
    with pytest.raises(RuntimeError, match="not running"):
        _ = provider.pid
    provider.start()
    first_pid = provider.pid
    provider.start()
    assert provider.pid == first_pid
    provider.stop()
    assert provider.last_exit_code == 0
    provider.stop()

    with pytest.raises(FakeProviderError, match="invalid job record"):
        fake_provider._job({"job_id": 123})


@pytest.mark.skipif(os.name != "nt", reason="Windows path boundary")
@pytest.mark.parametrize(
    "database",
    [
        Path(r"\\server\share\provider.db"),
        Path(r"\\?\C:\provider.db"),
        Path(r"C:\provider.db:alternate"),
    ],
)
def test_provider_rejects_remote_device_and_ads_database_paths(database: Path) -> None:
    with pytest.raises(ValueError, match="local|alternate data streams"):
        FakeProviderProcess(database, trusted_root=database.parent)


@pytest.mark.skipif(os.name != "nt", reason="Windows mapped drive boundary")
def test_provider_rejects_mapped_network_drive(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fake_provider_paths, "_windows_drive_type", lambda _root: 4)
    with pytest.raises(ValueError, match="mapped network drive"):
        FakeProviderProcess(tmp_path / "provider.db", trusted_root=tmp_path)


@pytest.mark.parametrize("filename", ["NUL.db", "COM¹.db", "LPT³.sqlite"])
def test_provider_rejects_windows_reserved_device_name(
    tmp_path: Path,
    filename: str,
) -> None:
    with pytest.raises(ValueError, match="reserved device"):
        FakeProviderProcess(tmp_path / filename, trusted_root=tmp_path)
    with pytest.raises(ValueError, match="reserved device"):
        FakeProviderProcess(tmp_path / "provider.db", trusted_root=tmp_path / filename)


def test_provider_requires_database_to_stay_in_explicit_trusted_root(tmp_path: Path) -> None:
    trusted = tmp_path / "trusted"
    outside = tmp_path / "outside"
    trusted.mkdir()
    outside.mkdir()

    with pytest.raises(ValueError, match="trusted root"):
        FakeProviderProcess(outside / "provider.db", trusted_root=trusted)


def test_provider_rejects_symlinked_storage_root(tmp_path: Path) -> None:
    real_root = tmp_path / "real"
    linked_root = tmp_path / "linked"
    real_root.mkdir()
    try:
        linked_root.symlink_to(real_root, target_is_directory=True)
    except OSError:
        pytest.skip("creating a directory symlink is not permitted")

    with pytest.raises(ValueError, match="reparse"):
        FakeProviderProcess(linked_root / "provider.db", trusted_root=linked_root)


@pytest.mark.parametrize(
    "payload",
    [
        {
            "job_id": "bad",
            "idempotency_key": "valid",
            "request_hash": REQUEST_HASH,
            "status": "ACCEPTED",
            "accepted_at": "2026-08-06T00:00:00Z",
        },
        {
            "job_id": f"job_{'1' * 32}",
            "idempotency_key": "valid",
            "request_hash": REQUEST_HASH,
            "status": "FAILED",
            "accepted_at": "2026-08-06T00:00:00Z",
        },
        {
            "job_id": f"job_{'1' * 32}",
            "idempotency_key": "valid",
            "request_hash": REQUEST_HASH,
            "status": "ACCEPTED",
            "accepted_at": "not-a-time",
        },
    ],
)
def test_provider_rejects_invalid_job_response_fields(payload: dict[str, object]) -> None:
    with pytest.raises(FakeProviderError, match="invalid job record"):
        fake_provider._job(payload)
