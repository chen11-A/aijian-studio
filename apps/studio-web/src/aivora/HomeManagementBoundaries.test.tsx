import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProjectData, StudioTransport } from "../api/studio";
import type { Editor, Field } from "./model";
import { HomePages } from "./HomePages";
import { readProjectUpdateJournal } from "./adapters/projectManagement";

const projectId = `prj_${"1".repeat(32)}`;
const operation = "11111111-1111-4111-8111-111111111111";
type Card = {
  id: number;
  backendId: string;
  name: string;
  revision: number;
  status: string;
  updated: string;
  episode: string;
  image: string;
  favorite: boolean;
};
function modelView() {
  return {
    page: "projects",
    isFixture: false,
    workspaceState: "connected",
    scenario: "normal",
    backendProjectId: projectId as string | null,
    projects: [
      {
        id: 1,
        backendId: projectId,
        name: "Before",
        revision: 1,
        status: "进行中",
        updated: "",
        episode: "",
        image: "",
        favorite: false,
      },
    ] as Card[],
    providerSettings: { state: { kind: "ready", response: { data: [] } } },
    value: (key: string, fallback = "") => ({ projectId: "1", title: "Before" })[key] ?? fallback,
    notify: vi.fn(),
    put: vi.fn(),
    go: vi.fn(),
    setEditor: vi.fn<(editor: Editor) => void>(),
    edit: vi.fn<(title: string, fields: Field[], save?: Editor["save"]) => void>(),
    setProjects: vi.fn<(update: (old: Card[]) => Card[]) => void>(),
    selectRealProject: vi.fn().mockResolvedValue(true),
    connectRealWorkspace: vi.fn(),
    createRealProject: vi.fn().mockResolvedValue({ kind: "SUCCEEDED" }),
    createRealEpisode: vi.fn().mockResolvedValue({ kind: "SUCCEEDED" }),
    episodeState: "ready",
    episodes: [{ id: "ep-test", title: "Test episode" }],
    selectedEpisodeId: "ep-test",
    episodeCreateInFlight: false,
    episodeCreateMarker: null,
    selectRealEpisode: vi.fn().mockResolvedValue(true),
    refreshRealEpisodes: vi.fn(),
    importRealSource: vi.fn(),
  };
}
let view = modelView();
let transport: Partial<StudioTransport>;
vi.mock("./model", () => ({ useDemo: () => view }));
vi.mock("../api/studio", () => ({ createStudioTransport: () => transport }));

