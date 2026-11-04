"""Temporary SQLite state transitions; no release claim, encoder, or real export."""

import sqlite3
from contextlib import contextmanager
from unittest.mock import Mock

import pytest
from aijian_api import product_export_store as store_module
from aijian_api.artifacts import canonical_content_hash
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import ProductExportClaimRequest
from aijian_api.product_export_output_verify import VerifiedProductOutput, output_target_identity
from aijian_api.product_export_render_plan import ProductExportRenderPlan
from aijian_api.product_export_store import ProductExportStateError, ProductExportStore
from aijian_api.product_timeline_export_contracts import ProductExportSpec
from test_draft_export_runtime import fixture as assembly_fixture
from test_persisted_production_boundaries import (
    OPERATION,
    STAMP,
    insert_operation,
    operation_fields,
)


def synthetic_tools(root):
    return MediaToolchain(
        profile_id="synthetic-only",
        version="1.0.0",
        ffmpeg_path=root / "unused-encoder",
        ffprobe_path=root / "unused-probe",
        ffmpeg_sha256="8" * 64,
        ffprobe_sha256="9" * 64,
        configuration_flags=(),
        license_class="LGPL",
        spdx_license="LGPL-2.1-or-later",
        distribution_status="DEVELOPMENT_ONLY",
    )


@pytest.fixture
def operation(tmp_path):
    repository, project, episode, asset, assembly = assembly_fixture(tmp_path)
    decision = (
        MediaAssetRightsStore(repository)
        .append_human_decision(
            project,
            asset.id,
            asset.latest_version.id,
            HumanRightsDecisionInput(
                operation_id="rdop_" + "a" * 32,
                expected_revision=0,
                decision="CLEARED",
                basis_text="Synthetic fixture only; no real rights asserted.",
            ),
            actor_id="synthetic-user",
        )
        .decision
    )
    fields = operation_fields()
    fields.update(
        project_id=project,
        episode_id=episode,
        assembly_artifact_id=assembly.artifact_id,
        assembly_version_id=assembly.version_id,
        assembly_content_hash=assembly.content_hash,
        assembly_head_revision=assembly.head_revision,
        inputs_sealed_at=None,
    )
    tools = synthetic_tools(tmp_path)
    spec = ProductExportSpec(
        container="MP4",
        width=160,
        height=90,
        frame_rate_num=24,
        frame_rate_den=1,
        video_codec="H264",
        audio_codec="AAC",
    )
    request = ProductExportClaimRequest(
        operation_id=OPERATION,
        assembly={
            "artifact_id": assembly.artifact_id,
            "version_id": assembly.version_id,
            "content_hash": assembly.content_hash,
            "head_revision": assembly.head_revision,
        },
        media_rights=(),
        spec=spec,
        output_relative_path="synthetic.mp4",
    )
    plan = ProductExportRenderPlan(
        assembly_content_hash=assembly.content_hash,
        source_asset_id=asset.id,
        source_version_id=asset.latest_version.id,
        source_sha256=asset.latest_version.sha256,
        source_probe_sha256="7" * 64,
        toolchain_profile_id=tools.profile_id,
        ffmpeg_sha256=tools.ffmpeg_sha256,
        ffprobe_sha256=tools.ffprobe_sha256,
        total_frames=24,
        has_audio=False,
        spec=spec,
    )
    fields.update(
        request_json=request.model_dump_json(),
        render_plan_json=plan.model_dump_json(),
        request_hash=canonical_content_hash(
            {
                "project_id": project,
                "episode_id": episode,
                "request": request.model_dump(mode="json"),
            }
        ),
        render_plan_hash=plan.content_hash,
        output_target_identity=output_target_identity(tmp_path, request),
    )
    with repository._connection() as connection:
        insert_operation(connection, fields)
        connection.execute(
            "INSERT INTO product_export_media_inputs "
            "VALUES (?, ?, 0, 'VISUAL', 'image', ?, ?, ?, ?, ?, ?)",
            (
                project,
                OPERATION,
                asset.id,
                asset.latest_version.id,
                asset.latest_version.sha256,
                decision.decision_id,
                decision.revision,
                decision.decision_content_hash,
            ),
        )
        connection.execute("UPDATE product_export_operations SET inputs_sealed_at = ?", (STAMP,))
        connection.commit()
    store = ProductExportStore(repository)
    store.mark_running(project, OPERATION)
    return store, project, repository, assembly


