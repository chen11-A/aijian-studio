import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
it("keeps the sandbox bridge electron-only and forwards identity/placement to fixed channels", async () => {
  const compiled = ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const invoke = vi.fn(async () => ({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true }));
  let bridge!: {
    listBundledFilmAudio: () => Promise<unknown>;
    addBundledFilmAudio: (input: unknown) => Promise<unknown>;
  };
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
    expectedProjectHash: "a".repeat(64),
    catalogSha256: "b".repeat(64),
    assetId: "asset",
    expectedAssetSha256: "c".repeat(64),
    shotId: "shot",
    takeId: "take",
    lane: "sfx",
    placement: { startSeconds: 0, durationSeconds: 0.2, offsetSeconds: 0, gainDb: 0, loop: false },
  };
  await bridge.listBundledFilmAudio();
  await bridge.addBundledFilmAudio(input);
  expect(invoke.mock.calls).toEqual([
    ["film:audio-library-list"],
    ["film:audio-library-add", input],
  ]);
});
