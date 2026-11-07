import type { AudioMixPreviewResult } from "@aijian/contracts/film-audio-mix";
import { buildAudioMixPlan } from "@aijian/contracts/film-audio-mix-plan";
import { filmAudioSourceIdentity } from "../film/audio-waveform-data";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FilmAssemblyInput, FilmAssemblyResult } from "@aijian/contracts/film-assembly";
import { sampleFilm, type FilmProject } from "../film/project";
import { NOTICE_TEXT } from "../film/notices";
import { historyRecordHash } from "./actions/persistent-history";
import * as editor from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editor.createEditorHost;
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function open(
  options: {
    partial?: boolean;
    deferred?: boolean;
    unknownClock?: boolean;
    saveFailure?: boolean;
    metadataHold?: boolean;
    metadataBusy?: boolean;
  } = {},
) {
  let host!: Parameters<typeof originalHost>[0];
  vi.spyOn(editor, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  const film = sampleFilm();
  film.scenes = film.scenes.slice(0, 1);
  film.shots = film.shots.slice(0, 3).map((shot, i) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    seconds: 99,
    selectedTakeId: i < 2 ? `t${i}` : "",
    takes:
      i < 2
        ? [
            {
              id: `t${i}`,
              shotId: shot.id,
              index: 1,
              status: "done" as const,
              videoPath: `/trusted/${i}.mp4`,
              videoUrl: "",
              stillUrl: "",
              prompt: "",
              reason: "",
              createdAt: "",
            },
          ]
        : [],
  }));
  if (options.unknownClock) {
    film.shots = film.shots.slice(0, 1);
    film.assemblyPath = "/trusted/existing-without-clock.mp4";
    film.assemblyUrl = "aijian-media:///trusted/existing-without-clock.mp4";
  }
  film.audioClips = [
    {
      id: "score",
      lane: "score",
      shotId: "",
      takeId: "",
      label: "Music",
      path: "/trusted/music.wav",
      startSeconds: 0,
      durationSeconds: 3,
      offsetSeconds: 0,
      gainDb: 0,
    },
  ];
  let disk = structuredClone(film),
    resolve!: (value: FilmAssemblyResult) => void;
  let input: FilmAssemblyInput | undefined;
  let releaseWave!: () => void, releasePreview!: () => void;
  const waveHold = new Promise<void>((done) => {
      releaseWave = done;
    }),
    previewHold = new Promise<void>((done) => {
      releasePreview = done;
    });
  const metadataOrder: string[] = [];
  const wave = vi.fn(async (value: { expectedSourceKey: string }) => {
    metadataOrder.push("wave-start");
    await waveHold;
    metadataOrder.push("wave-ready");
    return {
      kind: "READY",
      waveform: {
        schemaVersion: 1,
        sourceKey: value.expectedSourceKey,
        sourceSha256: "b".repeat(64),
        offsetSeconds: 0,
        durationSeconds: 3,
        analyzedSeconds: 3,
        peaks: [0.1, 0.2],
      },
    };
  });
  if (options.metadataBusy) releaseWave();
  let previewCalls = 0;
  const preview = vi.fn(
    async (value: { projectId: string; expectedHash: string }): Promise<AudioMixPreviewResult> => {
      expect(value.expectedHash).toBe(await historyRecordHash(disk));
      if (options.metadataBusy) return { kind: "FAILED", code: "BUSY" };
      if (++previewCalls === 1) await previewHold;
      metadataOrder.push("preview-ready");
      return {
        kind: "READY",
        fingerprint: value.expectedHash,
        plan: buildAudioMixPlan({
          projectId: disk.id,
          durationSeconds: 3,
          shots: disk.shots
            .filter((s) => s.selectedTakeId)
            .map((shot, i) => ({
              shotId: shot.id,
              takeId: shot.selectedTakeId!,
              startSeconds: i ? 2 : 0,
              durationSeconds: i ? 1 : 2,
              nativeSourceKey: shot.selectedTakeId!,
              hasDialogue: false,
            })),
          clips: [{ ...disk.audioClips[0]!, sourceKey: "score" }],
          sources: {
            t0: { durationSeconds: 2, hasAudio: true },
            t1: { durationSeconds: 1, hasAudio: true },
            score: { durationSeconds: 3, hasAudio: true },
          },
        }),
        sourcePaths: { t0: "/trusted/0.mp4", t1: "/trusted/1.mp4", score: "/trusted/music.wav" },
        sourceSha256: {},
        sourceInfo: {},
      };
    },
  );
  const oldAssemble = vi.fn(),
    provider = vi.fn(),
    cancel = vi.fn(async () => ({ kind: "REQUESTED" as const }));
  function result(value: FilmAssemblyInput): FilmAssemblyResult {
    return {
      kind: options.partial ? "PARTIAL" : "ASSEMBLED",
      projectId: value.projectId,
      projectHash: value.expectedHash,
      path: "/trusted/new-assembly.mp4",
      durationSeconds: 3,
      shots: value.expectedSelection.map((row, i) => ({
        ...row,
        startSeconds: i ? 2 : 0,
        durationSeconds: i ? 1 : 2,
      })),
      limitations: [],
      ...(options.partial ? { incomplete: "audio" as const } : {}),
    };
  }
  const assemble = vi.fn(async (value: FilmAssemblyInput) => {
    metadataOrder.push("assembly");
    expect(value.expectedHash).toBe(await historyRecordHash(disk));
    input = value;
    expect(value.expectedSelection).toEqual(
      disk.shots
        .filter((s) => s.selectedTakeId)
        .map((s) => ({ shotId: s.id, takeId: s.selectedTakeId! })),
    );
    return options.deferred
      ? new Promise<FilmAssemblyResult>((done) => {
          resolve = done;
        })
      : result(value);
  });
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(disk)),
    prepareFilmProject: vi.fn(async (v: FilmProject) => structuredClone(v)),
    writeFilmProject: vi.fn(async (v: FilmProject) => {
      if (options.saveFailure && v.assemblyPath === "/trusted/new-assembly.mp4")
        throw Error("private write failure");
      disk = structuredClone(v);
      return structuredClone(v);
    }),
    captureFilmHistory: vi.fn(),
    restoreFilmHistory: vi.fn(),
    listFilmHistory: vi.fn(),
    assembleFilmProject: assemble,
    cancelFilmAssemblyOperation: cancel,
    assembleFilm: oldAssemble,
    createStoryFilm: provider,
  } as unknown as Window["aijian"];
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "test",
      lastError: null,
    })),
    models: vi.fn(async () => ({
      kind: "OK",
      models: [{ id: "grok-imagine-video-1.5", label: "video" }],
    })),
  } as unknown as Window["aijianGrok"];
  if (options.metadataHold || options.metadataBusy)
    Object.assign(window.aijian!, { readFilmAudioWaveform: wave, getFilmAudioMixPreview: preview });
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  return {
    host: () => host,
    disk: () => disk,
    film,
    assemble,
    cancel,
    oldAssemble,
    provider,
    wave,
    preview,
    releaseWave,
    releasePreview,
    metadataOrder,
    complete: () => resolve(result(input!)),
  };
}
it("assembles only actual ready selections then jumps and marks source seconds using the native per-shot clock", async () => {
  const f = await open();
  await waitFor(() => expect(f.disk().assemblyPath).toBe("/trusted/new-assembly.mp4"));
  expect(f.assemble).toHaveBeenCalledOnce();
  expect(f.assemble.mock.calls[0]![0].expectedSelection).toHaveLength(2);
  const video = document.querySelector<HTMLVideoElement>(".screen video")!;
  expect(video).toBeTruthy();
  Object.defineProperty(video, "duration", { configurable: true, value: 3 });
  Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
  fireEvent.loadedMetadata(video);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  await waitFor(() => expect(video.currentTime).toBe(2));
  video.currentTime = 0;
  fireEvent.timeUpdate(video);
  fireEvent.click(screen.getByRole("button", { name: "设入点" }));
  expect(await screen.findByText(NOTICE_TEXT.ASSEMBLY_SHOT_REQUIRED)).toBeInTheDocument();
  expect(document.querySelector(".selbar")).toBeNull();
  fireEvent.keyDown(window, { key: "ArrowDown" });
  video.currentTime = 2.5;
  fireEvent.timeUpdate(video);
  fireEvent.click(screen.getByRole("button", { name: "设入点" }));
  expect(screen.getByRole("button", { name: "取消选择" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^重新生成$/ }));
  expect(await screen.findByLabelText("局部重做入点")).toHaveValue(0.5);
  expect(screen.getByLabelText("局部重做出点")).toHaveValue(1);
  expect(screen.queryByText(NOTICE_TEXT.ASSEMBLY_CLOCK_REQUIRED)).toBeNull();
  expect(f.disk().shots[2]!.takes).toEqual([]);
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("retains a post-join partial and reports incomplete audio without invoking legacy assembly or a provider", async () => {
  const f = await open({ partial: true });
  await waitFor(() => expect(f.disk().assemblyPath).toBe("/trusted/new-assembly.mp4"));
  expect(await screen.findByText(NOTICE_TEXT.ASSEMBLY_PARTIAL)).toBeInTheDocument();
  expect(document.querySelector(".screen video")).toBeTruthy();
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("requests cancellation for selected-version changes and never applies the late old result to the new draft", async () => {
  const f = await open({ deferred: true });
  await waitFor(() => expect(f.assemble).toHaveBeenCalledOnce());
  const base = f.host().current()!;
  await act(async () =>
    f.host().applyLive({
      ...base,
      title: "new user title",
      shots: base.shots.map((s, i) =>
        i
          ? s
          : {
              ...s,
              selectedTakeId: "new-take",
              takes: [...s.takes, { ...s.takes[0]!, id: "new-take" }],
            },
      ),
    }),
  );
  await waitFor(() => expect(f.cancel).toHaveBeenCalled());
  // Leave edit before releasing the first native operation: no second assembly is dispatched.
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /分镜/,
    }),
  );
  await act(async () => {
    f.complete();
  });
  expect(f.host().current()!.title).toBe("new user title");
  expect(f.host().current()!.assemblyPath).not.toBe("/trusted/new-assembly.mp4");
  expect(f.host().current()!.shots[0]!.selectedTakeId).toBe("new-take");
  expect(f.assemble).toHaveBeenCalledOnce();
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("keeps an existing whole file playable but refuses unverified per-shot jumps and range marks after reopening without cached clock", async () => {
  const f = await open({ unknownClock: true });
  expect(await screen.findByText(NOTICE_TEXT.ASSEMBLY_CLOCK_REQUIRED)).toBeInTheDocument();
  const video = document.querySelector<HTMLVideoElement>(".screen video")!;
  expect(video).toBeTruthy();
  Object.defineProperty(video, "duration", { configurable: true, value: 3 });
  Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
  fireEvent.loadedMetadata(video);
  video.currentTime = 1;
  fireEvent.timeUpdate(video);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(video.currentTime).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "设入点" }));
  expect(screen.queryByText(/重做选段/)).toBeNull();
  expect(f.assemble).not.toHaveBeenCalled();
  expect(f.oldAssemble).not.toHaveBeenCalled();
});
it("does not claim a rendered artifact was saved when its lease write fails", async () => {
  const f = await open({ saveFailure: true });
  expect(await screen.findByText(NOTICE_TEXT.SAVE_FAILED)).toBeInTheDocument();
  expect(f.disk().assemblyPath).not.toBe("/trusted/new-assembly.mp4");
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});

