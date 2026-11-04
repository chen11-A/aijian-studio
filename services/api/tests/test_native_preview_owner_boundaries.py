"""Controlled owner boundaries only; no release admission or native execution."""

import base64
import io
import json
import struct
import threading
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import native_preview_owner as native


def reviewed_material():
    receipt = {"test_receipt": "controlled-policy-not-a-release"}
    profile = {
        "distribution_status": "REVIEWED_RELEASE",
        "schema_version": 1,
        "host_file": "aivora-mlt-preview-host.exe",
        "network_disabled_build": True,
        "pe_closure_receipt_sha256": native.digest(receipt).removeprefix("sha256:"),
        "license_source_receipt_sha256": "a" * 64,
        "files": [
            {"relative_path": f"file-{index}.dll", "byte_size": 1, "sha256": "b" * 64}
            for index in range(6)
        ]
        + [
            {
                "relative_path": "licenses\\source-build-receipt.json",
                "byte_size": 1,
                "sha256": "a" * 64,
            }
        ],
    }
    return profile, receipt


def policy(profile, receipt):
    return native.NativeRelease(json.dumps(profile), json.dumps(receipt))


def test_profile_binds_full_profile_and_receipt_digests():
    profile, receipt = reviewed_material()
    release = policy(profile, receipt)
    assert native._profile(release, native.digest(profile)) == (profile, receipt)
    with pytest.raises(native.NativePreviewUnavailable, match="digest"):
        native._profile(release, "sha256:" + "0" * 64)
    profile["pe_closure_receipt_sha256"] = "0" * 64
    with pytest.raises(native.NativePreviewUnavailable, match="digest"):
        native._profile(policy(profile, receipt), native.digest(profile))
    assert native.ADMITTED_NATIVE_RELEASES == ()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("distribution_status", "DEVELOPMENT_ONLY"),
        ("schema_version", 2),
        ("host_file", "other.exe"),
        ("network_disabled_build", False),
        ("files", []),
    ],
)
def test_unreviewed_or_incomplete_profile_is_refused(field, value):
    profile, receipt = reviewed_material()
    profile[field] = value
    with pytest.raises(native.NativePreviewUnavailable, match="closed reviewed"):
        native._profile(policy(profile, receipt), native.digest(profile))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("relative_path", 5),
        ("relative_path", "../outside.dll"),
        ("relative_path", "..\\outside.dll"),
        ("relative_path", "file-1.dll"),
        ("byte_size", True),
        ("byte_size", "1"),
        ("byte_size", 0),
        ("byte_size", 512 * 1024 * 1024 + 1),
        ("sha256", None),
        ("sha256", "F" * 64),
        ("extra", "not allowed"),
    ],
)
def test_unsafe_inventory_is_refused(field, value):
    profile, receipt = reviewed_material()
    profile["files"][0][field] = value
    with pytest.raises(native.NativePreviewUnavailable, match="inventory"):
        native._profile(policy(profile, receipt), native.digest(profile))


@pytest.mark.parametrize("fault", ["total-size", "missing-receipt", "wrong-receipt"])
def test_size_budget_and_exact_source_receipt_are_required(fault):
    profile, receipt = reviewed_material()
    if fault == "total-size":
        for file in profile["files"]:
            file["byte_size"] = 512 * 1024 * 1024
    elif fault == "missing-receipt":
        profile["files"][-1]["relative_path"] = "licenses\\other.json"
    else:
        profile["license_source_receipt_sha256"] = "f" * 64
    with pytest.raises(native.NativePreviewUnavailable, match="receipt"):
        native._profile(policy(profile, receipt), native.digest(profile))


@pytest.fixture
def owned():
    manager = native.NativePreviewOwner(None, Mock())
    lease = "npl_" + "c" * 32
    owner = Mock()
    owner.job._closing = threading.Event()
    manager._leases[lease] = owner
    manager._sequences[lease] = 0
    return manager, owner, lease


@pytest.mark.parametrize("payload", [None, [], {}, {"lease_id": "invalid"}])
def test_invalid_lease_never_reaches_owner(owned, payload):
    manager, owner, _ = owned
    assert manager.dispatch("read", payload) == {"kind": "REFUSED"}
    assert owner.mock_calls == []


def test_unknown_closed_or_extra_field_requests_are_refused(owned):
    manager, owner, lease = owned
    assert manager.dispatch("stop", {"lease_id": "npl_" + "d" * 32}) == {"kind": "REFUSED"}
    assert manager.dispatch("unknown", {"lease_id": lease}) == {"kind": "REFUSED"}
    assert manager.dispatch("stop", {"lease_id": lease, "extra": True}) == {"kind": "REFUSED"}
    manager._closing = True
    assert manager.dispatch("read", {"lease_id": lease}) == {"kind": "REFUSED"}
    assert owner.mock_calls == []


