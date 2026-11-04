import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, test, vi } from "vitest";

test("sandbox preload forwards last-frame requests only to its fixed IPC channel", async () => {
  const source = readFileSync(resolve(process.cwd(), "src/preload.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  let bridge!: { extractFilmLastFrame: (seriesId: string, videoPath: string) => Promise<unknown> };
  const result = { path: "/films/frame.png", sourceVideoPath: "/story/shot.mp4" };
  const invoke = vi.fn().mockResolvedValue(result);
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
  await expect(
    bridge.extractFilmLastFrame("film_series0000000001", "/story/shot.mp4"),
  ).resolves.toEqual(result);
  expect(invoke).toHaveBeenCalledExactlyOnceWith(
    "film:last-frame",
    "film_series0000000001",
    "/story/shot.mp4",
  );
  const failure = {
    path: "",
    sourceVideoPath: "",
    code: "CONTINUITY_VIDEO_INVALID",
    text: "视频不可用。",
  };
  invoke.mockResolvedValueOnce(failure);
  await expect(
    bridge.extractFilmLastFrame("film_series0000000001", "/external.mp4"),
  ).resolves.toEqual(failure);
});