function project(): ProjectData {
  return {
    id: projectId,
    name: "Before",
    revision: 1,
    status: "active",
    aspect_ratio: "9:16",
    target_duration_seconds: 60,
    source_language: "zh-CN",
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  };
}
function api() {
  let saved = project();
  const gateway = {
    updateProject: vi
      .fn<NonNullable<StudioTransport["updateProject"]>>()
      .mockImplementation(async (_id, command) => {
        expect(readProjectUpdateJournal(localStorage, projectId).kind).toBe("PENDING");
        saved = {
          ...saved,
          revision: command.expectedRevision + 1,
          name: command.name ?? saved.name,
          status: command.status ?? saved.status,
        };
        return { kind: "SUCCEEDED", receipt: { data: saved, request_id: "patch" } };
      }),
    getProject: vi
      .fn<StudioTransport["getProject"]>()
      .mockImplementation(async () => ({ data: saved, request_id: "get" })),
  };
  transport = gateway;
  return gateway;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
function editor(): Editor {
  const current = view.setEditor.mock.calls.at(-1)?.[0];
  if (!current) throw new Error("Expected editor");
  return current;
}
async function save(values: Record<string, string>) {
  let result: void | false;
  await act(async () => {
    result = await editor().save?.(values);
  });
  return result!;
}
beforeEach(() => {
  localStorage.clear();
  view = modelView();
  view.setProjects.mockImplementation((update) => {
    view.projects = update(view.projects);
  });
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operation);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("project centre uses journaled authoritative management", () => {
  test.each(["重命名", "归档", "恢复项目"])(
    "%s is displayed only after receipt and GET agree",
    async (action) => {
      const gateway = api();
      if (action === "恢复项目") view.projects[0]!.status = "已归档";
      render(<HomePages />);
      click("管理Before");
      expect(editor().validate?.()).toBeUndefined();
      await save({ name: "After", action });
      expect(gateway.updateProject).toHaveBeenCalledExactlyOnceWith(projectId, {
        expectedRevision: 1,
        name: "After",
        ...(action === "归档"
          ? { status: "archived" }
          : action === "恢复项目"
            ? { status: "active" }
            : {}),
      });
      expect(gateway.getProject).toHaveBeenCalledExactlyOnceWith(projectId);
      expect(view.projects[0]).toMatchObject({
        name: "After",
        revision: 2,
        status: action === "归档" ? "已归档" : "进行中",
      });
      expect(view.put).toHaveBeenCalledWith("title", "After");
      expect(readProjectUpdateJournal(localStorage, projectId).kind).toBe("EMPTY");
      expect(screen.getByText("项目已由更新回执与权威 GET 双重核对。")).toBeVisible();
    },
  );

  test.each(["Before", "Other"])(
    "UNKNOWN remains locked until explicit reconciliation: current %s",
    async (name) => {
      const gateway = api();
      gateway.updateProject.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
      gateway.getProject.mockResolvedValue({ data: { ...project(), name }, request_id: "get" });
      render(<HomePages />);
      click("管理Before");
      expect(await save({ name: "Other", action: "重命名" })).toBe(false);
      expect(readProjectUpdateJournal(localStorage, projectId).kind).toBe("PENDING");
      click(`管理${name}`);
      expect(view.setEditor).toHaveBeenCalledTimes(1);
      await act(async () => click("查询当前项目状态"));
      expect(screen.getByText(/已读取权威项目状态/)).toBeVisible();
      expect(readProjectUpdateJournal(localStorage, projectId).kind).toBe("PENDING");
      await act(async () => click("核对并结束本地未知记录"));
      expect(readProjectUpdateJournal(localStorage, projectId).kind).toBe("EMPTY");
      expect(gateway.updateProject).toHaveBeenCalledTimes(1);
      expect(gateway.getProject).toHaveBeenCalledTimes(3);
    },
  );

  test.each([401, 403, 409, 412, 422, 428] as const)(
    "definite %s rejection reads current state without claiming save",
    async (status) => {
      const gateway = api();
      gateway.updateProject.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code: "REJECTED",
        request_id: "rejection",
      });
      render(<HomePages />);
      click("管理Before");
      expect(await save({ name: "After", action: "重命名" })).toBe(false);
      expect(view.projects[0]?.name).toBe("Before");
      expect(screen.getByText(new RegExp(`项目更新被明确拒绝：${status}`))).toBeVisible();
      expect(readProjectUpdateJournal(localStorage, projectId).kind).toBe("EMPTY");
    },
  );

  test.each(["", "a".repeat(81), "bad\nname", "bad\u007fname"])(
    "invalid project name %j cannot write",
    async (name) => {
      const gateway = api();
      render(<HomePages />);
      click("管理Before");
      expect(await save({ name, action: "重命名" })).toBe(false);
      expect(gateway.updateProject).not.toHaveBeenCalled();
    },
  );
  test.each(["重命名", "收藏 / 取消收藏（待接入）", "删除（待影响核对）"])(
    "unchanged or unsupported action %s cannot write",
    async (action) => {
      const gateway = api();
      render(<HomePages />);
      click("管理Before");
      expect(await save({ name: "Before", action })).toBe(false);
      expect(gateway.updateProject).not.toHaveBeenCalled();
      expect(view.setProjects).not.toHaveBeenCalled();
    },
  );
  test.each(["fixture", "missing-id", "bad-revision", "corrupt-journal"])(
    "%s blocks management before opening editor",
    (mode) => {
      const gateway = api();
      if (mode === "fixture") view.isFixture = true;
      if (mode === "missing-id") view.projects[0]!.backendId = "";
      if (mode === "bad-revision") view.projects[0]!.revision = 0;
      if (mode === "corrupt-journal")
        localStorage.setItem(`aivora.project-update.v1.${projectId}`, "corrupt");
      render(<HomePages />);
      click("管理Before");
      expect(view.setEditor).not.toHaveBeenCalled();
      expect(view.notify).toHaveBeenCalled();
      expect(gateway.updateProject).not.toHaveBeenCalled();
    },
  );
  test("revision drift between opening and saving rejects the stale command", async () => {
    const gateway = api();
    render(<HomePages />);
    click("管理Before");
    view.projects[0]!.revision = 2;
    expect(editor().validate?.()).toContain("项目列表已变化");
    expect(await save({ name: "After", action: "重命名" })).toBe(false);
    expect(gateway.updateProject).not.toHaveBeenCalled();
  });
  test("read failure keeps UNKNOWN locked, and stale GET cannot regress a newer card", async () => {
    const gateway = api();
    gateway.updateProject.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    gateway.getProject.mockRejectedValue(new Error("unavailable"));
    render(<HomePages />);
    click("管理Before");
    await save({ name: "After", action: "重命名" });
    await act(async () => click("查询当前项目状态"));
    expect(screen.getByText(/项目状态读取未知/)).toBeVisible();
    view.projects[0]!.revision = 9;
    gateway.getProject.mockResolvedValue({
      data: { ...project(), revision: 2, name: "Stale" },
      request_id: "get",
    });
    await act(async () => click("查询当前项目状态"));
    expect(view.projects[0]).toMatchObject({ name: "Before", revision: 9 });
    expect(gateway.updateProject).toHaveBeenCalledTimes(1);
  });
});