def test_progress_monotonic_verification_and_interruption_preserve_uncertainty(operation):
    store, project, _, _ = operation
    assert store.record_progress(project, OPERATION, 5).progress_frames == 5
    assert store.record_progress(project, OPERATION, 5).progress_frames == 5
    for stale in [4, -1, 25]:
        with pytest.raises(ProductExportStateError) as caught:
            store.record_progress(project, OPERATION, stale)
        assert caught.value.code == "PROGRESS_CONFLICT"
    verifying = store.mark_verifying(project, OPERATION)
    assert (verifying.status, verifying.progress_phase, verifying.progress_frames) == (
        "RUNNING",
        "VERIFYING",
        24,
    )
    with pytest.raises(ProductExportStateError) as caught:
        store.mark_verifying(project, OPERATION)
    assert caught.value.code == "NOT_VERIFYING"
    unknown = store.mark_unknown(project, OPERATION, "SYNTHETIC_INTERRUPTION")
    assert unknown.output is None
    assert store.mark_unknown(project, OPERATION, "SECOND_REASON") == unknown
    assert store.mark_interrupted_unknown() == 0


@pytest.mark.parametrize("value", [True, None, 1.5, "1"])
def test_progress_rejects_noninteger_before_transaction(operation, value):
    store, project, _, _ = operation
    with pytest.raises(ProductExportStateError) as caught:
        store.record_progress(project, OPERATION, value)
    assert caught.value.code == "INVALID_PROGRESS"
    assert store.get(project, OPERATION).progress_frames == 0


@pytest.mark.parametrize("reason", ["", "lowercase", "WITH SPACE", "1PREFIX", "x" * 161])
def test_unknown_requires_bounded_reason_code(operation, reason):
    store, project, _, _ = operation
    with pytest.raises(ProductExportStateError) as caught:
        store.mark_unknown(project, OPERATION, reason)
    assert caught.value.code == "INVALID_REASON"
    assert store.get(project, OPERATION).status == "RUNNING"


def test_cancellation_is_a_signal_then_a_separate_terminal_transition(operation):
    store, project, _, _ = operation
    requested = store.request_cancel(project, OPERATION)
    assert requested.status == "RUNNING" and requested.cancel_requested_at is not None
    assert store.request_cancel(project, OPERATION) == requested
    with pytest.raises(ProductExportStateError) as caught:
        store.record_progress(project, OPERATION, 1)
    assert caught.value.code == "PROGRESS_CONFLICT"
    final = store.mark_cancelled(project, OPERATION)
    assert final.status == "CANCELLED" and final.output is None
    assert store.mark_cancelled(project, OPERATION) == final
    with pytest.raises(ProductExportStateError) as caught:
        store.mark_unknown(project, OPERATION, "CANNOT_RESTART")
    assert caught.value.code == "TERMINAL"


def test_finalize_persists_only_the_supplied_verifier_receipt_atomically(operation, monkeypatch):
    store, project, repository, _ = operation
    root = repository.database_path.parent
    store.mark_verifying(project, OPERATION)
    receipt = VerifiedProductOutput(
        str(root / "synthetic.mp4"), "a" * 64, 7, "{}", "sha256:" + "b" * 64, STAMP
    )
    verifier = Mock(return_value=receipt)
    monkeypatch.setattr(store_module, "verify_product_output", verifier)
    finished = store.finalize_output(project, OPERATION, root, synthetic_tools(root))
    assert finished.status == "SUCCEEDED"
    assert finished.output.sha256 == receipt.sha256
    verifier.assert_called_once()
    assert store.request_cancel(project, OPERATION) == finished
    with pytest.raises(ProductExportStateError) as caught:
        store.mark_cancelled(project, OPERATION)
    assert caught.value.code == "TERMINAL"
    assert not (root / "synthetic.mp4").exists()


