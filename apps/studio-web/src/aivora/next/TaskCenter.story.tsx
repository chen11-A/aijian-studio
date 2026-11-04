import { useEffect, useState } from "react";
import { taskCenterData } from "./adapters";
import { sampleProjectJson } from "./adapters/sampleProject";
import { TaskCenter, type TaskItem, type TaskRecovery } from "./TaskCenter";
import { StoryFrame } from "./stories/StoryFrame";
import { sampleTasks } from "./stories/sampleData";

/** Example page with made-up props. Nothing here is sent anywhere. */
const STATES = [
  { id: "recovery", label: "关闭后重新打开" },
  { id: "checked", label: "查完了" },
  { id: "running", label: "正在生成" },
  { id: "loading", label: "加载中" },
  { id: "empty", label: "没有任务" },
  { id: "error", label: "读不出记录" },
  { id: "project", label: "按 project.json" },
];

/** A fixed clock, so the example always says the running take has waited 72 seconds. */
const PROJECT_NOW = Date.parse("2026-11-04T08:01:12.000Z");

const UNCERTAIN_FOUND = "scene-2-shot-23-take-1";
const CHECK_SECONDS = 1.2;

/** What the lookup finds in the example: A was finished, B was never sent. */
export function afterCheck(tasks: readonly TaskItem[]): TaskItem[] {
  return tasks.map((task) =>
    task.status !== "uncertain"
      ? task
      : task.id === UNCERTAIN_FOUND
        ? { ...task, status: "done", reason: "查过了：Grok 已经做完，存进了作品" }
        : { ...task, status: "requeued" },
  );
}

/** Starts the first two jobs in the queue. */
export function startQueue(tasks: readonly TaskItem[]): TaskItem[] {
  let started = 0;
  return tasks.map((task) => {
    if ((task.status === "queued" || task.status === "requeued") && started < 2) {
      started += 1;
      return { ...task, status: "running", waitedSeconds: 12 };
    }
    return task;
  });
}

type Start = { title: string; tasks: TaskItem[]; recovery: TaskRecovery | null };

function initial(state: string): Start {
  const title = "第 1 集 · 一键成片";
  if (state === "empty") return { title, tasks: [], recovery: null };
  if (state === "project") {
    const adapted = taskCenterData(sampleProjectJson(), { now: PROJECT_NOW });
    const props = adapted.ok ? adapted.props : { title, tasks: [] };
    return { title: props.title, tasks: [...props.tasks], recovery: null };
  }
  const tasks = sampleTasks();
  if (state === "checked") {
    return { title, tasks: afterCheck(tasks), recovery: { phase: "checked", found: 1, lost: 1 } };
  }
  if (state === "running") return { title, tasks: startQueue(afterCheck(tasks)), recovery: null };
  return { title, tasks, recovery: { phase: "needs-check" } };
}

export function TaskCenterStory({ state = "recovery" }: { state?: string }) {
  const [start] = useState(() => initial(state));
  const [tasks, setTasks] = useState(start.tasks);
  const [recovery, setRecovery] = useState(start.recovery);
  const [paused, setPaused] = useState(state !== "running");
  const [log, setLog] = useState<string>();

  useEffect(() => {
    if (recovery?.phase !== "checking") return;
    const timer = window.setTimeout(() => {
      setTasks((rows) => afterCheck(rows));
      setRecovery({ phase: "checked", found: 1, lost: 1 });
    }, CHECK_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [recovery?.phase]);

  return (
    <StoryFrame story="task-center" states={STATES} state={state} log={log}>
      <TaskCenter
        title={start.title}
        tasks={tasks}
        recovery={recovery}
        paused={paused}
        loading={state === "loading"}
        error={state === "error" ? "作品文件夹里的任务记录打不开，可能被别的程序占用了。" : null}
        onCheck={() => setRecovery({ phase: "checking" })}
        onResume={() => {
          setRecovery(null);
          setPaused(false);
          setTasks((rows) => startQueue(rows));
          setLog("接着做");
        }}
        onPause={() => {
          setPaused(true);
          setLog("全部暂停");
        }}
        onRetry={(id, wording) => {
          setTasks((rows) =>
            rows.map((row) =>
              row.id === id ? { ...row, status: "queued", attempt: row.attempt + 1 } : row,
            ),
          );
          setLog(wording === "suggestion" ? `用建议的描述再试 ${id}` : `按原样再试 ${id}`);
        }}
        onRetryFailed={() => {
          setTasks((rows) =>
            rows.map((row) =>
              row.status === "failed"
                ? { ...row, status: "queued", attempt: row.attempt + 1 }
                : row,
            ),
          );
          setLog("失败的全部重试");
        }}
        onRemove={(id) => {
          setTasks((rows) => rows.filter((row) => row.id !== id));
          setLog(`移出队列 ${id}`);
        }}
        onReload={() => setLog("重新读取")}
        onOpenStoryboard={() => setLog("去分镜")}
      />
    </StoryFrame>
  );
}
