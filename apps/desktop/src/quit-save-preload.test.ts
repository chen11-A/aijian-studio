import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import type { QuitSaveGateway } from "@aijian/contracts/quit-save";
function harness() {
  let bridge!: QuitSaveGateway;
  let listener!: (_event: unknown, request: unknown) => void;
  const ipc = {
    on: vi.fn((_channel: string, callback: typeof listener) => {
      listener = callback;
    }),
    removeListener: vi.fn(),
    invoke: vi.fn(async () => undefined),
  };
  runInNewContext(
    ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports: {},
      require: (name: string) => {
        expect(name).toBe("electron");
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, value: QuitSaveGateway) => {
              bridge = value;
            },
          },
          ipcRenderer: ipc,
        };
      },
    },
  );
  return {
    bridge,
    ipc,
    emit: (value: unknown) => listener({ secret: "must not cross bridge" }, value),
  };
}
it("forwards only the fixed save request DTO and matches the actual receipt channel", async () => {
  const h = harness(),
    callback = vi.fn();
  h.bridge.onFlush(callback);
  for (const value of [
    null,
    {},
    { requestId: 1 },
    { requestId: "valid", path: "raw" },
    { requestId: "bad id" },
  ])
    h.emit(value);
  expect(callback).not.toHaveBeenCalled();
  h.emit({ requestId: "quit-1" });
  expect(callback).toHaveBeenCalledExactlyOnceWith({ requestId: "quit-1" });
  await h.bridge.flushed({ requestId: "quit-1", status: "failed" });
  expect(h.ipc.invoke).toHaveBeenCalledExactlyOnceWith("film:flushed", {
    requestId: "quit-1",
    status: "failed",
  });
});
it("unsubscribes the same listener and suppresses a retained late callback", () => {
  const h = harness(),
    callback = vi.fn();
  const unsubscribe = h.bridge.onFlush(callback);
  const listener = h.ipc.on.mock.calls[0]![1];
  unsubscribe();
  h.emit({ requestId: "late" });
  expect(callback).not.toHaveBeenCalled();
  expect(h.ipc.removeListener).toHaveBeenCalledExactlyOnceWith("aivora:flush", listener);
});
