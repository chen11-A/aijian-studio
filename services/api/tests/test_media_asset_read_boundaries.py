"""Temporary real SQLite and synthetic bytes; no decoding or legal-rights claim."""

import hashlib
import io
import json
import sqlite3
import time
from dataclasses import replace
from types import SimpleNamespace

import pytest
from aijian_api import media_asset_rights_reader as rights_reader
from aijian_api import media_asset_selected_reader as reader
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.repository import StudioRepository


@pytest.fixture
def media(tmp_path):
    repository = StudioRepository(tmp_path / "workspace" / "studio.sqlite3")
    project = repository.create_project(
        name="Synthetic media read test",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    source = tmp_path / "header-only.png"
    body = (
        b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + (2).to_bytes(4, "big") * 2 + b"synthetic"
    )
    source.write_bytes(body)
    store = MediaAssetStore(repository)
    asset = store.import_local(project.id, source)
    version = asset.latest_version
    blob = (
        repository.database_path.parent
        / "media-assets"
        / "blobs"
        / version.sha256[:2]
        / version.sha256
    )
    return SimpleNamespace(
        repository=repository,
        project=project,
        source=source,
        body=body,
        store=store,
        asset=asset,
        version=version,
        blob=blob,
    )


def selected(media):
    return reader.read_selected_media_asset_version(
        media.repository.database_path,
        media.project.id,
        media.asset.id,
        media.version.id,
    )


def rights(media, **expected):
    return rights_reader.read_latest_rights_decision(
        media.repository.database_path,
        media.project.id,
        media.asset.id,
        media.version.id,
        **expected,
    )


def directory_hashes(path):
    return {
        str(item.relative_to(path)): hashlib.sha256(item.read_bytes()).hexdigest()
        for item in path.rglob("*")
        if item.is_file()
    }


def test_selected_version_read_is_zero_write_and_preserves_pending_rights(media):
    before = directory_hashes(media.repository.database_path.parent)
    result = selected(media)
    assert result.status == "VERIFIED"
    assert result.version.sha256 == hashlib.sha256(media.body).hexdigest()
    assert result.version.rights_status == "PENDING_REVIEW"
    assert result.version.technical_metadata["inspection_status"] == "HEADER_ONLY"
    assert directory_hashes(media.repository.database_path.parent) == before


@pytest.mark.parametrize(
    "fault,status",
    [
        ("missing", "MISSING"),
        ("size", "CORRUPT"),
        ("hash", "CORRUPT"),
        ("limit", "UNVERIFIED_SIZE_LIMIT"),
        ("budget", "UNKNOWN_READ_BUDGET"),
    ],
)
def test_selected_blob_failures_never_become_verified(media, monkeypatch, fault, status):
    if fault == "missing":
        media.blob.unlink()
    elif fault == "size":
        media.blob.write_bytes(b"changed")
    elif fault == "hash":
        media.blob.write_bytes(b"x" * len(media.body))
    elif fault == "limit":
        monkeypatch.setattr(reader, "MAX_VERIFIED_ASSET_BYTES", 1)
    else:
        monkeypatch.setattr(reader, "MAX_READ_SECONDS", 0)
    before = directory_hashes(media.repository.database_path.parent)
    assert selected(media).status == status
    assert directory_hashes(media.repository.database_path.parent) == before


@pytest.mark.parametrize("module", [reader, rights_reader])
@pytest.mark.parametrize(
    "fault,status",
    [
        ("missing", "UNKNOWN_DATABASE"),
        ("empty", "UNKNOWN_DATABASE"),
        ("directory", "UNKNOWN_DATABASE"),
        ("corrupt", "UNKNOWN_DATABASE"),
        ("wal", "UNKNOWN_DATABASE_BUSY"),
        ("limit", "UNKNOWN_READ_BUDGET"),
        ("relative", "UNKNOWN_UNSAFE_PATH"),
    ],
)
def test_snapshot_reader_rejects_unavailable_database(tmp_path, monkeypatch, module, fault, status):
    path = tmp_path / "absent.sqlite3"
    if fault == "directory":
        path.mkdir()
    elif fault == "empty":
        path.touch()
    elif fault not in {"missing", "relative"}:
        path.write_bytes(b"not sqlite")
    if fault == "wal":
        path.with_name(path.name + "-wal").write_bytes(b"uncheckpointed")
    if fault == "limit":
        monkeypatch.setattr(module, "MAX_DATABASE_BYTES", 1)
    if fault == "relative":
        path = type(path)("relative.sqlite3")
    read = (
        module.read_selected_media_asset_version
        if module is reader
        else module.read_latest_rights_decision
    )
    result = read(path, "prj_" + "1" * 32, "asset_" + "2" * 32, "asv_" + "3" * 32)
    assert result.status == status


@pytest.mark.parametrize("module", [reader, rights_reader])
@pytest.mark.parametrize("field", [0, 1, 2])
def test_bad_identifiers_do_not_create_database(tmp_path, module, field):
    identifiers = ["prj_" + "1" * 32, "asset_" + "2" * 32, "asv_" + "3" * 32]
    identifiers[field] = "invalid"
    path = tmp_path / "absent.sqlite3"
    read = (
        module.read_selected_media_asset_version
        if module is reader
        else module.read_latest_rights_decision
    )
    assert read(path, *identifiers).status == "NOT_FOUND"
    assert not path.exists()


@pytest.mark.parametrize("module", [reader, rights_reader])
@pytest.mark.parametrize(
    "fault,status",
    [
        ("before-count", "UNKNOWN_DATABASE_CHANGED"),
        ("after-count", "UNKNOWN_DATABASE_CHANGED"),
        ("after-hash", "UNKNOWN_DATABASE_CHANGED"),
        ("budget", "UNKNOWN_READ_BUDGET"),
        ("open", "UNKNOWN_DATABASE_BUSY"),
    ],
)
def test_snapshot_read_faults_discard_authority(media, monkeypatch, module, fault, status):
    original = module._hash_stream
    calls = 0

    def hashing(stream, **kwargs):
        nonlocal calls
        calls += 1
        if fault == "budget":
            raise reader._ReadBudgetExceeded
        digest, count = original(stream, **kwargs)
        if (fault == "before-count" and calls == 1) or (fault == "after-count" and calls == 2):
            return digest, count + 1
        return ("0" * 64 if fault == "after-hash" and calls == 2 else digest), count

    if fault == "open":

        def unavailable(path):
            raise OSError("synthetic sharing conflict")

        monkeypatch.setattr(module, "_open_local_source", unavailable)
    else:
        monkeypatch.setattr(module, "_hash_stream", hashing)
    if module is reader:
        # Isolate the DB snapshot read from the separately tested blob hash pass.
        monkeypatch.setattr(reader, "_verify_blob", lambda *_: "VERIFIED")
    before = directory_hashes(media.repository.database_path.parent)
    assert (selected(media) if module is reader else rights(media)).status == status
    assert directory_hashes(media.repository.database_path.parent) == before


def test_rights_declaration_is_version_bound_and_does_not_change_legacy_asset(media):
    store = MediaAssetRightsStore(media.repository)
    assert rights(media).status == "NO_DECISION"
    command = HumanRightsDecisionInput(
        operation_id="rdop_" + "a" * 32,
        expected_revision=0,
        decision="CLEARED",
        basis_text="Synthetic fixture declaration only; no real media rights.",
    )
    first = store.append_human_decision(
        media.project.id,
        media.asset.id,
        media.version.id,
        command,
        actor_id="test-human",
    )
    before = directory_hashes(media.repository.database_path.parent)
    result = rights(
        media,
        expected_revision=1,
        expected_decision_id=first.decision.decision_id,
        expected_content_hash=first.decision.decision_content_hash,
    )
    assert result.status == "VERIFIED"
    assert result.decision.decision == "CLEARED"
    assert selected(media).version.rights_status == "PENDING_REVIEW"
    assert directory_hashes(media.repository.database_path.parent) == before
    assert store.get_operation_receipt(
        media.project.id, media.asset.id, media.version.id, command.operation_id
    ).replayed
    assert rights(media, expected_revision=0).status == "CONFLICT"
    assert rights(media, expected_decision_id="ard_" + "0" * 32).status == "CONFLICT"
    assert rights(media, expected_content_hash="0" * 64).status == "CONFLICT"


@pytest.mark.parametrize(
    "expected",
    [
        {"expected_revision": -1},
        {"expected_revision": True},
        {"expected_revision": 1.2},
        {"expected_decision_id": "invalid"},
        {"expected_content_hash": "invalid"},
        {"expected_decision_id": "ard_" + "a" * 32},
        {"expected_content_hash": "a" * 64},
    ],
)
def test_rights_read_rejects_invalid_or_absent_expectations(media, expected):
    assert rights(media, **expected).status == "CONFLICT"


def test_selected_version_and_rights_disappear_after_soft_delete_but_blob_remains(media):
    media.store.soft_delete(media.project.id, media.asset.id)
    assert selected(media).status == rights(media).status == "NOT_FOUND"
    assert media.blob.read_bytes() == media.body


def test_hash_stream_bounds_bytes_and_elapsed_time():
    with pytest.raises(reader._ReadBudgetExceeded):
        reader._hash_stream(io.BytesIO(b"123"), maximum=2, deadline=time.monotonic() + 10)
    with pytest.raises(reader._ReadBudgetExceeded):
        reader._hash_stream(io.BytesIO(b"1"), maximum=2, deadline=0)
    assert reader._hash_stream(io.BytesIO(b""), maximum=0, deadline=0) == (
        hashlib.sha256(b"").hexdigest(),
        0,
    )


@pytest.mark.parametrize(
    "change",
    [
        {"kind": "other"},
        {"rights_status": "UNKNOWN"},
        {"source_kind": "REMOTE"},
        {"sha256": "invalid"},
        {"byte_size": 0},
        {"ordinal": 0},
        {"filename": ""},
        {"mime_type": ""},
        {"technical_json": "[]"},
        {"technical_json": "{"},
        {"technical_json": '{"enabled":true}'},
        {"technical_json": '{"x":null}'},
    ],
)
def test_corrupt_row_parser_does_not_admit_malformed_metadata(change):
    # A isolated SELECT creates an actual sqlite3.Row without altering constraints.
    values = dict(
        project_id="prj_" + "1" * 32,
        asset_id="asset_" + "2" * 32,
        id="asv_" + "3" * 32,
        kind="image",
        rights_status="PENDING_REVIEW",
        source_kind="LOCAL_IMPORT",
        sha256="a" * 64,
        byte_size=8,
        ordinal=1,
        filename="fixture.png",
        mime_type="image/png",
        technical_json="{}",
    )
    values.update(change)
    with sqlite3.connect(":memory:") as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT " + ",".join(f"? AS {key}" for key in values), tuple(values.values())
        ).fetchone()
        with pytest.raises((ValueError, json.JSONDecodeError)):
            reader._version_from_row(row, [])


def test_episode_reference_is_returned_for_exact_selected_version(media):
    episode = media.repository.create_episode(media.project.id, title="Fixture episode")
    media.store.add_episode_reference(
        media.project.id, media.asset.id, episode.id, media.version.id, "visual"
    )
    result = selected(media)
    assert result.version.episode_uses == (reader.SelectedEpisodeUse(episode.id, "visual"),)
    changed = replace(result.version, byte_size=result.version.byte_size + 1)
    assert (
        reader._verify_blob(media.repository.database_path.parent, changed, time.monotonic() + 10)
        == "CORRUPT"
    )
