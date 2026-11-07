import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { registerFilmRiskTrials } from "./film-risk-trial-ipc";
import type { createFilmRiskTrials } from "./film-risk-trial";
it("authorizes only the main-frame owner and exact arguments before touching trial operations", async () => {
  const callbacks = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  const methods = {
    prepare: vi.fn(async () => ({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true })),
    readMedia: vi.fn(async () => ({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true })),
    record: vi.fn(async () => ({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true })),
    check: vi.fn(async () => ({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true })),
  };
  registerFilmRiskTrials(
    (name, run) => callbacks.set(name, run),
    (event: boolean) => event,
    () => 7,
    methods as unknown as ReturnType<typeof createFilmRiskTrials>,
  );
  await expect(callbacks.get("film:risk-trial-record")!(false, {})).rejects.toThrow("Unauthorized");
  await expect(
    callbacks.get("film:risk-trial-media")!(true, "project", "token", "/private/override"),
  ).rejects.toThrow("Invalid");
  expect(methods.record).not.toHaveBeenCalled();
  expect(methods.readMedia).not.toHaveBeenCalled();
  const input = { projectId: "project", expectedHash: "hash", shotId: "shot", takeId: "take" };
  await callbacks.get("film:risk-trial-prepare")!(true, input);
  await callbacks.get("film:risk-trial-record")!(true, input);
  await callbacks.get("film:risk-trial-check")!(true, input);
  await callbacks.get("film:risk-trial-media")!(true, "project", "token");
  expect(methods.prepare).toHaveBeenCalledExactlyOnceWith(7, input);
  expect(methods.record).toHaveBeenCalledExactlyOnceWith(7, input);
  expect(methods.check).toHaveBeenCalledExactlyOnceWith(7, input);
  expect(methods.readMedia).toHaveBeenCalledExactlyOnceWith(7, "project", "token");
});
it("uses the sandbox preload's closed channels without renderer paths, owners or provider credentials", async () => {
  const compiled = ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const invoke = vi.fn(async () => ({
    kind: "FAILED",
    code: "UNSUPPORTED_SCOPE",
    unchanged: true,
  }));
  let bridge!: Record<string, (...args: unknown[]) => Promise<unknown>>;
  runInNewContext(compiled, {
    exports: {},
    require: (name: string) => {
      expect(name).toBe("electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_: string, value: typeof bridge) => {
            bridge = value;
          },
        },
        ipcRenderer: { invoke },
      };
    },
  });
  const input = { projectId: "project", expectedHash: "hash", shotId: "shot", takeId: "take" };
  await bridge.prepareFilmRiskTrial!(input);
  await bridge.readFilmRiskTrialMedia!("project", "token");
  await bridge.recordFilmRiskTrialDecision!(input);
  await bridge.checkFilmRiskTrialDecision!(input);
  expect(invoke.mock.calls).toEqual([
    ["film:risk-trial-prepare", input],
    ["film:risk-trial-media", "project", "token"],
    ["film:risk-trial-record", input],
    ["film:risk-trial-check", input],
  ]);
});
