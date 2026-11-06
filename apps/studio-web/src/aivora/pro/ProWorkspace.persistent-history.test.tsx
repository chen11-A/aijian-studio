import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FilmHistoryEntry, FilmHistoryGateway } from "@aijian/contracts/film-history";
import { sampleFilm, type FilmProject } from "../film/project";
import { historyRecordHash } from "./actions/persistent-history";
import { ProWorkspace } from "./ProWorkspace";
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.scenes = [film.scenes[0]!];
  film.shots = film.shots.slice(0, 1).map((shot) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    line: "",
    lines: [],
    speaker: "",
    characters: [],
    poster: "/media/old.png",
    selectedTakeId: "old",
    takes: [
      {
        id: "old",
        shotId: shot.id,
        index: 1,
        status: "done",
        videoPath: "/media/old.mp4",
        videoUrl: "",
        stillUrl: "/media/old.png",
        prompt: "old",
        createdAt: "",
        reason: "",
      },
    ],
  }));
  film.audioClips = [];
  const other = structuredClone(film);
  other.id = "film_historyother001";
  other.episodeNo = 2;
  other.episodeTitle = "第 2 集";
  other.scenes[0]!.text = "另一部作品的正文";
  const disk = new Map([
      [film.id, structuredClone(film)],
      [other.id, other],
    ]),
    snapshots = new Map<string, { entry: FilmHistoryEntry; film: FilmProject }>(),
    events: string[] = [];
  let index = 0,
    holdCapture: ReturnType<typeof gate> | undefined,
    holdRestore: ReturnType<typeof gate> | undefined;
  const newEntry = (reason: FilmHistoryEntry["reason"]): FilmHistoryEntry => ({
    id: `hst_${(++index).toString(16).padStart(32, "0")}`,
    createdAt: new Date(Date.now() + index).toISOString(),
    reason,
    summary: { scenes: 1, shots: 1, done: 1 },
  });
  const list = vi.fn<FilmHistoryGateway["listFilmHistory"]>(async (projectId) => ({
    kind: "LIST",
    entries: [...snapshots.values()]
      .filter((value) => value.film.id === projectId)
      .map((value) => value.entry)
      .reverse(),
    unreadable: 0,
  }));
  const capture = vi.fn<FilmHistoryGateway["captureFilmHistory"]>(async (input) => {
    events.push("capture-requested");
    await holdCapture?.promise;
    const stored = disk.get(input.projectId)!;
    if ((await historyRecordHash(stored)) !== input.expectedHash)
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    const entry = newEntry(input.reason);
    snapshots.set(entry.id, { entry, film: structuredClone(stored) });
    events.push("snapshot-kept");
    return { kind: "CAPTURED", entry };
  });
  const restore = vi.fn<FilmHistoryGateway["restoreFilmHistory"]>(async (input) => {
    await holdRestore?.promise;
    const target = snapshots.get(input.historyId),
      stored = disk.get(input.projectId)!;
    if (!target) return { kind: "FAILED", code: "HISTORY_DAMAGED", unchanged: true };
    const backup = newEntry("before-restore");
    snapshots.set(backup.id, { entry: backup, film: structuredClone(stored) });
    const restored = structuredClone(target.film);
    disk.set(input.projectId, restored);
    return { kind: "RESTORED", project: restored, backup };
  });
  const write = vi.fn(async (value: FilmProject) => {
    disk.set(value.id, structuredClone(value));
    return structuredClone(value);
  });
  const video = vi.fn(async () => {
    events.push("video-provider");
    return { data: { status: "SUCCEEDED", output_path: "/media/new.mp4" } };
  });
  const still = vi.fn(async () => {
    events.push("image-provider");
    return { path: `/media/new-${events.length}.png`, reason: "" };
  });
  const text = vi.fn(async () => {
    events.push("text-provider");
    return { kind: "OK", text: "{}" };
  });
  window.aijian = {
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.title, path: "", savedAt: "" },
    ]),
    listFilmEpisodes: vi.fn(async () =>
      [...disk.values()].map((value) => ({
        id: value.id,
        seriesId: value.seriesId,
        title: value.episodeTitle,
        no: value.episodeNo,
        shots: 1,
        done: 1,
        savedAt: "",
      })),
    ),
    readFilmProject: vi.fn(async (id: string) => structuredClone(disk.get(id) ?? null)),
    writeFilmProject: write,
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    listFilmHistory: list,
    captureFilmHistory: capture,
    restoreFilmHistory: restore,
    createStoryFilm: video,
    generateFilmStill: still,
  } as unknown as Window["aijian"];
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    })),
    models: vi.fn(async () => ({
      kind: "OK",
      models: [
        { id: "grok-imagine-video-1.5", label: "video" },
        { id: "grok-imagine-image-2.0", label: "image" },
        { id: "grok-4.7", label: "text" },
      ],
    })),
    completeText: text,
  } as unknown as Window["aijianGrok"];
  localStorage.setItem("aivora.film.activeId", film.id);
  return {
    film,
    other,
    disk,
    snapshots,
    events,
    list,
    capture,
    restore,
    write,
    video,
    still,
    text,
    holdCapture: () => {
      holdCapture = gate();
      return holdCapture;
    },
    holdRestore: () => {
      holdRestore = gate();
      return holdRestore;
    },
  };
}
async function open() {
  const view = render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  return view;
}
function settings() {
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
  return screen.getByRole("dialog", { name: "作品设置" });
}
async function keep() {
  const dialog = settings();
  fireEvent.click(within(dialog).getByRole("button", { name: "保存当前版本" }));
  await within(dialog).findByRole("button", { name: "恢复到这里" });
  return dialog;
}
async function restore() {
  fireEvent.click(screen.getByRole("button", { name: "恢复到这里" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "确认恢复" })).getByRole("button", {
      name: "恢复",
    }),
  );
}
function board() {
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: "分镜",
    }),
  );
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
it("lists real history after remount, restores through confirmation, and keeps the before-restore version", async () => {
  const f = fixture();
  const first = await open();
  const original = f.film.scenes[0]!.text;
  const dialog = await keep();
  expect(f.capture).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: f.film.id, reason: "manual" }),
  );
  expect(dialog.textContent).not.toContain("hst_");
  expect(dialog.textContent).not.toContain("/media/");
  first.unmount();
  await open();
  settings();
  await screen.findByRole("button", { name: "恢复到这里" });
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "恢复之前的新正文" } });
  settings();
  await screen.findByRole("button", { name: "恢复到这里" });
  fireEvent.click(screen.getByRole("button", { name: "恢复到这里" }));
  expect(f.restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(f.restore).not.toHaveBeenCalled();
  await restore();
  await screen.findByText("已恢复历史版本，恢复前的作品已另存。");
  await waitFor(() => expect(f.disk.get(f.film.id)!.scenes[0]!.text).toBe(original));
  expect(
    [...f.snapshots.values()].some(
      (value) =>
        value.entry.reason === "before-restore" &&
        value.film.scenes[0]!.text === "恢复之前的新正文",
    ),
  ).toBe(true);
  expect(f.video).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
});
it("does not apply a late restore over a new edit", async () => {
  const f = fixture();
  await open();
  await keep();
  const pending = f.holdRestore();
  await restore();
  await waitFor(() => expect(f.restore).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "等待恢复时的新编辑" } });
  await act(async () => pending.resolve());
  expect(screen.getByLabelText("这一场")).toHaveValue("等待恢复时的新编辑");
  await waitFor(() => expect(f.disk.get(f.film.id)!.scenes[0]!.text).toBe("等待恢复时的新编辑"));
  expect(f.video).not.toHaveBeenCalled();
});
it("does not write a late restore into the project opened while waiting", async () => {
  const f = fixture();
  await open();
  await keep();
  const pending = f.holdRestore();
  await restore();
  await waitFor(() => expect(f.restore).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
  await screen.findByText(/已打开第 2 集/);
  await act(async () => pending.resolve());
  expect(screen.getByLabelText("这一场")).toHaveValue("另一部作品的正文");
  expect(f.disk.get(f.other.id)!.scenes[0]!.text).toBe("另一部作品的正文");
  expect(f.video).not.toHaveBeenCalled();
});
it("persists a baseline before any video or prerequisite image request and submits only once", async () => {
  const f = fixture();
  await open();
  board();
  const pending = f.holdCapture();
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(f.capture).toHaveBeenCalledOnce());
  expect(f.video).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  expect(f.disk.get(f.film.id)!.shots[0]!.takes).toHaveLength(1);
  await act(async () => pending.resolve());
  await waitFor(() => expect(f.video).toHaveBeenCalledOnce());
  expect(f.events.indexOf("snapshot-kept")).toBeLessThan(f.events.indexOf("video-provider"));
  expect(f.capture.mock.calls[0]![0]).toMatchObject({ reason: "before-batch-generation" });
});
it("blocks the paid batch on backup failure with zero provider calls and no generated takes", async () => {
  const f = fixture();
  f.capture.mockResolvedValueOnce({ kind: "FAILED", code: "BACKUP_FAILED", unchanged: true });
  await open();
  board();
  fireEvent.click(screen.getByRole("button", { name: "生成这一场" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await screen.findByText("历史快照没有保存，请先重试。");
  expect(f.video).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  expect(f.text).not.toHaveBeenCalled();
  expect(f.disk.get(f.film.id)!.shots[0]!.takes).toHaveLength(1);
  expect(f.capture).toHaveBeenCalledOnce();
});
it("keeps missing desktop history capability explicitly unsupported instead of inventing an empty history", async () => {
  fixture();
  delete window.aijian!.listFilmHistory;
  await open();
  const dialog = settings();
  expect(within(dialog).getByText(/这个版本的软件还不能看历史版本/)).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "保存当前版本" })).toBeNull();
});
it("reports partial restore without announcing success", async () => {
  const f = fixture();
  await open();
  await keep();
  f.restore.mockImplementationOnce(async () => {
    const backup = [...f.snapshots.values()][0]!.entry;
    return { kind: "PARTIAL", project: null, backup };
  });
  await restore();
  await screen.findByText("历史恢复尚未确认，请核对当前作品。");
  expect(screen.queryByText("已恢复历史版本，恢复前的作品已另存。")).toBeNull();
});
it("waits for the snapshot after explicit four-image confirmation before any image provider call", async () => {
  const f = fixture();
  await open();
  board();
  const more = screen.getByRole("button", { name: "更多操作" });
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("button", { name: "出 4 张候选" }));
  expect(f.capture).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  const pending = f.holdCapture();
  fireEvent.click(screen.getByRole("button", { name: "确认这 4 张" }));
  await waitFor(() => expect(f.capture).toHaveBeenCalledOnce());
  expect(f.still).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await screen.findByText(/4 张候选画面已生成/);
  expect(f.still.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(f.events.indexOf("snapshot-kept")).toBeLessThan(f.events.indexOf("image-provider"));
  expect(f.video).not.toHaveBeenCalled();
});
it("backs up the all-portrait batch before its first actual image request", async () => {
  const f = fixture();
  const value = f.disk.get(f.film.id)!;
  value.characters = [{ ...value.characters[0]!, identity: "成年男性，短发黑衣", portraits: [] }];
  await open();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /角色与场景/,
    }),
  );
  const pending = f.holdCapture();
  fireEvent.click(screen.getByRole("button", { name: "给所有人出定妆照" }));
  await waitFor(() => expect(f.capture).toHaveBeenCalledOnce());
  expect(f.still).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await waitFor(() => expect(f.still).toHaveBeenCalledTimes(4));
  expect(f.events.indexOf("snapshot-kept")).toBeLessThan(f.events.indexOf("image-provider"));
});
it("does not confuse a failed history read with an empty or unsupported history", async () => {
  const f = fixture();
  f.list.mockResolvedValueOnce({ kind: "FAILED", code: "READ_FAILED", unchanged: true });
  await open();
  const dialog = settings();
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "历史版本暂时无法读取，请重试。",
  );
  expect(dialog).not.toHaveTextContent("还没有存过的版本");
  expect(dialog).not.toHaveTextContent("这个版本的软件还不能看历史版本");
});
it("uses the real workspace pipeline beforeRun barrier before membership text or media dispatch", async () => {
  const f = fixture();
  f.disk.get(f.film.id)!.sourceText = "雨夜里，书店老板收到一封来信。";
  await open();
  const pending = f.holdCapture();
  fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
  await waitFor(() => expect(f.capture).toHaveBeenCalledOnce());
  expect(f.capture.mock.calls[0]![0].reason).toBe("before-pipeline");
  expect(f.text).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await waitFor(() => expect(f.text).toHaveBeenCalled());
  expect(f.events.indexOf("snapshot-kept")).toBeLessThan(f.events.indexOf("text-provider"));
});
it("blocks the entire real pipeline before any member dispatch when its first snapshot fails", async () => {
  const f = fixture();
  f.capture.mockResolvedValueOnce({ kind: "FAILED", code: "BACKUP_FAILED", unchanged: true });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
  await screen.findByText("历史快照没有保存，请先重试。");
  expect(f.capture).toHaveBeenCalledOnce();
  expect(f.text).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
});
