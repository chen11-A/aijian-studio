import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoryCreationFailurePolicyResult } from "@aijian/contracts/generation-failure-policy";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";
import * as editors from "./actions/editor-host";
import * as policyView from "./StoryCreationFailurePolicyView";
import { deferred } from "./shot-audio-suggestions.test-fixture";
const originalHost = editors.createEditorHost,
  OriginalView = policyView.StoryCreationFailurePolicyView;
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
const configured = (revision: number, limit: number): StoryCreationFailurePolicyResult => ({
  kind: "POLICY",
  policy: {
    state: "CONFIGURED",
    revision,
    failure_limit: limit,
    scope: "GROK_STORY_CREATION_FAILURES",
  },
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
  vi.spyOn(policyView, "StoryCreationFailurePolicyView").mockImplementation((props) => {
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
  const get = vi.fn(async (): Promise<StoryCreationFailurePolicyResult> => ({
    kind: "POLICY",
    policy: {
      state: "UNCONFIGURED",
      revision: 0,
      failure_limit: null,
      scope: "GROK_STORY_CREATION_FAILURES",
    },
  }));
  const put = vi.fn(
    async (
      _id: string,
      _input: { expected_revision: number; failure_limit: number },
    ): Promise<StoryCreationFailurePolicyResult> => configured(1, 0),
  );
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
      : { getStoryCreationFailurePolicy: get, configureStoryCreationFailurePolicy: put }),
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  const rendered = render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await firstWrite.promise;
  function show() {
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
    fireEvent.click(screen.getByRole("button", { name: "设置创作流程失败上限" }));
    return screen.getByRole("dialog", { name: "创作流程失败保护" });
  }
  return { film, get, put, provider, create, write, show, rendered, callbacks, host: () => host };
}
it("uses the real settings entry, saves explicit zero once with the server revision, and leaves the film/media untouched", async () => {
  const f = await open();
  const before = structuredClone(f.host().current());
  const dialog = f.show();
  await within(dialog).findByText("尚未配置创作流程上限。");
  expect(within(dialog).getByRole("textbox")).toHaveValue("");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "0" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  await within(dialog).findByText("创作流程上限已保存。");
  expect(f.get).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId);
  expect(f.put).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId, {
    expected_revision: 0,
    failure_limit: 0,
  });
  expect(f.host().current()).toEqual(before);
  expect(f.provider).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});