def test_cancel_arriving_during_verification_prevents_success(operation, monkeypatch):
    store, project, repository, _ = operation
    root = repository.database_path.parent
    store.mark_verifying(project, OPERATION)

    def verify(*args, **kwargs):
        store.request_cancel(project, OPERATION)
        return VerifiedProductOutput(
            str(root / "synthetic.mp4"), "a" * 64, 7, "{}", "sha256:" + "b" * 64, STAMP
        )

    monkeypatch.setattr(store_module, "verify_product_output", verify)
    with pytest.raises(ProductExportStateError) as caught:
        store.finalize_output(project, OPERATION, root, synthetic_tools(root))
    assert caught.value.code == "CLAIM_CHANGED"
    assert store.get(project, OPERATION).output is None


def corrupt_readback(monkeypatch, repository, discriminator, changes):
    """Only change decoded SELECT rows; immutable database triggers remain active."""
    original = repository._connection

    @contextmanager
    def opened():
        with original() as connection:

            def row_factory(cursor, row):
                decoded = sqlite3.Row(cursor, row)
                if discriminator not in decoded.keys():
                    return decoded
                return {**dict(decoded), **changes}

            connection.row_factory = row_factory
            yield connection

    monkeypatch.setattr(repository, "_connection", opened)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("request_json", "{}"),
        ("render_plan_json", "{}"),
        ("request_hash", "sha256:" + "0" * 64),
        ("render_plan_hash", "sha256:" + "0" * 64),
        ("total_frames", 25),
        ("assembly_content_hash", "sha256:" + "0" * 64),
        ("output_target_identity", "mismatch"),
    ],
)
def test_corrupt_claim_never_reaches_output_verifier(operation, monkeypatch, field, value):
    store, project, repository, _ = operation
    root = repository.database_path.parent
    store.mark_verifying(project, OPERATION)
    verifier = Mock(side_effect=AssertionError("must not verify corrupt claim"))
    monkeypatch.setattr(store_module, "verify_product_output", verifier)
    corrupt_readback(monkeypatch, repository, "request_json", {field: value})
    with pytest.raises(ProductExportStateError) as caught:
        store.finalize_output(project, OPERATION, root, synthetic_tools(root))
    assert caught.value.code == "CORRUPT_CLAIM"
    verifier.assert_not_called()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("inputs_sealed_at", None),
        ("latest_version_id", "other"),
        ("revision", 999),
        ("content_hash", "sha256:" + "0" * 64),
    ],
)
def test_changed_assembly_prevents_start(operation, monkeypatch, field, value):
    store, project, repository, _ = operation
    corrupt_readback(monkeypatch, repository, "latest_version_id", {field: value})
    with pytest.raises(ProductExportStateError) as caught:
        store.mark_running(project, OPERATION)
    assert caught.value.code == "ASSEMBLY_CHANGED"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("current_sha256", "changed"),
        ("current_decision_id", "changed"),
        ("current_revision", 999),
        ("current_rights_hash", "changed"),
        ("rights_asset_sha256", "changed"),
        ("decision", "RESTRICTED"),
        ("deleted_at", STAMP),
    ],
)
def test_changed_selected_media_or_rights_prevents_start(operation, monkeypatch, field, value):
    store, project, repository, _ = operation
    corrupt_readback(monkeypatch, repository, "current_sha256", {field: value})
    with pytest.raises(ProductExportStateError) as caught:
        store.mark_running(project, OPERATION)
    assert caught.value.code == "MEDIA_OR_RIGHTS_CHANGED"


def test_start_is_not_a_retry_and_finalization_requires_verifying(operation):
    store, project, repository, _ = operation
    with pytest.raises(ProductExportStateError) as caught:
        store.mark_running(project, OPERATION)
    assert caught.value.code == "NOT_STARTABLE"
    root = repository.database_path.parent
    with pytest.raises(ProductExportStateError) as caught:
        store.finalize_output(project, OPERATION, root, synthetic_tools(root))
    assert caught.value.code == "NOT_VERIFYING"
    store.mark_verifying(project, OPERATION)
    store.request_cancel(project, OPERATION)
    with pytest.raises(ProductExportStateError) as caught:
        store.finalize_output(project, OPERATION, root, synthetic_tools(root))
    assert caught.value.code == "CANCEL_REQUESTED"
