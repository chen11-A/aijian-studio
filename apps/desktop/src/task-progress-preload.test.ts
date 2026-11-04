import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, test, vi } from "vitest";
import type { TaskListener, TaskSnapshot } from "@aijian/contracts/task-progress";

function ipcHarness() {
  let eventListener: ((event: unknown, snapshot: TaskSnapshot) => void) | undefined;
  let initial: ((snapshot: TaskSnapshot) => void) | undefined;
  const ipc = {
    on: vi.fn((_channel: string, listener: (event: unknown, snapshot: TaskSnapshot) => void) => {
      eventListener = listener;
    }),
    removeListener: vi.fn(),
    invoke: vi.fn(
      () =>
        new Promise<TaskSnapshot>((resolve) => {
          initial = resolve;
        }),
    ),
  };
  let bridge:
    { onTask: (listener: TaskListener) => () => void; publishTasks: TaskListener } | undefined;
  const compiled = ts.transpileModule(
    readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  runInNewContext(compiled, {
    exports: {},
    require: (name: string) => {
      expect(name).toBe("electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_name: string, value: typeof bridge) => {
            bridge = value;
          },
        },
        ipcRenderer: ipc,
      };
    },
  });
  if (!bridge) throw new Error("preload did not expose bridge");
  return {
    ipc,
    bridge,
    emit: (snapshot: TaskSnapshot) => eventListener?.(null, snapshot),
    read: (snapshot: TaskSnapshot) => initial?.(snapshot),
  };
}

test("actual self-contained preload subscribes and ignores a stale initial task read", async () => {
  const h = ipcHarness();
  const callback = vi.fn();
  const stop = h.bridge.onTask(callback);
  const current: TaskSnapshot = {
    tasks: [{ id: "image", kind: "image", status: "running", attempt: 1 }],
    batches: [],
  };
  h.emit(current);
  h.read({ tasks: [], batches: [] });
  await Promise.resolve();
  expect(callback).toHaveBeenCalledExactlyOnceWith(current.tasks, []);
  stop();
  expect(h.ipc.removeListener).toHaveBeenCalledWith("aivora:tasks", expect.any(Function));
  h.bridge.publishTasks(current.tasks, current.batches);
  expect(h.ipc.invoke).toHaveBeenLastCalledWith("film:tasks-publish", current);
});

test("actual preload unsubscribe suppresses initial read and later task events", async () => {
  const h = ipcHarness();
  const callback = vi.fn();
  h.bridge.onTask(callback)();
  h.read({ tasks: [], batches: [] });
  h.emit({ tasks: [], batches: [] });
  await Promise.resolve();
  expect(callback).not.toHaveBeenCalled();
});
