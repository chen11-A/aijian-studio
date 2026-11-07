import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FilmFlushRequest } from "@aijian/contracts/quit-save";
import type {
  FilmDialogueSplitApplyResult,
  FilmDialogueSplitPrepareResult,
  FilmDialogueSplitBackupResult,
} from "@aijian/contracts/film-dialogue-split";
import type {
  FilmHistoryList,
  FilmHistoryCapture,
  FilmHistoryRestore,
} from "@aijian/contracts/film-history";
import { sampleFilm, type FilmProject } from "../film/project";
import * as queues from "./film-persistence";
import * as editor from "./actions/editor-host";
import * as hashes from "./actions/persistent-history";
import { rememberDialogueLimit } from "./actions/dialogue-limit-session";
import { ProWorkspace } from "./ProWorkspace";
type Raw = Record<string, unknown> & { id: string; seriesId: string };
type History = {
  list: (id: string) => Promise<FilmHistoryList>;
  capture: (input: unknown) => Promise<FilmHistoryCapture>;
  restore: (input: unknown) => Promise<FilmHistoryRestore>;
};
type Native = {
  prepare: (input: unknown) => Promise<FilmDialogueSplitPrepareResult>;
  apply: (input: unknown) => Promise<FilmDialogueSplitApplyResult>;
  verifyBackup: (input: unknown) => Promise<FilmDialogueSplitBackupResult>;
};
const nativeLibrary = await vi.importActual<{
  writeProject: (root: string, value: unknown) => Promise<Raw>;
  readProject: (root: string, id: string) => Promise<Raw | null>;
}>("../../../../desktop/src/film-library");
const { createFilmHistory } = await vi.importActual<{
  createFilmHistory: (host: { filmsRoot: string }) => History;
}>("../../../../desktop/src/film-history");
const { createFilmDialogueSplits } = await vi.importActual<{
  createFilmDialogueSplits: (host: {
    filmsRoot: string;
    history: History;
    beforeCommit: () => Promise<void>;
    limitEvidence?: (
      owner: number,
      id: string,
      record: Record<string, unknown>,
      shotId: string,
    ) => { requiredSeconds: number; maxSeconds: 10 | 15; rawAudioSaved: boolean } | null;
    consumeLimitEvidence?: (id: string) => void;
  }) => Native;
}>("../../../../desktop/src/film-dialogue-split");
const queue = queues.createFilmPersistence,
  editorHost = editor.createEditorHost;
const roots: string[] = [],
  work = new Set<Promise<unknown>>(),
  releases: (() => void)[] = [];
