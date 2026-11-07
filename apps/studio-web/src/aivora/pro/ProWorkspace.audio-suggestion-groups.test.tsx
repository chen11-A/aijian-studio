import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ApplyBundledFilmShotAudioInput,
  ApplyBundledFilmShotAudioResult,
  SuggestBundledFilmShotAudioInput,
} from "@aijian/contracts/film-audio-library";
import type { FilmFlushRequest } from "@aijian/contracts/quit-save";
import type { FilmProject } from "../film/project";
import * as editor from "./actions/editor-host";
import * as queues from "./film-persistence";
import { historyRecordHash } from "./actions/persistent-history";
import { deferred, soundFilm, soundPlan } from "./shot-audio-suggestions.test-fixture";
import * as groupProof from "./actions/audio-suggestion-proof";
import { groupNativeResult } from "./audio-suggestion-group.test-fixture";
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editor.createEditorHost,
  originalQueue = queues.createFilmPersistence;
const queued = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>) {
  queued.add(p);
  void p.then(
    () => queued.delete(p),
    () => queued.delete(p),
  );
  return p;
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
      id: "film_groupsother00001",
      episodeNo: 2,
      episodeTitle: "配声另一集",
      styleZh: "另一集独有画风",
    };
  const disk = new Map<string, Record<string, unknown>>(
    [film, other].map((f) => [f.id, structuredClone(f) as unknown as Record<string, unknown>]),
  );
  const files = new Set<string>([film.audioClips[0]!.path!]);
  let host!: Parameters<typeof originalHost>[0],
    persistence!: ReturnType<typeof originalQueue>,
    flush: ((r: FilmFlushRequest) => void) | undefined,
    failWrites = false,
    active = false;
  let mode: "success" | "hold" | "transport" | "bad-receipt" | "failed" | "partial-canonical" =
      "success",
    currentInput: ApplyBundledFilmShotAudioInput | undefined,
    release: ((r: ApplyBundledFilmShotAudioResult) => void) | undefined,
    rejectNative: ((error: Error) => void) | undefined,
    nativeWrites = 0;
  let onRelease: (() => void) | undefined;
  let otherInitialSave:
    | {
        admitted: ReturnType<typeof deferred<void>>;
        released: ReturnType<typeof deferred<void>>;
        completed: ReturnType<typeof deferred<FilmProject>>;
        started: boolean;
      }
    | undefined;
  vi.spyOn(editor, "createEditorHost").mockImplementation((options) => {
    host = options;
    return originalHost(options);
  });
  vi.spyOn(queues, "createFilmPersistence").mockImplementation((options) => {
    const p = originalQueue(options);
    persistence = p;
    return {
      ...p,
      save: (...args: Parameters<typeof p.save>) => {
        const pending = track(p.save(...args)),
          gate = otherInitialSave;
        if (gate && args[0].id === other.id)
          void pending.then(
            (stored) => {
              if (stored) gate.completed.resolve(stored);
            },
            (error) => gate.completed.reject(error),
          );
        return pending;
      },
      flushAll: () => track(p.flushAll()),
      acquire: async (id) => {
        const lease = await track(p.acquire(id));
        return {
          ...lease,
          save: (...args: Parameters<typeof lease.save>) => track(lease.save(...args)),
          release: () =>
            track(
              (async () => {
                if (onRelease && !p.externalWriteState(id)) {
                  const task = onRelease;
                  onRelease = undefined;
                  task();
                }
                await lease.release();
              })(),
            ),
        };
      },
    };
  });
  let heldWrite:
    | { admitted: ReturnType<typeof deferred<void>>; released: ReturnType<typeof deferred<void>> }
    | undefined;
  const write = vi.fn(async (value: FilmProject) => {
    if (otherInitialSave && value.id === other.id && !otherInitialSave.started) {
      const gate = otherInitialSave;
      gate.started = true;
      gate.admitted.resolve();
      await gate.released.promise;
    }
    if (heldWrite) {
      const held = heldWrite;
      heldWrite = undefined;
      held.admitted.resolve();
      await held.released.promise;
    }
    if (failWrites) throw Error("PRIVATE_DISK");
    const raw = structuredClone(value) as unknown as Record<string, unknown>;
    disk.set(value.id, raw);
    return structuredClone(raw);
  });
  const proposal = (input: SuggestBundledFilmShotAudioInput) => {
    const p = soundPlan(input);
    p.clips[2]!.asset = structuredClone(p.clips[1]!.asset);
    return p;
  };
  const suggest = vi.fn(async (input: SuggestBundledFilmShotAudioInput) => {
    expect(input.expectedProjectHash).toBe(await historyRecordHash(disk.get(input.projectId)));
    return proposal(input);
  });
  const commit = async (input: ApplyBundledFilmShotAudioInput) => {
    const raw = disk.get(input.projectId)!,
      result = await groupNativeResult(raw, proposal(input), input);
    disk.set(input.projectId, result.project);
    for (const c of result.project.audioClips as FilmProject["audioClips"])
      if (c.path) files.add(c.path);
    nativeWrites++;
    active = false;
    return result;
  };
  const nativeAdmitted = deferred<void>();
  const apply = vi.fn(
    async (input: ApplyBundledFilmShotAudioInput): Promise<ApplyBundledFilmShotAudioResult> => {
      expect(Object.keys(input).sort()).toEqual([
        "catalogSha256",
        "expectedProjectHash",
        "lanes",
        "pickerSha256",
        "planFingerprint",
        "projectId",
        "shotId",
        "takeId",
      ]);
      expect(input.expectedProjectHash).toBe(await historyRecordHash(disk.get(input.projectId)));
      currentInput = input;
      if (mode === "failed") return { kind: "FAILED", code: "PLAN_UNSUPPORTED", unchanged: true };
      active = true;
      if (mode === "transport") {
        nativeAdmitted.resolve();
        throw Error("PRIVATE_TRANSPORT");
      }
      if (mode === "hold")
        return new Promise((resolve, reject) => {
          release = resolve;
          rejectNative = reject;
          nativeAdmitted.resolve();
        });
      const result = await commit(input);
      if (mode === "partial-canonical") {
        (result.project.audioClips as unknown[]).pop();
        disk.set(input.projectId, structuredClone(result.project));
      }
      return mode === "bad-receipt"
        ? { ...result, receipt: { ...result.receipt, members: result.receipt.members.slice(0, 1) } }
        : result;
    },
  );
  const inspect = vi.fn(async (input: SuggestBundledFilmShotAudioInput) => {
    if (active) return { kind: "FAILED", code: "BUSY", unchanged: true };
    if (input.expectedProjectHash !== (await historyRecordHash(disk.get(input.projectId))))
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    return {
      kind: "TARGET",
      projectId: input.projectId,
      shotId: input.shotId,
      takeId: input.takeId,
      projectHash: input.expectedProjectHash,
      durationSeconds: 8,
    };
  });
  const provider = vi.fn(),
    singleAdd = vi.fn(),
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
        shots: 6,
        done: 6,
        savedAt: "",
      })),
    readFilmProject: async (id: string) => structuredClone(disk.get(id) ?? null),
    writeFilmProject: write,
    suggestBundledFilmShotAudio: suggest,
    applyBundledFilmShotAudio: apply,
    inspectBundledFilmAudioTarget: inspect,
    addBundledFilmAudio: singleAdd,
    createStoryFilm: provider,
    assembleFilm: async () => {
      throw Error("SYNTHETIC_ASSEMBLY_UNAVAILABLE");
    },
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
    files,
    apply,
    suggest,
    inspect,
    write,
    singleAdd,
    provider,
    flushed,
    current: () => host.current()!,
    adopt: (next: FilmProject) => host.applyLive(next),
    queue: () => persistence,
    mode: (v: typeof mode) => {
      mode = v;
    },
    failWrites: () => {
      failWrites = true;
    },
    holdOtherInitialSave: () => {
      const gate = {
        admitted: deferred<void>(),
        released: deferred<void>(),
        completed: deferred<FilmProject>(),
        started: false,
      };
      otherInitialSave = gate;
      return gate;
    },
    holdNextWrite: () => {
      const held = { admitted: deferred<void>(), released: deferred<void>() };
      heldWrite = held;
      return held;
    },
    onRelease: (fn: () => void) => {
      onRelease = fn;
    },
    flush: () => flush?.({ requestId: "group-quit" }),
    finish: async () => {
      if (!currentInput) throw Error("missing input");
      const result = await commit(currentInput);
      release?.(result);
      return result;
    },
    nativeWrites: () => nativeWrites,
    admitted: () => nativeAdmitted.promise,
    rejectPending: () => {
      rejectNative?.(Error("PRIVATE_TRANSPORT_LATE"));
    },
  };
}
async function view() {
  fireEvent.click(screen.getByRole("button", { name: "查看本镜声音建议" }));
  const dialog = await screen.findByRole("dialog", { name: "本镜声音建议" });
  await within(dialog).findByRole("checkbox", { name: "音效 · 完整 2 段" });
  return dialog;
}
const confirm = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "选用所选轨道的完整建议" });
function pick(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "音效 · 完整 2 段" }));
}
async function close(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
}
it("requires explicit whole-lane selection, writes once, keeps complete repeat-asset segments and removes only this group", async () => {
  const f = await open(),
    before = structuredClone(f.current()),
    dialog = await view();
  expect(
    within(dialog)
      .getAllByRole("checkbox")
      .every((c) => !(c as HTMLInputElement).checked),
  ).toBe(true);
  expect(confirm(dialog)).toBeDisabled();
  expect(f.apply).not.toHaveBeenCalled();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/本次 2 段声音已加入并保存/);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.apply.mock.calls[0]![0].lanes).toEqual(["sfx"]);
  expect(f.nativeWrites()).toBe(1);
  expect(f.current().shots).toEqual(before.shots);
  expect(f.current().audioClips).toHaveLength(before.audioClips.length + 2);
  const additions = f.current().audioClips.filter((c) => c.suggestionGroup);
  expect(additions[0]!.path).toBe(additions[1]!.path);
  expect(additions[0]!.envelope?.fades).toHaveLength(2);
  const files = [...f.files];
  await close(dialog);
  const remove = await screen.findByRole("button", { name: "移除第1组声音" });
  await waitFor(() => expect(remove).toBeEnabled());
  fireEvent.click(remove);
  await screen.findByText(/已移除本次 2 段声音引用并保存/);
  expect(f.current().audioClips).toEqual(before.audioClips);
  expect([...f.files]).toEqual(files);
  expect(f.provider).not.toHaveBeenCalled();
  expect(f.singleAdd).not.toHaveBeenCalled();
});
it("deduplicates a batched double click and locks write controls until actual native completion", async () => {
  const f = await open();
  f.mode("hold");
  const dialog = await view();
  pick(dialog);
  const button = confirm(dialog);
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  await f.admitted();
  expect(f.apply).toHaveBeenCalledOnce();
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "刷新建议" })).toBeDisabled();
  await act(async () => {
    await f.finish();
  });
  await within(dialog).findByText(/声音已加入并保存/);
  expect(f.nativeWrites()).toBe(1);
});
it("preflight failure makes zero group RPC and preserves unsaved current edits", async () => {
  const f = await open(),
    dialog = await view();
  f.failWrites();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/尚未开始选用声音建议/);
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.nativeWrites()).toBe(0);
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "group-quit", status: "failed" }),
  );
});
it("unknown write uses the original global recovery panel, BUSY blocks retries, and exact complete readback unblocks quit", async () => {
  const f = await open(),
    before = structuredClone(f.current());
  f.mode("transport");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  expect(f.apply).toHaveBeenCalledOnce();
  await close(dialog);
  fireEvent.click(screen.getByRole("button", { name: "本地素材保存待核对（1）" }));
  const panel = await screen.findByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText(/本机写入尚未确认结束/);
  expect(f.current().audioClips).toEqual(before.audioClips);
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "group-quit", status: "unknown" }),
  );
  await act(async () => {
    await f.finish();
  });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "本地素材保存待核对（1）" })).toBeNull(),
  );
  expect(f.current().audioClips).toHaveLength(before.audioClips.length + 2);
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenLastCalledWith({ requestId: "group-quit", status: "saved" }),
  );
});
it("malformed partial ADDED receipt never reports added or clears pending despite real stored clips", async () => {
  const f = await open(),
    before = structuredClone(f.current());
  f.mode("bad-receipt");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/无法对应/);
  expect(f.current().audioClips).toEqual(before.audioClips);
  expect(f.disk.get(f.film.id)!.audioClips).toHaveLength(before.audioClips.length + 2);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "本地素材保存待核对（1）" })).toBeVisible();
  expect(dialog).not.toHaveTextContent("已加入并保存");
});
it("preserves edits made while native completion waits and saves an exact multi-clip rebase", async () => {
  const f = await open();
  f.mode("hold");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await f.admitted();
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => {
    f.adopt({ ...f.current(), title: "后来保留的片名", sourceText: "后来编辑的原文" });
    await f.finish();
  });
  await within(dialog).findByText(/保留了本页后来的编辑/);
  expect(f.current().title).toBe("后来保留的片名");
  expect(f.current().sourceText).toBe("后来编辑的原文");
  expect(f.current().audioClips).toHaveLength(f.film.audioClips.length + 2);
  expect(f.disk.get(f.film.id)!.title).toBe("后来保留的片名");
});
it("late safe foreign rebase saves only the original draft and never adopts or writes the other work", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  await close(dialog);
  await act(async () => {
    f.adopt({ ...f.current(), title: "原工程保留新稿" });
  });
  const otherSave = f.holdOtherInitialSave();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "配声另一集" }));
  await waitFor(() => expect(f.current().id).toBe(f.other.id));
  // Opening a work normalizes continuity before its normal initial save.
  // Capture the complete readback baseline only after that real queue/write settles.
  await otherSave.admitted.promise;
  await act(async () => {
    otherSave.released.resolve();
    await otherSave.completed.promise;
  });
  const other = structuredClone(f.current()),
    otherRaw = structuredClone(f.disk.get(f.other.id)),
    otherWrites = f.write.mock.calls.filter(([value]) => value.id === f.other.id).length;
  expect(document.querySelector(".topbar .ep")).toHaveTextContent(f.other.episodeTitle);
  expect(otherRaw).toEqual(other);
  await act(async () => {
    await f.finish();
  });
  fireEvent.click(screen.getByRole("button", { name: "本地素材保存待核对（1）" }));
  const panel = await screen.findByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "本地素材保存待核对（1）" })).toBeNull(),
  );
  expect(f.current()).toEqual(other);
  expect(f.disk.get(f.other.id)).toEqual(otherRaw);
  expect(f.write.mock.calls.filter(([value]) => value.id === f.other.id)).toHaveLength(otherWrites);
  expect(f.disk.get(f.film.id)!.title).toBe("原工程保留新稿");
  expect(f.disk.get(f.film.id)!.audioClips).toHaveLength(f.film.audioClips.length + 2);
  expect(f.apply).toHaveBeenCalledOnce();
});
it("confirmed native result followed by release save failure is a failed save, never phantom unknown or a repeated apply", async () => {
  const f = await open(),
    dialog = await view();
  f.onRelease(() => {
    f.adopt({ ...f.current(), title: "release期间的新编辑" });
    f.failWrites();
  });
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/结果已核对，但后来的编辑还没保存上/);
  expect(f.current().audioClips).toHaveLength(f.film.audioClips.length + 2);
  expect(f.current().title).toBe("release期间的新编辑");
  expect(f.queue().externalWriteState(f.film.id)).toBeNull();
  expect(screen.queryByRole("button", { name: "本地素材保存待核对（1）" })).toBeNull();
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "group-quit", status: "failed" }),
  );
  expect(f.apply).toHaveBeenCalledOnce();
});

