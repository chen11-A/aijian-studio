"""Real scoped SQLite/parent bytes, and closed default production policy. No native execution."""

import base64
import io
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from aijian_api import native_preview_owner
from aijian_api.media_preview_plan_routes import derive_native_preview_plan
from aijian_api.native_preview_materials import prepare_native_preview_sources
from aijian_api.native_preview_parent_pipe import MAX_LINE, NativeParentPipe
from aijian_api.native_preview_private_contracts import (
    PrivateOpening,
    PrivatePrepare,
    encode_opening,
)
from test_native_preview_plan import counts

pytest_plugins = ["test_native_preview_plan"]


def opening(preview):
    selected, episode, saved, *_rest = preview
    receipt = derive_native_preview_plan(
        selected.repository, selected.args[0], episode, saved.version_id
    )
    source = receipt.plan.source
    return {
        "open_request_id": "pvo_" + "b" * 32,
        "session_id": "pvs_" + "a" * 32,
        "generation": 1,
        "expires_at": (datetime.now(UTC) + timedelta(seconds=120))
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "identity": {
            "project_id": source.project_id,
            "episode_id": source.episode_id,
            "assembly_artifact_id": source.assembly_artifact_id,
            "assembly_version_id": source.assembly_version_id,
            "assembly_content_hash": source.assembly_content_hash,
            "assembly_head_revision": source.assembly_head_revision,
            "plan_hash": receipt.plan_hash,
        },
        "plan": receipt.model_dump(mode="json"),
    }


def request(pipe, payload, **overrides):
    return {
        "event": "aivora_native_request",
        "request_id": "npr_" + "c" * 32,
        "peer_pid": pipe.peer_pid,
        "parent_pid": pipe.parent_pid,
        "operation": "prepare",
        "payload": payload,
        **overrides,
    }


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode() + b"\n"


def test_default_production_pipe_refuses_before_any_native_or_private_source_access(
    preview, monkeypatch
):
    selected, *_rest = preview
    before = counts(selected.repository)
    output = io.BytesIO()
    pipe = NativeParentPipe(selected.repository, output)

    def forbidden(*_args):
        pytest.fail("No admitted policy may reach native/resource/snapshot access")

    monkeypatch.setattr(native_preview_owner, "_installed_root", forbidden)
    monkeypatch.setattr(native_preview_owner.protected, "_api", forbidden)
    monkeypatch.setattr(native_preview_owner, "prepare_native_preview_sources", forbidden)
    payload = {"opening": opening(preview), "profile_hash": "sha256:" + "f" * 64}
    pipe.serve(io.BytesIO(encoded(request(pipe, payload))))
    result = json.loads(output.getvalue())
    assert result == {
        "event": "aivora_native_reply",
        "peer_pid": pipe.peer_pid,
        "request_id": "npr_" + "c" * 32,
        "result": {"kind": "UNAVAILABLE"},
    }
    assert not pipe.owner._leases and counts(selected.repository) == before
    assert selected.runner.call_count == 1  # Existing controlled probe fixture only.
    pipe.shutdown_and_wait()


@pytest.mark.parametrize(
    "fault",
    [
        "child",
        "parent",
        "bool-pid",
        "extra",
        "operation",
        "operation-value",
        "duplicate",
        "oversized",
        "utf8",
    ],
)
def test_parent_pipe_rejects_unowned_malformed_or_replayed_requests(preview, fault):
    selected, *_rest = preview
    output = io.BytesIO()
    pipe = NativeParentPipe(selected.repository, output)
    value = request(pipe, {"opening": opening(preview), "profile_hash": "sha256:" + "f" * 64})
    if fault == "child":
        value["peer_pid"] += 1
    if fault == "parent":
        value["parent_pid"] += 1
    if fault == "bool-pid":
        value["parent_pid"] = True
    if fault == "extra":
        value["credentials"] = "refuse-extra-no-credential-value"
    if fault == "operation":
        value["operation"] = "encode"
    if fault == "operation-value":
        value["operation"] = []
    raw = encoded(value)
    if fault == "duplicate":
        raw += raw
    if fault == "oversized":
        raw = b"x" * (MAX_LINE + 1)
    if fault == "utf8":
        raw = b"\xff\n"
    with pytest.raises(ValueError):
        pipe.serve(io.BytesIO(raw))
    assert pipe._closed.is_set() and not pipe.owner._leases
    if fault == "duplicate":
        assert len(output.getvalue().splitlines()) == 1
    else:
        assert output.getvalue() == b""
    pipe.shutdown_and_wait()


