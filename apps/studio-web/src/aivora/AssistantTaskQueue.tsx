import { formatTime, nodeLabels, shortHash, toneFor } from "../domain/task-queue-model";
import { useDemo } from "./model";
import { Button } from "./Common";

export function AssistantTaskQueue() {
  const d = useDemo();
  const queue = d.taskQueue;
  const state = queue.state;
  return (
    <>
      <h3>真实制作任务</h3>
      {!d.backendProjectId && <p>当前项目尚未连接本地工作区；不会读取或创建制作任务。</p>}
      {d.backendProjectId && (state.kind === "loading" || state.kind === "idle") && (
        <p role="status">正在读取制作任务…</p>
      )}
      {d.backendProjectId && state.kind === "error" && (
        <p role="alert">
          任务队列暂时无法读取。
          <Button onClick={() => void queue.reload()}>重新读取</Button>
        </p>
      )}
      {d.backendProjectId && state.kind === "ready" && (
        <>
          <p>
            共 {state.response.data.summary.total} 项 · 执行中 {state.response.data.summary.active}{" "}
            项 · 需处理 {state.response.data.summary.attention} 项 · 已完成{" "}
            {state.response.data.summary.completed} 项
          </p>
          <Button onClick={() => void queue.reload()}>刷新任务</Button>
          {!state.response.data.tasks.length ? (
            <p>还没有制作任务。冻结输入后任务才会出现。</p>
          ) : (
            <>
              <div aria-label="筛选真实任务">
                {(
                  [
                    ["all", "全部"],
                    ["active", "执行中"],
                    ["attention", "需处理"],
                    ["completed", "已完成"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    aria-pressed={queue.filter === value}
                    onClick={() => queue.setFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {!queue.visibleTasks.length && <p role="status">当前筛选条件下没有任务</p>}
              {queue.visibleTasks.map((item) => (
                <article className={`task-row tone-${toneFor(item)}`} key={item.task.task_id}>
                  <strong>
                    {nodeLabels[item.node.node_type] ?? item.node.node_type} ·{" "}
                    {item.presentation.status_label}
                  </strong>
                  <small>{item.task.task_id}</small>
                  <small>
                    {item.node.responsible_role} ·{" "}
                    {item.node.upstream_gate ? `上游 ${item.node.upstream_gate}` : "无上游 Gate"} ·
                    尝试 {item.attempt.number} / {item.node.max_attempts}
                  </small>
                  <small>
                    执行位置：{item.attempt.execution_mode === "remote" ? "远程" : "本地"}
                  </small>
                  <small>
                    最近检查点：{formatTime(item.task.heartbeat_at ?? item.task.updated_at)}
                  </small>
                  <small>
                    成本：
                    {item.cost.status === "NOT_RECORDED"
                      ? "未知，成本账本尚未接入"
                      : item.cost.status}
                  </small>
                  <small>下一步：{item.presentation.next_action_label}</small>
                  {item.attempt.error_code && <small>错误码：{item.attempt.error_code}</small>}
                  <details>
                    <summary>查看真实输入与执行身份</summary>
                    <code>{item.node.workflow_run_id}</code>
                    <code>{item.node.node_run_id}</code>
                    <code>{item.attempt.attempt_id}</code>
                    <code title={item.node.input_hash}>{shortHash(item.node.input_hash)}</code>
                    {item.node.input_version_ids.map((version) => (
                      <code key={version}>{version}</code>
                    ))}
                    <small>执行状态：{item.attempt.status}</small>
                    <small>
                      产物版本：
                      {item.attempt.output_version_id ?? item.node.output_version_id ?? "尚未产生"}
                    </small>
                    <small>提案：{item.proposal_id ?? "尚无提案"}</small>
                  </details>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