it("stops before group RPC when a real edit arrives during canonical preflight write", async () => {
  const f = await open(),
    before = structuredClone(f.current()),
    dialog = await view(),
    gate = f.holdNextWrite();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await gate.admitted.promise;
  await act(async () => {
    f.adopt({
      ...f.current(),
      shots: f.current().shots.map((s, i) => (i ? s : { ...s, action: "预检期间的新动作" })),
    });
    gate.released.resolve();
  });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "关闭" })).toBeEnabled());
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.current().shots[0]!.action).toBe("预检期间的新动作");
  expect(f.current().shots.map((s) => s.takes)).toEqual(before.shots.map((s) => s.takes));
  expect(f.current().audioClips).toEqual(before.audioClips);
});
it("a confirmed old-version result preserves the user's newer selection and all old versions", async () => {
  const f = await open(),
    before = structuredClone(f.current());
  f.mode("hold");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await f.admitted();
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => {
    f.adopt({
      ...f.current(),
      shots: f.current().shots.map((s, i) => (i ? s : { ...s, selectedTakeId: s.takes[1]!.id })),
    });
    await f.finish();
  });
  await waitFor(() => expect(f.current().audioClips).toHaveLength(before.audioClips.length + 2));
  expect(f.current().shots[0]!.selectedTakeId).toBe(before.shots[0]!.takes[1]!.id);
  expect(f.current().shots.map((s) => s.takes)).toEqual(before.shots.map((s) => s.takes));
  expect(
    f
      .current()
      .audioClips.filter((c) => c.suggestionGroup)
      .every((c) => c.takeId === before.shots[0]!.selectedTakeId),
  ).toBe(true);
  expect(f.apply).toHaveBeenCalledOnce();
});
it("deleted old clips remain a conflict until the user explicitly adopts the fresh saved version", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/本机写入尚未确认结束/);
  await close(dialog);
  await act(async () => {
    f.adopt({ ...f.current(), title: "冲突稿必须保留", audioClips: [] });
    await f.finish();
  });
  fireEvent.click(screen.getByRole("button", { name: "本地素材保存待核对（1）" }));
  const panel = await screen.findByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText(/尚不能安全合并/);
  expect(f.current().title).toBe("冲突稿必须保留");
  expect(f.current().audioClips).toEqual([]);
  expect(f.apply).toHaveBeenCalledOnce();
  fireEvent.click(within(panel).getByRole("button", { name: "查看冲突处理" }));
  const review = within(panel).getByRole("region", { name: "保存冲突选择" });
  expect(review).toHaveTextContent("冲突稿必须保留");
  expect(f.current().audioClips).toEqual([]);
  fireEvent.click(within(review).getByRole("button", { name: "采用已保存版本并放弃这份未保存稿" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "本地素材保存待核对（1）" })).toBeNull(),
  );
  expect(f.current().audioClips).toHaveLength(f.film.audioClips.length + 2);
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => {
    f.flush();
  });
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "group-quit", status: "saved" }),
  );
});