@pytest.mark.parametrize(
    ("field", "value"), [("offset", True), ("length", "1"), ("relative_path", None)]
)
def test_read_rejects_wrong_types_before_held_bytes(owned, field, value):
    manager, owner, lease = owned
    payload = {"lease_id": lease, "relative_path": "host.exe", "offset": 0, "length": 1}
    payload[field] = value
    assert manager.dispatch("read", payload) == {"kind": "REFUSED"}
    owner.read.assert_not_called()


def test_read_returns_only_requested_owned_chunk(owned):
    manager, owner, lease = owned
    owner.read.return_value = "YWJj"
    assert manager.dispatch(
        "read", {"lease_id": lease, "relative_path": "host.exe", "offset": 3, "length": 3}
    ) == {"kind": "OK", "value": {"lease_id": lease, "bytes": "YWJj"}}
    owner.read.assert_called_once_with("host.exe", 3, 3)


@pytest.mark.parametrize(
    "value",
    [None, "x" * 174773, "", "YWJj", "AAAAAAEAAAADAAAA"],
    ids=["not-text", "oversized", "empty", "short", "wrong-size-prefix"],
)
def test_invalid_packet_never_dispatches(owned, value):
    manager, owner, lease = owned
    assert manager.dispatch("launch", {"lease_id": lease, "bytes": value}) == {"kind": "REFUSED"}
    owner.launch.assert_not_called()
    owner.job.write.assert_not_called()


@pytest.mark.parametrize("operation", ["launch", "write"])
def test_valid_packet_routes_to_exact_owner(owned, operation):
    manager, owner, lease = owned
    packet = struct.pack("<III", 8, 1, 3)
    assert manager.dispatch(
        operation, {"lease_id": lease, "bytes": base64.b64encode(packet).decode()}
    ) == {"kind": "OK", "value": {"lease_id": lease}}
    if operation == "launch":
        owner.launch.assert_called_once_with(packet)
        owner.job.write.assert_not_called()
    else:
        owner.job.write.assert_called_once_with(packet)
        owner.launch.assert_not_called()


def test_write_cannot_replay_an_open_packet(owned):
    manager, owner, lease = owned
    packet = struct.pack("<III", 8, 1, 1)
    assert manager.dispatch(
        "write", {"lease_id": lease, "bytes": base64.b64encode(packet).decode()}
    ) == {"kind": "REFUSED"}
    owner.job.write.assert_not_called()


def test_stop_receipt_and_release_require_successful_owner_operations(owned):
    manager, owner, lease = owned
    manager._closing = True
    owner.stop.side_effect = native.NativeJobError("pending")
    with pytest.raises(native.NativeJobError):
        manager.dispatch("stop", {"lease_id": lease})
    assert lease in manager._leases
    owner.stop.side_effect = None
    result = manager.dispatch("stop", {"lease_id": lease})
    assert result["value"] == {
        "lease_id": lease,
        "start_settled": True,
        "zero_active": True,
        "readers_joined": True,
        "owner_closed": True,
    }
    owner.dispose.side_effect = native.NativeJobError("still owned")
    with pytest.raises(native.NativeJobError):
        manager.dispatch("release", {"lease_id": lease})
    assert lease in manager._leases and lease in manager._sequences
    owner.dispose.side_effect = None
    assert manager.dispatch("release", {"lease_id": lease})["kind"] == "OK"
    assert manager._leases == manager._sequences == {}


def test_output_sequences_stop_at_cancellation(owned):
    manager, owner, lease = owned
    manager._output(lease, "stdout", b"first")
    manager._output(lease, "stderr", b"second")
    owner.job._closing.set()
    manager._output(lease, "exit", b"")
    assert manager.stream.call_args_list == [
        ((lease, 1, "stdout", b"first"),),
        ((lease, 2, "stderr", b"second"),),
    ]
    assert manager._sequences[lease] == 2


def test_shutdown_continues_cleanup_but_retains_unknown_owners(owned):
    manager, owner, _ = owned
    other = Mock()
    manager._leases["npl_" + "e" * 32] = other
    owner.stop.side_effect = native.NativeJobError("not stopped")
    with pytest.raises(native.NativeJobError, match="retain"):
        manager.shutdown_and_wait(0)
    assert manager._closing and len(manager._leases) == 2
    owner.dispose.assert_not_called()
    other.stop.assert_called_once_with(0)
    other.dispose.assert_called_once()


@pytest.mark.parametrize(("offset", "length"), [(-1, 1), (4, 1), (0, 0), (0, 65537), (2, 3)])
def test_held_read_bounds_never_leak_bytes(offset, length):
    owner = native._Prepared(None, None, None, lambda *_: None)
    owner.files["host.exe"] = io.BytesIO(b"abcd")
    owner.material = {"profile": {"files": [{"relative_path": "host.exe", "byte_size": 4}]}}
    with pytest.raises(ValueError):
        owner.read("host.exe", offset, length)


