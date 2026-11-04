import { expect, test, vi } from "vitest";
import { registerTaskProgressHandlers, validTaskSnapshot } from "./task-progress-ipc";

const snapshot = () => ({
  tasks: [{ id: "job-1", shotId: "shot-1", kind: "image", status: "queued", attempt: 1 }],
  batches: [{ batchId: "b", label: "定妆照", done: 0, total: 1, failed: 0, running: false }],
});

test("authorized snapshots are emitted and retained per window without executing work", async () => {
  const handlers = new Map<string, (event: number, ...args: unknown[]) => Promise<unknown>>();
  const emit = vi.fn();
  registerTaskProgressHandlers(
    (name, callback) => handlers.set(name, callback),
    (id) => id > 0,
    (id) => id,
    emit,
  );
  const published = snapshot();
  await handlers.get("film:tasks-publish")?.(1, published);
  expect(emit).toHaveBeenCalledWith(1, published);
  published.tasks[0]!.status = "done";
  expect(await handlers.get("film:tasks-read")?.(1)).toMatchObject({
    tasks: [{ status: "queued" }],
  });
  expect(await handlers.get("film:tasks-read")?.(2)).toEqual({ tasks: [], batches: [] });
  await expect(handlers.get("film:tasks-publish")?.(0, snapshot())).rejects.toThrow(
    "not authorized",
  );
  await expect(handlers.get("film:tasks-read")?.(0)).rejects.toThrow("not authorized");
  await expect(
    handlers.get("film:tasks-publish")?.(1, { ...snapshot(), secret: "not accepted" }),
  ).rejects.toThrow("Invalid task snapshot");
});

test("strict boundary rejects unexpected content, invalid counters/status, duplicate IDs", () => {
  expect(validTaskSnapshot(snapshot())).toBe(true);
  expect(
    validTaskSnapshot({ tasks: [{ ...snapshot().tasks[0], prompt: "novel text" }], batches: [] }),
  ).toBe(false);
  expect(
    validTaskSnapshot({ tasks: [{ ...snapshot().tasks[0], status: "invented" }], batches: [] }),
  ).toBe(false);
  expect(validTaskSnapshot({ tasks: [{ ...snapshot().tasks[0], attempt: -1 }], batches: [] })).toBe(
    false,
  );
  expect(
    validTaskSnapshot({ tasks: [...snapshot().tasks, ...snapshot().tasks], batches: [] }),
  ).toBe(false);
  expect(validTaskSnapshot({ tasks: [], batches: [{ ...snapshot().batches[0], done: 2 }] })).toBe(
    false,
  );
});