it("registers a late unknown in the shared global panel even after the original dialog generation is gone", async () => {
  const f = await open();
  f.mode("hold");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await f.admitted();
  await act(async () => {
    f.adopt(f.other);
    f.rejectPending();
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "本地素材保存待核对（1）" })).toBeVisible(),
  );
  expect(screen.queryByRole("dialog", { name: "本镜声音建议" })).toBeNull();
  expect(f.current().id).toBe(f.other.id);
  expect(f.apply).toHaveBeenCalledOnce();
  const retainedOther = structuredClone(f.current());
  await act(async () => {
    await f.finish();
  });
  fireEvent.click(screen.getByRole("button", { name: "本地素材保存待核对（1）" }));
  const panel = await screen.findByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "本地素材保存待核对（1）" })).toBeNull(),
  );
  expect(f.current()).toEqual(retainedOther);
  expect(f.apply).toHaveBeenCalledOnce();
});
it("does not mistake a partial stored group for success", async () => {
  const f = await open();
  f.mode("partial-canonical");
  const before = structuredClone(f.current()),
    dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/无法对应/);
  expect(f.current().audioClips).toEqual(before.audioClips);
  expect(f.disk.get(f.film.id)!.audioClips).toHaveLength(before.audioClips.length + 1);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "本地素材保存待核对（1）" })).toBeVisible();
});
it("disables aggregate removal on a member ID collision outside the group without deleting references or files", async () => {
  const f = await open(),
    dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/声音已加入并保存/);
  await close(dialog);
  const added = f.current().audioClips.find((c) => c.suggestionGroup)!;
  await act(async () => {
    f.adopt({
      ...f.current(),
      audioClips: [...f.current().audioClips, { ...f.current().audioClips[0]!, id: added.id }],
    });
  });
  const button = await screen.findByRole("button", { name: "移除第1组声音" });
  await waitFor(() => expect(button).toBeDisabled());
  const before = structuredClone(f.current().audioClips),
    files = [...f.files];
  fireEvent.click(button);
  expect(f.current().audioClips).toEqual(before);
  expect([...f.files]).toEqual(files);
});
it("rechecks the current snapshot after asynchronous group-body proof before removing", async () => {
  const f = await open(),
    dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/声音已加入并保存/);
  await close(dialog);
  const button = await screen.findByRole("button", { name: "移除第1组声音" });
  await waitFor(() => expect(button).toBeEnabled());
  const proof = await groupProof.verifiedAudioGroup(f.current().audioClips, "audio-group-1"),
    admitted = deferred<void>(),
    held = deferred<typeof proof>();
  vi.spyOn(groupProof, "verifiedAudioGroup").mockImplementationOnce(() => {
    admitted.resolve();
    return held.promise;
  });
  const before = structuredClone(f.current().audioClips),
    files = [...f.files];
  fireEvent.click(button);
  await admitted.promise;
  await act(async () => {
    f.adopt({ ...f.current(), title: "移除核验期间的新片名" });
    held.resolve(proof);
  });
  await screen.findByText(/不能作为完整组移除/);
  expect(f.current().title).toBe("移除核验期间的新片名");
  expect(f.current().audioClips).toEqual(before);
  expect([...f.files]).toEqual(files);
});

