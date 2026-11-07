import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

it("keeps failure policy on fixed sandbox IPC channels with no account/token argument", async () => {
  const compiled = ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const invoke = vi.fn(async () => ({ kind: "FAILED", code: "UNAVAILABLE" }));
  let bridge!: {
    getGenerationFailurePolicy: (project: string) => Promise<unknown>;
    configureGenerationFailurePolicy: (project: string, input: unknown) => Promise<unknown>;
  };
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
  const project = `prj_${"b".repeat(32)}`;
  const input = { expected_revision: 0, failure_limit: 0 };
  await bridge.getGenerationFailurePolicy(project);
  await bridge.configureGenerationFailurePolicy(project, input);
  expect(invoke.mock.calls).toEqual([
    ["story-film:failure-policy", project],
    ["story-film:configure-failure-policy", project, input],
  ]);
});
