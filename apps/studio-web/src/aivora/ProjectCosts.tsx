import type { useTaskQueue } from "../domain/use-task-queue";
import { Button } from "./Common";
import "./project-costs.css";

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
        <p>预算设置还不能用，所以下面的按钮是停用的。</p>
        <Button disabled title="预算设置还不能用">
          预算设置待接入
        </Button>
      </section>
      <section className="v2-utility-card project-cost-ledger">
        <h2>项目任务账本</h2>
        <p>项目：{projectId ?? "尚未选择"}</p>
        <p>这里只列出已经记下的任务，不是完整账单。没有记下来的金额不能当成 0。</p>
        <Button
          disabled={!projectId || state.kind === "loading"}
          onClick={() => void queue.reload()}
        >
          重新读取项目任务账本（只读）
        </Button>
        {!projectId && <p role="status">请先选择真实作品，再读取该作品的任务与费用记录。</p>}
        {projectId && (state.kind === "loading" || state.kind === "idle") && (
          <p role="status">正在读取当前作品任务账本…</p>
        )}
        {projectId && (state.kind === "error" || (state.kind === "ready" && !data)) && (
          <p role="alert">项目任务账本未可靠读回，当前无法判断任务或费用；请重新读取。</p>
        )}
        {data && (
          <>
            <p>
              现有记录 {data.tasks.length} 项 · 需处理 {data.summary.attention}{" "}
              项。任务状态不代表收费状态。
            </p>
            {!data.tasks.length ? (
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
                    {data.tasks.map((item) => (
                      <tr key={item.attempt.attempt_id}>
                        <td>
                          <strong>{item.node.node_type}</strong>
                          <code>{item.task.task_id}</code>
                          <span>{item.attempt.provider_model ?? "未记录模型"}</span>
                          <span>
                            {item.attempt.execution_mode === "remote" ? "远程任务" : "本地任务"} ·
                            尝试 {item.attempt.number}
                          </span>
                        </td>
                        <td>
                          <span>{item.presentation.status_label}</span>
                          <span>{item.attempt.status}</span>
                          <time>{item.attempt.updated_at}</time>
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
                          <details>
                            <summary>查看任务、输入版本与费用证据</summary>
                            <p>尝试：{item.attempt.attempt_id}</p>
                            <p>工作流：{item.node.workflow_run_id}</p>
                            <p>节点：{item.node.node_run_id}</p>
                            <p>输入校验值：{item.node.input_hash}</p>
                            {item.node.input_version_ids.map((id) => (
                              <p key={id}>输入版本：{id}</p>
                            ))}
                            <p>供应商任务：{item.attempt.provider_job_id ?? "尚未记录"}</p>
                            <p>
                              费用状态：{item.cost.status}
                              ；币种、预留、累计、实付、预算和追加上限尚无可靠合同。
                            </p>
                            <p>
                              产物：
                              {item.attempt.output_version_id ??
                                item.node.output_version_id ??
                                "尚未产生"}
                            </p>
                            {item.attempt.error_code && <p>错误码：{item.attempt.error_code}</p>}
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
