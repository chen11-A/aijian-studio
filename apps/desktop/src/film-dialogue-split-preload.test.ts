import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
it("keeps native split bridge sandbox electron-only and forwards one scope to fixed channels", async () => {
  const invoke = vi.fn(async () => ({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true }));
  let bridge!: {
    prepareFilmDialogueSplit: (v: unknown) => Promise<unknown>;
    applyFilmDialogueSplit: (v: unknown) => Promise<unknown>;
  };
  const compiled = ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
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
        ipcRenderer: { invoke },
      };
    },
  });
  const input = {
    projectId: "film_aaaaaaaaaaaaaaaa",
    expectedHash: "a".repeat(64),
    shotId: "source",
    versions: 2,
  };
  await bridge.prepareFilmDialogueSplit(input);
  const apply = { ...input, reviewFingerprint: "b".repeat(64) };
  await bridge.applyFilmDialogueSplit(apply);
  expect(invoke.mock.calls).toEqual([
    ["film:dialogue-split-prepare", input],
    ["film:dialogue-split-apply", apply],
  ]);
});
