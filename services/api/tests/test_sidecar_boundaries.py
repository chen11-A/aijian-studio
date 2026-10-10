"""Offline sidecar composition and cleanup; no server, engine, or credential access."""

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import sidecar
from aijian_api.remote_settlement_contracts import DenyRemoteSettlementVerifier
from aijian_api.remote_source_extract_runtime import RemoteSourceExtractComposition


@pytest.fixture
def process(tmp_path, monkeypatch):
    owner, listener, server = Mock(), Mock(), Mock()
    repository = SimpleNamespace(database_path=tmp_path / "unused.sqlite3")
    resources = {
        name: Mock(name=name)
        for name in (
            "draft",
            "product",
            "jobs",
            "fake",
            "timeline",
            "remote",
            "sub2",
        )
    }
    substitutions = {
        "default_database_path": Mock(return_value=repository.database_path),
        "acquire_workspace_owner_lock": Mock(return_value=owner),
        "create_listener": Mock(return_value=(listener, 43123)),
        "create_token": Mock(return_value="synthetic" * 8),
        "StudioRepository": Mock(return_value=repository),
        "ProductExportJobManager": Mock(return_value=resources["jobs"]),
        "LocalMediaToolchainService": Mock(),
        "machine_settings_path": Mock(),
        "DraftExportRuntime": Mock(return_value=resources["draft"]),
        "ProductExportRuntime": Mock(return_value=resources["product"]),
        "SystemCredentialVault": Mock(),
        "create_app": Mock(),
        "create_local_fake_worker": Mock(return_value=resources["fake"]),
        "create_local_fake_timeline_runtime": Mock(return_value=(Mock(), resources["timeline"])),
        "create_remote_source_extract_runtime": Mock(return_value=resources["remote"]),
        "create_sub2api_source_extract_runtime": Mock(return_value=resources["sub2"]),
        "threading": SimpleNamespace(Thread=Mock()),
        "uvicorn": SimpleNamespace(Config=Mock(), Server=Mock(return_value=server)),
    }
    for name, value in substitutions.items():
        monkeypatch.setattr(sidecar, name, value)
    monkeypatch.setenv("AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME", "1")
    return SimpleNamespace(
        owner=owner,
        listener=listener,
        server=server,
        resources=resources,
        substitutions=substitutions,
    )


SHUTDOWN = [
    ("draft", "stop_accepting"),
    ("product", "stop_accepting"),
    ("jobs", "shutdown_and_wait"),
    ("product", "join_workers"),
    ("draft", "join_workers"),
    ("sub2", "stop"),
    ("remote", "stop"),
    ("timeline", "stop"),
    ("fake", "stop"),
]


@pytest.mark.parametrize("resource,method", SHUTDOWN)
def test_shutdown_error_retains_owner_but_still_cleans_every_resource(process, resource, method):
    error = RuntimeError("synthetic shutdown failure")
    getattr(process.resources[resource], method).side_effect = error
    with pytest.raises(RuntimeError) as caught:
        sidecar.run()
    assert caught.value is error
    for name, operation in SHUTDOWN:
        getattr(process.resources[name], operation).assert_called_once_with()
    process.listener.close.assert_called_once_with()
    process.owner.release.assert_not_called()


def test_all_cleanup_failures_preserve_first_error_and_owner(process):
    errors = [RuntimeError(f"synthetic failure {index}") for index in range(len(SHUTDOWN))]
    for (name, operation), error in zip(SHUTDOWN, errors, strict=True):
        getattr(process.resources[name], operation).side_effect = error
    with pytest.raises(RuntimeError) as caught:
        sidecar.run()
    assert caught.value is errors[0]
    for name, operation in SHUTDOWN:
        getattr(process.resources[name], operation).assert_called_once_with()
    process.listener.close.assert_called_once_with()
    process.owner.release.assert_not_called()


def test_normal_cleanup_releases_owner_only_after_every_runtime_stops(process):
    parent = Mock()
    for index, (name, operation) in enumerate(SHUTDOWN):
        parent.attach_mock(getattr(process.resources[name], operation), f"cleanup_{index}")
    parent.attach_mock(process.listener.close, "close_listener")
    parent.attach_mock(process.owner.release, "release_owner")
    sidecar.run()
    for name in ("fake", "timeline", "remote", "sub2"):
        process.resources[name].start.assert_called_once_with()
    for name, operation in SHUTDOWN:
        getattr(process.resources[name], operation).assert_called_once_with()
    process.listener.close.assert_called_once_with()
    process.owner.release.assert_called_once_with()
    assert [entry[0] for entry in parent.mock_calls] == [
        *(f"cleanup_{index}" for index in range(len(SHUTDOWN))),
        "close_listener",
        "release_owner",
    ]


