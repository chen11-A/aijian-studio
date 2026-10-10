"""Real temporary SQLite probe receipts with a synthetic, non-decoding probe boundary."""

import hashlib
import json
import sqlite3
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import media_asset_probe_store as probes
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.repository import StudioRepository
from test_media_execution_plan_boundaries import probe as synthetic_probe
from test_product_store_boundaries import synthetic_tools


@pytest.fixture
def selected(tmp_path, monkeypatch):
    repository = StudioRepository(tmp_path / "workspace" / "studio.sqlite3")
    project = repository.create_project(
        name="Synthetic probe store",
        aspect_ratio="9:16",
        target_duration_seconds=3,
        source_language="zh-CN",
    )
    source = tmp_path / "not-real-video.mp4"
    source.write_bytes(b"0000ftypisom synthetic header only, not decodable")
    asset = MediaAssetStore(repository).import_local(project.id, source)
    version = asset.latest_version
    result = synthetic_probe().probe.model_copy(
        update={
            "source_asset_sha256": "sha256:" + version.sha256,
            "byte_size": version.byte_size,
        }
    )
    runner = Mock(return_value=result)
    monkeypatch.setattr(probes, "probe_local_media", runner)
    return SimpleNamespace(
        repository=repository,
        args=(project.id, asset.id, version.id),
        result=result,
        runner=runner,
        store=probes.MediaAssetProbeEvidenceStore(repository),
        tools=synthetic_tools(tmp_path),
        version=version,
    )


def persist(selected):
    return selected.store.probe_selected_video(*selected.args, selected.tools)


def test_probe_is_persisted_once_and_read_back_without_reprobing(selected):
    assert selected.store.read(*selected.args) is None
    evidence = persist(selected)
    assert evidence.probe == selected.result
    assert selected.store.read(*selected.args) == evidence
    assert selected.runner.call_count == 1
    assert persist(selected) == evidence
    with selected.repository._connection() as connection:
        assert (
            connection.execute("SELECT count(*) FROM media_asset_probe_evidence").fetchone()[0] == 1
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("profile_id", "other"),
        ("version", "other"),
        ("ffmpeg_sha256", "a" * 64),
        ("ffprobe_sha256", "b" * 64),
    ],
)
def test_conflicting_probe_tool_identity_is_not_overwritten(selected, field, value):
    evidence = persist(selected)
    selected.tools = replace(selected.tools, **{field: value})
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        persist(selected)
    assert caught.value.code == "PROBE_EVIDENCE_CONFLICT"
    assert selected.store.read(*selected.args) == evidence


@pytest.mark.parametrize(
    "field,value",
    [
        ("source_asset_sha256", "sha256:" + "a" * 64),
        ("byte_size", 999),
    ],
)
def test_probe_identity_must_match_selected_immutable_version(selected, field, value):
    selected.runner.return_value = selected.result.model_copy(update={field: value})
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        persist(selected)
    assert caught.value.code == "MEDIA_IDENTITY_CHANGED"
    assert selected.store.read(*selected.args) is None


def test_changed_probe_cannot_replace_persisted_receipt(selected):
    evidence = persist(selected)
    selected.runner.return_value = selected.result.model_copy(update={"format_names": ("mov",)})
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        persist(selected)
    assert caught.value.code == "PROBE_EVIDENCE_CONFLICT"
    assert selected.store.read(*selected.args) == evidence


def test_oversized_probe_is_rejected_before_insert(selected, monkeypatch):
    monkeypatch.setattr(probes, "MAX_PERSISTED_PROBE_BYTES", 10)
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        persist(selected)
    assert caught.value.code == "PROBE_EVIDENCE_TOO_LARGE"
    assert selected.store.read(*selected.args) is None


def sqlite_row(fields):
    with sqlite3.connect(":memory:") as connection:
        connection.row_factory = sqlite3.Row
        columns = ", ".join(f"? AS {key}" for key in fields)
        return connection.execute(f"SELECT {columns}", tuple(fields.values())).fetchone()


