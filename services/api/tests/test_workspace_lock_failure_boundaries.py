"""Temporary lock-file failures only; never access the active workspace lock."""

import errno
import os
import stat
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import workspace_owner_lock as locks


def os_proxy(**changes):
    values = {name: getattr(os, name) for name in dir(os)}
    values.update(changes)
    return SimpleNamespace(**values)


@pytest.mark.parametrize(
    "kind", ["relative", "name", "parent", "missing_root", "database_directory"]
)
def test_unsafe_database_identity_is_rejected_before_lock_creation(tmp_path, kind):
    database = tmp_path / "data" / "workspace.sqlite3"
    if kind == "relative":
        database = Path("data/workspace.sqlite3")
    elif kind == "name":
        database = database.with_name("other.db")
    elif kind == "parent":
        database = tmp_path / ".." / "data" / "workspace.sqlite3"
    elif kind == "missing_root":
        database = tmp_path / "missing" / "data" / "workspace.sqlite3"
    else:
        database.mkdir(parents=True)
    with pytest.raises(locks.WorkspaceLockUnsafePathError):
        locks.acquire_workspace_owner_lock(database)
    assert not list(tmp_path.glob(".aivora-workspace-*.lock"))


@pytest.mark.parametrize("error_number", [errno.EACCES, errno.EAGAIN, errno.EDEADLK, errno.EIO])
def test_os_lock_failure_closes_descriptor_and_releases_process_identity(
    tmp_path, monkeypatch, error_number
):
    database = tmp_path / "data" / "workspace.sqlite3"
    identity, _ = locks._identity_and_lock_path(database)
    assert identity not in locks._ACTIVE_IDENTITIES
    closed = []

    def close(fd):
        closed.append(fd)
        os.close(fd)

    monkeypatch.setattr(locks, "os", os_proxy(close=close))
    monkeypatch.setattr(locks, "_lock_file", Mock(side_effect=OSError(error_number, "synthetic")))
    expected = (
        locks.WorkspaceLockBusyError if error_number != errno.EIO else locks.WorkspaceLockError
    )
    with pytest.raises(expected):
        locks.acquire_workspace_owner_lock(database)
    assert identity not in locks._ACTIVE_IDENTITIES
    assert len(closed) == 1
    with pytest.raises(OSError):
        os.fstat(closed[0])


@pytest.mark.parametrize(
    "field,value", [("st_mode", stat.S_IFDIR), ("st_nlink", 2), ("st_ino", -1)]
)
def test_changed_opened_file_identity_is_not_locked(tmp_path, monkeypatch, field, value):
    database = tmp_path / "data" / "workspace.sqlite3"
    identity, _ = locks._identity_and_lock_path(database)

    def changed(fd):
        actual = os.fstat(fd)
        fields = {
            name: getattr(actual, name) for name in ("st_mode", "st_nlink", "st_dev", "st_ino")
        }
        fields[field] = value
        return SimpleNamespace(**fields)

    monkeypatch.setattr(locks, "os", os_proxy(fstat=changed))
    lock_file = Mock()
    monkeypatch.setattr(locks, "_lock_file", lock_file)
    with pytest.raises(locks.WorkspaceLockUnsafePathError, match="changed during open"):
        locks.acquire_workspace_owner_lock(database)
    lock_file.assert_not_called()
    assert identity not in locks._ACTIVE_IDENTITIES


def test_open_failure_releases_identity_even_without_descriptor(tmp_path, monkeypatch):
    database = tmp_path / "data" / "workspace.sqlite3"
    identity, _ = locks._identity_and_lock_path(database)
    closed = Mock()
    monkeypatch.setattr(
        locks,
        "os",
        os_proxy(open=Mock(side_effect=OSError("synthetic open failure")), close=closed),
    )
    with pytest.raises(OSError, match="synthetic open failure"):
        locks.acquire_workspace_owner_lock(database)
    assert identity not in locks._ACTIVE_IDENTITIES
    closed.assert_not_called()


def test_unlock_failure_still_closes_and_releases_idempotently(tmp_path, monkeypatch):
    database = tmp_path / "data" / "workspace.sqlite3"
    monkeypatch.setattr(locks, "_lock_file", lambda _: None)
    owner = locks.acquire_workspace_owner_lock(database)
    fd = owner._fd
    monkeypatch.setattr(
        locks, "_unlock_file", Mock(side_effect=OSError("synthetic unlock failure"))
    )
    with pytest.raises(OSError, match="synthetic unlock failure"):
        owner.release()
    assert owner.identity not in locks._ACTIVE_IDENTITIES
    owner.release()
    with pytest.raises(OSError):
        os.fstat(fd)
    with pytest.raises(locks.WorkspaceLockError, match="already been released"):
        owner.__enter__()


def test_posix_lock_and_unlock_use_nonblocking_flock_without_real_lock(monkeypatch):
    flock = Mock()
    monkeypatch.setitem(
        sys.modules, "fcntl", SimpleNamespace(flock=flock, LOCK_EX=2, LOCK_NB=4, LOCK_UN=8)
    )
    monkeypatch.setattr(locks, "sys", SimpleNamespace(platform="linux"))
    locks._lock_file(999)
    locks._unlock_file(999)
    assert [call.args for call in flock.call_args_list] == [(999, 6), (999, 8)]
