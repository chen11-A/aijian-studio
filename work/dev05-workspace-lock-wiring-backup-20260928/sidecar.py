"""Electron-managed FastAPI sidecar and offline workspace backup entrypoint."""

import argparse
import hashlib
import json
import logging
import os
import secrets
import sqlite3
import socket
import stat
import sys
import threading
from collections.abc import Mapping
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

import uvicorn

from aijian_api.credential_vault import CredentialVault, SystemCredentialVault
from aijian_api.fake_media_package import FakeMediaPackageGenerator
from aijian_api.fake_timeline_run import FakeTimelineRunFactory, LocalFakeTimelineWorker
from aijian_api.gateway_transport import GatewayTextTransport
from aijian_api.main import create_app, default_database_path
from aijian_api.media_toolchain import discover_media_toolchain, load_media_toolchain_lock
from aijian_api.provider_connection_repository import ProviderConnectionRepository
from aijian_api.remote_execution_authorization import RemoteExecutionAuthorizationStore
from aijian_api.remote_settlement_contracts import DenyRemoteSettlementVerifier
from aijian_api.remote_source_extract_runtime import (
    RemoteSourceExtractComposition,
    RemoteSourceExtractRuntime,
)
from aijian_api.remote_source_extract_worker import RemoteSourceExtractWorker
from aijian_api.repository import StudioRepository
from aijian_api.runtime_resources import media_tool_root, media_toolchain_lock_path
from aijian_api.security import SIDECAR_ORIGIN, SidecarSecurity
from aijian_api.source_extract_worker import (
    LocalFakeSourceExtractWorker,
    SourceExtractInvocationBuilder,
)
from aijian_api.sub2api_source_extract_invocation import (
    Sub2APISourceExtractInvocationBuilder,
)
from aijian_api.sub2api_source_extract_proposal import build_sub2api_source_extract_proposal
from aijian_api.sub2api_source_extract_runtime import Sub2APISourceExtractRuntime
from aijian_api.sub2api_source_extract_store import Sub2APISourceExtractStore
from aijian_api.sub2api_source_extract_worker import Sub2APISourceExtractWorker
from aijian_api.sub2api_text_transport import Sub2APITextTransport
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_models import new_id

PROTOCOL_VERSION = 1
SIDECAR_HOST = "127.0.0.1"
_LOGGER = logging.getLogger(__name__)
_BACKUP_DIRECTORIES = ("media-assets", "fake-media", "exports")
_SQLITE_SIDECARS = frozenset(
    {"workspace.sqlite3-wal", "workspace.sqlite3-shm", "workspace.sqlite3-journal"}
)


class WorkspaceBackupError(RuntimeError):
    """The offline backup did not produce a verified receipt."""


def _plain_existing_path(path: Path, *, directory: bool) -> None:
    if not path.is_absolute() or ".." in path.parts or str(path).startswith("\\\\"):
        raise WorkspaceBackupError("Backup path must be a plain absolute local path")
    cursor = path
    while True:
        if cursor.is_symlink() or getattr(cursor, "is_junction", lambda: False)():
            raise WorkspaceBackupError("Backup path contains a link or junction")
        if cursor == cursor.parent:
            break
        cursor = cursor.parent
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise WorkspaceBackupError("Backup path is unavailable") from error
    if os.path.normcase(str(resolved)) != os.path.normcase(str(path)):
        raise WorkspaceBackupError("Backup path changes when resolved")
    if directory and not path.is_dir() or not directory and not path.is_file():
        raise WorkspaceBackupError("Backup path has the wrong file type")


def _inventory(workspace: Path) -> dict[str, tuple[str, int, int, int, int]]:
    """Enumerate every supported media file without following links."""

    allowed = {"workspace.sqlite3", *_SQLITE_SIDECARS, *_BACKUP_DIRECTORIES}
    if any(child.name not in allowed for child in workspace.iterdir()):
        raise WorkspaceBackupError("Workspace contains an unsupported top-level entry")
    for name in _SQLITE_SIDECARS:
        path = workspace / name
        if os.path.lexists(path):
            _plain_existing_path(path, directory=False)
    inventory: dict[str, tuple[str, int, int, int, int]] = {}

    def visit(path: Path) -> None:
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise WorkspaceBackupError("Workspace contains a link or junction")
        info = path.stat(follow_symlinks=False)
        relative = path.relative_to(workspace).as_posix()
        if stat.S_ISDIR(info.st_mode):
            inventory[relative] = ("dir", 0, info.st_mtime_ns, info.st_dev, info.st_ino)
            for child in sorted(path.iterdir(), key=lambda item: item.name):
                visit(child)
        elif stat.S_ISREG(info.st_mode):
            inventory[relative] = (
                "file", info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino,
            )
        else:
            raise WorkspaceBackupError("Workspace contains an unsupported file type")

    for name in _BACKUP_DIRECTORIES:
        root = workspace / name
        if os.path.lexists(root):
            visit(root)
    return inventory


