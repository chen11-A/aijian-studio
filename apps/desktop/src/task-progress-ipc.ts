import type { TaskItem, BatchProgress, TaskSnapshot } from "@aijian/contracts/task-progress";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit = 300) => typeof value === "string" && value.length <= limit;
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optionalText = (value: unknown) => value === undefined || text(value);
const keysOnly = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

export function validTaskSnapshot(value: unknown): value is TaskSnapshot {
  if (
    !record(value) ||
    !keysOnly(value, ["tasks", "batches"]) ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.batches) ||
    value.tasks.length > 2000 ||
    value.batches.length > 200
  )
    return false;
  const tasks = value.tasks.every(
    (task: unknown): task is TaskItem =>
      record(task) &&
      keysOnly(task, [
        "id",
        "shotId",
        "title",
        "version",
        "kind",
        "status",
        "attempt",
        "reason",
        "suggestion",
        "waitedSeconds",
      ]) &&
      text(task.id) &&
      !!task.id &&
      optionalText(task.shotId) &&
      optionalText(task.title) &&
      optionalText(task.reason) &&
      optionalText(task.suggestion) &&
      optionalText(task.version) &&
      count(task.attempt) &&
      (task.waitedSeconds === undefined || count(task.waitedSeconds)) &&
      ["video", "image", "voice", "lipsync", "export"].includes(String(task.kind)) &&
      ["queued", "running", "uncertain", "requeued", "failed", "done"].includes(
        String(task.status),
      ),
  );
  const batches = value.batches.every(
    (batch: unknown): batch is BatchProgress =>
      record(batch) &&
      keysOnly(batch, ["batchId", "label", "done", "total", "failed", "running"]) &&
      text(batch.batchId) &&
      !!batch.batchId &&
      text(batch.label) &&
      count(batch.done) &&
      count(batch.total) &&
      count(batch.failed) &&
      typeof batch.running === "boolean" &&
      Number(batch.done) + Number(batch.failed) <= Number(batch.total),
  );
  return (
    tasks &&
    batches &&
    new Set(value.tasks.map((task: TaskItem) => task.id)).size === value.tasks.length &&
    new Set(value.batches.map((batch: BatchProgress) => batch.batchId)).size ===
      value.batches.length
  );
}

/** Mirrors the existing renderer-owned task ledger; it never executes or invents a job. */
export function registerTaskProgressHandlers<TEvent>(
  handle: (
    channel: string,
    callback: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  authorized: (event: TEvent) => boolean,
  owner: (event: TEvent) => number,
  emit: (event: TEvent, snapshot: TaskSnapshot) => void,
): void {
  const snapshots = new Map<number, TaskSnapshot>();
  handle("film:tasks-read", async (event, ...args) => {
    if (!authorized(event) || args.length)
      throw new Error("Task IPC sender or input is not authorized");
    return structuredClone(snapshots.get(owner(event)) ?? { tasks: [], batches: [] });
  });
  handle("film:tasks-publish", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Task IPC sender is not authorized");
    if (args.length !== 1 || !validTaskSnapshot(args[0])) throw new Error("Invalid task snapshot");
    const snapshot = structuredClone(args[0]);
    snapshots.set(owner(event), snapshot);
    emit(event, structuredClone(snapshot));
  });
}