def test_busy_workspace_stops_before_listener_or_repository(process, capsys):
    process.substitutions[
        "acquire_workspace_owner_lock"
    ].side_effect = sidecar.WorkspaceLockBusyError("synthetic busy owner")
    with pytest.raises(SystemExit) as caught:
        sidecar.run()
    assert caught.value.code == 73
    assert capsys.readouterr().err.strip() == "AIVORA_STARTUP_WORKSPACE_BUSY"
    process.substitutions["create_listener"].assert_not_called()
    process.substitutions["StudioRepository"].assert_not_called()


@pytest.mark.parametrize(
    "failed", ["create_listener", "DraftExportRuntime", "ProductExportRuntime"]
)
def test_partial_initialization_releases_owner_without_starting_workers(process, failed):
    process.substitutions[failed].side_effect = RuntimeError("synthetic setup failure")
    with pytest.raises(RuntimeError, match="synthetic setup failure"):
        sidecar.run()
    process.owner.release.assert_called_once_with()
    for name in ("fake", "timeline", "remote", "sub2"):
        process.resources[name].start.assert_not_called()
        process.resources[name].stop.assert_not_called()
    if failed != "create_listener":
        process.listener.close.assert_called_once_with()


def composed():
    return RemoteSourceExtractComposition(
        bindings=SimpleNamespace(next_ready=lambda **_: None),
        composition_policy_reader=lambda: None,
        settlement_source=SimpleNamespace(read=lambda *_: None),
        settlement_verifier=SimpleNamespace(verify=lambda *_: None),
        credentials=SimpleNamespace(get=lambda *_: None),
    )


@pytest.mark.parametrize(
    "field",
    [
        "bindings",
        "composition_policy_reader",
        "settlement_source",
        "settlement_verifier",
        "credentials",
    ],
)
@pytest.mark.parametrize("invalid", [None, object()])
def test_remote_composition_rejects_missing_or_noncallable_dependencies(field, invalid):
    value = replace(composed(), **{field: invalid})
    assert (
        sidecar.remote_source_extract_availability(value) == "TRUSTED_REMOTE_DEPENDENCY_UNAVAILABLE"
    )
    repository = Mock()
    assert sidecar.create_remote_source_extract_runtime(repository, composition=value) is None
    assert repository.mock_calls == []


def test_deny_settlement_verifier_cannot_enable_remote_composition():
    value = replace(composed(), settlement_verifier=DenyRemoteSettlementVerifier())
    assert (
        sidecar.remote_source_extract_availability(value) == "TRUSTED_REMOTE_DEPENDENCY_UNAVAILABLE"
    )
    assert sidecar.remote_source_extract_availability(composed()) == (
        "CONFIGURED_PENDING_PER_TASK_AUTHORIZATION"
    )


def test_remote_composition_builds_but_never_starts_or_dispatches(tmp_path, monkeypatch):
    names = (
        "LocalTaskLedger",
        "ProviderConnectionRepository",
        "RemoteExecutionAuthorizationStore",
        "SourceExtractInvocationBuilder",
        "GatewayTextTransport",
        "RemoteSourceExtractWorker",
        "RemoteSourceExtractRuntime",
    )
    constructors = {name: Mock() for name in names}
    for name, constructor in constructors.items():
        monkeypatch.setattr(sidecar, name, constructor)
    composition = composed()
    result = sidecar.create_remote_source_extract_runtime(
        SimpleNamespace(database_path=tmp_path / "unused.sqlite3"), composition=composition
    )
    assert result is constructors["RemoteSourceExtractRuntime"].return_value
    assert (
        constructors["RemoteExecutionAuthorizationStore"].call_args.kwargs["settlement_verifier"]
        is composition.settlement_verifier
    )
    assert (
        constructors["RemoteSourceExtractWorker"].call_args.kwargs["transport"]
        is constructors["GatewayTextTransport"].return_value
    )
    result.start.assert_not_called()
    constructors["RemoteSourceExtractWorker"].return_value.execute.assert_not_called()


