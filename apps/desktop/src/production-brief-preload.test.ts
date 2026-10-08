import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, test, vi } from "vitest";

test("actual sandbox preload exposes fixed ProductionBrief invokes", async () => {
  const source = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  let bridge!: Record<string, (...args: unknown[]) => Promise<unknown>>;
  const invoke = vi.fn().mockResolvedValue({ receipt: true });
  runInNewContext(compiled, {
    exports: {},
    require: (name: string) => {
      expect(name).toBe("electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_name: string, value: typeof bridge) => (bridge = value),
        },
        ipcRenderer: { invoke },
      };
    },
  });
  const projectId = `prj_${"1".repeat(32)}`;
  const versionId = `ver_${"2".repeat(32)}`;
  await expect(bridge.getProductionBrief!(projectId)).resolves.toEqual({ receipt: true });
  expect(invoke.mock.lastCall).toEqual(["production-brief:get", projectId]);
  await bridge.getProductionBriefVersion!(projectId, versionId);
  expect(invoke.mock.lastCall).toEqual(["production-brief:get-version", projectId, versionId]);
  const command = { operation_id: "80cdb6d5-4633-4ffb-9d68-0c9456452274", input: {} };
  await bridge.createProductionBriefVersion!(projectId, command);
  expect(invoke.mock.lastCall).toEqual(["production-brief:create", projectId, command]);
  expect(source).toContain('"production-brief:get"');
  expect(source).toContain('"production-brief:get-version"');
  expect(source).toContain('"production-brief:create"');
  expect(source).not.toMatch(/productionBriefIdempotencyKey|sidecar.*token|Authorization/);
});
