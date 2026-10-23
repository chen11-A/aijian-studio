import { useState } from "react";
import { attemptLabels, formatTime, nodeLabels, toneFor } from "../domain/task-queue-model";
import type { useTaskQueue } from "../domain/use-task-queue";
import { Button } from "./Common";
import "./project-costs.css";

const DISMISSED_FAILURES = "aivora.dismissed-task-failures";

function readDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_FAILURES) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function taskName(nodeType: string, kind: string): string {
  return nodeLabels[nodeType] ?? nodeLabels[kind] ?? "创作任务";
}

export function ProjectCosts({
  projectId,
  queue,
}: {
  projectId: string | null;
  queue: ReturnType<typeof useTaskQueue>;
}) {
  const state = queue.state;
  const data =
    projectId && state.kind === "ready" && state.response.data.project_id === projectId
      ? state.response.data
      : null;
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const hidden = new Set(dismissed);
  const visible = data?.tasks.filter((item) => !hidden.has(item.attempt.attempt_id)) ?? [];
  const folded = visible.filter((item) => item.presentation.status_label === "已被后来的成片取代");
  const rows = visible.filter((item) => item.presentation.status_label !== "已被后来的成片取代");
  const attention = rows.filter((item) => toneFor(item) === "attention").length;
  const failedIds = (data?.tasks ?? [])
    .filter((item) => item.attempt.status === "FAILED")
    .map((item) => item.attempt.attempt_id);
  const canClear = failedIds.some((id) => !hidden.has(id));
  return (
    <div className="v2-cost-body project-costs" aria-label="当前作品任务与费用记录">
      <div className="v2-cost-summary">
        {(
          [
            ["预留费用", "还没有记录会先占用的金额。"],
            ["累计费用", "还没有记录已经累计的金额。"],
            ["实付费用", "还没有记录已经支付的金额。"],
          ] as const
        ).map(([label, detail]) => (
          <section className="v2-utility-card" key={label}>
            <h2>{label}</h2>
            <strong>未知</strong>
            <p>{detail}</p>
          </section>
        ))}
      </div>
      <section className="v2-utility-card">
        <h2>作品预算</h2>
        <p>还不能在这里设置花费上限。每次真正调用前都会再确认一次。</p>
        <p>用订阅生成不会另外收费，所以金额保持未知，这不是一张账单。</p>
      </section>
      <section className="v2-utility-card project-cost-ledger">
        <h2>用量记录</h2>
        <p>{projectId ? "当前作品" : "尚未选择作品"}</p>
        <p>这里只列出已经记下的任务，不是完整账单。没有记下来的金额不能当成 0。</p>
        <Button
          disabled={!projectId || state.kind === "loading"}
          onClick={() => void queue.reload()}
        >
          刷新
        </Button>
        {canClear && (
          <Button
            onClick={() => {
              const next = [...new Set([...dismissed, ...failedIds])];
              localStorage.setItem(DISMISSED_FAILURES, JSON.stringify(next));
              setDismissed(next);
            }}
          >
            清理失败记录
          </Button>
        )}
        {!projectId && <p role="status">请先选择真实作品，再读取该作品的任务与费用记录。</p>}
        {projectId && (state.kind === "loading" || state.kind === "idle") && (
          <p role="status">正在读取用量记录…</p>
        )}
        {projectId && (state.kind === "error" || (state.kind === "ready" && !data)) && (
          <p role="alert">用量记录没有读出来。请再刷新一次。</p>
        )}
        {data && (
          <>
            <p>
              现有记录 {rows.length} 项 · 需处理 {attention} 项。任务状态不代表收费状态。
            </p>
            {!rows.length && !folded.length ? (
              <p role="status">尚无任务记录；这不代表费用为零，也不证明没有发生外部调用。</p>
            ) : (
              <div
                className="project-cost-table"
                role="region"
                aria-label="项目任务费用明细"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      {["任务 / 模型", "状态与检查点", "预留", "累计", "实付", "版本与核对"].map(
                        (label) => (
                          <th key={label} scope="col">
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr key={item.attempt.attempt_id} data-task={item.task.task_id}>
                        <td>
                          <strong>{taskName(item.node.node_type, item.task.kind)}</strong>
                          <span>{item.attempt.provider_model ?? "未记录模型"}</span>
                          <span>第 {item.attempt.number} 次</span>
                        </td>
                        <td>
                          <span>{item.presentation.status_label}</span>
                          <span>{attemptLabels[item.attempt.status] ?? "进行中"}</span>
                          <time>{formatTime(item.attempt.updated_at)}</time>
                          {(item.attempt.status === "REMOTE_UNKNOWN" ||
                            item.attempt.retry_disposition === "REMOTE_UNKNOWN") && (
                            <p>结果未知，不自动重发。</p>
                          )}
                        </td>
                        <td>未知</td>
                        <td>未知</td>
                        <td>未知</td>
                        <td>
                          <span>金额尚未记录</span>
                          <span>{item.presentation.next_action_label}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {folded.length > 0 && (
                  <details>
                    <summary>更早的失败，已被后来的成片取代</summary>
                    {folded.map((item) => (
                      <p key={item.attempt.attempt_id}>
                        {taskName(item.node.node_type, item.task.kind)} ·{" "}
                        {formatTime(item.attempt.updated_at)} · {item.presentation.status_label}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
