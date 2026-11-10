"""Cross-API metadata semantics must not weaken same-file or cached-read checks."""

import hashlib
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api import local_media_original as originals


def test_real_original_changed_with_restored_size_and_mtime_is_not_reused(tmp_path):
    payload = b"owned bounded original"
    digest = hashlib.sha256(payload).hexdigest()
    path = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
    path.parent.mkdir(parents=True)
    path.write_bytes(payload)
    prior = path.stat()
    with originals.availability_read_scope(len(payload)):
        assert (
            originals._availability(tmp_path / "workspace.db", digest, len(payload)) == "VERIFIED"
        )
        path.write_bytes(b"x" * len(payload))
        os.utime(path, ns=(prior.st_atime_ns, prior.st_mtime_ns))
        assert originals._availability(tmp_path / "workspace.db", digest, len(payload)) == (
            "UNKNOWN_MEDIA_CHANGED"
        )


@pytest.fixture
def original(tmp_path, monkeypatch):
    payload = b"owned bounded original"
    digest = hashlib.sha256(payload).hexdigest()
    path = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
    path.parent.mkdir(parents=True)
    path.write_bytes(payload)
    named_stat = Path.stat
    fd_stat = originals.os.fstat
    metadata = {"named_ctime": 100, "held_ctime": 200, "reads": 0}

    def copy_stat(value, ctime):
        return SimpleNamespace(
            **{
                key: getattr(value, key)
                for key in ("st_mode", "st_dev", "st_ino", "st_size", "st_mtime_ns")
            },
            st_ctime_ns=ctime,
        )

    def named(value, *args, **kwargs):
        result = named_stat(value, *args, **kwargs)
        return copy_stat(result, metadata["named_ctime"]) if value.name == digest else result

    def held(fd):
        result = fd_stat(fd)
        metadata["reads"] += 1
        return copy_stat(result, metadata["held_ctime"])

    monkeypatch.setattr(Path, "stat", named)
    monkeypatch.setattr(originals.os, "fstat", held)
    return tmp_path / "workspace.db", digest, len(payload), metadata


def test_stable_original_allows_distinct_named_and_held_ctime_without_rehash(original):
    database, digest, size, metadata = original
    with originals.availability_read_scope(size):
        assert originals._availability(database, digest, size) == "VERIFIED"
        assert originals._availability(database, digest, size) == "VERIFIED"
    assert metadata["reads"] > 0


@pytest.mark.parametrize("field", ["named_ctime", "held_ctime"])
def test_cached_original_refuses_metadata_change_in_either_observation_domain(original, field):
    database, digest, size, metadata = original
    with originals.availability_read_scope(size):
        assert originals._availability(database, digest, size) == "VERIFIED"
        metadata[field] += 1
        assert originals._availability(database, digest, size) == "UNKNOWN_MEDIA_CHANGED"


def test_cached_original_does_not_trust_metadata_when_reopening_fails(original, monkeypatch):
    database, digest, size, _ = original
    with originals.availability_read_scope(size):
        assert originals._availability(database, digest, size) == "VERIFIED"

        def unavailable(path):
            raise OSError("original cannot be reopened")

        monkeypatch.setattr(originals, "_open_local_source", unavailable)
        assert originals._availability(database, digest, size) == "UNKNOWN_MEDIA_READ"


@pytest.mark.parametrize("field", ["named_ctime", "held_ctime"])
def test_original_rejects_metadata_change_during_hash_and_consumes_allowance(
    original, monkeypatch, field
):
    database, digest, size, metadata = original
    real_sha256 = originals.hashlib.sha256

    class ChangingHash:
        def __init__(self):
            self.inner = real_sha256()

        def update(self, chunk):
            self.inner.update(chunk)
            metadata[field] += 1

        def hexdigest(self):
            return self.inner.hexdigest()

    monkeypatch.setattr(originals.hashlib, "sha256", ChangingHash)
    with originals.availability_read_scope(size):
        assert originals._availability(database, digest, size) == "UNKNOWN_MEDIA_CHANGED"
        assert originals._availability(database, digest, size) == "UNVERIFIED_SIZE_LIMIT"
