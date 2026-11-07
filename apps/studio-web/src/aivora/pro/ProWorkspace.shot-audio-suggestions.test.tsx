import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SuggestBundledFilmShotAudioInput } from "@aijian/contracts/film-audio-library";
import type { FilmFlushRequest } from "@aijian/contracts/quit-save";
import type { FilmProject } from "../film/project";
import * as editor from "./actions/editor-host";
import * as queues from "./film-persistence";
import { historyRecordHash } from "./actions/persistent-history";
import {
  deferred,
  soundFilm,
  soundPlan,
  type SoundReply,
} from "./shot-audio-suggestions.test-fixture";
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editor.createEditorHost,
  originalQueue = queues.createFilmPersistence;
const queued = new Set<Promise<unknown>>();
function track<T>(promise: Promise<T>) {
  queued.add(promise);
  void promise.then(
    () => queued.delete(promise),
    () => queued.delete(promise),
  );
  return promise;
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(async () => {
  cleanup();
  while (queued.size) await Promise.allSettled([...queued]);
  vi.restoreAllMocks();
});
async function open() {
  const film = soundFilm(),
    other = {
      ...structuredClone(film),
      id: "film_other_audio_suggestion",
      episodeNo: 2,
      episodeTitle: "独有另一集",
      styleZh: "另一集画风",
    };
  const disk = new Map<string, Record<string, unknown>>(
    [film, other].map((f) => [f.id, structuredClone(f) as unknown as Record<string, unknown>]),
  );
  let host!: Parameters<typeof originalHost>[0],
    persistence!: ReturnType<typeof originalQueue>,
    failWrite = false;
  vi.spyOn(editor, "createEditorHost").mockImplementation((options) => {
    host = options;
    return originalHost(options);
  });
  vi.spyOn(queues, "createFilmPersistence").mockImplementation((options) => {
    const p = originalQueue(options);
    persistence = p;
    return {
      ...p,
      save: (...args: Parameters<typeof p.save>) => track(p.save(...args)),
      flushAll: () => track(p.flushAll()),
      acquire: async (id) => {
        const lease = await track(p.acquire(id));
        return {
          ...lease,
          save: (...args: Parameters<typeof lease.save>) => track(lease.save(...args)),
          release: () => track(lease.release()),
        };
      },
    };
  });
  let savedVersion = 0,
    flush: ((request: FilmFlushRequest) => void) | undefined;
  const write = vi.fn(async (value: FilmProject) => {
    if (failWrite) throw Error("PRIVATE_DISK_PATH");
    const raw = {
      ...structuredClone(value),
      assemblyUrl: "aivora-media://native/preview.mp4",
      savedAt: String(++savedVersion),
    };
    disk.set(value.id, raw);
    return structuredClone(raw);
  });
  const suggest = vi.fn(async (input: SuggestBundledFilmShotAudioInput): Promise<SoundReply> => {
    expect(input.expectedProjectHash).toBe(await historyRecordHash(disk.get(input.projectId)));
    return soundPlan(input);
  });
  const provider = vi.fn(),
    add = vi.fn(),
    flushed = vi.fn(async () => undefined);
  window.aijian = {
    listFilmSeries: async () => [
      { id: film.seriesId, title: film.seriesTitle, savedAt: "", path: film.directory },
    ],
    listFilmEpisodes: async () =>
      [film, other].map((f) => ({
        id: f.id,
        seriesId: f.seriesId,
        title: f.episodeTitle,
        no: f.episodeNo,
        shots: f.shots.length,
        done: f.shots.length,
        savedAt: "",
      })),
    readFilmProject: vi.fn(async (id: string) => structuredClone(disk.get(id) ?? null)),
    writeFilmProject: write,
    suggestBundledFilmShotAudio: suggest,
    addBundledFilmAudio: add,
    createStoryFilm: provider,
    assembleFilmCut: async () => ({ kind: "FAILED", code: "SOURCE_UNVERIFIED" }),
    onFlush: (handler: (r: FilmFlushRequest) => void) => {
      flush = handler;
      return () => {
        flush = undefined;
      };
    },
    flushed,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "查看本镜声音建议" })).toBeEnabled(),
  );
  return {
    film,
    other,
    disk,
    suggest,
    provider,
    add,
    write,
    flushed,
    current: () => host.current()!,
    apply: (next: FilmProject) => host.applyLive(next),
    queue: () => persistence,
    failWrites: () => {
      failWrite = true;
    },
    flush: () => flush?.({ requestId: "readonly-quit" }),
  };
}
async function view() {
  fireEvent.click(screen.getByRole("button", { name: "查看本镜声音建议" }));
  return await screen.findByRole("dialog", { name: "本镜声音建议" });
}
it("opens the real edit entry, displays complete groups and preserves all media without adding or generating", async () => {
  const f = await open(),
    before = structuredClone(f.current()),
    dialog = await view();
  await within(dialog).findByRole("heading", { name: "音效 · 2 段" });
  expect(within(dialog).getAllByRole("article")).toHaveLength(4);
  expect(dialog).toHaveTextContent("时间仅按文字计划");
  expect(dialog).toHaveTextContent("-32 dB");
  expect(f.current().shots).toEqual(before.shots);
  expect(f.current().audioClips).toEqual(before.audioClips);
  expect(f.add).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
  const writes = f.write.mock.calls.length;
  await act(async () => {
    const changed = { ...f.current(), savedAt: "metadata-only" };
    f.apply(changed);
  });
  expect(within(dialog).getAllByRole("article")).toHaveLength(4);
  expect(f.suggest).toHaveBeenCalledOnce();
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "readonly-quit", status: "saved" }),
  );
  expect(f.write.mock.calls.length).toBeLessThanOrEqual(writes + 1);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog", { name: "本镜声音建议" })).toBeNull();
});
it("does not retain a save owner while native suggestion is pending and closing drops the late reply", async () => {
  const f = await open(),
    hold = deferred<SoundReply>();
  f.suggest.mockImplementationOnce(() => hold.promise);
  const dialog = await view();
  await waitFor(() => expect(f.suggest).toHaveBeenCalledOnce());
  expect(within(dialog).getByRole("button", { name: "刷新建议" })).toBeDisabled();
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "readonly-quit", status: "saved" }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await act(async () => {
    hold.resolve(soundPlan(f.suggest.mock.calls[0]![0]));
  });
  expect(screen.queryByRole("dialog", { name: "本镜声音建议" })).toBeNull();
  expect(f.add).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("save failure stops before the read-only RPC and keeps quit failure accurate", async () => {
  const f = await open();
  f.failWrites();
  await act(async () => {
    f.apply({ ...f.current(), title: "未落盘修改" });
  });
  const dialog = await view();
  await within(dialog).findByText(/当前编辑还没保存上/);
  expect(f.suggest).not.toHaveBeenCalled();
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "readonly-quit", status: "failed" }),
  );
  expect(dialog).not.toHaveTextContent("PRIVATE_DISK_PATH");
  expect(f.add).not.toHaveBeenCalled();
});
it.each(["creative", "take", "page", "project"])(
  "rejects pending replies after actual host %s change without applying anything",
  async (change) => {
    const f = await open(),
      hold = deferred<SoundReply>();
    f.suggest.mockImplementationOnce(() => hold.promise);
    await view();
    await waitFor(() => expect(f.suggest).toHaveBeenCalledOnce());
    if (change === "creative")
      await act(async () => {
        f.apply({
          ...f.current(),
          shots: f.current().shots.map((s, i) => (i ? s : { ...s, action: "新的动作事实" })),
        });
      });
    if (change === "take")
      await act(async () => {
        f.apply({
          ...f.current(),
          shots: f
            .current()
            .shots.map((s, i) => (i ? s : { ...s, selectedTakeId: s.takes[1]!.id })),
        });
      });
    if (change === "page")
      fireEvent.click(
        within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
          name: /剧本/,
        }),
      );
    if (change === "project") {
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      fireEvent.click(screen.getByRole("button", { name: "作品" }));
      fireEvent.click(await screen.findByRole("button", { name: otherName }));
      await waitFor(() => expect(f.current().id).toBe(f.other.id));
    }
    const before = structuredClone(f.current());
    await act(async () => {
      hold.resolve(soundPlan(f.suggest.mock.calls[0]![0]));
    });
    expect(screen.queryByRole("heading", { name: "音效 · 2 段" })).toBeNull();
    expect(f.current().shots).toEqual(before.shots);
    expect(f.current().audioClips).toEqual(before.audioClips);
    expect(f.add).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  },
);
const otherName = "独有另一集";
it.each(["library", "empty", "limit", "invalid", "transport"])(
  "renders finite %s outcome in the real dialog and permits explicit refresh",
  async (mode) => {
    const f = await open();
    f.suggest.mockImplementationOnce(async (input) => {
      if (mode === "empty")
        return {
          ...soundPlan(input),
          clips: [],
          warnings: [{ code: "MUSIC_MOOD_UNDECIDED", message: "情绪未确定" }],
        };
      if (mode === "invalid") return { ...soundPlan(input), durationSeconds: NaN };
      if (mode === "transport") throw Error("PRIVATE_NETWORK_TOKEN");
      return {
        kind: "FAILED",
        code: mode === "limit" ? "PLAN_UNSUPPORTED" : "LIBRARY_UNAVAILABLE",
        unchanged: true,
        ...(mode === "limit"
          ? { reason: "TRACK_LIMIT", maxSegments: 128, minimumRequiredSegments: 129 }
          : {}),
      };
    });
    const dialog = await view();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "刷新建议" })).toBeEnabled(),
    );
    if (mode === "empty") {
      expect(dialog).toHaveTextContent("配乐情绪待决定");
      expect(within(dialog).getAllByRole("heading", { name: /· 0 段/ })).toHaveLength(3);
    } else expect(within(dialog).queryAllByRole("article")).toHaveLength(0);
    expect(dialog).not.toHaveTextContent("PRIVATE_");
    fireEvent.click(within(dialog).getByRole("button", { name: "刷新建议" }));
    await within(dialog).findByRole("heading", { name: "音效 · 2 段" });
    expect(f.suggest).toHaveBeenCalledTimes(2);
    expect(f.add).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  },
);
it("invalidates a displayed plan on creative edits without auto-reading or touching clips", async () => {
  const f = await open(),
    dialog = await view();
  await within(dialog).findByRole("heading", { name: "音效 · 2 段" });
  const clips = structuredClone(f.current().audioClips);
  await act(async () => {
    f.apply({
      ...f.current(),
      shots: f
        .current()
        .shots.map((s, i) => (i ? s : { ...s, sound: { ...s.sound, musicMood: "安静" } })),
    });
  });
  expect(within(dialog).queryAllByRole("article")).toHaveLength(0);
  expect(dialog).toHaveTextContent("镜头内容或素材已变化");
  expect(f.suggest).toHaveBeenCalledOnce();
  fireEvent.click(within(dialog).getByRole("button", { name: "刷新建议" }));
  await within(dialog).findByRole("heading", { name: "音效 · 2 段" });
  expect(f.suggest).toHaveBeenCalledTimes(2);
  expect(f.current().audioClips).toEqual(clips);
  expect(f.add).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
