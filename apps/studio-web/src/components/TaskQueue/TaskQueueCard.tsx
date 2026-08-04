import { formatTime, nodeLabels, shortHash, toneFor, type TaskQueueItem } from "./task-queue-model";

function CostLedger({ cost }: { cost: TaskQueueItem["cost"] }) {
  return (
    <div className="queue-cost-missing" data-ledger-status={cost.status}>
      <strong>成本账本尚未接入</strong>
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
          <span className="queue-step">{item.node.node_key}</span>
          <h3>{nodeLabels[item.node.node_type] ?? item.node.node_type}</h3>
          <p>
            {item.node.responsible_role}
            {item.node.upstream_gate ? ` · 上游 ${item.node.upstream_gate}` : " · 无上游 Gate"}
          </p>
        </div>
        <div className="queue-status" aria-label={`任务状态：${item.presentation.status_label}`}>
          <span aria-hidden="true" />
          <strong>{item.presentation.status_label}</strong>
          <small>{item.attempt.status}</small>
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
          <span>精确输入版本</span>
          {item.node.input_version_ids.length > 0 ? (
            item.node.input_version_ids.map((versionId) => <code key={versionId}>{versionId}</code>)
          ) : (
            <em>此节点没有 Artifact 版本输入</em>
          )}
        </div>
        <div>
          <span>输入哈希</span>
          <code title={item.node.input_hash}>{shortHash(item.node.input_hash)}</code>
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
            <dt>Workflow Run</dt>
            <dd>{item.node.workflow_run_id}</dd>
          </div>
          <div>
            <dt>Node Run</dt>
            <dd>{item.node.node_run_id}</dd>
          </div>
          <div>
            <dt>Attempt</dt>
            <dd>{item.attempt.attempt_id}</dd>
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
