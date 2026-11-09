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
    confirmFixedInput: (projectId: string, offerId: string) => Promise<unknown>;
    importFixedInput: (projectId: string) => Promise<unknown>;
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

it("uses only the two fixed prepare/retire channels and preserves the exact public scope", async () => {
  const { bridge, invoke } = fixture();
  const executionBridge = bridge as typeof bridge & {
    prepareFilmGenerationExecution: (input: unknown) => Promise<unknown>;
    retireFilmGenerationExecution: (input: unknown) => Promise<unknown>;
  };
  const input = {
    projectId: "film",
    expectedProjectHash: "a".repeat(64),
    mode: "video",
    targets: [{ shotId: "shot", versions: 1 }],
  };
  const retired = { executionId: "issued", videoSlotId: "slot" };
  await executionBridge.prepareFilmGenerationExecution(input);
  await executionBridge.retireFilmGenerationExecution(retired);
  expect(invoke.mock.calls).toEqual([
    ["film:generation-execution-prepare", input],
    ["film:generation-execution-retire", retired],
  ]);
});

it("forwards fixed-input confirm and import with only the explicit project and offer", async () => {
  const { bridge, invoke } = fixture();
  const projectId = `film_${"a".repeat(16)}`;
  const offerId = `fio_${"01234567-89ab-cdef-0123-456789abcdef"}`;
  await bridge.confirmFixedInput(projectId, offerId);
  await bridge.importFixedInput(projectId);
  expect(invoke.mock.calls).toEqual([
    ["film:confirm-fixed-input", projectId, offerId],
    ["film:import-fixed-input", projectId],
  ]);
});