def test_truncated_held_read_and_released_owner_are_refused():
    owner = native._Prepared(None, None, None, lambda *_: None)
    owner.files["host.exe"] = io.BytesIO(b"a")
    owner.material = {"profile": {"files": [{"relative_path": "host.exe", "byte_size": 4}]}}
    with pytest.raises(ValueError, match="truncated"):
        owner.read("host.exe", 0, 4)
    owner.released = True
    with pytest.raises(ValueError, match="unavailable"):
        owner.read("host.exe", 0, 1)
    owner.dispose()


def test_unlaunched_disposal_proves_stop_before_source_release():
    owner = native._Prepared(None, None, None, lambda *_: None)
    calls = []
    owner.job = SimpleNamespace(
        request_stop=lambda: calls.append("cancel"),
        stop_and_wait=lambda _: calls.append("stopped"),
    )
    owner.source = SimpleNamespace(release=lambda **kwargs: calls.append(("source", kwargs)))
    owner.held.callback(lambda: calls.append("held"))
    owner.session.callback(lambda: calls.append("session"))
    owner.dispose()
    owner.dispose()
    assert calls == [
        "cancel",
        "stopped",
        "held",
        ("source", {"owned_processes_stopped": True}),
        "session",
    ]
    assert owner.released and owner.stopped


@pytest.mark.parametrize(
    "outcome", ["success", "prepare-failed", "stop-unknown", "dispose-unknown"]
)
def test_manager_registers_before_prepare_and_retains_uncertain_cleanup(monkeypatch, outcome):
    # Parsing/opening checks have separate real-model tests. Isolate ownership
    # registration here without creating any native or database resources.
    profile, receipt = reviewed_material()
    release = policy(profile, receipt)
    request = SimpleNamespace(profile_hash=native.digest(profile), opening=Mock())
    monkeypatch.setattr(native, "PrivatePrepare", SimpleNamespace(model_validate=lambda _: request))
    monkeypatch.setattr(native, "ADMITTED_NATIVE_RELEASES", (release,))
    manager = native.NativePreviewOwner(None, Mock())
    owner = Mock()

    def prepare():
        assert list(manager._leases.values()) == [owner]
        assert list(manager._sequences.values()) == [0]
        if outcome != "success":
            raise native.NativePreviewUnavailable("controlled material failure")
        return {"material": {"test": "owned"}, "pe_receipt": receipt}

    owner.prepare.side_effect = prepare
    if outcome == "stop-unknown":
        owner.stop.side_effect = native.NativeJobError("still pending")
    if outcome == "dispose-unknown":
        owner.dispose.side_effect = native.NativeJobError("still retained")
    monkeypatch.setattr(native, "_Prepared", lambda *_: owner)
    result = manager.dispatch("prepare", {})
    if outcome == "success":
        assert result["kind"] == "OK" and result["value"]["material"] == {"test": "owned"}
        assert result["value"]["lease_id"] in manager._leases
        owner.stop.assert_not_called()
    elif outcome == "prepare-failed":
        assert result == {"kind": "REFUSED"}
        assert manager._leases == manager._sequences == {}
        owner.stop.assert_called_once()
        owner.dispose.assert_called_once()
    else:
        assert result == {"kind": "UNKNOWN"}
        assert list(manager._leases.values()) == [owner]


@pytest.mark.parametrize("condition", ["capacity", "closing", "ambiguous"])
def test_manager_refuses_new_resources_when_policy_or_ownership_is_unavailable(
    monkeypatch, condition
):
    profile, receipt = reviewed_material()
    release = policy(profile, receipt)
    request = SimpleNamespace(profile_hash=native.digest(profile), opening=Mock())
    monkeypatch.setattr(native, "PrivatePrepare", SimpleNamespace(model_validate=lambda _: request))
    monkeypatch.setattr(
        native, "ADMITTED_NATIVE_RELEASES", (release,) * (2 if condition == "ambiguous" else 1)
    )
    monkeypatch.setattr(native, "_Prepared", lambda *_: pytest.fail("No resource allocation"))
    manager = native.NativePreviewOwner(None, Mock())
    if condition == "capacity":
        manager._leases = {str(index): Mock() for index in range(4)}
    manager._closing = condition == "closing"
    assert manager.dispatch("prepare", {}) == {
        "kind": "UNAVAILABLE" if condition == "ambiguous" else "REFUSED"
    }


