import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  GenerationVideoRecoveryListResult,
  GenerationVideoRecoveryResult,
  SaveRecoveredGenerationVideoResult,
} from "@aijian/contracts/generation-video-recovery";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";
import * as editors from "./actions/editor-host";
import * as recoveryView from "./GenerationVideoRecoveryView";
import { deferred } from "./shot-audio-suggestions.test-fixture";
const originalHost = editors.createEditorHost,
  OriginalView = recoveryView.GenerationVideoRecoveryView;
const writes = new Set<Promise<unknown>>();
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(async () => {
  cleanup();
  while (writes.size) await Promise.allSettled([...writes]);
  vi.restoreAllMocks();
});
const attemptId = "a".repeat(32);
const file = { fileName: `recovered-${attemptId}.mp4`, sha256: "a".repeat(64), bytes: 100 };
const listed = (recovered = false): GenerationVideoRecoveryListResult => ({
  kind: "ATTEMPTS",
  items: [
    {
      attemptId: attemptId,
      state: recovered ? "RECOVERED" : "UNKNOWN",
      ...(recovered ? { file } : {}),
    },
  ],
  hasMore: false,
});
async function open(options: { unbound?: boolean; unsupported?: boolean } = {}) {
  const film = sampleFilm();
  film.jobs = [];
  film.backendProjectId = options.unbound ? "" : `prj_${"a".repeat(32)}`;
  let host!: Parameters<typeof originalHost>[0];
  vi.spyOn(editors, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  const callbacks: Parameters<typeof OriginalView>[0][] = [];
  vi.spyOn(recoveryView, "GenerationVideoRecoveryView").mockImplementation((props) => {
    callbacks.push(props);
    return OriginalView(props);
  });
  const firstWrite = deferred<void>();
  const write = vi.fn((raw: FilmProject) => {
    const promise = Promise.resolve(structuredClone(raw));
    writes.add(promise);
    void promise.then(() => {
      writes.delete(promise);
      firstWrite.resolve();
    });
    return promise;
  });
  const list = vi.fn(async (): Promise<GenerationVideoRecoveryListResult> => listed());
  const recover = vi.fn(async (): Promise<GenerationVideoRecoveryResult> => ({
    kind: "RECOVERED",
    attemptId: attemptId,
    file,
  }));
  const save = vi.fn(async (): Promise<SaveRecoveredGenerationVideoResult> => ({
    kind: "SAVED",
    file,
  }));
  const provider = vi.fn(),
    create = vi.fn();
  window.aijian = {
    listFilmSeries: async () => [],
    readFilmProject: async () => structuredClone(film),
    writeFilmProject: write,
    createProject: create,
    createStoryFilm: provider,
    ...(options.unsupported
      ? {}
      : {
          listGenerationVideoRecoveries: list,
          recoverGenerationVideo: recover,
          saveRecoveredGenerationVideo: save,
        }),
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await firstWrite.promise;
  function show() {
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    fireEvent.click(screen.getByRole("button", { name: "查看可核对的视频记录" }));
    return screen.getByRole("dialog", { name: "找回原视频素材" });
  }
  return { film, list, recover, save, provider, create, write, show, callbacks, host: () => host };
}
it("only reads after the actual settings entry and explicitly recovers then saves raw footage without changing any film/take/media", async () => {
  const f = await open(),
    before = structuredClone(f.host().current());
  expect(f.list).not.toHaveBeenCalled();
  expect(f.recover).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  const dialog = f.show();
  await within(dialog).findByText("原素材尚未确认。");
  expect(f.list).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId);
  expect(f.recover).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "找回原素材" }));
  await within(dialog).findByText(file.fileName);
  expect(f.recover).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId, attemptId);
  expect(within(dialog).queryByText(attemptId)).not.toBeInTheDocument();
  expect(f.save).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "另存原素材" }));
  await within(dialog).findByText("原素材已另存。当前镜头和版本没有替换。");
  expect(f.save).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId, attemptId);
  expect(f.host().current()).toEqual(before);
  expect(f.provider).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});
