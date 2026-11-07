import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type {
  AddBundledFilmAudioInput,
  AddBundledFilmAudioResult,
  BundledAudioAsset,
} from "@aijian/contracts/film-audio-library";
import type { FilmFlushRequest } from "@aijian/contracts/quit-save";
const { readProject, writeProject } = await vi.importActual<{
  readProject: (root: string, id: string) => Promise<Record<string, unknown> | null>;
  writeProject: (root: string, value: unknown) => Promise<Record<string, unknown>>;
}>("../../../../desktop/src/film-library.ts");
import { sampleFilm, upgradeFilm, type FilmProject } from "../film/project";
import { historyRecordHash } from "./actions/persistent-history";
import * as editor from "./actions/editor-host";
import * as persistenceModule from "./film-persistence";
const originalPersistence = persistenceModule.createFilmPersistence;
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editor.createEditorHost;
const folders: string[] = [];
const pendingQueueWork = new Set<Promise<unknown>>();
function trackQueueWork<T>(run: Promise<T>): Promise<T> {
  pendingQueueWork.add(run);
  void run.then(
    () => pendingQueueWork.delete(run),
    () => pendingQueueWork.delete(run),
  );
  return run;
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(async () => {
  cleanup();
  // Unmount cancels subscriptions/timers first; drain only work already admitted by
  // this fixture, including queue operations whose native write has not started yet.
  while (pendingQueueWork.size) await Promise.allSettled([...pendingQueueWork]);
  vi.restoreAllMocks();
  await Promise.all(folders.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
function wav() {
  const b = Buffer.alloc(44 + 8 * 8000 * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
async function open(realFs = false) {
  const film = sampleFilm();
  film.id = `film_${"a".repeat(24)}`;
  film.seriesId = film.id;
  film.title = film.seriesTitle = "本地素材用例";
  film.episodeTitle = "原集";
  film.characters[0]!.portraits = [
    {
      view: "正面",
      prompt: "保留定妆",
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kGZkAAAAASUVORK5CYII=",
    },
  ];
  film.shots = film.shots.map((s, i) => ({
    ...s,
    sceneId: film.scenes[0]!.id,
    seconds: 20,
    selectedTakeId: `take-${i}-1`,
    takes: [1, 2, 3].map((index) => ({
      id: `take-${i}-${index}`,
      shotId: s.id,
      index,
      status: "done" as const,
      videoPath: `/trusted/video-${i}-${index}.mp4`,
      cleanVideoPath: `/trusted/clean-${i}-${index}.mp4`,
      videoUrl: "",
      stillUrl: "",
      createdAt: "",
      prompt: "保留旧稿",
      reason: "",
    })),
  }));
  film.audioClips = [
    {
      id: "original-voice",
      lane: "dialogue",
      shotId: film.shots[0]!.id,
      takeId: film.shots[0]!.selectedTakeId!,
      path: "/trusted/old.wav",
      label: "原配音",
      startSeconds: 0,
      durationSeconds: 2,
      offsetSeconds: 0,
      gainDb: -6,
    },
  ];
  const other = {
    ...structuredClone(film),
    id: `film_${"b".repeat(24)}`,
    episodeNo: 2,
    episodeTitle: "另一集",
  };
  const map = new Map<string, Record<string, unknown>>();
  const folder = realFs ? await mkdtemp(join(tmpdir(), "audio-library-host-")) : null;
  if (folder) folders.push(folder);
  let version = 0,
    host!: Parameters<typeof originalHost>[0],
    flushListener: ((request: FilmFlushRequest) => void) | undefined;
  vi.spyOn(editor, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  let heldRead: { admit: () => void; released: Promise<void> } | undefined;
  const raw = async (id: string): Promise<Record<string, unknown> | null> =>
    folder
      ? ((await readProject(folder, id)) as Record<string, unknown> | null)
      : structuredClone(map.get(id) ?? null);
  const saveRaw = async (value: Record<string, unknown>) => {
    // Native retains a cached URL that upgradeFilm deliberately resets. Main's hash must
    // still use the whole raw record, not an upgraded projection.
    const next: Record<string, unknown> = {
      ...structuredClone(value),
      assemblyUrl: "aivora-media://native-cache/preview.mp4",
      savedAt: `saved-${++version}`,
    };
    if (folder) return await trackQueueWork(writeProject(folder, next));
    map.set(String(next.id), next);
    return structuredClone(next);
  };
  await saveRaw(film as unknown as Record<string, unknown>);
  await saveRaw(other as unknown as Record<string, unknown>);
  const bytes = wav(),
    asset: BundledAudioAsset = {
      id: "rain-test",
      name: "雨声",
      type: "sfx",
      category: "天气",
      tags: ["雨"],
      scene: "室外",
      durationSeconds: 8,
      loopable: false,
      loudness: -20,
      source: "https://example.org/rain",
      author: "素材作者",
      license: "CC0",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  const first = await raw(film.id);
  const assetPath = folder
    ? join(String(first!.directory), "episodes", film.id, "media", "library-rain.wav")
    : "/trusted/imported-rain.wav";
  if (folder) {
    await mkdir(join(assetPath, ".."), { recursive: true });
    await writeFile(assetPath, bytes);
  }
  let mode: "success" | "hold" | "transport" | "failed" | "unconfirmed" = "success",
    failWrites = false,
    sourceUnavailable = false,
    actualDuration = 2.25;
  const active = new Set<string>();
  let pendingInput: AddBundledFilmAudioInput | undefined,
    resolveAdd: ((value: AddBundledFilmAudioResult) => void) | undefined;
  const provider = vi.fn(),
    flushed = vi.fn(async () => undefined);
  const write = vi.fn(async (value: FilmProject) => {
    if (failWrites) throw Error("PRIVATE_DISK_PATH");
    return saveRaw(value as unknown as Record<string, unknown>);
  });
  const inspect = vi.fn(
    async (input: {
      projectId: string;
      expectedProjectHash: string;
      shotId: string;
      takeId: string;
    }) => {
      if (active.has(input.projectId))
        return { kind: "FAILED" as const, code: "BUSY" as const, unchanged: true };
      const stored = await raw(input.projectId);
      if (!stored || input.expectedProjectHash !== (await historyRecordHash(stored)))
        return { kind: "FAILED" as const, code: "PROJECT_CHANGED" as const, unchanged: true };
      if (sourceUnavailable)
        return { kind: "FAILED" as const, code: "SOURCE_UNVERIFIED" as const, unchanged: true };
      return {
        kind: "TARGET" as const,
        projectId: input.projectId,
        projectHash: input.expectedProjectHash,
        shotId: input.shotId,
        takeId: input.takeId,
        durationSeconds: actualDuration,
      };
    },
  );
  const commit = async (input: AddBundledFilmAudioInput) => {
    const stored = (await raw(input.projectId))!;
    const old = stored.audioClips as FilmProject["audioClips"];
    const clip = {
      id: "audio-library-added",
      lane: input.lane,
      shotId: input.shotId,
      takeId: input.takeId,
      label: asset.name,
      path: assetPath,
      ...input.placement,
      enabled: true,
      libraryAsset: {
        assetId: asset.id,
        source: asset.source,
        author: asset.author,
        license: asset.license,
        sha256: asset.sha256,
        loopable: asset.loopable,
        loudness: asset.loudness,
        processingGainDb: -7,
      },
    };
    const result = await saveRaw({ ...stored, audioClips: [...old, clip] });
    active.delete(input.projectId);
    return { kind: "ADDED" as const, clipId: clip.id, project: result };
  };
  let writesAtDispatch = 0;
  const add = vi.fn(async (input: AddBundledFilmAudioInput): Promise<AddBundledFilmAudioResult> => {
    expect(input.expectedProjectHash).toBe(await historyRecordHash(await raw(input.projectId)));
    expect(input.expectedAssetSha256).toBe(asset.sha256);
    expect(input.catalogSha256).toBe("c".repeat(64));
    pendingInput = input;
    writesAtDispatch = write.mock.calls.length;
    if (mode === "failed") return { kind: "FAILED", code: "SOURCE_UNVERIFIED", unchanged: true };
    active.add(input.projectId);
    if (mode === "transport") throw Error("PRIVATE_TRANSPORT_TOKEN");
    if (mode === "hold")
      return new Promise((resolve) => {
        resolveAdd = resolve;
      });
    const outcome = await commit(input);
    return mode === "unconfirmed"
      ? { kind: "FAILED", code: "WRITE_UNCONFIRMED", unchanged: false }
      : outcome;
  });
  window.aijian = {
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.seriesTitle, savedAt: "", path: "/trusted" },
    ]),
    listFilmEpisodes: vi.fn(async () =>
      [film, other].map((f) => ({
        id: f.id,
        seriesId: f.seriesId,
        title: f.episodeTitle,
        no: f.episodeNo,
        shots: 6,
        done: 6,
        savedAt: "",
      })),
    ),
    readFilmProject: vi.fn(async (id: string) => {
      if (id === film.id && heldRead) {
        const held = heldRead;
        heldRead = undefined;
        const snapshot = await raw(id);
        held.admit();
        await held.released;
        return snapshot;
      }
      return await raw(id);
    }),
    writeFilmProject: write,
    listBundledFilmAudio: vi.fn(async () => ({
      kind: "CATALOG",
      manifestSha256: "c".repeat(64),
      assets: [asset],
    })),
    inspectBundledFilmAudioTarget: inspect,
    addBundledFilmAudio: add,
    createStoryFilm: provider,
    onFlush: (handler: (request: FilmFlushRequest) => void) => {
      flushListener = handler;
      return () => {
        flushListener = undefined;
      };
    },
    flushed,
  } as unknown as Window["aijian"];
  let onConfirmedRelease: (() => void) | undefined;
  let persistence: ReturnType<typeof originalPersistence>;
  let afterPendingRead: (() => void) | undefined;
  vi.spyOn(persistenceModule, "createFilmPersistence").mockImplementation((options) => {
    const p = originalPersistence(options);
    persistence = p;
    const wrap = async (id: string, recovery = false) => {
      const lease = await (recovery ? p.acquireExternalRecovery(id) : p.acquire(id));
      let external = recovery;
      return {
        ...lease,
        save: (...args: Parameters<typeof lease.save>) => trackQueueWork(lease.save(...args)),
        rebaseExternalWrite: (...args: Parameters<NonNullable<typeof lease.rebaseExternalWrite>>) =>
          trackQueueWork(lease.rebaseExternalWrite!(...args)),
        beginExternalWrite: (guard: () => boolean) => {
          external = true;
          lease.beginExternalWrite!(guard);
        },
        release: () =>
          trackQueueWork(
            (async () => {
              if (external && !p.externalWriteState(id) && onConfirmedRelease) {
                const fn = onConfirmedRelease;
                onConfirmedRelease = undefined;
                fn();
              }
              return await lease.release();
            })(),
          ),
      };
    };
    return {
      ...p,
      externalWriteState: (id: string) => {
        const state = p.externalWriteState(id);
        if (id === film.id && state && afterPendingRead) {
          const complete = afterPendingRead;
          afterPendingRead = undefined;
          queueMicrotask(complete);
        }
        return state;
      },
      save: (...args: Parameters<typeof p.save>) => trackQueueWork(p.save(...args)),
      flush: () => trackQueueWork(p.flush()),
      flushAll: () => trackQueueWork(p.flushAll()),
      acquire: (id: string) => trackQueueWork(wrap(id)),
      acquireExternalRecovery: (id: string) => trackQueueWork(wrap(id, true)),
    };
  });
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() => expect(write).toHaveBeenCalled());
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  return {
    film,
    other,
    asset,
    bytes,
    assetPath,
    write,
    inspect,
    add,
    provider,
    flushed,
    raw,
    current: () => host.current()!,
    apply: host.applyLive,
    mode: (v: typeof mode) => {
      mode = v;
    },
    settleAfterNextPendingRead: async () => {
      const lease = await persistence.acquireExternalRecovery(film.id);
      const stored = upgradeFilm((await raw(film.id)) as Partial<FilmProject>)!;
      let done!: () => void;
      const completed = new Promise<void>((resolve) => {
        done = resolve;
      });
      afterPendingRead = () => {
        const adopting = host.current()?.id === film.id;
        if (adopting) host.applyLive(stored);
        // This is the already-verified recovery's synchronous confirmation boundary,
        // using the actual lease; no fabricated external state or extra native add.
        expect(lease.confirmExternalWrite!(stored, adopting ? host.current()! : undefined)).toBe(
          true,
        );
        void trackQueueWork(lease.release()).then(done);
      };
      return { completed };
    },
    holdNextOriginalRead: () => {
      let admit!: () => void, release!: () => void;
      const admitted = new Promise<void>((resolve) => {
        admit = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldRead = { admit, released };
      return { admitted, release };
    },
    onConfirmedRelease: (fn: () => void) => {
      onConfirmedRelease = fn;
    },
    allowWrites: () => {
      failWrites = false;
    },
    failWrites: () => {
      failWrites = true;
    },
    unavailable: () => {
      sourceUnavailable = true;
    },
    duration: (seconds: number) => {
      actualDuration = seconds;
    },
    conflictCanonical: async () => {
      const stored = await raw(film.id);
      if (!stored) throw Error("MISSING_RECORD");
      await saveRaw({ ...stored, title: "本机另一份片名" });
    },
    dropOriginal: () => {
      map.delete(film.id);
    },
    writesAtDispatch: () => writesAtDispatch,
    finish: async () => {
      if (!pendingInput) throw Error("No native admission");
      const outcome = await commit(pendingInput);
      resolveAdd?.(outcome);
    },
    flush: () => {
      if (!flushListener) throw Error("No flush listener");
      flushListener({ requestId: "library-flush" });
    },
  };
}
async function choose() {
  fireEvent.click(screen.getByRole("button", { name: "选用本地音效/配乐" }));
  const dialog = await screen.findByRole("dialog", { name: "选用本地音效或配乐" });
  fireEvent.click(await within(dialog).findByRole("radio", { name: /雨声/ }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "加入当前版本" })).toBeEnabled(),
  );
  return dialog;
}
it("uses raw canonical hashes and actual short target duration, adds once, then removes only this clip while real native files survive", async () => {
  const f = await open(true),
    before = f.current();
  const portraitPath = before.characters[0]!.portraits[0]!.url!;
  const portraitBytes = await readFile(portraitPath);
  expect(portraitPath).not.toMatch(/^data:/);
  const dialog = await choose();
  expect(within(dialog).getByLabelText("使用时长（秒）")).toHaveValue(2.25);
  expect(f.add).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/素材已加入并保存/);
  expect(f.add).toHaveBeenCalledOnce();
  expect(f.write.mock.calls.length).toBe(f.writesAtDispatch());
  expect(f.current().audioClips.find((c) => c.libraryAsset)?.gainDb).toBe(0);
  expect(f.current().audioClips[0]!.id).toBe("original-voice");
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "移除雨声" }));
  await screen.findByText(/片段已移除并保存/);
  expect(f.current().audioClips.map((c) => c.id)).toEqual(["original-voice"]);
  expect(await readFile(f.assetPath)).toEqual(f.bytes);
  expect(await readFile(portraitPath)).toEqual(portraitBytes);
  expect(f.current().characters[0]!.portraits[0]!.url).toBe(portraitPath);
  expect(f.current().shots.map((s) => s.takes)).toEqual(before.shots.map((s) => s.takes));
  expect(f.provider).not.toHaveBeenCalled();
}, 15000);
it("does not dispatch add or invent default timing when canonical saving fails", async () => {
  const f = await open();
  f.failWrites();
  fireEvent.click(screen.getByRole("button", { name: "选用本地音效/配乐" }));
  const dialog = await screen.findByRole("dialog", { name: "选用本地音效或配乐" });
  fireEvent.click(await within(dialog).findByRole("radio", { name: /雨声/ }));
  await within(dialog).findByText(/检查保存状态/);
  expect(within(dialog).getByRole("button", { name: "加入当前版本" })).toBeDisabled();
  expect(f.add).not.toHaveBeenCalled();
  expect(f.inspect).not.toHaveBeenCalled();
  expect(dialog).not.toHaveTextContent("PRIVATE_DISK_PATH");
});
it("reports unavailable source verification separately and keeps non-loopable bounds before dispatch", async () => {
  const f = await open();
  const dialog = await choose();
  fireEvent.change(within(dialog).getByLabelText("使用时长（秒）"), { target: { value: "3" } });
  expect(within(dialog).getByRole("button", { name: "加入当前版本" })).toBeDisabled();
  expect(within(dialog).getByRole("checkbox", { name: "循环到所选时长" })).toBeDisabled();
  expect(f.add).not.toHaveBeenCalled();
  f.unavailable();
  fireEvent.click(within(dialog).getByRole("button", { name: "核对当前版本时长" }));
  await within(dialog).findByText(/来源暂时无法核验/);
  expect(f.add).not.toHaveBeenCalled();
});
it("does not optimistically add on native unchanged failure or automatically resubmit", async () => {
  const f = await open();
  f.mode("failed");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/来源暂时无法核验/);
  expect(f.add).toHaveBeenCalledOnce();
  expect(f.current().audioClips.map((c) => c.id)).toEqual(["original-voice"]);
  expect(screen.queryByRole("button", { name: /本地素材保存待核对/ })).toBeNull();
});
it("precisely retains a late title/version edit and all old media rather than applying the old whole record", async () => {
  const f = await open();
  f.mode("hold");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await waitFor(() => expect(f.add).toHaveBeenCalledOnce());
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeDisabled();
  const live = f.current(),
    first = live.shots[0]!;
  await act(async () => {
    f.apply({
      ...live,
      title: "后来改的片名",
      shots: live.shots.map((s) =>
        s.id === first.id ? { ...s, selectedTakeId: s.takes[1]!.id } : s,
      ),
    });
  });
  await act(async () => f.finish());
  await screen.findByText(/素材已加入原版本/);
  expect(f.current().title).toBe("后来改的片名");
  expect(f.current().shots[0]!.selectedTakeId).toBe(first.takes[1]!.id);
  expect(f.current().audioClips.find((c) => c.libraryAsset)?.takeId).toBe(first.takes[0]!.id);
  expect(f.current().shots[0]!.takes).toEqual(first.takes);
  expect(f.add).toHaveBeenCalledOnce();
});
it("keeps transport-unknown writes quarantined through global quit and recovers the original work after real menu switching", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  expect(f.add).toHaveBeenCalledOnce();
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "unknown" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText(/本机写入尚未确认结束/);
  expect(f.current().id).toBe(f.other.id);
  await act(async () => f.finish());
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText("本地素材保存状态已核对。");
  expect(f.current().id).toBe(f.other.id);
  expect(f.current().audioClips.map((c) => c.id)).toEqual(["original-voice"]);
  expect(
    ((await f.raw(f.film.id))!.audioClips as FilmProject["audioClips"]).some(
      (c) => c.id === "audio-library-added",
    ),
  ).toBe(true);
  expect(f.add).toHaveBeenCalledOnce();
}, 15000);

