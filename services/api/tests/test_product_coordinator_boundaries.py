"""Coordinator state-machine tests with typed synthetic receipts and no claim grant."""

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest,
    ProductExportOperationData,
)
from aijian_api.product_export_operation_coordinator import (
    ProductExportCoordinatorError,
    ProductExportOperationCoordinator,
)
from aijian_api.product_export_render_plan import ProductExportRenderPlan
from aijian_api.product_timeline_export_contracts import ProductExportSpec
from test_product_store_boundaries import synthetic_tools


@pytest.fixture
def case(tmp_path):
    repository = Mock()
    coordinator = ProductExportOperationCoordinator(repository)
    coordinator._store = Mock()
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
        operation_id="peop_" + "1" * 32,
        assembly=dict(
            artifact_id="art_" + "2" * 32,
            version_id="ver_" + "3" * 32,
            content_hash="sha256:" + "4" * 64,
            head_revision=1,
        ),
        media_rights=(),
        spec=spec,
        output_relative_path="synthetic.mp4",
    )
    operation = ProductExportOperationData(
        project_id="prj_" + "5" * 32,
        episode_id="ep_" + "6" * 32,
        operation_id=request.operation_id,
        request_hash="sha256:" + "7" * 64,
        assembly=request.assembly,
        status="CLAIMED",
        progress_phase="QUEUED",
        progress_frames=0,
        total_frames=24,
        inputs_sealed_at="2026-10-10T00:00:00Z",
        cancel_requested_at=None,
        unknown_reason=None,
        output=None,
        created_at="2026-10-10T00:00:00Z",
        updated_at="2026-10-10T00:00:00Z",
        started_at=None,
        finished_at=None,
        reconciled_at=None,
    )
    plan = ProductExportRenderPlan(
        assembly_content_hash=request.assembly.content_hash,
        source_asset_id="asset_" + "8" * 32,
        source_version_id="asv_" + "9" * 32,
        source_sha256="a" * 64,
        source_probe_sha256="b" * 64,
        toolchain_profile_id=tools.profile_id,
        ffmpeg_sha256=tools.ffmpeg_sha256,
        ffprobe_sha256=tools.ffprobe_sha256,
        total_frames=24,
        has_audio=False,
        spec=spec,
    )
    row = dict(
        render_plan_json=plan.model_dump_json(),
        render_plan_hash=plan.content_hash,
        total_frames=24,
        assembly_content_hash=plan.assembly_content_hash,
    )
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = row
    repository._connection.return_value = nullcontext(connection)
    running = operation.model_copy(update={"status": "RUNNING"})
    coordinator._store.mark_running.return_value = running
    coordinator._store.get.return_value = running
    executor = Mock()
    return SimpleNamespace(
        coordinator=coordinator,
        store=coordinator._store,
        operation=operation,
        request=request,
        plan=plan,
        tools=tools,
        root=tmp_path,
        row=row,
        connection=connection,
        executor=executor,
    )


def run(case, stop=lambda: False):
    return case.coordinator.execute_claimed(
        case.operation,
        case.request,
        case.root,
        case.tools,
        execute=case.executor,
        stop_requested_externally=stop,
    )


@pytest.mark.parametrize(
    "fault", ["missing", "json", "root", "mode", "schema", "hash", "frames", "assembly"]
)
def test_plan_read_is_query_only_and_rejects_corrupt_claim(case, fault):
    if fault == "missing":
        case.connection.execute.return_value.fetchone.return_value = None
    elif fault in {"json", "root", "mode", "schema"}:
        case.row["render_plan_json"] = {
            "json": "{",
            "root": "[]",
            "mode": '{"mode":"MLT"}',
            "schema": '{"mode":"SINGLE_VERIFIED_VIDEO"}',
        }[fault]
    else:
        key = {
            "hash": "render_plan_hash",
            "frames": "total_frames",
            "assembly": "assembly_content_hash",
        }[fault]
        case.row[key] = 25 if fault == "frames" else "sha256:" + "f" * 64
    with pytest.raises(ProductExportCoordinatorError):
        run(case)
    case.executor.assert_not_called()
    case.store.mark_running.assert_not_called()
    case.store.mark_unknown.assert_called_once_with(
        case.operation.project_id, case.request.operation_id, "PRE_EXECUTION_REJECTED"
    )
    statements = [call.args[0].strip() for call in case.connection.execute.call_args_list]
    assert statements[0] == "PRAGMA query_only = ON"
    assert all(statement.startswith(("PRAGMA", "SELECT")) for statement in statements)