it.each(["WAITING", "UNREACHABLE", "NO_VALID_VIDEO", "PROVIDER_FAILED"] as const)(
  "keeps %s unknown and never calls save or restarts generation",
  async (reason) => {
    const f = await open();
    f.recover.mockResolvedValue({ kind: "UNKNOWN", attemptId: attemptId, reason });
    const d = f.show();
    await within(d).findByText("原素材尚未确认。");
    fireEvent.click(within(d).getByRole("button", { name: "找回原素材" }));
    await within(d).findByText(
      {
        WAITING: "原任务仍未确认完成，可以稍后手动核对。",
        UNREACHABLE: "暂时无法联系原任务，是否完成仍未确认。",
        NO_VALID_VIDEO: "尚未读到可核验的视频素材。",
        PROVIDER_FAILED: "原任务返回失败，本次没有找回视频素材。",
      }[reason],
    );
    expect(within(d).queryByRole("button", { name: "另存原素材" })).not.toBeInTheDocument();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  },
);
it("locks duplicate recovery while pending, allows close, and rejects retained callbacks after reopening", async () => {
  const f = await open(),
    hold = deferred<GenerationVideoRecoveryResult>();
  f.recover.mockReturnValueOnce(hold.promise);
  const d = f.show();
  await within(d).findByText("原素材尚未确认。");
  const old = f.callbacks.at(-1)!;
  fireEvent.click(within(d).getByRole("button", { name: "找回原素材" }));
  fireEvent.click(within(d).getByRole("button", { name: "找回原素材" }));
  expect(f.recover).toHaveBeenCalledTimes(1);
  fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
  const next = f.show();
  await within(next).findByText("原素材尚未确认。");
  await act(async () => {
    hold.resolve({ kind: "RECOVERED", attemptId: attemptId, file });
    await hold.promise;
    old.onRecover(attemptId);
    old.onSave(attemptId);
    old.onClose();
  });
  expect(screen.getByRole("dialog", { name: "找回原视频素材" })).toBeInTheDocument();
  expect(within(next).queryByText(file.fileName)).not.toBeInTheDocument();
  expect(f.recover).toHaveBeenCalledTimes(1);
  expect(f.save).not.toHaveBeenCalled();
});
it("retires an account's pending list synchronously on account-change notification", async () => {
  const f = await open(),
    hold = deferred<GenerationVideoRecoveryListResult>();
  f.list.mockReturnValueOnce(hold.promise);
  f.show();
  fireEvent(window, new Event("aivora-grok-changed"));
  await act(async () => {
    hold.resolve(listed(true));
    await hold.promise;
  });
  expect(screen.queryByRole("dialog", { name: "找回原视频素材" })).not.toBeInTheDocument();
  expect(screen.queryByText(file.fileName)).not.toBeInTheDocument();
  expect(f.recover).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("drops old project/backend identity replies without applying the returned footage", async () => {
  const f = await open(),
    hold = deferred<GenerationVideoRecoveryResult>();
  f.recover.mockReturnValueOnce(hold.promise);
  const d = f.show();
  await within(d).findByText("原素材尚未确认。");
  fireEvent.click(within(d).getByRole("button", { name: "找回原素材" }));
  const before = f.host().current()!;
  await act(async () => {
    f.host().applyLive({
      ...before,
      id: "film_other",
      backendProjectId: `prj_${"b".repeat(32)}`,
      styleZh: "另一份创作稿",
    });
  });
  await act(async () => {
    hold.resolve({ kind: "RECOVERED", attemptId: attemptId, file });
    await hold.promise;
  });
  expect(screen.queryByRole("dialog", { name: "找回原视频素材" })).not.toBeInTheDocument();
  expect(f.host().current()?.styleZh).toBe("另一份创作稿");
  expect(f.save).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("separates cancelled save from confirmed save and preserves the file for a deliberate later save", async () => {
  const f = await open();
  f.list.mockResolvedValue(listed(true));
  f.save.mockResolvedValueOnce({ kind: "CANCELLED" });
  const d = f.show();
  await within(d).findByText(file.fileName);
  fireEvent.click(within(d).getByRole("button", { name: "另存原素材" }));
  await within(d).findByText("已取消另存，当前镜头没有修改。");
  expect(within(d).queryByText("原素材已另存。当前镜头和版本没有替换。")).not.toBeInTheDocument();
  fireEvent.click(within(d).getByRole("button", { name: "另存原素材" }));
  await within(d).findByText("原素材已另存。当前镜头和版本没有替换。");
  expect(f.save).toHaveBeenCalledTimes(2);
});
it.each(["ack", "transport"] as const)(
  "does not automatically repeat unconfirmed %s save; only explicit fresh listing unlocks the row",
  async (mode) => {
    const f = await open();
    f.list.mockResolvedValue(listed(true));
    if (mode === "ack") f.save.mockResolvedValueOnce({ kind: "FAILED", code: "WRITE_UNCONFIRMED" });
    else f.save.mockRejectedValueOnce(new Error("PRIVATE_PATH_AND_TOKEN"));
    const d = f.show();
    await within(d).findByText(file.fileName);
    fireEvent.click(within(d).getByRole("button", { name: "另存原素材" }));
    await within(d).findByText(/保存结果尚未确认/);
    expect(within(d).getByRole("button", { name: "另存原素材" })).toBeDisabled();
    expect(within(d).queryByText("PRIVATE_PATH_AND_TOKEN")).not.toBeInTheDocument();
    expect(f.save).toHaveBeenCalledTimes(1);
    fireEvent.click(within(d).getByRole("button", { name: "重新读取列表" }));
    await within(d).findByText(file.fileName);
    expect(within(d).getByRole("button", { name: "另存原素材" })).toBeEnabled();
    expect(f.save).toHaveBeenCalledTimes(1);
  },
);
it("distinguishes empty, truncated, invalid metadata and unavailable lists without inventing successful footage", async () => {
  const f = await open();
  f.list.mockResolvedValueOnce({ kind: "ATTEMPTS", items: [], hasMore: true });
  const d = f.show();
  await within(d).findByText("没有读到可核对的记录。这不代表所有视频都已生成。");
  expect(within(d).getByText("还有其他记录未列出。本次列表不是完整任务清单。")).toBeInTheDocument();
  f.list.mockResolvedValueOnce({
    kind: "ATTEMPTS",
    items: [
      {
        attemptId: attemptId,
        state: "RECOVERED",
        file: { ...file, fileName: "/PRIVATE/secret.mp4" },
      },
    ],
    hasMore: false,
  });
  fireEvent.click(within(d).getByRole("button", { name: "重新读取列表" }));
  await within(d).findByText("记录暂时无法核验，请重新读取列表。");
  expect(d.textContent).not.toContain("/PRIVATE/");
  f.list.mockResolvedValueOnce({ kind: "FAILED", code: "ACCOUNT_UNAVAILABLE" });
  fireEvent.click(within(d).getByRole("button", { name: "重新读取列表" }));
  await within(d).findByText("当前登录身份无法核对这些记录，请先核对登录状态。");
  expect(f.recover).not.toHaveBeenCalled();
});
it.each([{ unsupported: true }, { unbound: true }])(
  "keeps unsupported or unbound environments local with no create/read/recover/save dispatch: %j",
  async (options) => {
    const f = await open(options);
    f.show();
    await screen.findByText(
      options.unsupported
        ? "当前环境不支持找回原视频素材，请使用支持此功能的桌面版。"
        : "本集尚未关联可核对的作品，不能读取原任务。",
    );
    expect(f.list).not.toHaveBeenCalled();
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  },
);
it("does not display a late save acknowledgement in a reopened account session or invoke retained callbacks", async () => {
  const f = await open();
  f.list.mockResolvedValue(listed(true));
  const hold = deferred<SaveRecoveredGenerationVideoResult>();
  f.save.mockReturnValueOnce(hold.promise);
  const d = f.show();
  await within(d).findByText(file.fileName);
  const old = f.callbacks.at(-1)!;
  fireEvent.click(within(d).getByRole("button", { name: "另存原素材" }));
  expect(within(d).getByRole("button", { name: "另存原素材" })).toBeDisabled();
  fireEvent(window, new Event("aivora-grok-changed"));
  const next = f.show();
  await within(next).findByText(file.fileName);
  await act(async () => {
    hold.resolve({ kind: "SAVED", file });
    await hold.promise;
    old.onSave(attemptId);
    old.onRecover(attemptId);
    old.onRefresh();
    old.onClose();
  });
  expect(screen.getByRole("dialog", { name: "找回原视频素材" })).toBeInTheDocument();
  expect(
    within(next).queryByText("原素材已另存。当前镜头和版本没有替换。"),
  ).not.toBeInTheDocument();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.list).toHaveBeenCalledTimes(2);
  expect(f.recover).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it.each(["ack", "transport"] as const)(
  "requires a fresh list after an unconfirmed %s recovery, without inventing a saved file or resubmitting generation",
  async (mode) => {
    const f = await open();
    if (mode === "ack")
      f.recover.mockResolvedValueOnce({ kind: "FAILED", code: "WRITE_UNCONFIRMED" });
    else f.recover.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_AND_PATH"));
    const d = f.show();
    await within(d).findByText("原素材尚未确认。");
    fireEvent.click(within(d).getByRole("button", { name: "找回原素材" }));
    await within(d).findByText("请重新读取列表后再核对这条记录。");
    expect(within(d).getByRole("button", { name: "找回原素材" })).toBeDisabled();
    expect(within(d).queryByRole("button", { name: "另存原素材" })).not.toBeInTheDocument();
    expect(d.textContent).not.toContain("PRIVATE_PROVIDER_AND_PATH");
    fireEvent.click(within(d).getByRole("button", { name: "重新读取列表" }));
    await within(d).findByText("原素材尚未确认。");
    expect(within(d).getByRole("button", { name: "找回原素材" })).toBeEnabled();
    expect(f.recover).toHaveBeenCalledTimes(1);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
  },
);
