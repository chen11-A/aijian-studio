import { formatTime, nodeLabels, shortHash, toneFor, type TaskQueueItem } from "./task-queue-model";

function CostLedger({ cost }: { cost: TaskQueueItem["cost"] }) {
  return (
    <div className="queue-cost-missing" data-ledger-status={cost.status}>
      <strong>费用暂未记录</strong>
      <span>不会把未知费用显示为 ¥0</span>
    </div>
  );
}

export function TaskQueueCard({ item }: { item: TaskQueueItem }) {
  const tone = toneFor(item);
  const checkpoint = item.task.heartbeat_at ?? item.task.updated_at;
  return (
    <article className={`queue-card tone-${tone}`}>
      <header className="queue-card-header">
        <div>
          <span className="queue-step">{item.node.upstream_gate ? "等待前一步" : "可执行"}</span>
          <h3>{nodeLabels[item.node.node_type] ?? item.node.node_type}</h3>
          <p>
            {item.node.responsible_role}
            {item.node.upstream_gate ? " · 需要先确认原文" : " · 无前置步骤"}
          </p>
        </div>
        <div className="queue-status" aria-label={`任务状态：${item.presentation.status_label}`}>
          <span aria-hidden="true" />
          <strong>{item.presentation.status_label}</strong>
        </div>
      </header>

      <div className="queue-facts" aria-label="任务执行摘要">
        <div>
          <span>执行位置</span>
          <strong>{item.attempt.execution_mode === "local" ? "本机" : "AI 供应商"}</strong>
        </div>
        <div>
          <span>尝试</span>
          <strong>
            尝试 {item.attempt.number} / {item.node.max_attempts}
          </strong>
        </div>
        <div>
          <span>优先级</span>
          <strong>{item.task.priority}</strong>
        </div>
        <div>
          <span>最近检查点</span>
          <strong>{formatTime(checkpoint)}</strong>
        </div>
      </div>

      <div className="queue-inputs">
        <div>
          <span>所用内容</span>
          <strong>
            {item.node.input_version_ids.length > 0
              ? `${item.node.input_version_ids.length} 份内容`
              : "这一步还没有内容输入"}
          </strong>
        </div>
        <div>
          <span>输入摘要</span>
          <strong>{shortHash(item.node.input_hash)}</strong>
        </div>
      </div>

      <div className="queue-card-footer">
        <CostLedger cost={item.cost} />
        <div className="queue-next-action">
          <span>下一步</span>
          <strong>{item.presentation.next_action_label}</strong>
        </div>
      </div>

      <details className="queue-details">
        <summary>查看技术详情</summary>
        <dl>
          <div>
            <dt>工作流 ID</dt>
            <dd>{item.node.workflow_run_id}</dd>
          </div>
          <div>
            <dt>步骤 ID</dt>
            <dd>{item.node.node_run_id}</dd>
          </div>
          <div>
            <dt>尝试 ID</dt>
            <dd>{item.attempt.attempt_id}</dd>
          </div>
          <div>
            <dt>所用版本</dt>
            <dd>
              {item.node.input_version_ids.length > 0
                ? item.node.input_version_ids.join("、")
                : "无"}
            </dd>
          </div>
          <div>
            <dt>输入哈希</dt>
            <dd>{item.node.input_hash}</dd>
          </div>
          <div>
            <dt>内部状态</dt>
            <dd>{item.attempt.status}</dd>
          </div>
          <div>
            <dt>错误码</dt>
            <dd>{item.attempt.error_code ?? "—"}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}
