import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { audioSourceKey } from "./actions/audio-waveforms";
import type {
  FilmAudioWaveformInput,
  FilmAudioWaveformResult,
} from "@aijian/contracts/film-audio-waveform";
import * as editorModule from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";
const createHost = editorModule.createEditorHost;
async function open(pending = false, duration = 1, analyzedSeconds = duration) {
  let host!: Parameters<typeof createHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return createHost(value);
  });
  const film = sampleFilm();
  film.audioClips = [
    {
      id: "score-1",
      lane: "score",
      shotId: "",
      takeId: "",
      label: "",
      path: "/synthetic/music.wav",
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: duration,
      gainDb: -14,
    },
  ];
  let stored = structuredClone(film),
    finish!: (result: FilmAudioWaveformResult) => void;
  const read = vi.fn(async (input: FilmAudioWaveformInput): Promise<FilmAudioWaveformResult> =>
    pending
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : duration <= 0
        ? { kind: "EMPTY", code: "WINDOW_UNKNOWN" }
        : {
            kind: "READY",
            waveform: {
              schemaVersion: 1,
              sourceKey: input.expectedSourceKey,
              sourceSha256: "a".repeat(64),
              offsetSeconds: 0,
              durationSeconds: duration,
              analyzedSeconds,
              peaks: [0, 0.125, 0.25, 0],
            },
          },
  );
  const writes = vi.fn(async (value: FilmProject) => {
    stored = structuredClone(value);
    return structuredClone(value);
  });
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(stored)),
    writeFilmProject: writes,
    prepareFilmProject: vi.fn(async (v: FilmProject) => structuredClone(v)),
    readFilmAudioWaveform: read,
    createStoryFilm: vi.fn(),
    exportFilmCut: vi.fn(),
  } as unknown as Window["aijian"];
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  return {
    film,
    host: () => host,
    read,
    writes,
    stored: () => stored,
    finish: async (result?: FilmAudioWaveformResult) => {
      const key = await audioSourceKey(film, film.audioClips[0]!);
      await act(async () =>
        finish(
          result ?? {
            kind: "READY",
            waveform: {
              schemaVersion: 1,
              sourceKey: key,
              sourceSha256: "a".repeat(64),
              offsetSeconds: 0,
              durationSeconds: 1,
              analyzedSeconds: 1,
              peaks: [0, 0.125, 0.25, 0],
            },
          },
        ),
      );
    },
  };
}
beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());
it("enters the real edit page, verifies before rendering and persists real peak metadata without generation", async () => {
  const env = await open();
  await screen.findByRole("img", { name: "已核对音源的波形（混音前）" });
  expect(env.read).toHaveBeenCalledOnce();
  expect(Object.keys(env.read.mock.calls[0]![0]).sort()).toEqual([
    "clipId",
    "expectedSourceKey",
    "projectId",
  ]);
  await waitFor(() =>
    expect(env.stored().audioClips[0]!.waveform?.peaks).toEqual([0, 0.125, 0.25, 0]),
  );
  expect(window.aijian?.createStoryFilm).not.toHaveBeenCalled();
  expect(window.aijian?.exportFilmCut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "刷新音频波形" }));
  await waitFor(() => expect(env.read).toHaveBeenCalledTimes(2));
});
it("does not display a late waveform after leaving edit and preserves the empty lane", async () => {
  const env = await open(true);
  await waitFor(() => expect(env.read).toHaveBeenCalledOnce());
  expect(screen.queryByRole("img", { name: "已核对音源的波形（混音前）" })).toBeNull();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剧本/,
    }),
  );
  await env.finish();
  expect(env.stored().audioClips[0]!.waveform).toBeUndefined();
  expect(screen.queryByRole("img", { name: "已核对音源的波形（混音前）" })).toBeNull();
});
it("keeps an unavailable source empty and allows an explicit retry", async () => {
  const env = await open(true);
  await waitFor(() => expect(env.read).toHaveBeenCalledOnce());
  env.read.mockResolvedValue({ kind: "EMPTY", code: "NO_AUDIO" });
  await env.finish({ kind: "EMPTY", code: "NO_AUDIO" });
  await screen.findByRole("button", { name: "刷新音频波形" });
  fireEvent.click(screen.getByRole("button", { name: "刷新音频波形" }));
  await waitFor(() => expect(env.read).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByRole("img", { name: "已核对音源的波形（混音前）" })).toBeNull(),
  );
});

it("does not stretch unknown-duration music into a seemingly time-aligned waveform", async () => {
  const env = await open(false, 0);
  await waitFor(() => expect(env.read).toHaveBeenCalledOnce());
  await screen.findByRole("button", { name: "刷新音频波形" });
  expect(screen.queryByRole("img", { name: "已核对音源的波形（混音前）" })).toBeNull();
  expect(screen.getByText(/导入的音乐.*波形时长未确定/)).toBeInTheDocument();
  expect(env.stored().audioClips[0]!.durationSeconds).toBe(0);
});

it("places a five-second measured source on only the first quarter of a twenty-second clip", async () => {
  const env = await open(false, 20, 5);
  const wave = await screen.findByRole("img", { name: "已核对音源的波形（混音前）" });
  const points = wave
    .querySelector("polyline")!
    .getAttribute("points")!
    .split(" ")
    .map((point) => point.split(",").map(Number));
  expect(points[0]![0]).toBe(0);
  expect(points.at(-1)![0]).toBe(25);
  expect(points.every((point) => point[0]! <= 25)).toBe(true);
  await waitFor(() => expect(env.stored().audioClips[0]!.waveform?.analyzedSeconds).toBe(5));
  expect(env.stored().audioClips[0]!.durationSeconds).toBe(20);
});

it.each(["peaks", "analyzedSeconds"] as const)(
  "does not trust a replaced %s cache body with the same source key/hash until refreshed",
  async (field) => {
    const env = await open();
    await screen.findByRole("img", { name: "已核对音源的波形（混音前）" });
    await screen.findByRole("button", { name: "刷新音频波形" });
    const changed = structuredClone(env.host().current()!);
    const waveform = changed.audioClips[0]!.waveform!;
    const sameSource = { key: waveform.sourceKey, sha: waveform.sourceSha256 };
    if (field === "peaks") waveform.peaks[1] = 0.9;
    else waveform.analyzedSeconds = 0.25;
    act(() => env.host().applyLive(changed));
    expect(waveform.sourceKey).toBe(sameSource.key);
    expect(waveform.sourceSha256).toBe(sameSource.sha);
    expect(screen.queryByRole("img", { name: "已核对音源的波形（混音前）" })).toBeNull();
    expect(env.read).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "刷新音频波形" }));
    await screen.findByRole("img", { name: "已核对音源的波形（混音前）" });
    expect(env.read).toHaveBeenCalledTimes(2);
    expect(env.host().current()!.audioClips[0]!.waveform!.peaks).toEqual([0, 0.125, 0.25, 0]);
    expect(env.host().current()!.audioClips[0]!.waveform!.analyzedSeconds).toBe(1);
  },
);