@pytest.mark.parametrize("corruption", ["hash", "oversize", "json", "model", "asset", "size"])
def test_corrupt_persisted_probe_cannot_be_read_as_evidence(selected, monkeypatch, corruption):
    persist(selected)
    with selected.repository._connection() as connection:
        row = dict(connection.execute("SELECT * FROM media_asset_probe_evidence").fetchone())
    if corruption == "hash":
        row["probe_sha256"] = "0" * 64
    elif corruption == "oversize":
        monkeypatch.setattr(probes, "MAX_PERSISTED_PROBE_BYTES", 10)
    elif corruption in {"json", "model"}:
        row["probe_json"] = "{" if corruption == "json" else json.dumps({"video": None})
        row["probe_sha256"] = hashlib.sha256(row["probe_json"].encode()).hexdigest()
    elif corruption == "asset":
        row["asset_sha256"] = "0" * 64
    else:
        row["byte_size"] += 1
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        probes._from_row(sqlite_row(row))
    assert caught.value.code == (
        "PROBE_IDENTITY_CONFLICT" if corruption in {"asset", "size"} else "PROBE_RECORD_CORRUPT"
    )


@pytest.mark.parametrize("field", ["sha256", "byte_size"])
def test_version_changed_during_probe_rolls_back_without_receipt(selected, monkeypatch, field):
    original = probes._selected_row
    reads = 0

    def changed(*args):
        nonlocal reads
        row = original(*args)
        reads += 1
        if reads == 2:
            fields = dict(row)
            fields[field] = "0" * 64 if field == "sha256" else fields[field] + 1
            return sqlite_row(fields)
        return row

    monkeypatch.setattr(probes, "_selected_row", changed)
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        persist(selected)
    assert caught.value.code == "MEDIA_IDENTITY_CHANGED"
    assert selected.store.read(*selected.args) is None


@pytest.mark.parametrize("field", ["asset_sha256", "byte_size"])
def test_read_rejects_receipt_that_does_not_match_current_version(selected, monkeypatch, field):
    evidence = persist(selected)
    changed = replace(evidence, **{field: "0" * 64 if field == "asset_sha256" else 999})
    monkeypatch.setattr(probes, "_from_row", lambda _row: changed)
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        selected.store.read(*selected.args)
    assert caught.value.code == "PROBE_IDENTITY_CONFLICT"


@pytest.mark.parametrize(
    "result,code",
    [
        (None, "ASSET_VERSION_NOT_FOUND"),
        ({}, "MEDIA_RECORD_CORRUPT"),
        ("image", "VIDEO_REQUIRED"),
    ],
)
def test_selected_row_requires_existing_sqlite_video_record(result, code):
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = (
        sqlite_row({"kind": "image"}) if result == "image" else result
    )
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        probes._selected_row(connection, "project", "asset", "version")
    assert caught.value.code == code


@pytest.mark.parametrize("digest", ["", "0" * 63, "0" * 65, "G" * 64, "A" * 64])
def test_invalid_stored_digest_is_not_used_in_path(selected, digest):
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        probes._managed_path(selected.repository, digest)
    assert caught.value.code == "MEDIA_RECORD_CORRUPT"


@pytest.mark.parametrize("boundary", ["root", "directory", "remote", "source", "absent"])
def test_unsafe_managed_path_is_rejected_before_probe(selected, monkeypatch, boundary):
    original = probes.managed_local_io_path
    digest = selected.version.sha256

    def resolve(workspace, path):
        if boundary == "root" or (boundary == "source" and path.name == digest):
            raise OSError("synthetic path resolution failure")
        if boundary == "absent" and path.name == digest:
            return path.parent / "absent-synthetic-blob"
        return original(workspace, path)

    monkeypatch.setattr(probes, "managed_local_io_path", resolve)
    if boundary == "directory":
        monkeypatch.setattr(probes, "_plain_directory", lambda _: False)
    if boundary == "remote":
        monkeypatch.setattr(probes, "_is_remote_windows_path", lambda _: True)
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        persist(selected)
    assert caught.value.code == "MEDIA_PATH_UNAVAILABLE"
    selected.runner.assert_not_called()


@pytest.mark.parametrize("error", [OSError("unavailable"), RuntimeError("loop")])
def test_unreadable_directory_fails_closed(error):
    path = Mock()
    path.is_dir.side_effect = error
    assert probes._plain_directory(path) is False


def test_final_local_source_resolution_failure_prevents_probe(selected, monkeypatch):
    monkeypatch.setattr(probes, "_managed_path", lambda *_: selected.repository.database_path)
    monkeypatch.setattr(probes, "managed_local_io_path", Mock(side_effect=ValueError("unsafe")))
    with pytest.raises(probes.MediaAssetProbeEvidenceError) as caught:
        persist(selected)
    assert caught.value.code == "MEDIA_PATH_UNAVAILABLE"
    selected.runner.assert_not_called()