it("does not restart or cancel an in-flight render for waveform/provenance metadata, keeps the metadata, and reopens only for consumed gain changes", async () => {
  const f = await open({ deferred: true });
  await waitFor(() => expect(f.assemble).toHaveBeenCalledOnce());
  const live = f.host().current()!;
  const metadata = {
    schemaVersion: 1 as const,
    sourceKey: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    offsetSeconds: 0,
    durationSeconds: 3,
    analyzedSeconds: 3,
    peaks: [0.1, 0.2],
    identity: filmAudioSourceIdentity(live, live.audioClips[0]!),
  };
  await act(async () =>
    f.host().applyLive({
      ...live,
      audioClips: live.audioClips.map((clip) => ({ ...clip, waveform: metadata })),
    }),
  );
  await act(async () => {
    f.complete();
  });
  await waitFor(() => expect(f.disk().assemblyPath).toBe("/trusted/new-assembly.mp4"));
  expect(f.assemble).toHaveBeenCalledOnce();
  expect(f.cancel).not.toHaveBeenCalled();
  expect(f.host().current()!.audioClips[0]!.waveform?.peaks).toEqual([0.1, 0.2]);
  const saved = f.host().current()!;
  await act(async () =>
    f.host().applyLive({
      ...saved,
      audioClips: saved.audioClips.map((clip) => ({ ...clip, gainDb: -6 })),
    }),
  );
  await waitFor(() => expect(f.assemble).toHaveBeenCalledTimes(2));
  await act(async () => {
    f.complete();
  });
  expect(f.host().current()!.audioClips[0]!.gainDb).toBe(-6);
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});

