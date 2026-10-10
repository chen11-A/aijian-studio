"""Synthetic read-boundary tests, not QA02 acceptance or native media execution.

Only parser tests replace the expected manifest digest with a temporary fixture
digest. The production QA02 pin is never changed on disk or used as test input.
"""

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest
from aijian_api import mlt_test_selection_resolver as resolver
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.repository import StudioRepository


def pin_synthetic_manifest(monkeypatch, path, raw):
    body = json.dumps(raw, ensure_ascii=False).encode()
    path.write_bytes(body)
    monkeypatch.setattr(
        resolver, "QA02_FIVE_INPUT_MANIFEST_SHA256", hashlib.sha256(body).hexdigest()
    )


@pytest.fixture
def synthetic_manifest(tmp_path, monkeypatch):
    root = tmp_path / "synthetic"
    root.mkdir()
    subtitle = (
        "1\n00:00:01,000 --> 00:00:02,000\nTEST 提示音一（非语音）\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\nTEST 提示音二（非语音）"
    ).encode()
    entries = []
    for name in resolver._FILE_NAMES:
        body = subtitle if name.endswith(".srt") else name.encode()
        path = root / name
        path.write_bytes(body)
        entries.append(
            {
                "name": name,
                "path": str(path),
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
                "usage": "SYNTHETIC_TEST_ONLY",
            }
        )
    raw = {
        "kind": "QA02_MLT_SYNTHETIC_FIVE_INPUT_MANIFEST",
        "status": "FIVE_INPUTS_FROZEN_NO_MLT",
        "usage": "SYNTHETIC_TEST_ONLY",
        "spec_sha256": resolver.ART04_MLT_TEST_SPEC_SHA256,
        "output_directory": str(root),
        "project_id": "prj_" + "1" * 32,
        "episode_id": "ep_" + "2" * 32,
        "test_script_version_id": "ver_" + "3" * 32,
        "test_script_content_hash": "sha256:" + "4" * 64,
        "first_script_block_id": "sblk_" + "5" * 32,
        "second_script_block_id": "sblk_" + "6" * 32,
        "ffmpeg_sha256": "7" * 64,
        "ffprobe_sha256": "8" * 64,
        "files": entries,
    }
    path = root / "manifest.json"
    pin_synthetic_manifest(monkeypatch, path, raw)
    return path, raw


def rejected(code):
    return pytest.raises(
        resolver.TestSelectionError, match=".", check=lambda error: error.code == code
    )


def test_synthetic_manifest_checks_all_five_bytes_and_preserves_identity(synthetic_manifest):
    path, raw = synthetic_manifest
    before = {entry.name: entry.read_bytes() for entry in path.parent.iterdir()}
    value = resolver._load_manifest(path)
    assert value.project_id == raw["project_id"]
    assert value.script_content_hash == raw["test_script_content_hash"]
    assert set(value.files) == set(resolver._FILE_NAMES)
    assert value.ffmpeg_sha256 == raw["ffmpeg_sha256"]
    for entry in raw["files"]:
        assert value.files[entry["name"]].sha256 == entry["sha256"]
    assert {entry.name: entry.read_bytes() for entry in path.parent.iterdir()} == before


def test_unpinned_manifest_fails_before_json_parsing(synthetic_manifest):
    path, _ = synthetic_manifest
    path.write_bytes(b"not the pinned bytes")
    with rejected("MANIFEST_CHANGED"):
        resolver._load_manifest(path)


@pytest.mark.parametrize("body", [b"{", b"\xff", b'{"kind":1,"kind":2}', b"[]"])
def test_invalid_synthetic_json_is_rejected(synthetic_manifest, monkeypatch, body):
    path, _ = synthetic_manifest
    path.write_bytes(body)
    monkeypatch.setattr(
        resolver, "QA02_FIVE_INPUT_MANIFEST_SHA256", hashlib.sha256(body).hexdigest()
    )
    with rejected("MANIFEST_INVALID"):
        resolver._load_manifest(path)


