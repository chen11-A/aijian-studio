import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { filmAudioSourceIdentity, validFilmAudioWaveform } from "./film-audio-waveform-data";
function compile(path: string) {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
}
it("sandbox preload only loads electron and forwards the fixed waveform request without accepting a path argument", async () => {
  let bridge!: { readFilmAudioWaveform: (input: unknown) => Promise<unknown> };
  const result = { kind: "EMPTY", code: "NO_SOURCE" },
    invoke = vi.fn(async () => result);
  runInNewContext(compile(resolve("src/preload.ts")), {
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
    clipId: "clip1",
    expectedSourceKey: "a".repeat(64),
  };
  expect(await bridge.readFilmAudioWaveform(input)).toEqual(result);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("film:audio-waveform", input);
});
it("renderer and main serialize the same source identity and validate the same bounded peaks", () => {
  const exports: Record<string, unknown> = {};
  runInNewContext(compile(resolve("../studio-web/src/aivora/film/audio-waveform-data.ts")), {
    exports,
  });
  const browserIdentity = exports.filmAudioSourceIdentity as typeof filmAudioSourceIdentity,
    browserValid = exports.validFilmAudioWaveform as typeof validFilmAudioWaveform;
  const film = {
    id: "project",
    shots: [
      {
        id: "shot1",
        selectedTakeId: "take1",
        takes: [{ id: "take1", videoPath: "/a.mp4", status: "done" }],
      },
    ],
  };
  const clip = {
    id: "clip1",
    lane: "dialogue",
    shotId: "shot1",
    takeId: "take1",
    label: "配音",
    path: "/voice.wav",
    offsetSeconds: 0.5,
    durationSeconds: 1,
  };
  const fixed =
    '["project","clip1","dialogue","shot1","take1","配音","/voice.wav",0.5,1,"take1","/a.mp4","done","",""]';
  expect(filmAudioSourceIdentity(film, clip)).toBe(fixed);
  expect(browserIdentity(film, clip)).toBe(fixed);
  const wave = {
    schemaVersion: 1,
    sourceKey: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    offsetSeconds: 0,
    durationSeconds: 1,
    analyzedSeconds: 1,
    peaks: [0, 0.125, 1],
  };
  for (const value of [
    wave,
    { ...wave, peaks: [NaN, 1] },
    { ...wave, peaks: [0, Infinity] },
    { ...wave, peaks: [0, 1.1] },
    { ...wave, peaks: new Array(257).fill(0) },
    { ...wave, analyzedSeconds: 0 },
  ])
    expect(browserValid(value)).toBe(validFilmAudioWaveform(value));
});
