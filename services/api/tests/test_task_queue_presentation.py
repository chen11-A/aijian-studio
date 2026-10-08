from dataclasses import replace
from datetime import UTC, datetime

import pytest
from aijian_api.task_queue_presentation import task_presentation
from aijian_api.task_queue_read import TaskQueueRecord

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)


def _record(**changes: object) -> TaskQueueRecord:
    baseline = TaskQueueRecord(
        proposal_id=None,
        workflow_run_id="run_11111111111111111111111111111111",
        node_run_id="nod_11111111111111111111111111111111",
        node_key="story.extract",
        node_type="story.extract",
        node_status="RUNNING",
        input_hash=f"sha256:{'a' * 64}",
        input_version_ids=(),
        node_output_version_id=None,
        attempt_count=1,
        max_attempts=2,
        node_updated_at=NOW,
        attempt_id="att_11111111111111111111111111111111",
        attempt_number=1,
        execution_mode="local",
        attempt_status="READY",
        provider_model=None,
        provider_job_id=None,
        retry_disposition=None,
        error_code=None,
        attempt_output_version_id=None,
        started_at=None,
        finished_at=None,
        attempt_updated_at=NOW,
        task_id="task_11111111111111111111111111111111",
        task_kind="local.story.extract",
        task_status="READY",
        priority=50,
        available_at=NOW,
        lease_generation=0,
        lease_expires_at=None,
        heartbeat_at=None,
        task_updated_at=NOW,
    )
    return replace(baseline, **changes)


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"node_status": "RECONCILIATION_REQUIRED"}, "需要核对供应商任务"),
        ({"attempt_status": "REMOTE_UNKNOWN"}, "供应商是否受理尚不明确"),
        ({"attempt_status": "WAITING_REMOTE"}, "等待供应商"),
        ({"attempt_status": "LEASED"}, "正在本地执行"),
        ({"attempt_status": "RUNNING"}, "正在本地执行"),
        ({"attempt_status": "READY"}, "等待本地执行"),
        (
            {"attempt_status": "FAILED", "retry_disposition": "SAFE_LOCAL_RETRY"},
            "本地步骤失败，可安全重试",
        ),
        ({"attempt_status": "FAILED"}, "执行失败"),
        ({"attempt_status": "SUCCEEDED"}, "已完成"),
        ({"attempt_status": "NOT_SUBMITTED"}, "供应商已确认未受理"),
        ({"attempt_status": "CANCEL_REQUESTED"}, "正在请求取消"),
        ({"attempt_status": "CANCELLED"}, "已取消"),
        ({"attempt_status": "PAUSED"}, "PAUSED"),
    ],
)
def test_task_presentation_maps_technical_state_to_film_language(
    changes: dict[str, object],
    expected: str,
) -> None:
    assert task_presentation(_record(**changes))[0] == expected