def _file_digest(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            total += len(chunk)
    return digest.hexdigest(), total


def _copy_verified(source: Path, target: Path, fingerprint: tuple[str, int, int, int, int]) -> dict[str, object]:
    digest = hashlib.sha256()
    total = 0
    with source.open("rb") as reader, target.open("xb") as writer:
        before = os.fstat(reader.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_size, before.st_mtime_ns, before.st_dev, before.st_ino)
            != fingerprint[1:]
        ):
            raise WorkspaceBackupError("Source media changed before copy")
        while chunk := reader.read(1024 * 1024):
            writer.write(chunk)
            digest.update(chunk)
            total += len(chunk)
        writer.flush()
        os.fsync(writer.fileno())
        after = os.fstat(reader.fileno())
        if (
            (after.st_size, after.st_mtime_ns, after.st_dev, after.st_ino)
            != fingerprint[1:]
            or total != fingerprint[1]
        ):
            raise WorkspaceBackupError("Source media changed during copy")
    if _file_digest(target) != (digest.hexdigest(), total):
        raise WorkspaceBackupError("Copied media failed readback")
    return {"sha256": digest.hexdigest(), "byte_size": total}


def backup_workspace(workspace: Path, output: Path) -> dict[str, object]:
    """Back up a stopped app's known workspace without opening its repository."""

    _plain_existing_path(workspace, directory=True)
    if workspace.name != "workspace":
        raise WorkspaceBackupError("Source must be the userData workspace directory")
    database = workspace / "workspace.sqlite3"
    _plain_existing_path(database, directory=False)
    if not output.is_absolute() or ".." in output.parts or str(output).startswith("\\\\"):
        raise WorkspaceBackupError("Output must be a new absolute local directory")
    _plain_existing_path(output.parent, directory=True)
    if os.path.lexists(output) or workspace in output.parents or output in workspace.parents:
        raise WorkspaceBackupError("Output must be new and outside the source workspace")
    before = _inventory(workspace)
    output.mkdir(mode=0o700)
    files: list[dict[str, object]] = []

    # A zero-timeout writer reservation rejects an active DB writer and holds
    # other writers off while SQLite creates the snapshot and media is copied.
    with closing(sqlite3.connect(database, timeout=0, isolation_level=None)) as guard:
        guard.execute("PRAGMA busy_timeout = 0")
        guard.execute("BEGIN IMMEDIATE")
        try:
            target_db = output / "workspace.sqlite3"
            with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source:
                with closing(sqlite3.connect(target_db)) as target:
                    # https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup
                    source.backup(target, pages=-1)
            with closing(sqlite3.connect(target_db.as_uri() + "?mode=ro", uri=True)) as verify:
                if verify.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                    raise WorkspaceBackupError("SQLite backup failed integrity check")
            db_digest, db_size = _file_digest(target_db)
            files.append({"path": "workspace.sqlite3", "sha256": db_digest, "byte_size": db_size})

            for relative, fingerprint in sorted(before.items()):
                source_path = workspace / relative
                target_path = output / relative
                if fingerprint[0] == "dir":
                    target_path.mkdir(mode=0o700)
                    continue
                detail = _copy_verified(source_path, target_path, fingerprint)
                files.append({"path": relative, **detail})
            if _inventory(workspace) != before:
                raise WorkspaceBackupError("Workspace media changed during backup")
        finally:
            guard.execute("ROLLBACK")

    receipt = {
        "schema_version": 1,
        "source_workspace": str(workspace),
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "files": sorted(files, key=lambda entry: str(entry["path"])),
        "sqlite_sidecars_excluded": sorted(_SQLITE_SIDECARS),
    }
    receipt_bytes = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    receipt_path = output / "receipt.json"
    with receipt_path.open("xb") as stream:
        stream.write(receipt_bytes)
        stream.flush()
        os.fsync(stream.fileno())
    receipt_sha256 = hashlib.sha256(receipt_bytes).hexdigest()
    if _file_digest(receipt_path) != (receipt_sha256, len(receipt_bytes)):
        raise WorkspaceBackupError("Backup receipt failed readback")
    return {
        "event": "backup-complete", "schema_version": 1,
        "output": str(output), "receipt_sha256": receipt_sha256,
        "file_count": len(files),
    }


