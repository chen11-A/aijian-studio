"""Real scoped SQLite and bounded original copies; no native process or decoder."""

import sqlite3
from pathlib import Path

import pytest
from aijian_api.draft_export_runtime import DraftExportError
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_preview_plan_routes import derive_native_preview_plan
from aijian_api.native_preview_materials import (
    NativePreviewMaterialError,
    prepare_native_preview_sources,
)
from test_native_preview_plan import counts

pytest_plugins = ["test_native_preview_plan"]


def prepared(preview, tmp_path):
    selected, episode, saved, _evidence, _url = preview
    receipt = derive_native_preview_plan(
        selected.repository, selected.args[0], episode, saved.version_id
    )
    private = tmp_path / "private-session"
    private.mkdir()
    lease = prepare_native_preview_sources(selected.repository, receipt, private_session=private)
    return selected, receipt, private, lease


def test_selected_snapshot_is_exact_read_only_and_confirmed_release(preview, tmp_path):
    selected, _episode, _saved, _evidence, _url = preview
    before = counts(selected.repository)
    selected, receipt, private, lease = prepared(preview, tmp_path)
    assert len(lease.sources) == 1
    source = lease.sources[0]
    media = receipt.plan.video_tracks[0].clips[0].media
    assert (source.asset_id, source.asset_version_id, source.sha256, source.byte_size) == (
        media.asset_id,
        media.asset_version_id,
        media.sha256,
        media.byte_size,
    )
    assert source.path.parent == lease.directory and source.path.stat().st_size == media.byte_size
    assert source.path.parent.parent == private
    lease.dispatch_under_admission(lambda: None)
    with pytest.raises(NativePreviewMaterialError, match="termination"):
        lease.release()
    assert source.path.exists()
    lease.release(owned_processes_stopped=True)
    lease.release(owned_processes_stopped=True)
    assert not lease.directory.exists() and list(private.iterdir()) == []
    assert counts(selected.repository) == before
    assert selected.runner.call_count == 1  # Existing explicitly controlled probe fixture only.


@pytest.mark.parametrize(
    "fault", ["original-missing", "original-changed", "snapshot-changed", "restricted"]
)
def test_fresh_prelaunch_recheck_refuses_loss_changes_or_latest_rights(preview, tmp_path, fault):
    selected, _receipt, _private, lease = prepared(preview, tmp_path)
    source = lease.sources[0]
    original = (
        selected.repository.database_path.parent
        / "media-assets"
        / "blobs"
        / source.sha256[:2]
        / source.sha256
    )
    if fault == "original-missing":
        original.unlink()
    elif fault == "original-changed":
        original.write_bytes(b"x" * source.byte_size)
    elif fault == "snapshot-changed":
        source.path.write_bytes(b"x" * source.byte_size)
    else:
        MediaAssetRightsStore(selected.repository).append_human_decision(
            *selected.args,
            HumanRightsDecisionInput(
                operation_id="rdop_" + "f" * 32,
                expected_revision=0,
                decision="RESTRICTED",
                basis_text="Source-only material regression current restriction",
            ),
            actor_id="human",
        )
    with pytest.raises((ValueError, DraftExportError)):
        lease.dispatch_under_admission(lambda: pytest.fail("Invalid material reached dispatch"))
    # No native dispatch occurred: private generated files may be released without process proof.
    lease.release()
    assert not lease.directory.exists() and selected.runner.call_count == 1


def test_changed_saved_identity_or_plan_refuses_before_private_writes(preview, tmp_path):
    selected, episode, saved, _evidence, _url = preview
    receipt = derive_native_preview_plan(
        selected.repository, selected.args[0], episode, saved.version_id
    )
    private = tmp_path / "private-session"
    private.mkdir()
    wrong = receipt.model_copy(update={"plan_hash": "sha256:" + "f" * 64})
    with pytest.raises(ValueError):
        prepare_native_preview_sources(selected.repository, wrong, private_session=private)
    assert list(private.iterdir()) == []
    assert selected.runner.call_count == 1


def test_partial_copy_failure_removes_only_its_generated_names(preview, tmp_path, monkeypatch):
    from aijian_api import native_preview_materials

    selected, episode, saved, _evidence, _url = preview
    receipt = derive_native_preview_plan(
        selected.repository, selected.args[0], episode, saved.version_id
    )
    private = tmp_path / "private-session"
    private.mkdir()
    unrelated = private / "already-present.txt"
    unrelated.write_text("preserve")

    def failed(_source, destination, *_args):
        Path(destination).write_bytes(b"partial")
        raise OSError("Controlled partial snapshot failure")

    monkeypatch.setattr(native_preview_materials, "_snapshot", failed)
    with pytest.raises(OSError, match="partial"):
        prepare_native_preview_sources(selected.repository, receipt, private_session=private)
    assert list(private.iterdir()) == [unrelated] and unrelated.read_text() == "preserve"


def test_restriction_committed_during_hashing_blocks_final_dispatch(preview, tmp_path, monkeypatch):
    from aijian_api import native_preview_materials

    selected, _receipt, _private, lease = prepared(preview, tmp_path)
    snapshot = native_preview_materials._snapshot
    decisions = []
    dispatched = []

    def snapshot_then_restrict(source, destination, *args):
        result = snapshot(source, destination, *args)
        if not decisions:
            decisions.append(
                MediaAssetRightsStore(selected.repository).append_human_decision(
                    *selected.args,
                    HumanRightsDecisionInput(
                        operation_id="rdop_" + "1" * 32,
                        expected_revision=0,
                        decision="RESTRICTED",
                        basis_text="Restriction committed during final source hashing",
                    ),
                    actor_id="human",
                )
            )
        return result

    monkeypatch.setattr(native_preview_materials, "_snapshot", snapshot_then_restrict)
    with pytest.raises(ValueError):
        lease.dispatch_under_admission(lambda: dispatched.append(True))
    assert decisions[0].decision.decision == "RESTRICTED"
    assert not dispatched and not lease._launch_started
    lease.release()
    assert not lease.directory.exists() and selected.runner.call_count == 1


def test_dispatch_holds_same_database_writer_gate_until_partial_start_settles(preview, tmp_path):
    selected, _receipt, _private, lease = prepared(preview, tmp_path)

    def partial_start():
        # A distinct real SQLite writer cannot commit rights/G5 between final
        # admission and the synchronous owner recording partial dispatch.
        with sqlite3.connect(selected.repository.database_path, timeout=0) as writer:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                writer.execute("BEGIN IMMEDIATE")
        assert lease._launch_started
        raise OSError("Controlled partial native start; no process created")

    with pytest.raises(OSError, match="partial native start"):
        lease.dispatch_under_admission(partial_start)
    # The writer gate was released after the start path settled, including failure.
    with sqlite3.connect(selected.repository.database_path, timeout=0) as writer:
        writer.execute("BEGIN IMMEDIATE")
        writer.rollback()
    with pytest.raises(NativePreviewMaterialError, match="termination"):
        lease.release()
    assert lease.directory.exists()
    lease.release(owned_processes_stopped=True)
