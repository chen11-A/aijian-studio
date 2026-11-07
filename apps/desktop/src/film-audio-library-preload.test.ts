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
    inspectBundledFilmAudioTarget: (input: unknown) => Promise<unknown>;
    suggestBundledFilmSceneAudio: (input: unknown) => Promise<unknown>;
    applyBundledFilmSceneAudio: (input: unknown) => Promise<unknown>;
    applyBundledFilmShotAudio: (input: unknown) => Promise<unknown>;
    suggestBundledFilmShotAudio: (input: unknown) => Promise<unknown>;
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
  const target = {
    projectId: input.projectId,
    expectedProjectHash: input.expectedProjectHash,
    shotId: input.shotId,
    takeId: input.takeId,
  };
  const apply = {
    ...target,
    catalogSha256: "a".repeat(64),
    pickerSha256: "b".repeat(64),
    planFingerprint: "c".repeat(64),
    lanes: ["sfx"],
  };
  const scene = {
    projectId: input.projectId,
    expectedProjectHash: input.expectedProjectHash,
    sceneId: "scene",
    expectedSelection: [{ shotId: "shot", takeId: "take" }],
  };
  await bridge.suggestBundledFilmSceneAudio(scene);
  await bridge.applyBundledFilmSceneAudio({
    ...scene,
    catalogSha256: apply.catalogSha256,
    pickerSha256: apply.pickerSha256,
    planFingerprint: apply.planFingerprint,
    lanes: apply.lanes,
  });
  await bridge.applyBundledFilmShotAudio(apply);
  await bridge.suggestBundledFilmShotAudio(target);
  await bridge.inspectBundledFilmAudioTarget(target);
  await bridge.listBundledFilmAudio();
  await bridge.addBundledFilmAudio(input);
  expect(invoke.mock.calls).toEqual([
    ["film:audio-library-scene-suggest", scene],
    [
      "film:audio-library-scene-apply",
      {
        ...scene,
        catalogSha256: apply.catalogSha256,
        pickerSha256: apply.pickerSha256,
        planFingerprint: apply.planFingerprint,
        lanes: apply.lanes,
      },
    ],
    ["film:audio-library-shot-apply", apply],
    ["film:audio-library-shot-suggest", target],
    ["film:audio-library-target", target],
    ["film:audio-library-list"],
    ["film:audio-library-add", input],
  ]);
});