@pytest.mark.parametrize(
    "field,value",
    [
        ("kind", "OTHER"),
        ("status", "DONE"),
        ("usage", "PRODUCTION"),
        ("spec_sha256", "0" * 64),
        ("spec_sha256", None),
        ("output_directory", "elsewhere"),
        ("files", []),
        ("files", None),
        ("project_id", ""),
        ("episode_id", None),
        ("test_script_version_id", 1),
        ("ffmpeg_sha256", None),
        ("ffprobe_sha256", ""),
    ],
)
def test_manifest_scope_and_required_identities_are_closed(
    synthetic_manifest, monkeypatch, field, value
):
    path, raw = synthetic_manifest
    raw[field] = value
    pin_synthetic_manifest(monkeypatch, path, raw)
    with rejected("MANIFEST_INVALID"):
        resolver._load_manifest(path)


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", "other.webm"),
        ("name", 1),
        ("usage", "PRODUCTION"),
        ("sha256", "bad"),
        ("sha256", None),
        ("bytes", True),
        ("bytes", 0),
        ("bytes", 1024 * 1024 + 1),
        ("path", "relative.webm"),
        ("path", None),
    ],
)
def test_manifest_file_fields_fail_before_selection(synthetic_manifest, monkeypatch, field, value):
    path, raw = synthetic_manifest
    raw["files"][0][field] = value
    pin_synthetic_manifest(monkeypatch, path, raw)
    with rejected("MANIFEST_INVALID"):
        resolver._load_manifest(path)


@pytest.mark.parametrize("mode", ["duplicate", "non-record", "hash", "size"])
def test_manifest_file_list_and_bytes_must_match(synthetic_manifest, monkeypatch, mode):
    path, raw = synthetic_manifest
    if mode == "duplicate":
        raw["files"][1] = raw["files"][0].copy()
    elif mode == "non-record":
        raw["files"][1] = None
    elif mode == "hash":
        raw["files"][0]["sha256"] = "0" * 64
    else:
        raw["files"][0]["bytes"] += 1
    pin_synthetic_manifest(monkeypatch, path, raw)
    with rejected("MANIFEST_INVALID" if mode in {"duplicate", "non-record"} else "FIXTURE_CHANGED"):
        resolver._load_manifest(path)


