import { formatTime, nodeLabels, toneFor } from "../domain/task-queue-model";
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
                  <small>
                    {item.node.responsible_role} · 第 {item.attempt.number} 次
                  </small>
                  <small>
                    执行位置：{item.attempt.execution_mode === "remote" ? "远程" : "这台电脑"}
                  </small>
                  <small>
                    最近检查点：{formatTime(item.task.heartbeat_at ?? item.task.updated_at)}
                  </small>
                  <small>金额未知。用订阅生成不会另外扣费。</small>
                  <small>下一步：{item.presentation.next_action_label}</small>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