it("admits the first edit assembly only after ordinary waveform saves and preview finish, without starving either under controlled holds", async () => {
  const f = await open({ metadataHold: true });
  await waitFor(() => {
    expect(f.wave).toHaveBeenCalledOnce();
  });
  expect(f.preview).not.toHaveBeenCalled();
  expect(f.assemble).not.toHaveBeenCalled();
  await act(async () => {
    f.releaseWave();
  });
  await waitFor(() => expect(f.preview).toHaveBeenCalledOnce());
  expect(f.assemble).not.toHaveBeenCalled();
  await act(async () => {
    f.releasePreview();
  });
  await waitFor(() => expect(f.disk().assemblyPath).toBe("/trusted/new-assembly.mp4"));
  expect(f.assemble).toHaveBeenCalledOnce();
  expect(f.wave).toHaveBeenCalledOnce();
  expect(f.metadataOrder.indexOf("assembly")).toBeGreaterThan(
    f.metadataOrder.indexOf("wave-ready"),
  );
  expect(f.metadataOrder.indexOf("assembly")).toBeGreaterThan(
    f.metadataOrder.indexOf("preview-ready"),
  );
  expect(f.disk().audioClips[0]!.waveform?.peaks).toEqual([0.1, 0.2]);
  expect(f.cancel).not.toHaveBeenCalled();
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});