def backup_command(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Back up a stopped AIVORA workspace")
    parser.add_argument("--backup-workspace", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args(argv)
    try:
        result = backup_workspace(arguments.backup_workspace, arguments.output)
    except (OSError, sqlite3.Error, WorkspaceBackupError) as error:
        print(f"workspace backup failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")), flush=True)
    return 0


def create_listener() -> tuple[socket.socket, int]:
    """Reserve an exclusive OS-assigned IPv4 loopback port."""

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    listener.bind((SIDECAR_HOST, 0))
    listener.listen()
    port = int(listener.getsockname()[1])
    return listener, port


def create_token() -> str:
    """Return 256 bits of process-local random material."""

    return secrets.token_urlsafe(32)


def create_handshake(*, port: int, token: str, pid: int) -> Mapping[str, object]:
    """Build the only secret-bearing message sent over the startup pipe."""

    return {
        "event": "ready",
        "host": SIDECAR_HOST,
        "pid": pid,
        "port": port,
        "protocol_version": PROTOCOL_VERSION,
        "token": token,
    }


def _stop_when_parent_pipe_closes(server: uvicorn.Server) -> None:
    sys.stdin.buffer.read()
    server.should_exit = True


def create_local_fake_worker(database_path: Path) -> LocalFakeSourceExtractWorker:
    """Build the only explicitly enabled background runtime for the Sidecar."""

    return LocalFakeSourceExtractWorker(database_path)


def create_local_fake_timeline_runtime(
    repository: StudioRepository,
) -> tuple[FakeTimelineRunFactory, LocalFakeTimelineWorker]:
    """Build the explicitly enabled development-evidence media runtime."""

    lock = load_media_toolchain_lock(media_toolchain_lock_path())
    toolchain = discover_media_toolchain(lock, explicit_root=media_tool_root())
    workspace = repository.database_path.parent
    generator = FakeMediaPackageGenerator.from_locked_tool_root(
        workspace,
        lock,
        toolchain.ffmpeg_path.parent,
    )
    return (
        FakeTimelineRunFactory(repository, generator),
        LocalFakeTimelineWorker(repository.database_path, generator),
    )


def remote_source_extract_availability(
    composition: RemoteSourceExtractComposition | None,
) -> str:
    """Explain why the remote worker is disabled before it can claim a task."""

    if composition is None:
        return "TRUSTED_REMOTE_COMPOSITION_UNAVAILABLE"
    if any(
        dependency is None
        for dependency in (
            composition.bindings,
            composition.composition_policy_reader,
            composition.settlement_source,
            composition.settlement_verifier,
            composition.credentials,
        )
    ) or isinstance(composition.settlement_verifier, DenyRemoteSettlementVerifier):
        return "TRUSTED_REMOTE_DEPENDENCY_UNAVAILABLE"
    if not all(
        callable(method)
        for method in (
            getattr(composition.bindings, "next_ready", None),
            composition.composition_policy_reader,
            getattr(composition.settlement_source, "read", None),
            getattr(composition.settlement_verifier, "verify", None),
            getattr(composition.credentials, "get", None),
        )
    ):
        return "TRUSTED_REMOTE_DEPENDENCY_UNAVAILABLE"
    return "CONFIGURED_PENDING_PER_TASK_AUTHORIZATION"


def create_remote_source_extract_runtime(
    repository: StudioRepository,
    *,
    composition: RemoteSourceExtractComposition | None,
) -> RemoteSourceExtractRuntime | None:
    """Compose the existing one-shot worker only with explicit trusted dependencies."""

    if remote_source_extract_availability(composition) != "CONFIGURED_PENDING_PER_TASK_AUTHORIZATION":
        return None
    assert composition is not None
    ledger = LocalTaskLedger(repository.database_path)
    connections = ProviderConnectionRepository(repository.database_path)
    authorizations = RemoteExecutionAuthorizationStore(
        repository.database_path,
        id_factory=new_id,
        composition_policy_reader=composition.composition_policy_reader,
        settlement_verifier=composition.settlement_verifier,
    )
    worker = RemoteSourceExtractWorker(
        ledger=ledger,
        authorizations=authorizations,
        invocation_builder=SourceExtractInvocationBuilder(repository.database_path),
        connections=connections,
        credentials=composition.credentials,
        transport=GatewayTextTransport(),
        settlement_source=composition.settlement_source,
    )
    return RemoteSourceExtractRuntime(
        ledger=ledger,
        worker=worker,
        bindings=composition.bindings,
        composition_policy_reader=composition.composition_policy_reader,
        connections=connections,
        credentials=composition.credentials,
        worker_id=f"remote-source-extract:{os.getpid()}:{secrets.token_hex(8)}",
    )


