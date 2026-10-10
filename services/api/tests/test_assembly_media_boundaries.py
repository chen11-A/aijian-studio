"""Managed byte admission and typed synthetic probe checks; no decoder or rights grant."""

import hashlib
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import episode_media_assembly_store as assembly_store
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidenceError
from aijian_api.media_asset_rights_store import RightsDecisionError
from test_media_execution_plan_boundaries import SHA, assembly, probe


@pytest.fixture
def managed(tmp_path):
    data = b"synthetic byte identity"
    digest = hashlib.sha256(data).hexdigest()
    path = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
    path.parent.mkdir(parents=True)
    path.write_bytes(data)
    return tmp_path / "unused.db", path, data, digest


def test_availability_checks_actual_bytes_without_creating_database(managed):
    database, path, data, digest = managed
    assert assembly_store._availability(database, digest, len(data)) == "VERIFIED"
    assert path.read_bytes() == data
    assert not database.exists()


@pytest.mark.parametrize(("digest", "size"), [("bad", 1), ("f" * 64, 0), ("f" * 64, -1)])
def test_corrupt_identity_stops_before_filesystem_admission(tmp_path, monkeypatch, digest, size):
    resolve = Mock(side_effect=AssertionError("must not resolve"))
    monkeypatch.setattr(assembly_store, "managed_local_io_path", resolve)
    assert assembly_store._availability(tmp_path / "unused.db", digest, size) == "CORRUPT"
    resolve.assert_not_called()


@pytest.mark.parametrize(
    ("failure", "status"),
    [
        (OSError, "UNKNOWN_UNSAFE_PATH"),
        (ValueError, "UNKNOWN_UNSAFE_PATH"),
        (FileNotFoundError, "MISSING"),
    ],
)
@pytest.mark.parametrize("call_index", [2, 5])
def test_directory_and_blob_resolution_fail_closed(
    managed, monkeypatch, failure, status, call_index
):
    database, _, data, digest = managed
    real = assembly_store.managed_local_io_path
    calls = 0

    def resolve(*args):
        nonlocal calls
        calls += 1
        if calls == call_index:
            raise failure("synthetic unavailable")
        return real(*args)

    monkeypatch.setattr(assembly_store, "managed_local_io_path", resolve)
    assert assembly_store._availability(database, digest, len(data)) == status


@pytest.mark.parametrize("failure", [OSError, ValueError])
def test_workspace_resolution_failure_is_unknown(managed, monkeypatch, failure):
    database, _, data, digest = managed
    monkeypatch.setattr(
        assembly_store, "managed_local_io_path", Mock(side_effect=failure("synthetic"))
    )
    assert assembly_store._availability(database, digest, len(data)) == "UNKNOWN_UNSAFE_PATH"


@pytest.mark.parametrize("failure", [OSError, ValueError])
def test_open_failure_is_unknown_not_verified(managed, monkeypatch, failure):
    database, _, data, digest = managed
    monkeypatch.setattr(
        assembly_store, "_open_local_source", Mock(side_effect=failure("synthetic"))
    )
    assert assembly_store._availability(database, digest, len(data)) == "UNKNOWN_MEDIA_READ"


@pytest.mark.parametrize("field", ["st_dev", "st_ino", "st_size", "st_mtime_ns"])
def test_handle_identity_change_is_unknown(managed, monkeypatch, field):
    database, path, data, digest = managed
    before = path.stat()
    values = {
        key: getattr(before, key)
        for key in ("st_mode", "st_dev", "st_ino", "st_size", "st_mtime_ns")
    }
    values[field] += 1
    monkeypatch.setattr(
        assembly_store,
        "os",
        SimpleNamespace(fstat=Mock(side_effect=[before, SimpleNamespace(**values)])),
    )
    assert assembly_store._availability(database, digest, len(data)) == "UNKNOWN_MEDIA_CHANGED"


def test_size_limit_does_not_claim_verified_media(managed, monkeypatch):
    database, _, data, digest = managed
    monkeypatch.setattr(assembly_store, "MAX_INLINE_PREVIEW_BYTES", len(data) - 1)
    assert assembly_store._availability(database, digest, len(data)) == "UNVERIFIED_SIZE_LIMIT"


@pytest.mark.parametrize("mutation", ["size", "hash", "missing"])
def test_original_file_drift_does_not_pass(managed, mutation):
    database, path, data, digest = managed
    if mutation == "size":
        path.write_bytes(data + b"x")
    elif mutation == "hash":
        path.write_bytes(b"x" * len(data))
    else:
        path.unlink()
    assert assembly_store._availability(database, digest, len(data)) == (
        "MISSING" if mutation == "missing" else "CORRUPT"
    )


