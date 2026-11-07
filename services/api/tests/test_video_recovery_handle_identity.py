"""Same-API file identity remains strict when Windows path ctime has another meaning."""

import hashlib
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api import video_recovery
from aijian_api.video_recovery import VideoRecoveryService


def changed_stat(info, **changes):
    values = {name: getattr(info, name) for name in dir(info) if name.startswith("st_")}
    return SimpleNamespace(**(values | changes))


def test_path_ctime_api_difference_keeps_actual_handles_hash_and_bytes(tmp_path, monkeypatch):
    path = tmp_path / "retained.mp4"
    data = b"complete retained recovery bytes"
    path.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    original = Path.lstat
    observed = []

    def other_ctime_api(value, *args, **kwargs):
        info = original(value, *args, **kwargs)
        if value == path:
            observed.append(info)
            return changed_stat(info, st_ctime_ns=info.st_ctime_ns + 10_000_000_000)
        return info

    monkeypatch.setattr(Path, "lstat", other_ctime_api)
    assert VideoRecoveryService._read_path(path, digest, len(data)) == data
    assert len(observed) == 2
    assert path.read_bytes() == data
    assert VideoRecoveryService._read_path(path, "f" * 64, len(data)) is None


@pytest.mark.parametrize("field", ["st_ino", "st_mtime_ns", "st_ctime_ns"])
def test_changed_named_path_identity_or_time_is_not_dropped(tmp_path, monkeypatch, field):
    path = tmp_path / "retained.mp4"
    data = b"retained"
    path.write_bytes(data)
    original = Path.lstat
    calls = 0

    def changed_after_read(value, *args, **kwargs):
        nonlocal calls
        info = original(value, *args, **kwargs)
        if value == path:
            calls += 1
            if calls == 2:
                return changed_stat(info, **{field: getattr(info, field) + 1})
        return info

    monkeypatch.setattr(Path, "lstat", changed_after_read)
    assert (
        VideoRecoveryService._read_path(path, hashlib.sha256(data).hexdigest(), len(data)) is None
    )
    assert calls == 2
    assert path.read_bytes() == data


def test_real_named_replacement_cannot_return_the_replaced_bytes(tmp_path, monkeypatch):
    path = tmp_path / "retained.mp4"
    replacement = tmp_path / "replacement.mp4"
    data = b"first bytes"
    changed = b"other bytes"
    path.write_bytes(data)
    replacement.write_bytes(changed)
    original = video_recovery._open_local_source
    calls = 0
    blocked = False

    def replacing_open(value):
        nonlocal calls, blocked
        calls += 1
        if calls == 2:
            try:
                os.replace(replacement, path)
            except OSError:
                # Windows read handles deny delete/replacement while the original
                # source is open. That is an equally strong rejection of the race.
                blocked = True
        return original(value)

    monkeypatch.setattr(video_recovery, "_open_local_source", replacing_open)
    result = VideoRecoveryService._read_path(path, hashlib.sha256(data).hexdigest(), len(data))
    assert calls == 2
    if blocked:
        assert result == data and path.read_bytes() == data
        assert replacement.read_bytes() == changed
    else:
        assert result is None and path.read_bytes() == changed


def test_reader_rejects_symbolic_link_without_touching_target(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"original")
    alias = tmp_path / "alias.mp4"
    try:
        alias.symlink_to(source)
    except OSError:
        pytest.skip("host cannot create a symbolic link")
    digest = hashlib.sha256(b"original").hexdigest()
    assert VideoRecoveryService._read_path(alias, digest, 8) is None
    assert source.read_bytes() == b"original"


def test_same_source_handle_ctime_change_still_rejects(tmp_path, monkeypatch):
    path = tmp_path / "retained.mp4"
    data = b"actual retained bytes"
    path.write_bytes(data)
    opener = video_recovery._open_local_source
    fstat = os.fstat
    read_completed = False

    class ObservedStream:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            self.stream.__enter__()
            return self

        def __exit__(self, *args):
            return self.stream.__exit__(*args)

        def fileno(self):
            return self.stream.fileno()

        def read(self, limit):
            nonlocal read_completed
            result = self.stream.read(limit)
            read_completed = True
            return result

    def changed_fstat(descriptor):
        info = fstat(descriptor)
        return changed_stat(info, st_ctime_ns=info.st_ctime_ns + 1) if read_completed else info

    monkeypatch.setattr(
        video_recovery, "_open_local_source", lambda value: ObservedStream(opener(value))
    )
    monkeypatch.setattr(os, "fstat", changed_fstat)
    assert (
        VideoRecoveryService._read_path(path, hashlib.sha256(data).hexdigest(), len(data)) is None
    )
    assert read_completed
    assert path.read_bytes() == data
