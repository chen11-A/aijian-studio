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
    verifyFilmDialogueSplitBackup: (v: unknown) => Promise<unknown>;
    createStoryFilm: (...v: unknown[]) => Promise<unknown>;
    supportsStoryFilmLocalScope: boolean;
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
  const backup = {
    projectId: input.projectId,
    historyId: "hst_" + "d".repeat(32),
    beforeHash: input.expectedHash,
  };
  await bridge.verifyFilmDialogueSplitBackup(backup);
  expect(bridge.supportsStoryFilmLocalScope).toBe(true);
  const scope = {
    projectId: "film_aaaaaaaaaaaaaaaa",
    shotId: "source",
    takeId: "running",
    inputFingerprint: "c".repeat(64),
  };
  await bridge.createStoryFilm("backend", {}, scope);
  await bridge.createStoryFilm("backend", {});
  expect(invoke.mock.calls).toEqual([
    ["film:dialogue-split-prepare", input],
    ["film:dialogue-split-apply", apply],
    ["film:dialogue-split-verify-backup", backup],
    ["story-film:create", "backend", {}, scope],
    ["story-film:create", "backend", {}],
  ]);
});