@pytest.mark.parametrize(
    "field,value", [("status", "RUNNING"), ("operation_id", "peop_" + "f" * 32), ("assembly", None)]
)
def test_old_or_different_claim_cannot_touch_store_or_executor(case, field, value):
    case.operation = case.operation.model_copy(update={field: value})
    with pytest.raises(ProductExportCoordinatorError, match="different or old"):
        run(case)
    assert case.store.mock_calls == []
    case.executor.assert_not_called()


@pytest.mark.parametrize("field", ["toolchain_profile_id", "ffmpeg_sha256", "ffprobe_sha256"])
def test_changed_toolchain_rejected_before_acquiring_running(case, field):
    plan = case.plan.model_copy(
        update={field: "different" if field == "toolchain_profile_id" else "f" * 64}
    )
    case.row.update(render_plan_json=plan.model_dump_json(), render_plan_hash=plan.content_hash)
    with pytest.raises(ProductExportCoordinatorError) as error:
        run(case)
    assert error.value.code == "CLAIM_TOOLCHAIN_CONFLICT"
    case.store.mark_running.assert_not_called()
    case.executor.assert_not_called()


def test_shutdown_before_start_leaves_unknown_not_running(case):
    with pytest.raises(ProductExportCoordinatorError) as error:
        run(case, stop=lambda: True)
    assert error.value.code == "SHUTDOWN_BEFORE_START"
    case.store.mark_running.assert_not_called()
    case.store.mark_unknown.assert_called_once()


@pytest.mark.parametrize(
    "status,cancel,transition",
    [
        ("CLAIMED", None, "mark_unknown"),
        ("CLAIMED", "stamp", "mark_cancelled"),
        ("RUNNING", None, None),
    ],
)
def test_start_failure_does_not_modify_another_running_owner(case, status, cancel, transition):
    failure = RuntimeError("synthetic acquisition failure")
    case.store.mark_running.side_effect = failure
    case.store.get.return_value = case.operation.model_copy(
        update={"status": status, "cancel_requested_at": cancel}
    )
    with pytest.raises(RuntimeError) as error:
        run(case)
    assert error.value is failure
    assert case.store.mark_unknown.call_count == int(transition == "mark_unknown")
    assert case.store.mark_cancelled.call_count == int(transition == "mark_cancelled")
    case.executor.assert_not_called()


@pytest.mark.parametrize("kind", ["external", "status", "cancel", "none"])
def test_executor_observes_current_stop_state_and_progress(case, kind):
    count = 0

    def external_stop():
        nonlocal count
        count += 1
        return count > 1 and kind == "external"

    current = case.store.get.return_value
    case.store.get.return_value = current.model_copy(
        update={
            "status": "UNKNOWN" if kind == "status" else "RUNNING",
            "cancel_requested_at": "stamp" if kind == "cancel" else None,
        }
    )

    def executor(*_args, on_progress, stop_requested):
        on_progress(3)
        assert stop_requested() is (kind != "none")

    case.executor.side_effect = executor
    result = run(case, stop=external_stop)
    assert result is case.store.finalize_output.return_value
    case.store.record_progress.assert_called_once_with(
        case.operation.project_id, case.request.operation_id, 3
    )
    assert case.store.get.call_count == int(kind != "external")
    case.store.mark_unknown.assert_not_called()


@pytest.mark.parametrize("stage", ["executor", "verifying", "finalize"])
def test_post_start_failure_records_uncertainty_without_retry(case, stage):
    failure = RuntimeError("synthetic interruption")
    target = {
        "executor": case.executor,
        "verifying": case.store.mark_verifying,
        "finalize": case.store.finalize_output,
    }[stage]
    target.side_effect = failure
    with pytest.raises(RuntimeError) as error:
        run(case)
    assert error.value is failure
    case.executor.assert_called_once()
    case.store.mark_unknown.assert_called_once_with(
        case.operation.project_id, case.request.operation_id, "EXECUTION_INTERRUPTED"
    )
