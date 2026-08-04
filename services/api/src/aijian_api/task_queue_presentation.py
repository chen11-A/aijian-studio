"""Film-team language for technical task states."""

from aijian_api.task_queue_read import TaskQueueRecord


def task_presentation(record: TaskQueueRecord) -> tuple[str, str]:
    if record.node_status == "RECONCILIATION_REQUIRED":
        return "需要核对供应商任务", "查看证据并开始核对"
    if record.attempt_status == "REMOTE_UNKNOWN":
        return "供应商是否受理尚不明确", "查看证据，禁止重复提交"
    if record.attempt_status == "WAITING_REMOTE":
        return "等待供应商", "查看供应商进度"
    if record.attempt_status in {"LEASED", "RUNNING"}:
        return "正在本地执行", "查看最近检查点"
    if record.attempt_status == "READY":
        return "等待本地执行", "等待执行器领取"
    if record.attempt_status == "FAILED" and record.retry_disposition == "SAFE_LOCAL_RETRY":
        return "本地步骤失败，可安全重试", "保留本次记录并等待新 Attempt"
    if record.attempt_status == "FAILED":
        return "执行失败", "检查错误与输入版本"
    if record.attempt_status == "SUCCEEDED":
        return "已完成", "查看输出版本"
    if record.attempt_status == "NOT_SUBMITTED":
        return "供应商已确认未受理", "等待创建下一 Attempt"
    if record.attempt_status == "CANCEL_REQUESTED":
        return "正在请求取消", "等待执行端确认"
    if record.attempt_status == "CANCELLED":
        return "已取消", "查看取消记录"
    return record.attempt_status, "查看详情"
