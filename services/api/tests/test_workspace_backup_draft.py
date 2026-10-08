"""A completed synthetic DRAFT may be backed up; interrupted staging is retained."""

import json
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from aijian_api import sidecar
from aijian_api.draft_export_runtime import DraftExportRuntime
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.repository import StudioRepository
from aijian_api.workspace_owner_lock import acquire_workspace_owner_lock
from test_draft_export_runtime import fixture, request_for, toolchain, wait_final


def test_actual_completed_draft_workspace_backup_and_restore(tmp_path: Path):
    seed = tmp_path / "synthetic-input"
    seed.mkdir()
    original, project, episode, _asset, assembly = fixture(seed)
    workspace = tmp_path / "userData/workspace"
    workspace.mkdir(parents=True)
    database = workspace / "workspace.sqlite3"
    with closing(sqlite3.connect(original.database_path)) as source:
        with closing(sqlite3.connect(database)) as target:
            source.backup(target)
    shutil.copytree(seed / "media-assets", workspace / "media-assets")
    repository = StudioRepository(database)
    output = tmp_path / "actual-owned-DRAFT.mp4"
    runtime = DraftExportRuntime(repository, toolchain)
    request = request_for(assembly, output)
    try:
        runtime.submit(project, episode, request)
        result = wait_final(runtime, project, episode, request.operation_id)
        assert result.status == "SUCCEEDED", result
    finally:
        runtime.join_workers()
    staging = workspace / "draft-export-work"
    assert staging.is_dir() and list(staging.iterdir()) == []
    inventory = sidecar._inventory(workspace)
    assert inventory["draft-export-work"][0] == "dir"

    backup = tmp_path / "backup"
    # Match the stopped-workspace condition; this test does not implement NSIS
    # process exclusion or claim backup_workspace itself owns that OS lock.
    with acquire_workspace_owner_lock(database):
        receipt = sidecar.backup_workspace(workspace, backup)
    assert receipt["event"] == "backup-complete"
    assert (backup / "draft-export-work").is_dir()
    assert list((backup / "draft-export-work").iterdir()) == []
    manifest = json.loads((backup / "receipt.json").read_text())
    assert not any(item["path"].endswith(".mp4") for item in manifest["files"])
    assert output.is_file()  # A workspace backup does not move/export/delete it.

    restored = tmp_path / "restored/workspace"
    shutil.copytree(backup, restored, ignore=shutil.ignore_patterns("receipt.json"))
    with closing(sqlite3.connect(restored / "workspace.sqlite3")) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        row = connection.execute(
            "SELECT status, output_sha256 FROM draft_export_jobs WHERE operation_id=?",
            (request.operation_id,),
        ).fetchone()
        assert row == ("SUCCEEDED", result.output_sha256)
    restored_repository = StudioRepository(restored / "workspace.sqlite3")
    readback = EpisodeMediaAssemblyStore(restored_repository).read_version(
        project, episode, version_id=assembly.version_id
    )
    assert readback.content_hash == assembly.content_hash
    for relative, fingerprint in inventory.items():
        if fingerprint[0] == "file":
            assert (restored / relative).read_bytes() == (workspace / relative).read_bytes()


@pytest.mark.parametrize(
    "kind", ["file", "job-directory", "linked-directory", "reported-junction", "plain-file"]
)
def test_draft_staging_nonempty_or_not_plain_directory_is_rejected(
    tmp_path: Path, kind: str, monkeypatch
):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    staging = workspace / "draft-export-work"
    if kind == "linked-directory":
        target = tmp_path / "other-empty-directory"
        target.mkdir()
        try:
            staging.symlink_to(target, target_is_directory=True)
        except OSError:
            pytest.skip("Test account cannot create symbolic links")
    elif kind == "reported-junction":
        staging.mkdir()
        monkeypatch.setattr(Path, "is_junction", lambda path: path == staging, raising=False)
    elif kind == "plain-file":
        staging.write_bytes(b"unexpected file must be retained")
    else:
        staging.mkdir()
        if kind == "file":
            (staging / "interrupted-source").write_bytes(b"retained interrupted bytes")
        else:
            (staging / "dmp_interrupted").mkdir()
    with pytest.raises(sidecar.WorkspaceBackupError):
        sidecar._inventory(workspace)
    assert staging.exists()


@pytest.mark.parametrize("change_kind", ["nonempty", "replacement"])
def test_unknown_top_level_and_change_during_backup_still_fail(
    tmp_path: Path, monkeypatch, change_kind: str
):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    unknown = workspace / "unknown-export-directory"
    unknown.mkdir()
    with pytest.raises(sidecar.WorkspaceBackupError, match="unsupported top-level"):
        sidecar._inventory(workspace)
    unknown.rmdir()  # Only this test's own empty synthetic directory.
    with closing(sqlite3.connect(workspace / "workspace.sqlite3")) as connection:
        connection.execute("CREATE TABLE synthetic(value TEXT)")
    media = workspace / "media-assets"
    media.mkdir()
    (media / "synthetic-file").write_bytes(b"fixture")
    staging = workspace / "draft-export-work"
    staging.mkdir()
    copy = sidecar._copy_verified

    def change(source, target, fingerprint):
        result = copy(source, target, fingerprint)
        if change_kind == "nonempty":
            (staging / "unexpected-active-job").write_bytes(b"must not discard")
        else:
            staging.rename(tmp_path / "retained-original-stage")
            staging.mkdir()
        return result

    monkeypatch.setattr(sidecar, "_copy_verified", change)
    with pytest.raises(sidecar.WorkspaceBackupError):
        sidecar.backup_workspace(workspace, tmp_path / "incomplete-backup")
    if change_kind == "nonempty":
        assert (staging / "unexpected-active-job").read_bytes() == b"must not discard"
    else:
        assert (tmp_path / "retained-original-stage").is_dir()
    assert not (tmp_path / "incomplete-backup/receipt.json").exists()
