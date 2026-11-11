import { beforeEach, expect, test, vi } from "vitest";
import type { TaskItem, BatchProgress } from "@aijian/contracts/task-progress";
import { blankFilm } from "./project";

beforeEach(() => {
  vi.resetModules();
  delete window.aijian;
});

test("queued is synchronous; real resolve/failure controls terminal state and batch totals", async () => {
  const { beginTaskBatch, runTask, subscribeTasks, taskSnapshot } = await import("./task-progress");
  const events: { tasks: TaskItem[]; batches: BatchProgress[] }[] = [];
  const unsubscribe = subscribeTasks((tasks, batches) => events.push({ tasks, batches }));
  beginTaskBatch({ projectId: "film-test", batchId: "portraits", label: "定妆照", total: 2 });
  let release: (() => void) | undefined;
  const execute = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = runTask(
    { id: "image-1", projectId: "film-test", kind: "image", batchId: "portraits" },
    execute,
  );
  expect(taskSnapshot().tasks[0]?.status).toBe("queued");
  expect(execute).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(taskSnapshot().tasks[0]?.status).toBe("running");
  expect(taskSnapshot().batches[0]).toMatchObject({ total: 2, running: true, done: 0 });
  release?.();
  await first;
  await expect(
    runTask(
      { id: "image-2", projectId: "film-test", kind: "image", batchId: "portraits" },
      async () => {
        throw new Error("synthetic supplier failure");
      },
    ),
  ).rejects.toThrow("synthetic supplier failure");
  expect(taskSnapshot().batches[0]).toMatchObject({ done: 1, failed: 1, running: false });
  expect(taskSnapshot().tasks[1]).toMatchObject({
    status: "failed",
    attempt: 1,
    suggestion: "检查失败提示后重试",
  });
  await runTask(
    { id: "image-2", projectId: "film-test", kind: "image", batchId: "portraits" },
    async () => "real return",
  );
  expect(taskSnapshot().tasks[1]).toMatchObject({ status: "done", attempt: 2 });
  expect(events.some((event) => event.tasks.some((task) => task.status === "queued"))).toBe(true);
  unsubscribe();
});

test("existing blocked and cancelled film jobs become terminal failures, not perpetual activity", async () => {
  const { publishFilmJobs, taskSnapshot } = await import("./task-progress");
  const film = blankFilm();
  film.jobs = ["blocked", "cancelled", "done"].map((status, index) => ({
    id: `job-${index}`,
    shotId: `shot-${index}`,
    take: 2,
    kind: index === 2 ? "video" : "portrait",
    status: status as "blocked" | "cancelled" | "done",
    prompt: "not in event",
    reason: "",
  }));
  publishFilmJobs(film);
  expect(taskSnapshot().tasks.map((task) => task.status)).toEqual(["failed", "failed", "done"]);
  expect(taskSnapshot().tasks.map((task) => task.kind)).toEqual(["image", "image", "video"]);
  expect(taskSnapshot().tasks[0]).not.toHaveProperty("prompt");
});