it("refreshes a CAS conflict without retrying PUT and preserves the requested draft for explicit resubmission", async () => {
  const f = await open();
  const dialog = f.show();
  await within(dialog).findByText("尚未配置创作流程上限。");
  f.put
    .mockResolvedValueOnce({ kind: "FAILED", code: "POLICY_CHANGED" })
    .mockResolvedValueOnce(configured(3, 7));
  f.get.mockResolvedValueOnce(configured(2, 5));
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "7" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  await within(dialog).findByText("设置已被修改，请核对已保存的值，再次提交你的创作流程上限。");
  expect(within(dialog).getByRole("textbox")).toHaveValue("7");
  expect(f.put).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  await within(dialog).findByText("创作流程上限已保存。");
  expect(f.put.mock.calls[1]).toEqual([
    f.film.backendProjectId,
    { expected_revision: 2, failure_limit: 7 },
  ]);
});
it("keeps an unconfirmed write read-only until an explicit fresh GET, never automatically resubmitting", async () => {
  const f = await open();
  const dialog = f.show();
  await within(dialog).findByText("尚未配置创作流程上限。");
  f.put.mockResolvedValueOnce({ kind: "FAILED", code: "WRITE_UNCONFIRMED" });
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "3" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  await within(dialog).findByText("创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。");
  expect(
    within(dialog).queryByRole("button", { name: "保存创作流程上限" }),
  ).not.toBeInTheDocument();
  expect(f.get).toHaveBeenCalledTimes(1);
  const old = f.callbacks.at(-1)!;
  act(() => old.onSave(3));
  expect(f.put).toHaveBeenCalledTimes(1);
  f.get.mockResolvedValueOnce({ kind: "FAILED", code: "WRITE_UNCONFIRMED" });
  fireEvent.click(within(dialog).getByRole("button", { name: "重新核对创作流程上限" }));
  await within(dialog).findByText("创作流程上限暂时没有读到，请重新核对。");
  expect(within(dialog).queryByRole("button", { name: "保存创作流程上限" })).toBeNull();
  act(() => old.onSave(3));
  expect(f.put).toHaveBeenCalledTimes(1);
  f.get.mockResolvedValueOnce(configured(1, 3));
  fireEvent.click(within(dialog).getByRole("button", { name: "重新核对创作流程上限" }));
  await within(dialog).findByText("已保存的创作流程上限：3 次。");
  expect(f.put).toHaveBeenCalledTimes(1);
});
it.each(["read", "write"] as const)(
  "ignores a late %s after changing the actual film/API identity and keeps the new work intact",
  async (phase) => {
    const f = await open();
    const pending = deferred<StoryCreationFailurePolicyResult>();
    if (phase === "read") f.get.mockReturnValueOnce(pending.promise);
    const dialog = f.show();
    if (phase === "write") {
      await within(dialog).findByText("尚未配置创作流程上限。");
      f.put.mockReturnValueOnce(pending.promise);
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "2" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
    }
    const other = {
      ...f.host().current()!,
      id: "other-policy-work",
      backendProjectId: `prj_${"b".repeat(32)}`,
      title: "另一作品",
    };
    act(() => f.host().applyLive(other));
    await act(async () => pending.resolve(configured(1, 2)));
    expect(screen.queryByRole("dialog", { name: "创作流程失败保护" })).not.toBeInTheDocument();
    expect(f.host().current()!.id).toBe(other.id);
    expect(f.host().current()!.backendProjectId).toBe(other.backendProjectId);
    expect(f.provider).not.toHaveBeenCalled();
  },
);
it("closing a pending write does not cancel the server request or adopt its late response into a new session", async () => {
  const f = await open();
  const dialog = f.show();
  await within(dialog).findByText("尚未配置创作流程上限。");
  const pending = deferred<StoryCreationFailurePolicyResult>();
  f.put.mockReturnValueOnce(pending.promise);
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "8" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  const fresh = f.show();
  await within(fresh).findByText("尚未配置创作流程上限。");
  await act(async () => pending.resolve(configured(1, 8)));
  expect(within(fresh).getByRole("textbox")).toHaveValue("");
  expect(within(fresh).queryByText("创作流程上限已保存。")).not.toBeInTheDocument();
  expect(f.put).toHaveBeenCalledTimes(1);
});
it.each([{ unbound: true }, { unsupported: true }])(
  "does not fabricate an API project or local policy when unavailable: %j",
  async (options) => {
    const f = await open(options);
    const dialog = f.show();
    expect(
      within(dialog).queryByRole("button", { name: "保存创作流程上限" }),
    ).not.toBeInTheDocument();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  },
);
it("does not enable writing after a failed or malformed read and treats a mismatched write acknowledgement as unconfirmed", async () => {
  const f = await open();
  f.get.mockResolvedValueOnce({ kind: "FAILED", code: "UNAVAILABLE" });
  const dialog = f.show();
  await within(dialog).findByText("创作流程上限暂时没有读到，请重新核对。");
  expect(
    within(dialog).queryByRole("button", { name: "保存创作流程上限" }),
  ).not.toBeInTheDocument();
  expect(f.put).not.toHaveBeenCalled();
  f.get.mockResolvedValueOnce({
    kind: "POLICY",
    policy: {
      state: "CONFIGURED",
      revision: 1,
      failure_limit: 1001,
      scope: "GROK_STORY_CREATION_FAILURES",
    },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "重新核对创作流程上限" }));
  await within(dialog).findByText("创作流程上限暂时没有读到，请重新核对。");
  expect(f.put).not.toHaveBeenCalled();
  f.get.mockResolvedValueOnce(configured(2, 3));
  fireEvent.click(within(dialog).getByRole("button", { name: "重新核对创作流程上限" }));
  await within(dialog).findByText("已保存的创作流程上限：3 次。");
  f.put.mockResolvedValueOnce(configured(4, 4));
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "4" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  await within(dialog).findByText("创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。");
  expect(f.put).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId, {
    expected_revision: 2,
    failure_limit: 4,
  });
});
it("retires old dialog callbacks instead of letting them submit or close a freshly read session", async () => {
  const f = await open();
  const dialog = f.show();
  await within(dialog).findByText("尚未配置创作流程上限。");
  const old = f.callbacks.at(-1)!;
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  const fresh = f.show();
  await within(fresh).findByText("尚未配置创作流程上限。");
  const reads = f.get.mock.calls.length;
  act(() => {
    old.onSave(9);
    old.onRefresh();
    old.onClose();
  });
  expect(f.put).not.toHaveBeenCalled();
  expect(f.get).toHaveBeenCalledTimes(reads);
  expect(screen.getByRole("dialog", { name: "创作流程失败保护" })).toBe(fresh);
});

