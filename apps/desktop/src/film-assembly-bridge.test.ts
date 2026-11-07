import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { registerFilmAssemblies } from "./film-assembly-ipc";
it("exposes fixed sandbox assembly invokes and a removable progress subscription with no runtime imports beyond electron", async () => {
  const source = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  let bridge!: Record<string, (...args: unknown[]) => unknown>;
  const invoke = vi.fn(async () => ({ kind: "FAILED", code: "INVALID_INPUT" })),
    on = vi.fn(),
    removeListener = vi.fn();
  runInNewContext(compiled, {
    exports: {},
    require: (name: string) => {
      expect(name).toBe("electron");
      return {
        contextBridge: {
          exposeInMainWorld: (name: string, value: typeof bridge) => {
            if (name === "aijian") bridge = value;
          },
        },
        ipcRenderer: { invoke, on, removeListener },
      };
    },
  });
  const input = {
    projectId: "film_aaaaaaaaaaaaaaaa",
    expectedHash: "a".repeat(64),
    expectedSelection: [{ shotId: "shot", takeId: "take" }],
  };
  await bridge.assembleFilmProject!(input, "one-op");
  expect(invoke.mock.lastCall).toEqual(["film:assembly-prepare", input, "one-op"]);
  await bridge.cancelFilmAssemblyOperation!("one-op");
  expect(invoke.mock.lastCall).toEqual(["film:assembly-cancel", "one-op"]);
  const listener = vi.fn(),
    unsubscribe = bridge.onFilmAssemblyProgress!(listener) as () => void;
  expect(on.mock.lastCall?.[0]).toBe("film:assembly-progress");
  const callback = on.mock.lastCall![1];
  callback({}, { operationId: "one-op", seq: 1 });
  expect(listener).toHaveBeenCalledWith({ operationId: "one-op", seq: 1 });
  unsubscribe();
  expect(removeListener).toHaveBeenCalledWith("film:assembly-progress", callback);
});
it("rejects untrusted frames, extra arguments and caller execution paths before tools or project reads", async () => {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>(),
    tools = vi.fn(),
    runner = vi.fn();
  registerFilmAssemblies<boolean>(
    (name, handler) => handlers.set(name, handler),
    (event) => event,
    (event) => String(event),
    {
      filmsRoot: "/must-not-read",
      storyFilmsRoot: "/must-not-read",
      temporaryRoot: "/must-not-read",
      font: () => "/must-not-read",
      tools,
      runner,
    },
  );
  for (const name of ["film:assembly-prepare", "film:assembly-cancel"])
    await expect(handlers.get(name)!(false, {})).rejects.toThrow("not authorized");
  await expect(handlers.get("film:assembly-prepare")!(true, {}, "op", "extra")).rejects.toThrow(
    "Invalid assembly arguments",
  );
  const input = {
    projectId: "film_aaaaaaaaaaaaaaaa",
    expectedHash: "a".repeat(64),
    expectedSelection: [{ shotId: "shot", takeId: "take" }],
    path: "/forged.mp4",
  };
  expect(await handlers.get("film:assembly-prepare")!(true, input)).toEqual({
    kind: "FAILED",
    code: "INVALID_INPUT",
  });
  await expect(handlers.get("film:assembly-cancel")!(true, "op", "extra")).rejects.toThrow(
    "Invalid assembly cancellation",
  );
  expect(tools).not.toHaveBeenCalled();
  expect(runner).not.toHaveBeenCalled();
});