@pytest.mark.parametrize("error", [OSError, RuntimeError])
def test_directory_inspection_errors_are_not_plain_directories(error):
    path = Mock(is_dir=Mock(side_effect=error("synthetic")))
    assert assembly_store._plain_directory(path) is False


@pytest.fixture
def collection(tmp_path, monkeypatch):
    content = assembly().content
    row = {
        "kind": "video",
        "sha256": SHA,
        "byte_size": 100,
        "source_kind": "LOCAL_IMPORT",
        "technical_json": "{}",
    }
    connection = Mock()
    connection.execute.side_effect = lambda sql, args=(): Mock(
        fetchone=Mock(return_value=row if "FROM media_asset_versions" in sql else {"present": 1})
    )
    rights = Mock(return_value=())
    from_row = Mock(return_value=probe())
    available = Mock(return_value="VERIFIED")
    monkeypatch.setattr(assembly_store, "_validated_history", rights)
    monkeypatch.setattr(assembly_store, "_from_row", from_row)
    monkeypatch.setattr(assembly_store, "_availability", available)
    return SimpleNamespace(
        connection=connection,
        content=content,
        database=tmp_path / "unused.db",
        row=row,
        rights=rights,
        probe=from_row,
        available=available,
    )


def collect(fixture, *, writing=True):
    return assembly_store._collect_checks(
        fixture.connection, fixture.database, fixture.content, writing=writing
    )


def test_matching_probe_retains_draft_only_metadata(collection):
    (check,) = collect(collection)
    assert check.technical_status == "PROBED_CFR_VIDEO"
    assert check.probe_evidence_id == probe().id
    assert check.probed_video_frames == 75
    assert check.probed_has_audio is False
    assert check.rights_status == "PENDING_REVIEW"


@pytest.mark.parametrize("mutation", ["hash", "size", "rate", "vfr", "range", "audio", "malformed"])
def test_stale_probe_cannot_enable_preview(collection, mutation):
    evidence = probe()
    if mutation == "hash":
        evidence = replace(evidence, asset_sha256="f" * 64)
    elif mutation == "size":
        evidence = replace(evidence, byte_size=101)
    elif mutation == "malformed":
        collection.probe.side_effect = MediaAssetProbeEvidenceError("SYNTHETIC_INVALID", "bad")
    elif mutation == "audio":
        collection.content = assembly(segment_fields={"embedded_audio": "PLAY"}).content
    else:
        video = evidence.probe.video
        if mutation == "rate":
            video = video.model_copy(
                update={
                    "average_frame_rate": video.average_frame_rate.model_copy(update={"num": 24})
                }
            )
        elif mutation == "vfr":
            video = video.model_copy(update={"is_variable_frame_rate": True})
        else:
            video = video.model_copy(update={"frames": video.frames[:54]})
        evidence = replace(evidence, probe=evidence.probe.model_copy(update={"video": video}))
    collection.probe.return_value = evidence
    (check,) = collect(collection)
    assert check.technical_status == "INVALID_MEDIA_PROBE"
    assert check.probe_evidence_id is None
    assert check.probed_video_frames is None


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("kind", "image", "MEDIA_IDENTITY_CONFLICT"),
        ("sha256", "f" * 64, "MEDIA_IDENTITY_CONFLICT"),
        ("source_kind", "OTHER", "MEDIA_IDENTITY_CONFLICT"),
        ("byte_size", "bad", "MEDIA_RECORD_CORRUPT"),
        ("technical_json", "{bad", "MEDIA_RECORD_CORRUPT"),
        ("technical_json", "[]", "MEDIA_RECORD_CORRUPT"),
    ],
)
def test_bad_stored_media_identity_cannot_be_saved(collection, field, value, code):
    collection.row[field] = value
    with pytest.raises(assembly_store.EpisodeMediaAssemblyError) as error:
        collect(collection)
    assert error.value.code == code
    collection.rights.assert_not_called()
    collection.probe.assert_not_called()


def test_invalid_rights_history_cannot_be_ignored(collection):
    collection.rights.side_effect = RightsDecisionError("SYNTHETIC_INVALID", "bad")
    with pytest.raises(assembly_store.EpisodeMediaAssemblyError) as error:
        collect(collection)
    assert error.value.code == "RIGHTS_CHAIN_INVALID"
    collection.available.assert_not_called()


@pytest.mark.parametrize(
    "status",
    ["MISSING", "CORRUPT", "UNKNOWN_UNSAFE_PATH", "UNKNOWN_MEDIA_READ", "UNKNOWN_MEDIA_CHANGED"],
)
def test_unavailable_media_blocks_save_but_read_preserves_status(collection, status):
    collection.available.return_value = status
    with pytest.raises(assembly_store.EpisodeMediaAssemblyError) as error:
        collect(collection)
    assert error.value.code == "MEDIA_" + status
    (check,) = collect(collection, writing=False)
    assert check.availability == status
