import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
function fixture() {
  let bridge!: {
    createStoryFilm: (...args: unknown[]) => Promise<unknown>;
    generateFilmStill: (...args: unknown[]) => Promise<unknown>;
    extractFilmLastFrame: (...args: unknown[]) => Promise<unknown>;
  };
  const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    kind: "controlled",
  }));
  runInNewContext(
    ts.transpileModule(readFileSync(resolve("src/preload.ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
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
    },
  );
  return { bridge, invoke };
}
it("forwards each protected context in its fixed position without serializing private/account fields", async () => {
  const { bridge, invoke } = fixture();
  const image = { executionId: "issued", stageId: "frame" },
    video = { executionId: "issued", videoSlotId: "slot", shotId: "shot", takeId: "take" };
  const body = { provider: "grok_subscription", confirmed: true },
    scope = { projectId: "film", shotId: "shot", takeId: "take", inputFingerprint: "a".repeat(64) };
  await bridge.generateFilmStill("series", "画面", "16:9", ["reference"], image);
  await bridge.extractFilmLastFrame("series", "source.mp4", image);
  await bridge.createStoryFilm("project", body, scope, video);
  await bridge.createStoryFilm("project", body, undefined, video);
  expect(invoke.mock.calls).toEqual([
    ["film:still", "series", "画面", "16:9", ["reference"], image],
    ["film:last-frame", "series", "source.mp4", image],
    ["story-film:create", "project", body, scope, video],
    ["story-film:create", "project", body, undefined, video],
  ]);
});
it("preserves legacy arities but never downgrades an explicit null protected argument", async () => {
  const { bridge, invoke } = fixture(),
    body = { provider: "stub" };
  await bridge.generateFilmStill("series", "画面");
  await bridge.extractFilmLastFrame("series", "source.mp4");
  await bridge.createStoryFilm("project", body);
  await bridge.generateFilmStill("series", "画面", "16:9", [], null);
  await bridge.extractFilmLastFrame("series", "source.mp4", null);
  await bridge.createStoryFilm("project", body, undefined, null);
  expect(invoke.mock.calls).toEqual([
    ["film:still", "series", "画面", undefined, []],
    ["film:last-frame", "series", "source.mp4"],
    ["story-film:create", "project", body],
    ["film:still", "series", "画面", "16:9", [], null],
    ["film:last-frame", "series", "source.mp4", null],
    ["story-film:create", "project", body, undefined, null],
  ]);
});