function tracked<T>(p: Promise<T>): Promise<T> {
  work.add(p);
  void p.then(
    () => work.delete(p),
    () => work.delete(p),
  );
  return p;
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  return { promise: new Promise<T>((r) => (resolve = r)), resolve };
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(async () => {
  cleanup();
  for (const r of releases.splice(0)) r();
  while (work.size) await Promise.allSettled([...work]);
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "split-host-"));
  roots.push(root);
  const films = join(root, "films"),
    film = sampleFilm();
  film.id = "film_" + "a".repeat(24);
  film.seriesId = film.id;
  film.title = film.seriesTitle = "拆镜宿主";
  film.episodeTitle = "原集";
  film.jobs = [];
  film.draft = false;
  film.scenes = film.scenes.slice(0, 1);
  const media = join(root, "media");
  await mkdir(media);
  const video = join(media, "original.mp4");
  await writeFile(video, "preserved-original-video");
  film.shots = film.shots.map((s, i) => ({
    ...s,
    id: `source-${i}`,
    sceneId: film.scenes[0]!.id,
    no: i + 1,
    continuity: undefined,
    continuityFromShotId: "",
    continuityFrame: undefined,
    picture: "保留原画面",
    line: i === 0 ? ("长".repeat(35) + "。 ").repeat(3) : "短句。",
    lines: [],
    speaker: "甲",
    takes: [1, 2, 3].map((index) => ({
      id: `take-${i}-${index}`,
      shotId: `source-${i}`,
      index,
      status: "done" as const,
      videoPath: video,
      videoUrl: "",
      stillUrl: "",
      prompt: "原版",
      reason: "",
      createdAt: "",
    })),
    selectedTakeId: `take-${i}-1`,
    stills: [],
  }));
  film.audioClips = [
    {
      id: "old-sfx",
      shotId: film.shots[0]!.id,
      takeId: film.shots[0]!.selectedTakeId,
      lane: "sfx",
      path: video,
      label: "原音轨",
      startSeconds: 0,
      durationSeconds: 1,
      offsetSeconds: 0,
      gainDb: -9,
    },
  ];
  const other = {
    ...structuredClone(film),
    id: "film_" + "b".repeat(24),
    episodeNo: 2,
    episodeTitle: "另一集",
    title: "另一集片名",
    sourceText: "另一集原文",
  };
  await nativeLibrary.writeProject(films, film);
  await nativeLibrary.writeProject(films, other);
  const history = createFilmHistory({ filmsRoot: films }),
    admitted = deferred<void>(),
    release = deferred<void>();
  releases.push(() => release.resolve());
  let hold = false,
    transport = false,
    corruptBackup = false,
    failSave = false,
    staleRead = false,
    refuseNative = false;
  let limitEnabled = false,
    registryNow = 0;
  const limitId = "dle_" + "d".repeat(32),
    expiresAt = 30 * 60 * 1000;
  const native = createFilmDialogueSplits({
    filmsRoot: films,
    history,
    limitEvidence: (_owner, id, record, shotId) =>
      limitEnabled &&
      registryNow < expiresAt &&
      id === limitId &&
      record.id === film.id &&
      shotId === "source-0"
        ? { requiredSeconds: 19.25, maxSeconds: 15, rawAudioSaved: true }
        : null,
    consumeLimitEvidence: () => {
      limitEnabled = false;
    },
    beforeCommit: async () => {
      if (hold) {
        admitted.resolve();
        await release.promise;
      }
      if (refuseNative) throw Error("BACKUP_FAILED");
    },
  });
  let onRelease: (() => void) | undefined;
  let dropReceipt = false,
    staleSecondRead = false,
    readNumber = 0;
  let corruptReply: "source" | "duplicate-child" | "extra-field" | undefined;
  let host!: Parameters<typeof editorHost>[0],
    persistence!: ReturnType<typeof queue>,
    flush: ((v: FilmFlushRequest) => void) | undefined;
  vi.spyOn(editor, "createEditorHost").mockImplementation((options) => {
    host = options;
    return editorHost(options);
  });
  vi.spyOn(queues, "createFilmPersistence").mockImplementation((options) => {
    const p = queue(options);
    persistence = p;
    const lease = async (id: string, recovery: boolean) => {
      const l = await tracked(recovery ? p.acquireExternalRecovery(id) : p.acquire(id));
      return {
        ...l,
        save: (...a: Parameters<typeof l.save>) =>
          tracked(l.save(...a).then((stored) => (dropReceipt ? undefined : stored))),
        release: () =>
          tracked(
            (async () => {
              if (onRelease && !p.externalWriteState(id)) {
                const task = onRelease;
                onRelease = undefined;
                task();
              }
              await l.release();
            })(),
          ),
      };
    };
    return {
      ...p,
      save: (...a: Parameters<typeof p.save>) => tracked(p.save(...a)),
      flushAll: () => tracked(p.flushAll()),
      acquire: (id) => lease(id, false),
      acquireExternalRecovery: (id) => lease(id, true),
    };
  });
  let heldRead:
    | { entered: ReturnType<typeof deferred<void>>; released: ReturnType<typeof deferred<void>> }
    | undefined;
  const read = vi.fn(async (id: string) => {
    const raw = await nativeLibrary.readProject(films, id);
    if (heldRead) {
      const gate = heldRead;
      heldRead = undefined;
      gate.entered.resolve();
      await gate.released.promise;
    }
    if (
      corruptReply &&
      raw &&
      Array.isArray(raw.shots) &&
      raw.shots.some((s) => s && typeof s === "object" && "splitSource" in s)
    ) {
      const changed = structuredClone(raw),
        shots = changed.shots as Record<string, unknown>[];
      if (corruptReply === "source")
        shots[0]!.splitSource = {
          ...(shots[0]!.splitSource as Record<string, unknown>),
          startOffset: 999,
        };
      if (corruptReply === "duplicate-child") shots[1]!.id = shots[0]!.id;
      if (corruptReply === "extra-field") changed.sourceText = "未经确认的外围改动";
      return changed;
    }
    if (staleSecondRead && ++readNumber === 2 && raw)
      return { ...raw, sourceText: "错误的第二次回读" };
    return staleRead && raw ? { ...raw, sourceText: "错误的旧回读" } : raw;
  });
  const write = vi.fn(async (value: FilmProject) => {
    if (failSave) throw Error("PRIVATE_SAVE");
    return (await nativeLibrary.writeProject(films, value)) as unknown as FilmProject;
  });
  const prepare = vi.fn(native.prepare),
    verify = vi.fn(native.verifyBackup),
    apply = vi.fn(async (input: Parameters<typeof native.apply>[0]) => {
      const run = tracked(native.apply(input));
      if (transport) {
        void run.catch(() => undefined);
        throw Error("PRIVATE_TRANSPORT");
      }
      const result = await run;
      if (corruptBackup && result.kind === "APPLIED")
        await writeFile(
          join(films, film.seriesId, "episodes", film.id, "history", result.backup.id + ".json"),
          "broken",
        );
      return result;
    });
  const paid = vi.fn(async () => {
      throw Error("FORBIDDEN_PROVIDER");
    }),
    flushed = vi.fn(async () => undefined);
  window.aijian = {
    listFilmSeries: async () => [
      {
        id: film.seriesId,
        title: film.seriesTitle,
        episodes: 2,
        shots: film.shots.length * 2,
        done: film.shots.length * 2,
        savedAt: "",
      },
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
    readFilmProject: read as never,
    writeFilmProject: write,
    prepareFilmDialogueSplit: prepare,
    applyFilmDialogueSplit: apply,
    verifyFilmDialogueSplitBackup: verify,
    listFilmHistory: history.list,
    captureFilmHistory: history.capture,
    restoreFilmHistory: history.restore,
    assembleFilm: async () => {
      throw Error("LOCAL_ASSEMBLY_UNAVAILABLE");
    },
    createStoryFilm: paid,
    previewVoice: paid,
    onFlush: (handler: (request: FilmFlushRequest) => void) => {
      flush = handler;
      return () => {
        flush = undefined;
      };
    },
    flushed,
  } as unknown as NonNullable<Window["aijian"]>;
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(screen.getByRole("button", { name: /剪辑/ }));
  await screen.findByRole("button", { name: "查看完整句拆镜方案" });
  return {
    root,
    films,
    film,
    other,
    native,
    history,
    prepare,
    apply,
    verify,
    write,
    read,
    paid,
    flushed,
    current: () => host.current()!,
    adopt: (f: FilmProject) => host.applyLive(f),
    queue: () => persistence,
    flush: () => flush?.({ requestId: "split-quit" }),
    hold: () => {
      hold = true;
      transport = true;
    },
    admitted: admitted.promise,
    release: () => release.resolve(),
    corrupt: () => {
      corruptBackup = true;
    },
    refuse: () => {
      refuseNative = true;
    },
    enableLimit: () => {
      limitEnabled = true;
      const current = host.current()!;
      host.applyLive({
        ...current,
        shots: current.shots.map((s, i) =>
          i
            ? s
            : {
                ...s,
                takes: [
                  ...s.takes,
                  {
                    ...s.takes[0]!,
                    id: "failed-limit",
                    index: 4,
                    status: "failed",
                    videoPath: "",
                    reason: "台词超限",
                  },
                ],
              },
        ),
      });
      rememberDialogueLimit(film.id, "source-0", "failed-limit", {
        dialogue_limit_evidence_id: limitId,
      });
    },
    expireLimit: () => {
      registryNow = expiresAt + 1;
    },
    failSave: () => {
      failSave = true;
    },
    corruptReply: (kind: "source" | "duplicate-child" | "extra-field") => {
      corruptReply = kind;
    },
    onRelease: (run: () => void) => {
      onRelease = run;
    },
    staleRead: () => {
      staleRead = true;
    },
    dropReceipt: () => {
      dropReceipt = true;
    },
    staleSecondRead: () => {
      staleSecondRead = true;
      readNumber = 0;
    },
    holdRead: () => {
      const gate = { entered: deferred<void>(), released: deferred<void>() };
      heldRead = gate;
      releases.push(() => gate.released.resolve());
      return gate;
    },
    disk: (id = film.id) => nativeLibrary.readProject(films, id),
    video,
  };
}
async function review() {
  fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
  const dialog = await screen.findByRole("dialog", { name: "按完整句拆镜" });
  await within(dialog).findByRole("region", { name: "完整句拆镜方案" });
  return dialog;
}
const accept = (d: HTMLElement) => {
  fireEvent.click(within(d).getByRole("checkbox"));
  fireEvent.click(within(d).getByRole("button", { name: "接受这份拆镜结构" }));
};
it("reviews the actual main complete plan with no write owner or media dispatch, and closes without applying", async () => {
  const f = await fixture(),
    before = f.current();
  const d = await review();
  expect(within(d).getAllByRole("article")).toHaveLength(3);
  expect(d).toHaveTextContent("预计新增 3 个视频");
  expect(d).toHaveTextContent("旧音轨引用和文件保留");
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.current()).toBe(before);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "saved" }),
  );
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.paid).not.toHaveBeenCalled();
});
it("accepts once through real backup/CAS and adopts the complete stored structure while preserving old audio and file bytes", async () => {
  const f = await fixture(),
    before = await f.disk();
  const d = await review();
  accept(d);
  await waitFor(() => expect(f.current().shots.some((s) => s.id === "source-0")).toBe(false));
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.verify).toHaveBeenCalled();
  expect(f.current().shots).toHaveLength(f.film.shots.length + 2);
  expect(f.current().audioClips).toEqual(f.film.audioClips);
  expect(await readFile(f.video, "utf8")).toBe("preserved-original-video");
  const list = await f.history.list(f.film.id);
  expect(list.kind).toBe("LIST");
  if (list.kind !== "LIST") throw Error("no history");
  expect(list.entries[0]!.reason).toBe("before-dialogue-split");
  const verified = await f.native.verifyBackup({
    projectId: f.film.id,
    historyId: list.entries[0]!.id,
    beforeHash: (f.verify.mock.calls[0]![0] as { beforeHash: string }).beforeHash,
  });
  expect(verified.kind).toBe("VERIFIED");
  expect(before!.shots as unknown[]).toHaveLength(f.film.shots.length);
  expect(f.paid).not.toHaveBeenCalled();
});
it("rejects incorrect same-ID canonical readback before preparing and preserves current creative input", async () => {
  const f = await fixture(),
    before = f.current();
  f.staleRead();
  fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
  await screen.findByText(/当前编辑还没核对保存/);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.current()).toBe(before);
  expect(f.current().sourceText).not.toBe("错误的旧回读");
  expect(f.paid).not.toHaveBeenCalled();
});
it("preflight save failure sends no prepare/apply and retains the current draft", async () => {
  const f = await fixture(),
    before = f.current();
  f.failSave();
  fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
  await screen.findByText(/当前编辑还没核对保存/);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.current()).toBe(before);
});
it("does not trust a successful apply ACK when actual backup bytes cannot be verified", async () => {
  const f = await fixture(),
    before = f.current();
  f.corrupt();
  const d = await review();
  accept(d);
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  expect(f.current().shots.map((s) => s.id)).toEqual(before.shots.map((s) => s.id));
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "unknown" }),
  );
  expect(f.paid).not.toHaveBeenCalled();
});
it("retains unknown during actual native pending, then fresh full structure and backup proofs recover without reapplying", async () => {
  const f = await fixture();
  f.hold();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await within(p).findByText(/结构或原版备份尚不能完整核对/);
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "unknown" }),
  );
  await act(async () => f.release());
  await waitFor(async () =>
    expect((await f.disk())!.shots as unknown[]).toHaveLength(f.film.shots.length + 2),
  );
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "拆镜保存待核对（1）" })).toBeNull(),
  );
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.current().shots).toHaveLength(f.film.shots.length + 2);
  expect(f.paid).not.toHaveBeenCalled();
});
it("drops a reviewed plan after creative or selected-version changes without dispatching apply", async () => {
  const f = await fixture();
  await review();
  await act(async () =>
    f.adopt({
      ...f.current(),
      shots: f.current().shots.map((s, i) => (i ? s : { ...s, selectedTakeId: s.takes[1]!.id })),
    }),
  );
  expect(screen.queryByRole("dialog", { name: "按完整句拆镜" })).toBeNull();
  expect(f.apply).not.toHaveBeenCalled();
  const d = await review();
  await act(async () => f.adopt({ ...f.current(), sourceText: "后来编辑的完整原文" }));
  expect(within(d).getByRole("button", { name: "接受这份拆镜结构" })).toBeDisabled();
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.current().sourceText).toBe("后来编辑的完整原文");
});
it("keeps a late original draft until the user explicitly adopts the fully verified split record", async () => {
  const f = await fixture();
  f.hold();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  fireEvent.change(screen.getByLabelText("改这一镜的描述"), {
    target: { value: "必须保留并展示的后来描述" },
  });
  await act(async () => f.release());
  await waitFor(async () =>
    expect((await f.disk())!.shots as unknown[]).toHaveLength(f.film.shots.length + 2),
  );
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await within(p).findByText(/与当前编辑不同/);
  expect(f.current().shots[0]!.picture).toBe("必须保留并展示的后来描述");
  fireEvent.click(within(p).getByRole("button", { name: "查看两份状态" }));
  expect((within(p).getByLabelText("拆镜保留稿文字备忘") as HTMLTextAreaElement).value).toContain(
    "必须保留并展示的后来描述",
  );
  fireEvent.click(within(p).getByRole("button", { name: "采用已核对的拆镜版并放弃这份保留稿" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "拆镜保存待核对（1）" })).toBeNull(),
  );
  expect(f.current().shots).toHaveLength(f.film.shots.length + 2);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.paid).not.toHaveBeenCalled();
});
it("late recovery verifies the original record without applying or writing the other work", async () => {
  const f = await fixture();
  f.hold();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(document.querySelector(".topbar .ep")).toHaveTextContent("另一集"));
  await waitFor(() =>
    expect(document.querySelector(".statusbar .where")).not.toHaveTextContent("正在保存"),
  );
  const other = f.current(),
    raw = await f.disk(f.other.id),
    writes = f.write.mock.calls.filter(([v]) => v.id === f.other.id).length;
  await act(async () => f.release());
  await waitFor(async () =>
    expect((await f.disk())!.shots as unknown[]).toHaveLength(f.film.shots.length + 2),
  );
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "拆镜保存待核对（1）" })).toBeNull(),
  );
  expect(f.current()).toBe(other);
  expect(await f.disk(f.other.id)).toEqual(raw);
  expect(f.write.mock.calls.filter(([v]) => v.id === f.other.id)).toHaveLength(writes);
  expect(f.apply).toHaveBeenCalledOnce();
});
it("rechecks the live ref after a measurement hash yields before applying or clearing pending", async () => {
  const f = await fixture();
  f.hold();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  await act(async () => f.release());
  await waitFor(async () =>
    expect((await f.disk())!.shots as unknown[]).toHaveLength(f.film.shots.length + 2),
  );
  const marker = f.current(),
    entered = deferred<void>(),
    released = deferred<void>(),
    hash = hashes.historyRecordHash;
  let held = false;
  releases.push(() => released.resolve());
  vi.spyOn(hashes, "historyRecordHash").mockImplementation(async (v) => {
    if (v === marker && !held) {
      held = true;
      entered.resolve();
      await released.promise;
    }
    return hash(v);
  });
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await entered.promise;
  await act(async () => {
    f.adopt({ ...marker, title: "hash期间的新片名" });
    released.resolve();
  });
  await within(p).findByText(/当前作品或保留稿又有变化/);
  expect(f.current().title).toBe("hash期间的新片名");
  expect(f.current().shots.map((s) => s.id)).toContain("source-0");
  expect(screen.getByRole("button", { name: "拆镜保存待核对（1）" })).toBeVisible();
  expect(f.apply).toHaveBeenCalledOnce();
});
it("rechecks the retained original draft even when the foreign current ref returns to the identical object during a hash", async () => {
  const f = await fixture();
  f.hold();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "另一集" }));
  await waitFor(() => expect(document.querySelector(".topbar .ep")).toHaveTextContent("另一集"));
  await waitFor(() =>
    expect(document.querySelector(".statusbar .where")).not.toHaveTextContent("正在保存"),
  );
  const other = f.current(),
    retained = f.queue().externalWriteState(f.film.id)!.draft;
  await act(async () => f.release());
  await waitFor(async () =>
    expect((await f.disk())!.shots as unknown[]).toHaveLength(f.film.shots.length + 2),
  );
  const entered = deferred<void>(),
    released = deferred<void>(),
    hash = hashes.historyRecordHash;
  let held = false;
  releases.push(() => released.resolve());
  vi.spyOn(hashes, "historyRecordHash").mockImplementation(async (v) => {
    if (v === retained && !held) {
      held = true;
      entered.resolve();
      await released.promise;
    }
    return hash(v);
  });
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await entered.promise;
  await act(async () => {
    f.adopt({ ...retained, title: "原工程微任务新稿" });
    f.queue().externalWriteState(f.film.id);
    f.adopt(other);
    released.resolve();
  });
  await within(p).findByText(/当前作品或保留稿又有变化/);
  expect(f.current()).toBe(other);
  expect(f.queue().externalWriteState(f.film.id)!.draft.title).toBe("原工程微任务新稿");
  expect(f.apply).toHaveBeenCalledOnce();
});
it.each(["creative", "take", "media"] as const)(
  "preserves a late %s change during preflight read and sends zero prepare/apply",
  async (kind) => {
    const f = await fixture(),
      gate = f.holdRead();
    fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
    await gate.entered.promise;
    const base = f.current(),
      next =
        kind === "creative"
          ? { ...base, sourceText: "读取期间的新原文" }
          : {
              ...base,
              shots: base.shots.map((s, i) =>
                i
                  ? s
                  : kind === "take"
                    ? { ...s, selectedTakeId: s.takes[1]!.id }
                    : { ...s, poster: "/trusted/late-still.png" },
              ),
            };
    await act(async () => {
      f.adopt(next);
      gate.released.resolve();
    });
    await waitFor(() => expect(f.current()).not.toBe(base));
    await waitFor(async () => {
      const stored = await f.disk();
      expect(
        kind === "creative"
          ? stored!.sourceText
          : kind === "take"
            ? (stored!.shots as { selectedTakeId: string }[])[0]!.selectedTakeId
            : (stored!.shots as { poster: string }[])[0]!.poster,
      ).toBe(
        kind === "creative"
          ? "读取期间的新原文"
          : kind === "take"
            ? next.shots[0]!.selectedTakeId
            : "/trusted/late-still.png",
      );
    });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.paid).not.toHaveBeenCalled();
  },
);
it("adopts materialized source only from this real save receipt and reads one main review without repeated media materialization", async () => {
  const f = await fixture(),
    png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kGZkAAAAASUVORK5CYII=";
  await act(async () =>
    f.adopt({
      ...f.current(),
      shots: f.current().shots.map((s, i) => (i ? s : { ...s, poster: png })),
    }),
  );
  const d = await review();
  expect(within(d).getAllByRole("article")).toHaveLength(3);
  const raw = await f.disk(),
    poster = (raw!.shots as { poster: string }[])[0]!.poster;
  expect(poster).not.toContain("data:");
  expect(f.current().shots[0]!.poster).toBe(poster);
  expect((await readFile(poster)).byteLength).toBeGreaterThan(0);
  const files = await readdir(join(f.films, f.film.seriesId, "media"));
  expect(files).toHaveLength(1);
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.paid).not.toHaveBeenCalled();
});
it("a lost ACK before any native write resolves only through fresh READY gate and exact unchanged raw, never a repeated apply", async () => {
  const f = await fixture();
  f.hold();
  f.refuse();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  await act(async () => f.release());
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await within(p).findByText(/当前仍是原分镜结构/);
  expect(screen.queryByRole("button", { name: "拆镜保存待核对（1）" })).toBeNull();
  expect(f.current().shots.map((s) => s.id)).toContain("source-0");
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.verify).not.toHaveBeenCalled();
  expect(f.prepare).toHaveBeenCalledTimes(2);
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "saved" }),
  );
  expect(f.paid).not.toHaveBeenCalled();
});
it("shows only main's actual target limit via the session helper without persisting its opaque evidence ID", async () => {
  const f = await fixture();
  await act(async () => f.enableLimit());
  const d = await review();
  expect(d).toHaveTextContent("本次目标的实际配音需要 19.25 秒");
  expect(d).toHaveTextContent("本次目标尚未提交视频");
  expect((f.prepare.mock.calls[0]![0] as { limitEvidenceId?: string }).limitEvidenceId).toMatch(
    /^dle_/u,
  );
  expect(JSON.stringify(await f.disk())).not.toContain("dle_");
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.paid).not.toHaveBeenCalled();
});
it("expired live limit evidence cannot leave an unchanged lost-ACK operation permanently unknown: fixed post-gate refusal plus exact before reads settles without reapply", async () => {
  const f = await fixture();
  await act(async () => f.enableLimit());
  f.hold();
  f.refuse();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  f.expireLimit();
  await act(async () => f.release());
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await within(p).findByText(/当前仍是原分镜结构/);
  expect(screen.queryByRole("button", { name: "拆镜保存待核对（1）" })).toBeNull();
  expect(f.apply).toHaveBeenCalledOnce();
  expect(await f.prepare.mock.results.at(-1)!.value).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
  expect(f.verify).not.toHaveBeenCalled();
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "saved" }),
  );
  expect(f.paid).not.toHaveBeenCalled();
});
it("INVALID_INPUT is never a lifecycle proof even when raw still equals before after a lost ACK", async () => {
  const f = await fixture();
  f.hold();
  f.refuse();
  const d = await review();
  accept(d);
  await f.admitted;
  await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
  await waitFor(() => expect(within(d).getByRole("button", { name: "关闭" })).toBeEnabled());
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  await act(async () => f.release());
  f.prepare.mockResolvedValueOnce({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true });
  fireEvent.click(screen.getByRole("button", { name: "拆镜保存待核对（1）" }));
  const p = await screen.findByRole("dialog", { name: "拆镜保存状态" });
  fireEvent.click(within(p).getByRole("button", { name: "核对拆镜保存结果" }));
  await within(p).findByText(/结构或原版备份尚不能完整核对/);
  expect(screen.getByRole("button", { name: "拆镜保存待核对（1）" })).toBeVisible();
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "unknown" }),
  );
});
it.each(["source", "duplicate-child", "extra-field"] as const)(
  "rejects the entire stored delta with forged %s instead of trusting child/source metadata",
  async (kind) => {
    const f = await fixture(),
      before = f.current();
    f.corruptReply(kind);
    const d = await review();
    accept(d);
    await screen.findByRole("button", { name: "拆镜保存待核对（1）" });
    expect(f.current().shots.map((s) => s.id)).toEqual(before.shots.map((s) => s.id));
    expect(f.current().sourceText).not.toBe("未经确认的外围改动");
    expect(f.apply).toHaveBeenCalledOnce();
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.paid).not.toHaveBeenCalled();
  },
);
it("native result confirmed before a late release-save failure is an ordinary failed save, not an orphan unknown or repeated split", async () => {
  const f = await fixture(),
    d = await review();
  f.onRelease(() => {
    f.adopt({ ...f.current(), title: "确认之后的新片名" });
    f.failSave();
  });
  accept(d);
  await waitFor(() => expect(f.current().shots).toHaveLength(f.film.shots.length + 2));
  await waitFor(() => expect(f.current().title).toBe("确认之后的新片名"));
  expect(screen.queryByRole("button", { name: "拆镜保存待核对（1）" })).toBeNull();
  expect(f.queue().externalWriteState(f.film.id)).toBeNull();
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "failed" }),
  );
  expect(f.apply).toHaveBeenCalledOnce();
  expect((await f.disk())!.title).not.toBe("确认之后的新片名");
  expect(f.paid).not.toHaveBeenCalled();
});
it("an older void save-lease adapter is rejected rather than treating a same-ID read as a new canonical receipt", async () => {
  const f = await fixture(),
    before = f.current();
  f.dropReceipt();
  fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
  await screen.findByText(/当前编辑还没核对保存/);
  expect(f.current()).toBe(before);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
});
it("a stale second read after actual materialization cannot replace creative input or reach native prepare", async () => {
  const f = await fixture(),
    source = f.current().sourceText,
    png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kGZkAAAAASUVORK5CYII=";
  await act(async () =>
    f.adopt({
      ...f.current(),
      shots: f.current().shots.map((s, i) => (i ? s : { ...s, poster: png })),
    }),
  );
  f.staleSecondRead();
  fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
  await screen.findByText(/当前编辑还没核对保存/);
  expect(f.current().sourceText).toBe(source);
  expect(f.current().sourceText).not.toBe("错误的第二次回读");
  expect(f.current().shots[0]!.poster).not.toContain("data:");
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
});
it.each(["lost-line", "bad-budget", "limit-mismatch"] as const)(
  "rejects an incomplete or contradictory native review (%s) as a whole",
  async (fault) => {
    const f = await fixture();
    f.prepare.mockImplementationOnce(async (input) => {
      const reply = await f.native.prepare(input);
      if (reply.kind !== "READY") throw Error("expected ready");
      if (fault === "lost-line") reply.plan.parts.pop();
      if (fault === "bad-budget") reply.plan.videoCount++;
      if (fault === "limit-mismatch")
        reply.actualLimit = {
          requiredSeconds: 19.25,
          maxSeconds: 10,
          rawAudioSaved: true,
          targetVideoSubmitted: false,
        };
      return reply;
    });
    fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
    const d = await screen.findByRole("dialog", { name: "按完整句拆镜" });
    await within(d).findByText("拆镜方案没有完整读到，请重新检查。");
    expect(within(d).queryAllByRole("article")).toHaveLength(0);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.paid).not.toHaveBeenCalled();
  },
);
it("does not adopt old canonical content after an in-place creative mutation during preflight read", async () => {
  const f = await fixture(),
    gate = f.holdRead();
  fireEvent.click(screen.getByRole("button", { name: "查看完整句拆镜方案" }));
  await gate.entered.promise;
  const original = f.current();
  original.sourceText = "等待回读时原对象里的新原文";
  await act(async () => gate.released.resolve());
  await screen.findByText("本次输入已变化，请重新检查拆镜方案。");
  expect(f.current()).toBe(original);
  expect(f.current().sourceText).toBe("等待回读时原对象里的新原文");
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
  await act(async () => f.flush());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "split-quit", status: "saved" }),
  );
  expect((await f.disk())!.sourceText).toBe("等待回读时原对象里的新原文");
});
