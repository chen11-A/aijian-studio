import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
it("keeps recovered-video operations in the sandbox bridge with only project and opaque local attempt", async () => {
  const compiled = ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const invoke = vi.fn(async () => ({ kind: "FAILED", code: "UNAVAILABLE" }));
  let bridge!: Record<string, (...args: string[]) => Promise<unknown>>;
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
  await bridge.listGenerationVideoRecoveries!("project");
  await bridge.recoverGenerationVideo!("project", "attempt");
  await bridge.saveRecoveredGenerationVideo!("project", "attempt");
  expect(invoke.mock.calls).toEqual([
    ["story-film:video-recovery-list", "project"],
    ["story-film:video-recover", "project", "attempt"],
    ["story-film:video-recovery-save", "project", "attempt"],
  ]);
});