@pytest.mark.parametrize("body", [b"\xff", b"different subtitle", b"1\n"])
def test_subtitle_requires_exact_two_cues(synthetic_manifest, monkeypatch, body):
    path, raw = synthetic_manifest
    entry = raw["files"][-1]
    Path(entry["path"]).write_bytes(body)
    entry.update(sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
    pin_synthetic_manifest(monkeypatch, path, raw)
    with rejected("SUBTITLE_INVALID"):
        resolver._load_manifest(path)


@pytest.mark.parametrize("mode", ["relative", "missing", "empty", "oversize"])
def test_fixture_file_safety_boundaries(tmp_path, mode):
    path = tmp_path / "fixture.bin"
    if mode == "relative":
        path = Path("relative.bin")
    elif mode != "missing":
        path.write_bytes(b"" if mode == "empty" else b"abcd")
    expected = {"relative": "FIXTURE_PATH_UNSAFE", "missing": "FIXTURE_READ_UNKNOWN"}.get(
        mode, "FIXTURE_SIZE_UNSUPPORTED"
    )
    with rejected(expected):
        resolver._file_bytes(path, maximum=3)


def test_frozen_database_is_read_only_and_rejects_noncheckpointed_sidecar(tmp_path):
    # This tests the byte snapshot wrapper, not SQLite schema validity.
    path = tmp_path / "snapshot.db"
    path.write_bytes(b"synthetic closed snapshot")
    with resolver._frozen_database(path):
        assert path.read_bytes() == b"synthetic closed snapshot"
    assert path.read_bytes() == b"synthetic closed snapshot"
    Path(str(path) + "-wal").write_bytes(b"live WAL")
    with rejected("DATABASE_BUSY"), resolver._frozen_database(path):
        pytest.fail("busy snapshot cannot yield")


@pytest.mark.parametrize("mode", ["missing", "empty", "relative", "oversize", "path-length"])
def test_frozen_database_preflight_denies_unavailable_input(tmp_path, monkeypatch, mode):
    path = tmp_path / "snapshot.db"
    if mode == "relative":
        path = Path("snapshot.db")
    elif mode != "missing":
        path.write_bytes(b"" if mode == "empty" else b"snapshot")
    if mode == "oversize":
        monkeypatch.setattr(resolver, "MAX_DATABASE_BYTES", 2)
    if mode == "path-length":
        monkeypatch.setattr(resolver, "_windows_path_units", lambda _: 260)
    with rejected("DATABASE_UNAVAILABLE"), resolver._frozen_database(path):
        pytest.fail("invalid snapshot cannot yield")


@pytest.mark.parametrize("mode", ["initial-size", "final-hash", "final-size", "budget"])
def test_snapshot_hash_and_budget_drift_are_fail_closed(tmp_path, monkeypatch, mode):
    path = tmp_path / "snapshot.db"
    path.write_bytes(b"snapshot")
    real_hash = resolver._hash_stream
    calls = 0

    def hash_stream(*args, **kwargs):
        nonlocal calls
        calls += 1
        if mode == "budget":
            raise resolver._ReadBudgetExceeded
        digest, size = real_hash(*args, **kwargs)
        if mode == "initial-size" and calls == 1 or mode == "final-size" and calls == 2:
            size += 1
        if mode == "final-hash" and calls == 2:
            digest = "0" * 64
        return digest, size

    monkeypatch.setattr(resolver, "_hash_stream", hash_stream)
    with rejected("DATABASE_UNAVAILABLE" if mode == "budget" else "DATABASE_CHANGED"):
        with resolver._frozen_database(path):
            assert mode != "initial-size"
    assert path.read_bytes() == b"snapshot"


@pytest.fixture
def script_snapshot(tmp_path, synthetic_manifest):
    repository = StudioRepository(tmp_path / "workspace" / "studio.sqlite3")
    project = repository.create_project(
        name="Synthetic selection",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    episode = repository.list_episodes(project.id)[0].id
    manifest = resolver._load_manifest(synthetic_manifest[0])
    version, _ = EpisodeScriptStore(repository).write(
        project_id=project.id,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": {
                    "project_id": project.id,
                    "episode_id": episode,
                    "scenes": [
                        {
                            "scene_id": "scn_" + "a" * 32,
                            "ordinal": 1,
                            "heading": "Synthetic",
                            "blocks": [
                                {
                                    "block_id": block,
                                    "ordinal": index + 1,
                                    "kind": "DIALOGUE",
                                    "text": f"TEST 提示音{'一' if index == 0 else '二'}（非语音）",
                                    "speaker": "TEST 提示音（非人声）",
                                    "delivery": "OFF_SCREEN",
                                }
                                for index, block in enumerate(
                                    (manifest.first_block_id, manifest.second_block_id)
                                )
                            ],
                        }
                    ],
                },
                "change_summary": "Synthetic read-only selection test",
            }
        ),
        idempotency_key="synthetic-script",
        actor_id="synthetic-user",
    )
    manifest = replace(
        manifest,
        project_id=project.id,
        episode_id=episode,
        script_version_id=version.version_id,
        script_content_hash=version.content_hash,
    )
    return repository.database_path, manifest


def test_script_snapshot_reads_exact_persisted_version_without_mutating_db(script_snapshot):
    path, manifest = script_snapshot
    before = path.read_bytes()
    with resolver._frozen_database(path):
        record = resolver._read_script_record(path, manifest)
    assert record.version.id == manifest.script_version_id
    assert record.version.content_hash == manifest.script_content_hash
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("script_version_id", "ver_" + "f" * 32, "SCRIPT_NOT_FOUND"),
        ("project_id", "prj_" + "f" * 32, "SCRIPT_NOT_FOUND"),
        ("script_content_hash", "sha256:" + "f" * 64, "SCRIPT_CHANGED"),
        ("first_block_id", "sblk_" + "f" * 32, "SCRIPT_CHANGED"),
    ],
)
def test_script_snapshot_rejects_manifest_identity_drift(script_snapshot, field, value, code):
    path, manifest = script_snapshot
    with rejected(code):
        resolver._read_script_record(path, replace(manifest, **{field: value}))


def test_script_reader_does_not_claim_missing_schema_as_missing_script(
    tmp_path, synthetic_manifest
):
    path = tmp_path / "not-sqlite.db"
    path.write_bytes(b"not a database")
    with rejected("SCRIPT_READ_UNKNOWN"):
        resolver._read_script_record(path, resolver._load_manifest(synthetic_manifest[0]))