it("keeps parent unconfigured and blank when the independent video policy already has a saved allowance", async () => {
  const f = await open();
  const videoGet = vi.fn(async () => ({
    kind: "POLICY" as const,
    policy: {
      state: "CONFIGURED" as const,
      revision: 9,
      failure_limit: 77,
      scope: "GROK_VIDEO_SUBMIT_FAILURES" as const,
    },
  }));
  window.aijian!.getGenerationFailurePolicy = videoGet;
  const videoPut = vi.fn();
  window.aijian!.configureGenerationFailurePolicy = videoPut;
  expect(f.get).not.toHaveBeenCalled();
  expect(videoGet).not.toHaveBeenCalled();
  const parent = f.show();
  await within(parent).findByText("尚未配置创作流程上限。");
  expect(within(parent).getByRole("textbox")).toHaveValue("");
  expect(parent.textContent).toContain("单独补做定妆照、单独配音");
  expect(parent.textContent).toContain("随机重做中间首帧不会重置");
  expect(videoGet).not.toHaveBeenCalled();
  expect(videoPut).not.toHaveBeenCalled();
  fireEvent.click(within(parent).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "作品设置" }));
  fireEvent.click(screen.getByRole("button", { name: "设置视频提交失败上限" }));
  const video = screen.getByRole("dialog", { name: "视频提交失败保护" });
  await within(video).findByText("已保存的上限：77 次。");
  expect(videoGet).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId);
  expect(f.put).not.toHaveBeenCalled();
});
it("blocks blank, negative, fractional, exponent and over-limit input then saves explicit 1000 without manufacturing usage", async () => {
  const f = await open(),
    dialog = f.show();
  await within(dialog).findByText("尚未配置创作流程上限。");
  const input = within(dialog).getByRole("textbox");
  for (const value of ["", "-1", "1.2", "1e2", "Infinity", "1001"]) {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
    expect(within(dialog).getByText("请输入0到1000的整数。")).toBeVisible();
    expect(f.put).not.toHaveBeenCalled();
  }
  f.put.mockResolvedValueOnce(configured(1, 1000));
  fireEvent.change(input, { target: { value: "1000" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  await within(dialog).findByText("创作流程上限已保存。");
  expect(f.put).toHaveBeenCalledExactlyOnceWith(f.film.backendProjectId, {
    expected_revision: 0,
    failure_limit: 1000,
  });
  expect(dialog.textContent).not.toMatch(/已用[：:]\s*\d|剩余[：:]\s*\d/);
});
it.each(["read", "write"] as const)(
  "retires late parent %s and captured callbacks immediately on an account-change event",
  async (phase) => {
    const f = await open(),
      pending = deferred<StoryCreationFailurePolicyResult>();
    if (phase === "read") f.get.mockReturnValueOnce(pending.promise);
    const dialog = f.show();
    if (phase === "write") {
      await within(dialog).findByText("尚未配置创作流程上限。");
      f.put.mockReturnValueOnce(pending.promise);
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "4" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
    }
    const stale = f.callbacks.at(-1)!;
    act(() => window.dispatchEvent(new Event("aivora-grok-changed")));
    await act(async () => pending.resolve(configured(1, 4)));
    expect(screen.queryByRole("dialog", { name: "创作流程失败保护" })).toBeNull();
    const calls = f.put.mock.calls.length;
    act(() => stale.onSave(5));
    expect(f.put).toHaveBeenCalledTimes(calls);
    expect(f.provider).not.toHaveBeenCalled();
    const fresh = f.show();
    await within(fresh).findByText("尚未配置创作流程上限。");
    expect(within(fresh).getByRole("textbox")).toHaveValue("");
    expect(within(fresh).queryByText("创作流程上限已保存。")).toBeNull();
  },
);
it("does not accept a valid video-scoped read or stale/mismatched parent ACK as a parent allowance", async () => {
  const f = await open();
  f.get.mockResolvedValueOnce({
    kind: "POLICY",
    policy: {
      state: "CONFIGURED",
      revision: 3,
      failure_limit: 99,
      scope: "GROK_VIDEO_SUBMIT_FAILURES",
    },
  } as unknown as StoryCreationFailurePolicyResult);
  const dialog = f.show();
  await within(dialog).findByText("创作流程上限暂时没有读到，请重新核对。");
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  expect(f.put).not.toHaveBeenCalled();
  f.get.mockResolvedValueOnce(configured(3, 2));
  fireEvent.click(within(dialog).getByRole("button", { name: "重新核对创作流程上限" }));
  await within(dialog).findByText("已保存的创作流程上限：2 次。");
  f.put.mockResolvedValueOnce(configured(3, 2));
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "2" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  await within(dialog).findByText("创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。");
  expect(f.put).toHaveBeenCalledTimes(1);
  expect(within(dialog).queryByRole("button", { name: "保存创作流程上限" })).toBeNull();
});

it("locks duplicate submissions synchronously while keeping close available", async () => {
  const f = await open(),
    dialog = f.show();
  await within(dialog).findByText("尚未配置创作流程上限。");
  const pending = deferred<StoryCreationFailurePolicyResult>();
  f.put.mockReturnValueOnce(pending.promise);
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "5" } });
  const captured = f.callbacks.at(-1)!;
  fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
  act(() => {
    captured.onSave(5);
    captured.onSave(5);
  });
  expect(f.put).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeEnabled();
  await act(async () => pending.resolve(configured(1, 5)));
  await within(dialog).findByText("创作流程上限已保存。");
  expect(f.put).toHaveBeenCalledTimes(1);
  expect(f.provider).not.toHaveBeenCalled();
});
it.each(["read", "write"] as const)(
  "keeps a %s transport error private and never retries it automatically",
  async (phase) => {
    const f = await open();
    if (phase === "read") f.get.mockRejectedValueOnce(Error("PRIVATE_TOKEN_PATH"));
    const dialog = f.show();
    if (phase === "write") {
      await within(dialog).findByText("尚未配置创作流程上限。");
      f.put.mockRejectedValueOnce(Error("PRIVATE_TOKEN_PATH"));
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "6" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "保存创作流程上限" }));
      await within(dialog).findByText("创作流程上限的保存结果尚未确认，请重新核对。不要重复提交。");
      expect(f.put).toHaveBeenCalledTimes(1);
    } else {
      await within(dialog).findByText("创作流程上限暂时没有读到，请重新核对。");
      expect(f.put).not.toHaveBeenCalled();
    }
    expect(dialog.textContent).not.toContain("PRIVATE_TOKEN_PATH");
    expect(within(dialog).queryByRole("button", { name: "保存创作流程上限" })).toBeNull();
    expect(f.provider).not.toHaveBeenCalled();
  },
);
it("retires a late response when only the backend project identity changes, without changing the local work", async () => {
  const f = await open(),
    pending = deferred<StoryCreationFailurePolicyResult>();
  f.get.mockReturnValueOnce(pending.promise);
  f.show();
  const before = f.host().current()!,
    project = `prj_${"b".repeat(32)}`;
  act(() => f.host().applyLive({ ...before, backendProjectId: project }));
  await act(async () => pending.resolve(configured(1, 8)));
  expect(screen.queryByRole("dialog", { name: "创作流程失败保护" })).toBeNull();
  expect(f.host().current()!.id).toBe(before.id);
  const fresh = f.show();
  await within(fresh).findByText("尚未配置创作流程上限。");
  expect(f.get.mock.calls.at(-1)).toEqual([project]);
  expect(f.put).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});