describe("project and episode creation entry boundaries", () => {
  test.each(["SUCCEEDED", "REMOTE_UNKNOWN", "DEFINITE_SERVER_ERROR"])(
    "episode creation %s only navigates on success",
    async (kind) => {
      api();
      view.page = "project";
      view.createRealEpisode.mockResolvedValue({ kind });
      render(<HomePages />);
      click("新建剧集");
      expect(await save({ title: " " })).toBe(false);
      expect(view.createRealEpisode).not.toHaveBeenCalled();
      await save({ title: " New episode " });
      expect(view.createRealEpisode).toHaveBeenCalledExactlyOnceWith({ title: "New episode" });
      if (kind === "SUCCEEDED") expect(view.go).toHaveBeenCalledWith("script");
      else expect(view.go).not.toHaveBeenCalled();
    },
  );
  test.each(["SUCCEEDED", "REMOTE_UNKNOWN", "disconnected"])(
    "new project %s keeps inspiration separate from source",
    async (kind) => {
      api();
      view.page = "home";
      view.createRealProject.mockResolvedValue({ kind });
      if (kind === "disconnected") view.workspaceState = "error";
      render(<HomePages />);
      click("新建项目");
      const callback = view.edit.mock.calls[0]?.[2];
      if (!callback) throw new Error("Expected new project editor");
      await act(async () => {
        await callback({ title: " New project ", input: " Original inspiration " });
      });
      if (kind === "SUCCEEDED") {
        expect(view.put).toHaveBeenCalledWith("input", "Original inspiration");
        expect(view.put).toHaveBeenCalledWith("c3DraftIntent", "original");
        expect(view.go).toHaveBeenCalledWith("source");
      } else {
        expect(view.put).not.toHaveBeenCalled();
        expect(view.go).not.toHaveBeenCalled();
      }
      expect(view.importRealSource).not.toHaveBeenCalled();
    },
  );
});