def test_duplicate_json_fields_cannot_hide_peer_or_payload(preview):
    selected, *_rest = preview
    output = io.BytesIO()
    pipe = NativeParentPipe(selected.repository, output)
    value = request(pipe, {"opening": opening(preview), "profile_hash": "sha256:" + "f" * 64})
    raw = encoded(value).replace(b'"event":', b'"peer_pid":0,"event":', 1)
    with pytest.raises(ValueError, match="duplicate"):
        pipe.serve(io.BytesIO(raw))
    assert output.getvalue() == b""


@pytest.mark.parametrize("fault", ["unknown", "identity", "expired", "bool-generation"])
def test_closed_opening_refuses_bad_identity_or_lease_before_owned_dispatch(preview, fault):
    value = opening(preview)
    if fault == "unknown":
        value["execute_provider"] = True
    if fault == "identity":
        value["identity"]["episode_id"] = "ep_" + "e" * 32
    if fault == "expired":
        value["expires_at"] = "2020-01-01T00:00:00.000Z"
    if fault == "bool-generation":
        value["generation"] = True
    with pytest.raises(ValueError):
        PrivateOpening.model_validate(value).check()


def test_held_byte_reader_survives_path_loss_and_refuses_after_dispatch(preview, tmp_path):
    selected, *_rest = preview
    path = tmp_path / "held.bin"
    path.write_bytes(b"original-held-bytes")
    owner = native_preview_owner._Prepared(
        selected.repository,
        PrivatePrepare(
            opening=PrivateOpening.model_validate(opening(preview)),
            profile_hash="sha256:" + "f" * 64,
        ),
        native_preview_owner.NativeRelease("{}", "{}"),
        lambda *_: None,
    )
    held = owner.held.enter_context(path.open("rb"))
    owner.files["host.exe"] = held
    owner.material = {"profile": {"files": [{"relative_path": "host.exe", "byte_size": 19}]}}
    path.unlink()  # Linux handle identity test; not Windows deny-write/delete acceptance.
    try:
        assert base64.b64decode(owner.read("host.exe", 0, 19)) == b"original-held-bytes"
        owner.launched = True
        with pytest.raises(ValueError):
            owner.read("host.exe", 0, 19)
    finally:
        owner.held.close()


def test_production_owner_freezes_exact_open_before_real_sqlite_admission_dispatch(
    preview, tmp_path, monkeypatch
):
    selected, *_rest = preview
    request_value = PrivatePrepare(
        opening=PrivateOpening.model_validate(opening(preview)), profile_hash="sha256:" + "f" * 64
    )
    owner = native_preview_owner._Prepared(
        selected.repository,
        request_value,
        native_preview_owner.NativeRelease("{}", "{}"),
        lambda *_: None,
    )
    owner.cwd, owner.env = tmp_path, {}
    owner.source = prepare_native_preview_sources(
        selected.repository, request_value.opening.plan, private_session=tmp_path
    )
    snapshots = [s.path for s in owner.source.sources]
    owner.material = {
        "profile_hash": request_value.profile_hash,
        "profile": {"host_file": "host.exe"},
        "runtime_root": str(tmp_path),
        "framework_path": str(tmp_path / "mlt.dll"),
        "module_directory": str(tmp_path / "modules"),
        "data_directory": str(tmp_path / "data"),
        "runtime_files": [],
        "sources": [
            {
                "asset_id": s.asset_id,
                "asset_version_id": s.asset_version_id,
                "path": str(s.path),
                "sha256": s.sha256,
                "byte_size": s.byte_size,
            }
            for s in owner.source.sources
        ],
    }
    expected = encode_opening(request_value.opening, owner.material)
    calls = []

    def held(_api, path, _sha, _size):
        return owner.held.enter_context(path.open("rb"))

    def dispatch(_exe, held_opening, _cwd, _env):
        assert held_opening.read() == expected
        with sqlite3.connect(selected.repository.database_path, timeout=0) as writer:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                writer.execute("BEGIN IMMEDIATE")
        calls.append("exact-held-open-under-writer-gate")

    monkeypatch.setattr(native_preview_owner.protected, "_api", lambda: None)
    monkeypatch.setattr(owner, "_hold", held)
    owner.job = SimpleNamespace(
        start=dispatch, request_stop=lambda: None, stop_and_wait=lambda _timeout: None
    )
    try:
        with pytest.raises(ValueError, match="differs"):
            owner.launch(expected + b"wrong")
        assert calls == [] and not owner.launched
        owner.launch(expected)
        assert calls == ["exact-held-open-under-writer-gate"] and owner.launched
        with pytest.raises(ValueError, match="again"):
            owner.launch(expected)
        with pytest.raises(native_preview_owner.NativeJobError):
            owner.dispose()
        assert all(p.exists() for p in snapshots)
        owner.stop()
        owner.dispose()
        assert not any(p.exists() for p in snapshots)
    finally:
        owner.stop()
        owner.dispose()
