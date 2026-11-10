import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ApplyBundledFilmSceneAudioInput,
  SuggestBundledFilmSceneAudioInput,
  SuggestBundledFilmSceneAudioResult,
} from "@aijian/contracts/film-audio-library";
import type { FilmProject } from "../film/project";
import * as editor from "./actions/editor-host";
import * as queues from "./film-persistence";
import { historyRecordHash } from "./actions/persistent-history";
import { soundFilm, deferred } from "./shot-audio-suggestions.test-fixture";
import { scenePlan, sceneGroupResult } from "./scene-audio-suggestions.test-fixture";
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editor.createEditorHost,
  originalQueue = queues.createFilmPersistence;
const running = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>) {
  running.add(p);
  void p.then(
    () => running.delete(p),
    () => running.delete(p),
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
  while (running.size) await Promise.allSettled([...running]);
  vi.restoreAllMocks();
});
async function open(fixtureOptions: { ordinarySaveGate?: Promise<void> } = {}) {
  const film = soundFilm(),
    other = {
      ...structuredClone(film),
      id: "film_sceneother00001",
      episodeNo: 2,
      episodeTitle: "整场另一集",
      styleZh: "另一集独有画风",
    };
  const disk = new Map<string, Record<string, unknown>>(
    [film, other].map((f) => [f.id, structuredClone(f) as unknown as Record<string, unknown>]),
  );
  let host!: Parameters<typeof originalHost>[0],
    persistence!: ReturnType<typeof originalQueue>,
    failWrites = false,
    active = false;
  let mode: "success" | "transport" | "partial" | "hold" = "success",
    pendingInput: ApplyBundledFilmSceneAudioInput | undefined;
  const files = new Set([film.audioClips[0]!.path!]),
    admitted = deferred<void>();
  const otherSaved = deferred<FilmProject>();
  const firstOrdinarySave = deferred<FilmProject>();
  let ordinarySaves = 0;
  const heldNative = deferred<Awaited<ReturnType<typeof sceneGroupResult>>>();
  const suggestionReads: {
    input: SuggestBundledFilmSceneAudioInput;
    raw: Record<string, unknown>;
    hash: string;
  }[] = [];
  vi.spyOn(editor, "createEditorHost").mockImplementation((options) => {
    host = options;
    return originalHost(options);
  });
  vi.spyOn(queues, "createFilmPersistence").mockImplementation((options) => {
    const queue = originalQueue(options);
    persistence = queue;
    return {
      ...queue,
      save: (...args: Parameters<typeof queue.save>) => {
        const saved = track(
          fixtureOptions.ordinarySaveGate
            ? fixtureOptions.ordinarySaveGate.then(() => queue.save(...args))
            : queue.save(...args),
        );
        void saved.then(
          (stored) => {
            if (stored?.id === other.id) otherSaved.resolve(stored);
            if (stored?.id === film.id) {
              ordinarySaves++;
              firstOrdinarySave.resolve(stored);
            }
          },
          () => undefined,
        );
        return saved;
      },
      acquire: async (id) => {
        const lease = await track(queue.acquire(id));
        return {
          ...lease,
          save: (...args: Parameters<typeof lease.save>) => track(lease.save(...args)),
          release: () => track(lease.release()),
        };
      },
    };
  });
  const write = vi.fn(async (value: FilmProject) => {
    if (failWrites) throw Error("PRIVATE_SAVE");
    const raw = structuredClone(value) as unknown as Record<string, unknown>;
    disk.set(value.id, raw);
    return structuredClone(raw);
  });
  const suggest = vi.fn(
    async (
      input: SuggestBundledFilmSceneAudioInput,
    ): Promise<SuggestBundledFilmSceneAudioResult> => {
      const read = structuredClone(disk.get(input.projectId)!);
      if (input.expectedProjectHash !== (await historyRecordHash(read)))
        return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
      expect(input.expectedSelection).toEqual(
        (read.shots as FilmProject["shots"]).map((shot) => ({
          shotId: shot.id,
          takeId: shot.selectedTakeId,
        })),
      );
      const finalRead = structuredClone(disk.get(input.projectId)!);
      const hash = await historyRecordHash(finalRead);
      if (input.expectedProjectHash !== hash)
        return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
      suggestionReads.push({ input: structuredClone(input), raw: finalRead, hash });
      return scenePlan(input);
    },
  );
  const commit = async (input: ApplyBundledFilmSceneAudioInput) => {
    const result = await sceneGroupResult(disk.get(input.projectId)!, scenePlan(input), input);
    if (mode === "partial") result.project.audioClips.pop();
    disk.set(input.projectId, structuredClone(result.project));
    for (const c of result.project.audioClips as FilmProject["audioClips"])
      if (c.path) files.add(c.path);
    active = false;
    return result;
  };
  const apply = vi.fn(async (input: ApplyBundledFilmSceneAudioInput) => {
    expect(Object.keys(input).sort()).toEqual([
      "catalogSha256",
      "expectedProjectHash",
      "expectedSelection",
      "lanes",
      "pickerSha256",
      "planFingerprint",
      "projectId",
      "sceneId",
    ]);
    expect(input.expectedProjectHash).toBe(await historyRecordHash(disk.get(input.projectId)));
    pendingInput = input;
    active = true;
    admitted.resolve();
    if (mode === "transport") throw Error("PRIVATE_TRANSPORT");
    if (mode === "hold") return await heldNative.promise;
    return await commit(input);
  });
  const inspect = vi.fn(
    async (input: {
      projectId: string;
      shotId: string;
      takeId: string;
      expectedProjectHash: string;
    }) =>
      active
        ? { kind: "FAILED", code: "BUSY", unchanged: true }
        : { kind: "TARGET", ...input, projectHash: input.expectedProjectHash, durationSeconds: 8 },
  );
  const provider = vi.fn(),
    single = vi.fn();
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
    suggestBundledFilmSceneAudio: suggest,
    applyBundledFilmSceneAudio: apply,
    inspectBundledFilmAudioTarget: inspect,
    addBundledFilmAudio: single,
    createStoryFilm: provider,
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
    expect(screen.getByRole("button", { name: "查看本场声音建议" })).toBeEnabled(),
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
    single,
    provider,
    admitted,
    otherSaved: () => otherSaved.promise,
    firstOrdinarySave: () => firstOrdinarySave.promise,
    ordinarySaves: () => ordinarySaves,
    suggestionReads,
    rejectNative: () => heldNative.reject(Error("PRIVATE_LATE_TRANSPORT")),
    current: () => host.current()!,
    change: (f: FilmProject) =>
      act(() => {
        host.applyLive(f);
      }),
    queue: () => persistence,
    failSave: () => {
      failWrites = true;
    },
    mode: (value: typeof mode) => {
      mode = value;
    },
    finish: async () => {
      if (!pendingInput) throw Error("missing input");
      return await commit(pendingInput);
    },
  };
}
async function view() {
  fireEvent.click(screen.getByRole("button", { name: "查看本场声音建议" }));
  const dialog = await screen.findByRole("dialog", { name: "本场声音建议" });
  await within(dialog).findByRole("checkbox", { name: "音效 · 完整 2 段" });
  return dialog;
}
function choose(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "音效 · 完整 2 段" }));
}
function confirm(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "选用所选轨道的完整建议" });
}
it("reviews all cross-shot segments and notes without writing clips, then explicitly adds once and removes the complete global group", async () => {
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
  expect(f.current().audioClips).toEqual(before.audioClips);
  expect(within(dialog).getByText(/场内配乐情绪不一致/)).toBeInTheDocument();
  expect(within(dialog).getAllByText(/以下起止时间均在该镜头内/)).toHaveLength(4);
  expect(within(dialog).getByText(/实际跨度 48 秒/)).toBeInTheDocument();
  expect(f.film.shots.reduce((sum, shot) => sum + shot.seconds, 0)).not.toBe(48);
  choose(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/本次 2 段声音已加入并保存/);
  expect(within(dialog).queryByText("场次、选版或素材已变化，请刷新后重新核对。")).toBeNull();
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.single).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
  expect(f.current().shots).toEqual(before.shots);
  const added = f.current().audioClips.filter((c) => c.sceneAudioBinding);
  expect(new Set(added.map((c) => c.shotId)).size).toBe(2);
  expect(added.every((c) => c.envelope?.fades?.length === 2)).toBe(true);
  const files = [...f.files];
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  const groups = await screen.findByRole("region", { name: "当前场次的完整配声建议组" });
  const remove = within(groups).getByRole("button", { name: "移除第1组声音" });
  await waitFor(() => expect(remove).toBeEnabled());
  fireEvent.click(remove);
  await waitFor(() => expect(f.current().audioClips).toEqual(before.audioClips));
  await waitFor(() => expect(f.disk.get(f.film.id)!.audioClips).toEqual(before.audioClips));
  expect([...f.files]).toEqual(files);
  expect(f.apply).toHaveBeenCalledOnce();
});
it("does not request suggestions when the real persistence preflight fails", async () => {
  const f = await open();
  f.failSave();
  fireEvent.click(screen.getByRole("button", { name: "查看本场声音建议" }));
  await screen.findByText(/当前编辑还没保存上/);
  expect(f.suggest).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
  expect(await f.queue().flushAll()).toMatchObject({ status: "failed" });
});
it("registers lost-ACK unknown before dialog discard, keeps BUSY pending and only adopts full cross-shot proof after native settles", async () => {
  const f = await open(),
    before = structuredClone(f.current());
  f.mode("transport");
  const dialog = await view();
  choose(dialog);
  fireEvent.click(confirm(dialog));
  await f.admitted.promise;
  await within(dialog).findByText(/尚未确认|保存结果/);
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)?.status).toBe("unknown"));
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  expect(f.apply).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /待核对/ }));
  const panel = await screen.findByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText(/本机写入尚未确认结束/);
  expect(f.queue().externalWriteState(f.film.id)?.status).toBe("unknown");
  expect(f.apply).toHaveBeenCalledOnce();
  await act(async () => {
    await f.finish();
  });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)).toBeNull());
  expect(f.current().audioClips).toHaveLength(before.audioClips.length + 2);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.provider).not.toHaveBeenCalled();
});
it("keeps an unknown full scene group pending when a later draft deleted a participating non-anchor shot", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await view();
  choose(dialog);
  fireEvent.click(confirm(dialog));
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)?.status).toBe("unknown"));
  const deleted = f.current().shots[1]!.id;
  f.change({
    ...f.current(),
    shots: f.current().shots.filter((shot) => shot.id !== deleted),
    styleZh: "保留后来改的画风",
  });
  await act(async () => {
    await f.finish();
  });
  fireEvent.click(screen.getByRole("button", { name: /本地素材保存待核对/ }));
  const panel = await screen.findByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await within(panel).findByText(/两份状态已保留/);
  expect(f.current().shots.some((shot) => shot.id === deleted)).toBe(false);
  expect(f.current().styleZh).toBe("保留后来改的画风");
  expect(f.current().audioClips).toEqual(f.film.audioClips);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(await f.queue().flushAll()).toMatchObject({ status: "unknown" });
  fireEvent.click(within(panel).getByRole("button", { name: "查看冲突处理" }));
  const review = within(panel).getByRole("region", { name: "保存冲突选择" });
  expect(f.current().shots.some((shot) => shot.id === deleted)).toBe(false);
  fireEvent.click(within(review).getByRole("button", { name: "采用已保存版本并放弃这份未保存稿" }));
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)).toBeNull());
  expect(f.current().shots.some((shot) => shot.id === deleted)).toBe(true);
  expect(f.current().audioClips).toHaveLength(f.film.audioClips.length + 2);
  expect((await f.queue().flushAll()).status).toBe("saved");
  expect(f.apply).toHaveBeenCalledOnce();
});
it("does not treat a partially returned cross-shot group as success or clear quit protection", async () => {
  const f = await open();
  f.mode("partial");
  const dialog = await view();
  choose(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/无法对应/);
  expect(f.current().audioClips).toEqual(f.film.audioClips);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(await f.queue().flushAll()).toMatchObject({ status: "unknown" });
  expect(f.provider).not.toHaveBeenCalled();
});
it("discards a readonly reply after creative changes and frees the save owner while review is in flight", async () => {
  const f = await open(),
    admitted = deferred<void>(),
    reply = deferred<ReturnType<typeof scenePlan>>();
  f.suggest.mockImplementationOnce(async () => {
    admitted.resolve();
    return reply.promise;
  });
  fireEvent.click(screen.getByRole("button", { name: "查看本场声音建议" }));
  await admitted.promise;
  // The real native request is pending, but its short preflight lease has ended.
  expect(await f.queue().flushAll()).toMatchObject({ status: "saved" });
  const input = f.suggest.mock.calls[0]![0];
  f.change({ ...f.current(), styleZh: "用户后来改的画风" });
  await act(async () => reply.resolve(scenePlan(input)));
  const dialog = screen.getByRole("dialog", { name: "本场声音建议" });
  expect(within(dialog).queryByRole("checkbox")).toBeNull();
  expect(f.current().styleZh).toBe("用户后来改的画风");
  expect(f.current().audioClips).toEqual(f.film.audioClips);
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("registers a late lost reply globally after another work opens, without applying or writing that work during recovery", async () => {
  const f = await open();
  f.mode("hold");
  const dialog = await view();
  choose(dialog);
  fireEvent.click(confirm(dialog));
  await f.admitted.promise;
  f.change(f.other);
  await act(async () => f.rejectNative());
  await f.otherSaved(); // Actual ordinary-save completion, not any write or an activeId side effect.
  await screen.findByRole("button", { name: "本地素材保存待核对（1）" });
  expect(screen.queryByRole("dialog", { name: "本场声音建议" })).toBeNull();
  const otherRaw = structuredClone(f.disk.get(f.other.id));
  const writes = f.write.mock.calls.filter(([raw]) => raw.id === f.other.id).length;
  await act(async () => {
    await f.finish();
  });
  fireEvent.click(screen.getByRole("button", { name: "本地素材保存待核对（1）" }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)).toBeNull());
  expect(f.current().id).toBe(f.other.id);
  expect(f.disk.get(f.other.id)).toEqual(otherRaw);
  expect(f.write.mock.calls.filter(([raw]) => raw.id === f.other.id)).toHaveLength(writes);
  expect(f.disk.get(f.film.id)!.audioClips).toHaveLength(f.film.audioClips.length + 2);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.provider).not.toHaveBeenCalled();
});
it("safely rebases the retained original draft with the full group while another work remains untouched", async () => {
  const f = await open();
  f.mode("transport");
  const dialog = await view();
  choose(dialog);
  fireEvent.click(confirm(dialog));
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)?.status).toBe("unknown"));
  f.change({ ...f.current(), styleZh: "原作品后来改的画风" });
  const retained = f.current();
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)?.draft).toBe(retained));
  f.change(f.other);
  await f.otherSaved();
  const otherRaw = structuredClone(f.disk.get(f.other.id));
  const writes = f.write.mock.calls.filter(([raw]) => raw.id === f.other.id).length;
  await act(async () => {
    await f.finish();
  });
  fireEvent.click(screen.getByRole("button", { name: "本地素材保存待核对（1）" }));
  const panel = screen.getByRole("dialog", { name: "本地素材保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对这部作品" }));
  await waitFor(() => expect(f.queue().externalWriteState(f.film.id)).toBeNull());
  expect(f.disk.get(f.film.id)!.styleZh).toBe("原作品后来改的画风");
  expect(f.disk.get(f.film.id)!.audioClips).toHaveLength(f.film.audioClips.length + 2);
  expect(f.current().id).toBe(f.other.id);
  expect(f.disk.get(f.other.id)).toEqual(otherRaw);
  expect(f.write.mock.calls.filter(([raw]) => raw.id === f.other.id)).toHaveLength(writes);
  expect(f.apply).toHaveBeenCalledOnce();
});
it("re-reads once for save-time-only CAS drift, without changing creative input or adding any clip", async () => {
  const ordinarySaveGate = deferred<void>(),
    ready = deferred<void>(),
    transport = deferred<void>();
  try {
    const f = await open({ ordinarySaveGate: ordinarySaveGate.promise });
    const before = structuredClone(f.current());
    const originalSuggest = f.suggest.getMockImplementation()!;
    f.suggest.mockImplementationOnce(async (input) => {
      f.disk.set(input.projectId, {
        ...f.disk.get(input.projectId)!,
        savedAt: "actual-later-save-time",
      });
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    });
    f.suggest.mockImplementationOnce(async (input) => {
      const reply = await originalSuggest(input);
      expect(reply.kind).toBe("SCENE_SUGGESTED");
      ready.resolve();
      await transport.promise;
      return reply;
    });
    // The real 400ms saver may be admitted before or after the read under load.
    // Gate only its queue admission so this case deterministically tests a later save;
    // leave the timer, native CAS, actual queue/write and transport distinct.
    const displayed = view();
    await ready.promise;
    expect(f.ordinarySaves()).toBe(0);
    ordinarySaveGate.resolve();
    await f.firstOrdinarySave();
    transport.resolve();
    await displayed;
    expect(f.suggest).toHaveBeenCalledTimes(2);
    expect(f.suggest.mock.calls[0]![0].expectedProjectHash).not.toBe(
      f.suggest.mock.calls[1]![0].expectedProjectHash,
    );
    expect(f.suggestionReads).toHaveLength(1);
    const accepted = f.suggestionReads[0]!;
    expect(accepted.input).toEqual(f.suggest.mock.calls[1]![0]);
    expect(accepted.hash).toBe(await historyRecordHash(accepted.raw));
    expect(accepted.input.expectedProjectHash).toBe(accepted.hash);
    expect(f.ordinarySaves()).toBe(1);
    expect(await historyRecordHash(f.disk.get(f.film.id)!)).not.toBe(accepted.hash);
    // Later legitimate saves may advance metadata. They cannot change this read receipt or
    // any creative field; never compare an accepted request hash to a different-time record.
    const creative = (raw: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(raw).filter(([key]) => !["savedAt", "directory"].includes(key)),
      );
    expect(await historyRecordHash(creative(f.disk.get(f.film.id)!))).toBe(
      await historyRecordHash(creative(accepted.raw)),
    );
    expect(f.current().audioClips).toEqual(before.audioClips);
    expect(f.current().styleZh).toBe(before.styleZh);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  } finally {
    ordinarySaveGate.resolve();
    transport.resolve();
  }
});
it("does not use the metadata retry for a creative CAS change", async () => {
  const f = await open(),
    before = structuredClone(f.current());
  f.suggest.mockImplementationOnce(async (input) => {
    f.disk.set(input.projectId, { ...f.disk.get(input.projectId)!, styleZh: "主进程新创作输入" });
    return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
  });
  fireEvent.click(screen.getByRole("button", { name: "查看本场声音建议" }));
  await screen.findByText(/作品、选版或素材已变化，请重新查看整场建议/);
  expect(f.suggest).toHaveBeenCalledOnce();
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.current().styleZh).toBe(before.styleZh);
  expect(f.current().audioClips).toEqual(before.audioClips);
});
it("shows a bounded missing-library result with refresh and close, and never dispatches an empty lane plan", async () => {
  const f = await open();
  f.suggest.mockImplementationOnce(async () => ({
    kind: "FAILED",
    code: "LIBRARY_UNAVAILABLE",
    unchanged: true,
  }));
  fireEvent.click(screen.getByRole("button", { name: "查看本场声音建议" }));
  const dialog = await screen.findByRole("dialog", { name: "本场声音建议" });
  await within(dialog).findByText(/本地素材目录暂时不可用/);
  expect(within(dialog).getByRole("button", { name: "刷新建议" })).toBeEnabled();
  f.suggest.mockImplementationOnce(async (input) => ({ ...scenePlan(input), clips: [] }));
  fireEvent.click(within(dialog).getByRole("button", { name: "刷新建议" }));
  await within(dialog).findByRole("checkbox", { name: "音效 · 完整 0 段" });
  expect(
    within(dialog)
      .getAllByRole("checkbox")
      .every((c) => (c as HTMLInputElement).disabled),
  ).toBe(true);
  expect(confirm(dialog)).toBeDisabled();
  fireEvent.click(confirm(dialog));
  expect(f.apply).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog", { name: "本场声音建议" })).toBeNull();
});
it("refuses whole-scene removal when a member ID is duplicated outside that group on another shot", async () => {
  const f = await open(),
    dialog = await view();
  choose(dialog);
  fireEvent.click(confirm(dialog));
  await within(dialog).findByText(/本次 2 段声音已加入并保存/);
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  const member = f.current().audioClips.find((c) => c.sceneAudioBinding)!;
  f.change({
    ...f.current(),
    audioClips: [
      ...f.current().audioClips,
      { ...f.current().audioClips[0]!, id: member.id, shotId: f.current().shots[4]!.id },
    ],
  });
  const group = await screen.findByRole("region", { name: "当前场次的完整配声建议组" });
  const remove = within(group).getByRole("button", { name: "移除第1组声音" });
  await waitFor(() => expect(remove).toBeDisabled());
  const clips = structuredClone(f.current().audioClips),
    files = [...f.files];
  fireEvent.click(remove);
  expect(f.current().audioClips).toEqual(clips);
  expect([...f.files]).toEqual(files);
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.provider).not.toHaveBeenCalled();
});