it.each(["add", "recover"] as const)(
  "keeps confirmed native results separate from later release-save failure during %s",
  async (phase) => {
    const f = await open();
    if (phase === "recover") f.mode("transport");
    const dialog = await choose();
    const late = () => {
      f.apply({ ...f.current(), title: "release期间的新编辑" });
      f.failWrites();
    };
    if (phase === "add") f.onConfirmedRelease(late);
    fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
    if (phase === "recover") {
      await within(dialog).findByText(/本机写入尚未确认结束/);
      await act(async () => f.finish());
      f.onConfirmedRelease(late);
      fireEvent.click(within(dialog).getByRole("button", { name: "核对保存状态" }));
    }
    await within(dialog).findByText("本地素材结果已核对，但后来的编辑还没保存上。请重试保存。");
    expect(f.current().title).toBe("release期间的新编辑");
    expect(f.current().audioClips.some((c) => c.id === "audio-library-added")).toBe(true);
    expect(screen.queryByRole("button", { name: /本地素材保存待核对/ })).toBeNull();
    expect(f.add).toHaveBeenCalledOnce();
    await act(async () => f.flush());
    await waitFor(() =>
      expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "failed" }),
    );
    f.allowWrites();
    await act(async () => f.flush());
    await waitFor(() =>
      expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "saved" }),
    );
    expect((await f.raw(f.film.id))!.title).toBe("release期间的新编辑");
    expect(f.add).toHaveBeenCalledOnce();
  },
);
it("retains the original unknown draft when real work menus navigate away and back before readback", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await act(async () => f.apply({ ...f.current(), title: "来回导航不能丢的片名" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "原集" }));
  await waitFor(() => expect(f.current().id).toBe(f.film.id));
  expect(f.current().title).toBe("来回导航不能丢的片名");
  await act(async () => f.finish());
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText("本地素材保存状态已核对。");
  expect(f.current().title).toBe("来回导航不能丢的片名");
  expect((await f.raw(f.film.id))!.title).toBe("来回导航不能丢的片名");
  expect(f.add).toHaveBeenCalledOnce();
});
it("does not resurrect a retained pre-add draft after a deferred open read outlives successful readback", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  const held = f.holdNextOriginalRead();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "原集" }));
  await held.admitted;
  expect(f.current().id).toBe(f.other.id);
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  await act(async () => f.finish());
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText("本地素材保存状态已核对。");
  expect(
    ((await f.raw(f.film.id))!.audioClips as FilmProject["audioClips"]).some(
      (c) => c.id === "audio-library-added",
    ),
  ).toBe(true);
  await act(async () => held.release());
  await waitFor(() => expect(f.current().id).toBe(f.film.id));
  expect(f.current().audioClips.some((c) => c.id === "audio-library-added")).toBe(true);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "saved" }),
  );
  expect(
    ((await f.raw(f.film.id))!.audioClips as FilmProject["audioClips"]).some(
      (c) => c.id === "audio-library-added",
    ),
  ).toBe(true);
  expect(f.add).toHaveBeenCalledOnce();
});
it("applies the final pending snapshot synchronously before a recovery confirmation microtask", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  await act(async () => f.finish());
  const held = f.holdNextOriginalRead();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "原集" }));
  await held.admitted;
  // Arm only after the menu read was admitted: its final pending lookup schedules
  // the real recovery lease confirmation into the immediately following microtask.
  const { completed } = await f.settleAfterNextPendingRead();
  await act(async () => {
    held.release();
    await completed;
  });
  await waitFor(() => expect(f.current().id).toBe(f.film.id));
  expect(f.current().audioClips.some((c) => c.id === "audio-library-added")).toBe(true);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "saved" }),
  );
  expect(
    ((await f.raw(f.film.id))!.audioClips as FilmProject["audioClips"]).some(
      (c) => c.id === "audio-library-added",
    ),
  ).toBe(true);
  expect(f.add).toHaveBeenCalledOnce();
});
it("can review and explicitly adopt a foreign saved conflict even when the original draft had no additional edits", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  const other = f.current();
  await act(async () => {
    await f.finish();
    await f.conflictCanonical();
  });
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText("已保存的作品与本次添加无法对应，保留当前编辑，请先核对。");
  fireEvent.click(within(panel).getByRole("button", { name: "查看冲突处理" }));
  expect(within(panel).getByRole("region", { name: "保存冲突选择" })).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole("button", { name: "采用已保存版本并放弃这份未保存稿" }));
  await within(panel).findByText("本地素材保存状态已核对。");
  expect(f.current()).toBe(other);
  expect((await f.raw(f.film.id))!.title).toBe("本机另一份片名");
  expect(f.add).toHaveBeenCalledOnce();
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "saved" }),
  );
});
it("safely rebases a retained original draft while another work is open without writing that current work", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  await act(async () => f.apply({ ...f.current(), title: "保留原作品未保存片名" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  const otherBefore = await f.raw(f.other.id);
  await act(async () => f.finish());
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText("本地素材保存状态已核对。");
  expect(f.current().id).toBe(f.other.id);
  expect(await f.raw(f.other.id)).toEqual(otherBefore);
  const original = await f.raw(f.film.id);
  expect(original!.title).toBe("保留原作品未保存片名");
  expect(
    (original!.audioClips as FilmProject["audioClips"]).some((c) => c.id === "audio-library-added"),
  ).toBe(true);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "saved" }),
  );
  expect(f.add).toHaveBeenCalledOnce();
});
it("does not apply a returned sound to a removed target and keeps the conflict explicitly recoverable", async () => {
  const f = await open();
  f.mode("hold");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await waitFor(() => expect(f.add).toHaveBeenCalledOnce());
  const live = f.current();
  await act(async () => f.apply({ ...live, shots: live.shots.slice(1) }));
  await act(async () => f.finish());
  await screen.findByRole("button", { name: /本地素材保存待核对/ });
  expect(f.current().shots.some((s) => s.id === live.shots[0]!.id)).toBe(false);
  expect(f.current().audioClips.some((c) => c.id === "audio-library-added")).toBe(false);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "unknown" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "查看冲突处理" }));
  expect(f.current().shots.some((s) => s.id === live.shots[0]!.id)).toBe(false);
  expect(within(panel).getByRole("region", { name: "保存冲突选择" })).toBeTruthy();
  await act(async () => f.apply({ ...f.current(), title: "确认前又改过的片名" }));
  fireEvent.click(within(panel).getByRole("button", { name: "采用已保存版本并放弃这份未保存稿" }));
  await within(panel).findByText("编辑副本又有变化，请重新查看两份状态。");
  expect(f.current().title).toBe("确认前又改过的片名");
  expect(f.current().shots.some((s) => s.id === live.shots[0]!.id)).toBe(false);
  fireEvent.click(within(panel).getByRole("button", { name: "查看冲突处理" }));
  fireEvent.click(within(panel).getByRole("button", { name: "采用已保存版本并放弃这份未保存稿" }));
  await within(panel).findByText("本地素材保存状态已核对。");
  expect(f.current().shots.some((s) => s.id === live.shots[0]!.id)).toBe(true);
  expect(f.current().audioClips.some((c) => c.id === "audio-library-added")).toBe(true);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "saved" }),
  );
  expect(f.add).toHaveBeenCalledOnce();
});
it("leaves a globally visible recovery path if the original work becomes unreadable", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await act(async () => f.finish());
  f.dropOriginal();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText(/暂时无法读取原作品/);
  expect(within(panel).getByRole("button", { name: "核对这部作品" })).toBeEnabled();
  expect(f.current().id).toBe(f.other.id);
  expect(f.add).toHaveBeenCalledOnce();
});
it("only settles an unconfirmed write after actual readback proves the single addition, without repeating add", async () => {
  const f = await open();
  f.mode("unconfirmed");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/素材已加入并保存/);
  expect(f.add).toHaveBeenCalledOnce();
  expect(f.current().audioClips.filter((c) => c.id === "audio-library-added")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /本地素材保存待核对/ })).toBeNull();
});
it("keeps an applied late edit honest when its rebase save fails after native addition", async () => {
  const f = await open();
  f.mode("hold");
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await waitFor(() => expect(f.add).toHaveBeenCalledOnce());
  await act(async () => f.apply({ ...f.current(), title: "必须保留的新编辑" }));
  f.failWrites();
  await act(async () => f.finish());
  await within(dialog).findByText(/新编辑还没保存上/);
  expect(f.current().title).toBe("必须保留的新编辑");
  expect(f.current().audioClips.some((c) => c.id === "audio-library-added")).toBe(true);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "library-flush", status: "failed" }),
  );
  expect(f.add).toHaveBeenCalledOnce();
});
it("keeps prior field undo separate from explicit sound removal", async () => {
  const f = await open(),
    original = f.current().shots[0]!.picture;
  fireEvent.change(screen.getByLabelText("改这一镜的描述"), {
    target: { value: "此前由用户改过的画面" },
  });
  const dialog = await choose();
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/素材已加入并保存/);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(f.current().shots[0]!.picture).toBe(original);
  expect(f.current().audioClips.some((c) => c.id === "audio-library-added")).toBe(true);
  expect(screen.getByRole("button", { name: "移除雨声" })).toBeEnabled();
});
it("requires explicit loop permission and uses the verified target bound rather than the stored shot length", async () => {
  const f = await open();
  f.asset.loopable = true;
  f.duration(13);
  const dialog = await choose();
  expect(within(dialog).getByLabelText("使用时长（秒）")).toHaveValue(8);
  fireEvent.change(within(dialog).getByLabelText("使用时长（秒）"), { target: { value: "10" } });
  expect(within(dialog).getByRole("button", { name: "加入当前版本" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "循环到所选时长" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "加入当前版本" }));
  await within(dialog).findByText(/素材已加入并保存/);
  expect(f.add.mock.calls[0]![0].placement).toMatchObject({ durationSeconds: 10, loop: true });
  expect(f.provider).not.toHaveBeenCalled();
});
