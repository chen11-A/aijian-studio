import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DemoProvider, useDemo } from "./model";
import { HomePages } from "./HomePages";
import { EditorDialog } from "./Common";
import { PROJECT_CREATE_JOURNAL_KEY as key } from "./adapters/projectCreateJournal";
import type { CreateProjectInput } from "../api/studio";
const input: CreateProjectInput = {
  name: "原创建",
  aspect_ratio: "16:9",
  target_duration_seconds: 60,
  source_language: "zh-CN",
};
const saved = {
  id: `prj_${"a".repeat(32)}`,
  ...input,
  status: "active",
  revision: 1,
  created_at: "2026-10-11T00:00:00Z",
  updated_at: "2026-10-11T00:00:00Z",
};
let model: ReturnType<typeof useDemo>;
function Capture() {
  model = useDemo();
  return (
    <>
      <HomePages />
      <EditorDialog />
    </>
  );
}
function bridge(createProject = vi.fn().mockRejectedValue(new Error("response lost"))) {
  const api = {
    health: vi.fn().mockResolvedValue({
      data: { status: "ok", service: "aijian-api", version: "1" },
      request_id: "health",
    }),
    listProjects: vi.fn().mockResolvedValue({ request_id: "list", data: [] }),
    createProject,
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [] }),
    getProductionBrief: vi.fn().mockResolvedValue({ kind: "EMPTY" }),
    getSourceManifest: vi.fn().mockRejectedValue(new Error("empty")),
  };
  window.aijian = api as unknown as NonNullable<Window["aijian"]>;
  return api;
}
async function mount() {
  window.history.replaceState({}, "", "#home");
  const view = render(
    <DemoProvider>
      <Capture />
    </DemoProvider>,
  );
  await screen.findByRole("button", { name: "本地工作区已连接" });
  return view;
}
async function submit() {
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("作品名称"), { target: { value: input.name } });
  fireEvent.click(screen.getByRole("button", { name: "创建真实项目" }));
  await screen.findByText(/创建结果未知或保存记录/);
}
async function close() {
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  const discard = screen.queryByRole("button", { name: "放弃修改并关闭" });
  if (discard) fireEvent.click(discard);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete window.aijian;
  vi.restoreAllMocks();
});
it("persists before the only POST, keeps exact UNKNOWN through refresh/dialog reopen, and restores original fields", async () => {
  const api = bridge();
  api.createProject.mockImplementation(async (request) => {
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ input: request });
    throw new Error("lost201");
  });
  await mount();
  await submit();
  const raw = localStorage.getItem(key);
  expect(raw).not.toBeNull();
  await close();
  api.listProjects.mockResolvedValue({ request_id: "list", data: [saved] } as never);
  fireEvent.click(screen.getByRole("button", { name: "本地工作区已连接" }));
  await waitFor(() => expect(api.listProjects).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  expect(screen.getByLabelText("作品名称")).toHaveValue(input.name);
  expect(screen.getByLabelText("项目画幅")).toHaveValue("16:9");
  expect(screen.getByLabelText("作品名称")).toBeDisabled();
  expect(screen.getByRole("button", { name: "创建真实项目" })).toBeDisabled();
  await act(async () => {
    await model.createRealProject({ ...input, name: "新UUID绕过" });
  });
  expect(api.createProject).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBe(raw);
});
it("keeps the original journal across full provider remount without any replay or original GET", async () => {
  const api = bridge(),
    view = await mount();
  await submit();
  const raw = localStorage.getItem(key);
  view.unmount();
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  expect(screen.getByLabelText("作品名称")).toHaveValue(input.name);
  expect(screen.getByRole("button", { name: "创建真实项目" })).toBeDisabled();
  expect(api.createProject).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBe(raw);
});
it.each(["name", "target_duration_seconds", "source_language", "aspect_ratio"] as const)(
  "keeps full-body mismatch %s UNKNOWN",
  async (field) => {
    const bad = {
      ...saved,
      [field]:
        field === "target_duration_seconds" ? 90 : field === "aspect_ratio" ? "9:16" : "different",
    };
    const api = bridge(vi.fn().mockResolvedValue({ data: bad }));
    await mount();
    await submit();
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(api.createProject).toHaveBeenCalledTimes(1);
  },
);
it("only clears its exact intent on current direct POST success", async () => {
  const api = bridge(vi.fn().mockResolvedValue({ data: saved }));
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("作品名称"), { target: { value: input.name } });
  fireEvent.click(screen.getByRole("button", { name: "创建真实项目" }));
  await waitFor(() => expect(model.page).toBe("source"));
  expect(localStorage.getItem(key)).toBeNull();
  expect(api.createProject).toHaveBeenCalledTimes(1);
});
it("does not let late positive creation after a list refresh clear the original intent", async () => {
  let resolve!: (value: unknown) => void;
  const api = bridge(
    vi.fn().mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    ),
  );
  await mount();
  let call!: Promise<unknown>;
  act(() => {
    call = model.createRealProject(input);
  });
  const raw = localStorage.getItem(key);
  await act(async () => {
    await model.connectRealWorkspace();
  });
  await act(async () => {
    resolve({ data: saved });
    await call;
  });
  expect(localStorage.getItem(key)).toBe(raw);
  expect(model.projectCreateState.kind).toBe("REMOTE_UNKNOWN");
  await act(async () => {
    await model.createRealProject(input);
  });
  expect(api.createProject).toHaveBeenCalledTimes(1);
});
it("does not let an unmounted owner's late positive result clear a remounted UNKNOWN", async () => {
  let resolve!: (value: unknown) => void;
  const api = bridge(
      vi.fn().mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      ),
    ),
    view = await mount();
  let call!: Promise<unknown>;
  act(() => {
    call = model.createRealProject(input);
  });
  const raw = localStorage.getItem(key);
  view.unmount();
  await mount();
  await act(async () => {
    resolve({ data: saved });
    await call;
  });
  expect(localStorage.getItem(key)).toBe(raw);
  expect(model.projectCreateState.kind).toBe("REMOTE_UNKNOWN");
  expect(api.createProject).toHaveBeenCalledTimes(1);
});
it("preserves substituted journal bytes on a late positive response", async () => {
  let resolve!: (value: unknown) => void;
  const api = bridge(
    vi.fn().mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    ),
  );
  await mount();
  let call!: Promise<unknown>;
  act(() => {
    call = model.createRealProject(input);
  });
  const original = JSON.parse(localStorage.getItem(key)!);
  const replacement = JSON.stringify({ ...original, input: { ...input, name: "替代" } });
  localStorage.setItem(key, replacement);
  await act(async () => {
    resolve({ data: saved });
    await call;
  });
  expect(localStorage.getItem(key)).toBe(replacement);
  expect(model.projectCreateState.kind).toBe("REMOTE_UNKNOWN");
  expect(api.createProject).toHaveBeenCalledTimes(1);
});
it("restores a missing owned UNKNOWN instead of creating a replacement", async () => {
  const api = bridge();
  await mount();
  await submit();
  const raw = localStorage.getItem(key);
  localStorage.removeItem(key);
  await close();
  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  expect(localStorage.getItem(key)).toBe(raw);
  expect(screen.getByRole("button", { name: "创建真实项目" })).toBeDisabled();
  expect(api.createProject).toHaveBeenCalledTimes(1);
});
it("blocks corrupt original records through list reads without clearing them", async () => {
  localStorage.setItem(key, "{broken");
  const api = bridge();
  await mount();
  await act(async () => {
    await model.connectRealWorkspace();
    await model.createRealProject(input);
  });
  expect(localStorage.getItem(key)).toBe("{broken");
  expect(api.createProject).not.toHaveBeenCalled();
});
it("does not dispatch if persistence cannot be verified", async () => {
  const api = bridge();
  await mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  await act(async () => {
    await model.createRealProject(input);
  });
  expect(api.createProject).not.toHaveBeenCalled();
  expect(model.projectCreateState.kind).toBe("REMOTE_UNKNOWN");
});