def test_held_directory_deduplication_and_bound(monkeypatch, tmp_path):
    owner = native._Prepared(None, None, None, lambda *_: None)
    hold = Mock(side_effect=lambda *_: nullcontext())
    monkeypatch.setattr(native.protected, "_hold_directory", hold)
    owner._hold_directories(None, tmp_path)
    first_count = hold.call_count
    owner._hold_directories(None, tmp_path)
    assert hold.call_count == first_count == len(tmp_path.parents) + 1
    owner._directories = {Path(f"controlled-{index}") for index in range(4096)}
    with pytest.raises(native.NativePreviewUnavailable, match="directory count"):
        owner._hold_directories(None, tmp_path / "new")
    assert hold.call_count == first_count
    owner.held.close()


@pytest.mark.parametrize("fault", ["size", "hash", "none"])
def test_held_material_requires_exact_size_and_hash(monkeypatch, tmp_path, fault):
    owner = native._Prepared(None, None, None, lambda *_: None)
    stream = io.BytesIO(b"held material")
    monkeypatch.setattr(owner, "_hold_directories", lambda *_: None)
    monkeypatch.setattr(native.protected, "_hold_executable", lambda *_: nullcontext(stream))
    actual_hash = native.hashlib.sha256(stream.getvalue()).hexdigest()
    if fault == "none":
        assert owner._hold(None, tmp_path / "material", actual_hash, 13) is stream
        assert stream.tell() == 0
    else:
        with pytest.raises(native.NativePreviewUnavailable, match="held bytes"):
            owner._hold(
                None,
                tmp_path / "material",
                "0" * 64 if fault == "hash" else actual_hash,
                12 if fault == "size" else 13,
            )
    owner.held.close()


@pytest.mark.parametrize("installed", [False, True])
def test_only_installed_windows_sidecar_can_resolve_native_release(
    monkeypatch, tmp_path, installed
):
    monkeypatch.setattr(native, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(native, "sys", SimpleNamespace(frozen=installed))
    lock = Mock(return_value=tmp_path / "media" / "lock.json")
    monkeypatch.setattr(native, "media_toolchain_lock_path", lock)
    if installed:
        assert native._installed_root() == tmp_path / "native" / "mlt-preview-v1"
    else:
        with pytest.raises(native.NativePreviewUnavailable, match="installed Windows"):
            native._installed_root()
        lock.assert_not_called()


def test_prepare_maps_exact_runtime_and_sources_while_deduplicating_originals(
    monkeypatch, tmp_path
):
    profile, receipt = reviewed_material()
    profile["framework_file"] = "file-0.dll"
    opening = SimpleNamespace(check=Mock(), plan=object())
    request = SimpleNamespace(opening=opening, profile_hash=native.digest(profile))
    repository = SimpleNamespace(database_path=tmp_path / "workspace.db")
    owner = native._Prepared(repository, request, policy(profile, receipt), lambda *_: None)
    sources = tuple(
        SimpleNamespace(
            asset_id=f"asset-{index}",
            asset_version_id=f"version-{index}",
            sha256="a" * 64,
            byte_size=3,
            path=tmp_path / f"snapshot-{index}",
        )
        for index in range(2)
    )
    lease = SimpleNamespace(sources=sources)
    runtime = tmp_path / "runtime"
    monkeypatch.setattr(native, "_installed_root", lambda: runtime)
    monkeypatch.setattr(
        native.protected, "external_process_session", lambda: nullcontext((tmp_path, {}))
    )
    monkeypatch.setattr(native, "prepare_native_preview_sources", lambda *_, **__: lease)
    monkeypatch.setattr(native.protected, "_api", lambda: None)
    held = Mock(side_effect=lambda *_: io.BytesIO(b"held"))
    monkeypatch.setattr(owner, "_hold", held)
    monkeypatch.setattr(owner, "_hold_directories", Mock())
    encoder = Mock(return_value=b"controlled-open")
    monkeypatch.setattr(native, "encode_opening", encoder)
    result = owner.prepare()
    assert result["pe_receipt"] == receipt and result["material"] is owner.material
    assert len(owner.files) == len(profile["files"]) == 7
    assert [item["asset_id"] for item in owner.material["sources"]] == ["asset-0", "asset-1"]
    paths = [call.args[1] for call in held.call_args_list]
    original = tmp_path / "media-assets" / "blobs" / "aa" / ("a" * 64)
    assert paths.count(original) == 1
    assert all(paths.count(source.path) == 1 for source in sources)
    encoder.assert_called_once_with(opening, owner.material)
    opening.check.assert_called_once()
    owner.held.close()
    owner.session.close()


def test_pending_preparation_cancels_job_without_claiming_stopped():
    owner = native._Prepared(None, None, None, lambda *_: None)
    owner.job = Mock()
    owner.lock = Mock()
    owner.lock.acquire.return_value = False
    with pytest.raises(native.NativeJobError, match="still pending"):
        owner.stop(0)
    owner.job.request_stop.assert_called_once()
    owner.job.stop_and_wait.assert_not_called()
    assert not owner.stopped and not owner.released