def create_sub2api_source_extract_runtime(
    repository: StudioRepository, *, credentials: CredentialVault
) -> Sub2APISourceExtractRuntime:
    """Compose the one-call worker; the approval store gates every network send."""
    ledger = LocalTaskLedger(repository.database_path)
    store = Sub2APISourceExtractStore(repository.database_path)
    connections = ProviderConnectionRepository(repository.database_path)
    worker = Sub2APISourceExtractWorker(
        ledger=ledger,
        dispatch_store=store,
        invocation_builder=Sub2APISourceExtractInvocationBuilder(repository.database_path),
        proposal_builder=build_sub2api_source_extract_proposal,
        connections=connections,
        credentials=credentials,
        transport=Sub2APITextTransport(),
    )
    return Sub2APISourceExtractRuntime(
        ledger=ledger,
        worker=worker,
        bindings=store,
        connections=connections,
        credentials=credentials,
        worker_id=f"sub2api-source-extract:{os.getpid()}:{secrets.token_hex(8)}",
    )


def run(*, remote_source_extract_composition: RemoteSourceExtractComposition | None = None) -> None:
    """Start one authenticated API process and supervise its parent pipe."""

    listener, port = create_listener()
    worker: LocalFakeSourceExtractWorker | None = None
    timeline_worker: LocalFakeTimelineWorker | None = None
    remote_worker: RemoteSourceExtractRuntime | None = None
    sub2api_worker: Sub2APISourceExtractRuntime | None = None
    worker_started = False
    timeline_worker_started = False
    remote_worker_started = False
    sub2api_worker_started = False
    try:
        token = create_token()
        security = SidecarSecurity(
            token=token,
            host=f"{SIDECAR_HOST}:{port}",
            origin=SIDECAR_ORIGIN,
        )
        repository = StudioRepository(default_database_path())
        credentials = SystemCredentialVault()
        worker = create_local_fake_worker(repository.database_path)
        remote_worker = create_remote_source_extract_runtime(
            repository, composition=remote_source_extract_composition
        )
        sub2api_worker = create_sub2api_source_extract_runtime(
            repository, credentials=credentials
        )
        if remote_worker is None:
            _LOGGER.info(
                "remote source.extract disabled: %s",
                remote_source_extract_availability(remote_source_extract_composition),
            )
        timeline_factory: FakeTimelineRunFactory | None = None
        if os.environ.get("AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME") == "1":
            timeline_factory, timeline_worker = create_local_fake_timeline_runtime(repository)
        config = uvicorn.Config(
            app=create_app(
                sidecar_security=security,
                repository=repository,
                credential_vault=credentials,
                fake_timeline_run_factory=timeline_factory,
                sub2api_runtime_availability=sub2api_worker.availability,
            ),
            host=SIDECAR_HOST,
            port=port,
            access_log=False,
            log_config=None,
            server_header=False,
        )
        server = uvicorn.Server(config)
        pipe_monitor = threading.Thread(
            target=_stop_when_parent_pipe_closes,
            args=(server,),
            name="sidecar-parent-pipe",
            daemon=True,
        )
        pipe_monitor.start()
        worker.start()
        worker_started = True
        if timeline_worker is not None:
            timeline_worker.start()
            timeline_worker_started = True
        if remote_worker is not None:
            remote_worker.start()
            remote_worker_started = True
        sub2api_worker.start()
        sub2api_worker_started = True

        handshake = create_handshake(port=port, token=token, pid=os.getpid())
        print(json.dumps(handshake, separators=(",", ":"), sort_keys=True), flush=True)
        server.run(sockets=[listener])
    finally:
        shutdown_error: Exception | None = None
        try:
            for started, runtime in (
                (sub2api_worker_started, sub2api_worker),
                (remote_worker_started, remote_worker),
                (timeline_worker_started, timeline_worker),
                (worker_started, worker),
            ):
                if not started or runtime is None:
                    continue
                try:
                    runtime.stop()
                except Exception as error:
                    if shutdown_error is None:
                        shutdown_error = error
        finally:
            listener.close()
        if shutdown_error is not None:
            raise shutdown_error


if __name__ == "__main__":  # pragma: no cover - exercised as a subprocess
    if len(sys.argv) > 1:
        raise SystemExit(backup_command(sys.argv[1:]))
    run()
