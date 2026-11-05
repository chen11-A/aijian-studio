import { videoTaskTarget } from "./generation-queue";
import type {
  TaskItem,
  BatchProgress,
  TaskListener,
  TaskSnapshot,
} from "@aijian/contracts/task-progress";
import type { FilmProject } from "./project";

export type TaskInput = Omit<TaskItem, "status" | "attempt"> & {
  projectId: string;
  attempt?: number;
  batchId?: string;
};
type StoredTask = {
  projectId: string;
  batchId?: string;
  task: TaskItem;
  source: "film" | "workflow";
};
const tasks = new Map<string, StoredTask>();
const batches = new Map<string, BatchProgress & { projectId: string }>();
const listeners = new Set<TaskListener>();
let activeProject = "";
const key = (projectId: string, id: string) => `${projectId}:${id}`;

export function taskSnapshot(): TaskSnapshot {
  const visible = [...tasks.values()].filter((item) => item.projectId === activeProject);
  return {
    tasks: visible.map((item) => ({ ...item.task })),
    batches: [...batches.values()]
      .filter((batch) => batch.projectId === activeProject)
      .map((batch) => {
        const members = visible
          .filter((item) => item.batchId === batch.batchId)
          .map((item) => item.task);
        return {
          batchId: batch.batchId,
          label: batch.label,
          total: Math.max(batch.total, members.length),
          done: members.filter((item) => item.status === "done").length,
          failed: members.filter((item) => item.status === "failed").length,
          running: members.some((item) =>
            ["queued", "running", "uncertain", "requeued"].includes(item.status),
          ),
        };
      }),
  };
}
function publish() {
  const snapshot = taskSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot.tasks, snapshot.batches);
    } catch {
      /* A display observer cannot abort a job. */
    }
  }
  // A disconnected display bridge must not change the execution outcome.
  try {
    void window.aijian?.publishTasks?.(snapshot.tasks, snapshot.batches).catch(() => undefined);
  } catch {
    /* A detached preload cannot abort a job. */
  }
}
export function subscribeTasks(listener: TaskListener): () => void {
  listeners.add(listener);
  const snapshot = taskSnapshot();
  listener(snapshot.tasks, snapshot.batches);
  return () => {
    listeners.delete(listener);
  };
}
export function beginTaskBatch(input: {
  projectId: string;
  batchId: string;
  label: string;
  total: number;
}): void {
  activeProject = input.projectId;
  batches.set(key(input.projectId, input.batchId), {
    ...input,
    done: 0,
    failed: 0,
    running: false,
  });
  publish();
}

/** queued is observable synchronously, before any provider work starts. */
export async function runTask<T>(
  input: TaskInput,
  execute: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { projectId, batchId, ...fields } = input;
  activeProject = projectId;
  const taskKey = key(projectId, input.id);
  const previous = tasks.get(taskKey)?.task;
  const stored: StoredTask = {
    projectId,
    batchId,
    source: "workflow",
    task: { ...fields, status: "queued", attempt: input.attempt ?? (previous?.attempt ?? 0) + 1 },
  };
  tasks.set(taskKey, stored);
  publish();
  const started = Date.now();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let rejectCancelled: (error: Error) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  void cancellation.catch(() => undefined);
  const cancel = () => {
    cancelled = true;
    controller.abort();
    rejectCancelled(new Error("TASK_CANCELLED"));
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("TASK_TIMEOUT"));
    }, options.timeoutMs ?? 300_000);
  });
  try {
    await Promise.resolve();
    if (options.signal?.aborted) {
      cancelled = true;
      controller.abort();
      throw new Error("TASK_CANCELLED");
    }
    stored.task = { ...stored.task, status: "running" };
    publish();
    if (controller.signal.aborted) throw new Error("TASK_CANCELLED");
    const result = await Promise.race([execute(controller.signal), deadline, cancellation]);
    if (controller.signal.aborted) throw new Error(cancelled ? "TASK_CANCELLED" : "TASK_TIMEOUT");
    stored.task = {
      ...stored.task,
      status: "done",
      waitedSeconds: Math.floor((Date.now() - started) / 1000),
    };
    return result;
  } catch (error) {
    stored.task = {
      ...stored.task,
      status: "failed",
      reason: cancelled ? "已取消" : controller.signal.aborted ? "等待结果超时" : "生成未完成",
      suggestion: cancelled
        ? "确认结果后再决定是否重试"
        : controller.signal.aborted
          ? "请先核对供应商是否已完成，再决定重试"
          : "检查失败提示后重试",
      waitedSeconds: Math.floor((Date.now() - started) / 1000),
    };
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
    publish();
  }
}

/** Video/keyframe/portrait jobs remain sourced from the existing film ledger. */
export function publishFilmJobs(film: FilmProject): void {
  activeProject = film.id;
  const jobIds = new Set(film.jobs.map((job) => job.id));
  for (const [id, stored] of tasks) {
    if (stored.projectId === film.id && stored.source === "film" && !jobIds.has(stored.task.id))
      tasks.delete(id);
  }
  for (const job of film.jobs) {
    tasks.set(key(film.id, job.id), {
      projectId: film.id,
      source: "film",
      task: {
        id: job.id,
        shotId: job.shotId,
        title:
          job.kind === "video" ? "生成视频" : job.kind === "portrait" ? "生成定妆照" : "生成画面",
        version:
          job.take >= 1 && job.take <= 26
            ? `${String.fromCharCode(64 + job.take)}版`
            : `${job.take}版`,
        kind: job.kind === "video" ? "video" : "image",
        status:
          job.status === "failed" &&
          job.interruptedFrom === "queued" &&
          videoTaskTarget(film, job.id)?.take.interruptedFrom === "queued"
            ? "queued"
            : job.status === "blocked" || job.status === "cancelled"
              ? "failed"
              : job.status,
        attempt: Math.max(1, job.attempt ?? 1),
        ...(job.reason || job.status === "cancelled" || job.status === "blocked"
          ? {
              reason: (job.reason || (job.status === "cancelled" ? "已取消" : "生成受阻")).slice(
                0,
                300,
              ),
            }
          : {}),
      },
    });
  }
  publish();
}
