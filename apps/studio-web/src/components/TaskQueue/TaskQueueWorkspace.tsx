import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProjectData, TaskQueueResponse } from "../../api/studio";
import { TaskQueueCard } from "./TaskQueueCard";
import { matchesFilter, type QueueFilter, type QueueState } from "./task-queue-model";
import "./task-queue.css";

interface TaskQueueWorkspaceProps {
  project: ProjectData;
  loadTasks(projectId: string): Promise<TaskQueueResponse>;
}

export function TaskQueueWorkspace({ project, loadTasks }: TaskQueueWorkspaceProps) {
  const [state, setState] = useState<QueueState>({ kind: "loading" });
  const [filter, setFilter] = useState<QueueFilter>("all");

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", response: await loadTasks(project.id) });
    } catch {
      setState({ kind: "error" });
    }
  }, [loadTasks, project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visibleTasks = useMemo(
    () =>
      state.kind === "ready"
        ? state.response.data.tasks.filter((item) => matchesFilter(item, filter))
        : [],
    [filter, state],
  );

  return (
    <section className="task-queue-workspace" aria-labelledby="task-queue-title">
      <header className="queue-hero">
        <div>
          <span className="eyebrow">制作进度</span>
          <h2 id="task-queue-title">制作任务总览</h2>
          <p>
            <strong>{project.name}</strong> · 查看正在执行、需要处理和已经完成的制作步骤
          </p>
        </div>
        {state.kind === "ready" && (
          <dl className="queue-summary" aria-label="任务统计">
            <div>
              <dt>全部</dt>
              <dd>{state.response.data.summary.total}</dd>
            </div>
            <div>
              <dt>执行中</dt>
              <dd>{state.response.data.summary.active}</dd>
            </div>
            <div>
              <dt>需处理</dt>
              <dd>{state.response.data.summary.attention}</dd>
            </div>
            <div>
              <dt>已完成</dt>
              <dd>{state.response.data.summary.completed}</dd>
            </div>
          </dl>
        )}
      </header>

      {state.kind === "loading" && (
        <div className="queue-state" role="status" aria-live="polite">
          <span className="queue-loader" aria-hidden="true" />
          <div>
            <strong>正在读取制作任务…</strong>
            <p>项目仍可安全留在当前页面。</p>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="queue-state queue-error" role="alert">
          <div>
            <strong>任务队列暂时无法读取</strong>
            <p>{project.name} 没有被修改；恢复连接后可继续查看。</p>
          </div>
          <button className="secondary-button" onClick={() => void reload()}>
            重新读取
          </button>
        </div>
      )}

      {state.kind === "ready" && state.response.data.tasks.length === 0 && (
        <div className="queue-empty">
          <span aria-hidden="true">◎</span>
          <h3>还没有制作任务</h3>
          <p>在故事设定里确认原文后，任务会出现在这里。</p>
        </div>
      )}

      {state.kind === "ready" && state.response.data.tasks.length > 0 && (
        <>
          <div className="queue-toolbar" aria-label="筛选任务">
            {(
              [
                ["all", "全部"],
                ["active", "执行中"],
                ["attention", "需处理"],
                ["completed", "已完成"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
            <span>{visibleTasks.length} 项</span>
          </div>
          {visibleTasks.length > 0 ? (
            <div className="queue-list">
              {visibleTasks.map((item) => (
                <TaskQueueCard key={item.task.task_id} item={item} />
              ))}
            </div>
          ) : (
            <div className="queue-filter-empty" role="status">
              当前筛选条件下没有任务
            </div>
          )}
        </>
      )}
    </section>
  );
}
