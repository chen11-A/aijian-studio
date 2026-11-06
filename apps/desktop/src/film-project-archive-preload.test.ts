import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
it("sandbox preload imports only electron and sends identity-only archive actions to fixed channels", async () => {
  const compiled = ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const invoke = vi.fn(async () => ({ kind: "CANCELLED" }));
  let bridge!: {
    exportFilmProjectArchive: (input: unknown) => Promise<unknown>;
    importFilmProjectArchive: () => Promise<unknown>;
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
  const input = { projectId: "film_aaaaaaaaaaaaaaaa", expectedHash: "a".repeat(64) };
  await bridge.exportFilmProjectArchive(input);
  await bridge.importFilmProjectArchive();
  expect(invoke.mock.calls).toEqual([
    ["film:project-archive-export", input],
    ["film:project-archive-import"],
  ]);
});