@pytest.mark.parametrize(
    "failure", [None, OSError("test io"), sidecar.WorkspaceBackupError("test")]
)
def test_backup_command_reports_receipt_or_error_without_claiming_partial_success(
    tmp_path, monkeypatch, capsys, failure
):
    receipt = {"event": "backup-complete", "file_count": 1}
    backup = Mock(return_value=receipt, side_effect=failure)
    monkeypatch.setattr(sidecar, "backup_workspace", backup)
    result = sidecar.backup_command(
        [
            "--backup-workspace",
            str(tmp_path / "workspace"),
            "--output",
            str(tmp_path / "backup"),
        ]
    )
    output = capsys.readouterr()
    if failure is None:
        import json

        assert result == 0
        assert json.loads(output.out) == receipt
        assert not output.err
    else:
        assert result == 1
        assert "workspace backup failed" in output.err
        assert not output.out


@pytest.mark.parametrize("kind", ["relative", "missing", "wrong-type", "resolved", "junction"])
def test_backup_source_requires_plain_absolute_directory(tmp_path, monkeypatch, kind):
    path = tmp_path / "workspace"
    path.mkdir()
    if kind == "relative":
        path = Path("relative-workspace")
    elif kind == "missing":
        path = tmp_path / "absent"
    elif kind == "wrong-type":
        path = tmp_path / "file"
        path.write_bytes(b"synthetic")
    elif kind == "resolved":
        original = Path.resolve
        monkeypatch.setattr(
            Path, "resolve", lambda p, **kw: tmp_path / "other" if p == path else original(p, **kw)
        )
    else:
        monkeypatch.setattr(Path, "is_junction", lambda p: p == path)
    with pytest.raises(sidecar.WorkspaceBackupError):
        sidecar._plain_existing_path(path, directory=True)


@pytest.mark.parametrize("kind", ["relative", "exists", "nested", "parent", "wrong-source-name"])
def test_backup_rejects_unsafe_destination_before_creating_output(tmp_path, kind):
    source = tmp_path / ("wrong-name" if kind == "wrong-source-name" else "workspace")
    source.mkdir()
    (source / "workspace.sqlite3").write_bytes(b"not opened in rejected preflight")
    output = tmp_path / "new-backup"
    if kind == "relative":
        output = Path("relative-backup")
    elif kind == "exists":
        output.mkdir()
    elif kind == "nested":
        output = source / "backup"
    elif kind == "parent":
        output = tmp_path
    with pytest.raises(sidecar.WorkspaceBackupError):
        sidecar.backup_workspace(source, output)
    assert not (output / "receipt.json").exists()


@pytest.mark.parametrize("stage", ["before", "during", "readback"])
def test_backup_copy_rejects_drift_and_never_returns_verified_detail(tmp_path, monkeypatch, stage):
    source, target = tmp_path / "source", tmp_path / "target"
    source.write_bytes(b"synthetic bytes")
    info = source.stat()
    fingerprint = ("file", info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino)
    if stage == "before":
        fingerprint = ("file", info.st_size + 1, info.st_mtime_ns, info.st_dev, info.st_ino)
    elif stage == "during":
        changed = SimpleNamespace(
            st_size=info.st_size + 1,
            st_mtime_ns=info.st_mtime_ns,
            st_dev=info.st_dev,
            st_ino=info.st_ino,
        )
        monkeypatch.setattr(
            sidecar,
            "os",
            SimpleNamespace(
                fstat=Mock(side_effect=[info, changed]),
                fsync=lambda _: None,
            ),
        )
    else:
        monkeypatch.setattr(sidecar, "_file_digest", lambda _: ("wrong", 0))
    with pytest.raises(sidecar.WorkspaceBackupError):
        sidecar._copy_verified(source, target, fingerprint)
    assert source.read_bytes() == b"synthetic bytes"


def test_plain_copy_returns_digest_and_never_overwrites_existing_target(tmp_path):
    import hashlib

    source, target = tmp_path / "source", tmp_path / "target"
    source.write_bytes(b"synthetic bytes")
    info = source.stat()
    fingerprint = ("file", info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino)
    assert sidecar._copy_verified(source, target, fingerprint) == {
        "sha256": hashlib.sha256(b"synthetic bytes").hexdigest(),
        "byte_size": info.st_size,
    }
    with pytest.raises(FileExistsError):
        sidecar._copy_verified(source, target, fingerprint)
    assert target.read_bytes() == source.read_bytes()