test("old project completion and failing display observers do not contaminate active project", async () => {
  const { runTask, subscribeTasks, publishFilmJobs, taskSnapshot } =
    await import("./task-progress");
  let release: (() => void) | undefined;
  const first = runTask(
    { id: "a", projectId: "film-a", kind: "image" },
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const film = blankFilm();
  film.id = "film-b";
  publishFilmJobs(film);
  const unsubscribe = subscribeTasks(() => undefined);
  release?.();
  await first;
  expect(taskSnapshot().tasks).toEqual([]);
  unsubscribe();
  let calls = 0;
  subscribeTasks(() => {
    if (++calls > 1) throw new Error("display broke");
  });
  await expect(
    runTask({ id: "b", projectId: "film-b", kind: "image" }, async () => "ok"),
  ).resolves.toBe("ok");
  expect(taskSnapshot().tasks[0]?.status).toBe("done");
});

test("a hung executor is aborted and becomes failed by its bounded deadline", async () => {
  vi.useFakeTimers();
  try {
    const { runTask, taskSnapshot } = await import("./task-progress");
    let signal: AbortSignal | undefined;
    const pending = runTask(
      { id: "hung", projectId: "timeouts", kind: "image" },
      async (received) => {
        signal = received;
        return new Promise<never>(() => undefined);
      },
      { timeoutMs: 500 },
    );
    const rejected = expect(pending).rejects.toThrow("TASK_TIMEOUT");
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(taskSnapshot().tasks[0]).toMatchObject({ status: "failed", reason: "等待结果超时" });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("removed film ledger entries disappear without dropping independent image work", async () => {
  const { publishFilmJobs, runTask, taskSnapshot } = await import("./task-progress");
  const film = blankFilm();
  film.jobs = [
    {
      id: "deleted",
      shotId: "s",
      kind: "video",
      take: 1,
      status: "running",
      prompt: "",
      reason: "",
    },
  ];
  publishFilmJobs(film);
  await runTask({ id: "image", projectId: film.id, kind: "image" }, async () => "done");
  publishFilmJobs({ ...film, jobs: [] });
  expect(taskSnapshot().tasks.map((task) => task.id)).toEqual(["image"]);
});

test("reopened unsent versions remain queued in the feed while unknown running results stay failed", async () => {
  const { sampleFilm, interruptStaleWork } = await import("./project");
  const { prepareVideoQueue, setVideoTaskState } = await import("./generation-queue");
  const { publishFilmJobs, taskSnapshot } = await import("./task-progress");
  const film = sampleFilm();
  const prepared = prepareVideoQueue(film, [film.shots[0]!], 2, false).film;
  const first = prepared.shots[0]!.takes[0]!;
  const recovered = interruptStaleWork(setVideoTaskState(prepared, first.id, "running")).film;
  publishFilmJobs(recovered);
  expect(taskSnapshot().tasks.map((task) => task.status)).toEqual(["failed", "queued"]);
  expect(taskSnapshot().tasks.map((task) => task.attempt)).toEqual([1, 1]);
});

test("external abort before execution never starts work and reaches a failed terminal state", async () => {
  const { runTask, taskSnapshot } = await import("./task-progress");
  const controller = new AbortController();
  controller.abort();
  const execute = vi.fn().mockResolvedValue("unused");
  await expect(
    runTask({ id: "pre-cancel", projectId: "cancel", kind: "export" }, execute, {
      signal: controller.signal,
    }),
  ).rejects.toThrow("TASK_CANCELLED");
  expect(execute).not.toHaveBeenCalled();
  expect(taskSnapshot().tasks[0]).toMatchObject({ status: "failed", reason: "已取消" });
});

test("external abort settles immediately even when work ignores the signal; late resolve cannot become done", async () => {
  const { runTask, taskSnapshot } = await import("./task-progress");
  const controller = new AbortController();
  let finish!: (value: string) => void;
  let received: AbortSignal | undefined;
  const pending = runTask(
    { id: "active-cancel", projectId: "cancel", kind: "export" },
    (signal) => {
      received = signal;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
    { signal: controller.signal },
  );
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toThrow("TASK_CANCELLED");
  expect(received?.aborted).toBe(true);
  finish("late");
  await Promise.resolve();
  expect(taskSnapshot().tasks[0]).toMatchObject({ status: "failed", reason: "已取消" });
});

test("queued film jobs still read as in progress when the task feed has not caught up", async () => {
  const { backgroundGenerationCopy } = await import("./task-progress");
  expect(
    backgroundGenerationCopy({ asking: false, active: 0, unfinished: 6, portraitBusy: false }),
  ).toBe("正在做 6 个");
  expect(
    backgroundGenerationCopy({ asking: false, active: 2, unfinished: 6, portraitBusy: false }),
  ).toBe("正在做 2 个");
  expect(
    backgroundGenerationCopy({ asking: true, active: 0, unfinished: 6, portraitBusy: false }),
  ).toBe("AI 在写");
  expect(
    backgroundGenerationCopy({ asking: false, active: 0, unfinished: 0, portraitBusy: true }),
  ).toBe("正在出定妆照");
  expect(
    backgroundGenerationCopy({ asking: false, active: 0, unfinished: 0, portraitBusy: false }),
  ).toBeNull();
});