it("keeps the original eight BUSY admissions across canonical adoption and assembly references, then retries only on an explicit click", async () => {
  const f = await open({ metadataBusy: true, deferred: true });
  try {
    await waitFor(() => expect(f.assemble).toHaveBeenCalledOnce(), { timeout: 5000 });
    expect(f.preview).toHaveBeenCalledTimes(8);
    expect(screen.getByRole("button", { name: "重试音轨试听" })).toBeInTheDocument();
    await act(async () => {
      f.complete();
    });
    await waitFor(() => expect(f.disk().assemblyPath).toBe("/trusted/new-assembly.mp4"));
    expect(screen.getByRole("button", { name: "重试音轨试听" })).toBeInTheDocument();
    expect(f.preview).toHaveBeenCalledTimes(8);
    expect(f.wave).toHaveBeenCalledOnce();
    const originalWave = f.wave.getMockImplementation()!;
    let releaseSameWave!: () => void;
    const sameWaveHold = new Promise<void>((done) => {
      releaseSameWave = done;
    });
    f.wave.mockImplementationOnce(async (input) => {
      const wave = await originalWave(input);
      await sameWaveHold;
      return wave;
    });
    fireEvent.click(screen.getByRole("button", { name: "刷新音频波形" }));
    try {
      await waitFor(() => expect(f.wave).toHaveBeenCalledTimes(2));
    } finally {
      await act(async () => {
        releaseSameWave();
        await f.wave.mock.results.at(-1)!.value;
      });
    }
    await screen.findByRole("button", { name: "刷新音频波形" });
    await screen.findByRole("button", { name: "重试音轨试听" }, { timeout: 5000 });
    process.stdout.write(
      `SAME_SOURCE_WAVE_REFRESH ${JSON.stringify({ previewCalls: f.preview.mock.calls.length, assemblyCalls: f.assemble.mock.calls.length, cancels: f.cancel.mock.calls.length })}\n`,
    );
    expect(f.preview).toHaveBeenCalledTimes(8);
    f.preview.mockImplementationOnce(async (input) => {
      expect(input.expectedHash).toBe(await historyRecordHash(f.disk()));
      return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
    });
    fireEvent.click(screen.getByRole("button", { name: "重试音轨试听" }));
    await waitFor(() => expect(f.preview).toHaveBeenCalledTimes(9));
    expect(f.assemble).toHaveBeenCalledOnce();
    expect(f.cancel).not.toHaveBeenCalled();
    expect(f.oldAssemble).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      f.complete();
    });
  }
});
it("rechecks main when a controlled same-source waveform refresh reports different bytes, without legacy or provider calls", async () => {
  const f = await open({ metadataHold: true });
  await waitFor(() => expect(f.wave).toHaveBeenCalledOnce());
  await act(async () => f.releaseWave());
  await waitFor(() => expect(f.preview).toHaveBeenCalledOnce());
  await act(async () => f.releasePreview());
  await waitFor(() => expect(f.disk().assemblyPath).toBe("/trusted/new-assembly.mp4"));
  const originalWave = f.wave.getMockImplementation()!;
  let releaseChanged!: () => void;
  const hold = new Promise<void>((done) => {
    releaseChanged = done;
  });
  f.wave.mockImplementationOnce(async (input) => {
    const result = await originalWave(input);
    await hold;
    return { ...result, waveform: { ...result.waveform, sourceSha256: "c".repeat(64) } };
  });
  fireEvent.click(screen.getByRole("button", { name: "刷新音频波形" }));
  try {
    await waitFor(() => expect(f.wave).toHaveBeenCalledTimes(2));
    expect(f.preview).toHaveBeenCalledOnce();
  } finally {
    await act(async () => {
      releaseChanged();
      await f.wave.mock.results.at(-1)!.value;
    });
  }
  await waitFor(() => expect(f.preview).toHaveBeenCalledTimes(2));
  expect(f.preview.mock.calls[0]![0].expectedHash).not.toBe(
    f.preview.mock.calls[1]![0].expectedHash,
  );
  expect(f.disk().audioClips[0]!.waveform?.sourceSha256).toBe("c".repeat(64));
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("moves a focused ruler in actual native seconds across cuts and boundaries without double bubbling", async () => {
  const f = await open();
  await waitFor(() => expect(f.disk().assemblyPath).toBe("/trusted/new-assembly.mp4"));
  const before = structuredClone(f.host().current()!.shots);
  const video = document.querySelector<HTMLVideoElement>(".screen video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 3 });
  Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
  fireEvent.loadedMetadata(video);
  const ruler = screen.getByRole("slider", { name: "播放位置" });
  async function press(key: string, expected: number, shiftKey = false) {
    ruler.focus();
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    fireEvent(ruler, event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(video.currentTime).toBeCloseTo(expected, 8));
    fireEvent.timeUpdate(video);
  }
  await press("ArrowRight", 1);
  await press("ArrowRight", 2);
  await press("ArrowLeft", 1);
  await press("Home", 0);
  await press("ArrowLeft", 0);
  await press("End", 3);
  await press("ArrowRight", 3);
  await press("ArrowLeft", 0, true);
  await press("ArrowRight", 3, true);
  expect(f.host().current()!.shots).toEqual(before);
  expect(f.assemble).toHaveBeenCalledTimes(1);
  expect(f.cancel).not.toHaveBeenCalled();
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("keeps unknown-clock whole-file ruler seeking separate from forbidden per-shot jumps and range marks", async () => {
  const f = await open({ unknownClock: true });
  const video = document.querySelector<HTMLVideoElement>(".screen video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 3 });
  Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
  fireEvent.loadedMetadata(video);
  const ruler = screen.getByRole("slider", { name: "播放位置" });
  ruler.focus();
  fireEvent.keyDown(ruler, { key: "ArrowRight" });
  await waitFor(() => expect(video.currentTime).toBe(1));
  fireEvent.timeUpdate(video);
  ruler.blur();
  fireEvent.keyDown(window, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("button", { name: "设入点" }));
  expect(document.querySelector(".status-note")).toHaveTextContent(
    NOTICE_TEXT.ASSEMBLY_CLOCK_REQUIRED,
  );
  expect(video.currentTime).toBe(1);
  expect(document.querySelector(".selbar")).toBeNull();
  expect(f.assemble).not.toHaveBeenCalled();
  expect(f.oldAssemble).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