it("closing a selected review performs no apply, and reopening starts with no lanes selected", async () => {
  const f = await open(),
    before = structuredClone(f.current()),
    dialog = await view();
  pick(dialog);
  expect(confirm(dialog)).toBeEnabled();
  await close(dialog);
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.current().audioClips).toEqual(before.audioClips);
  const reopened = await view();
  expect(confirm(reopened)).toBeDisabled();
  expect(
    within(reopened)
      .getAllByRole("checkbox")
      .every((c) => !(c as HTMLInputElement).checked),
  ).toBe(true);
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.nativeWrites()).toBe(0);
});
it("empty suggested lanes cannot be selected or dispatched", async () => {
  const f = await open();
  f.suggest.mockImplementationOnce(async (input) => ({ ...soundPlan(input), clips: [] }));
  fireEvent.click(screen.getByRole("button", { name: "查看本镜声音建议" }));
  const dialog = await screen.findByRole("dialog", { name: "本镜声音建议" });
  await within(dialog).findByRole("checkbox", { name: "音效 · 完整 0 段" });
  expect(
    within(dialog)
      .getAllByRole("checkbox")
      .every((c) => (c as HTMLInputElement).disabled),
  ).toBe(true);
  expect(confirm(dialog)).toBeDisabled();
  fireEvent.click(confirm(dialog));
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.nativeWrites()).toBe(0);
});
it("native unchanged refusal remains a bounded failure without new clips or orphaned pending", async () => {
  const f = await open(),
    before = structuredClone(f.current());
  f.mode("failed");
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/暂时无法完整加入/);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.nativeWrites()).toBe(0);
  expect(f.current().audioClips).toEqual(before.audioClips);
  expect(f.queue().externalWriteState(f.film.id)).toBeNull();
  expect(screen.queryByRole("button", { name: "本地素材保存待核对（1）" })).toBeNull();
});
it("keeps prior text undo separate from removing the newly added group", async () => {
  const f = await open(),
    original = f.current().shots[0]!.picture;
  fireEvent.change(screen.getByLabelText("改这一镜的描述"), {
    target: { value: "这次添加前用户改过的画面" },
  });
  const dialog = await view();
  pick(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/声音已加入并保存/);
  await close(dialog);
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(f.current().shots[0]!.picture).toBe(original);
  expect(f.current().audioClips.filter((c) => c.suggestionGroup)).toHaveLength(2);
  await waitFor(() => expect(screen.getByRole("button", { name: "移除第1组声音" })).toBeEnabled());
  expect(f.apply).toHaveBeenCalledOnce();
});
