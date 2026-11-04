import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProjectData, StudioTransport } from "../api/studio";
import type { AppPreferencesGateway, AppPreferencesResponse } from "./adapters/appPreferences";
import type { Editor } from "./model";
import { SettingsPage } from "./SettingsPage";

const projectId = `prj_${"1".repeat(32)}`;
const operation = "11111111-1111-4111-8111-111111111111";
type Card = {
  backendId: string;
  name: string;
  revision: number;
  status: string;
  updated: string;
  episode: string;
};
function modelView() {
  return {
    isFixture: false,
    page: "settings",
    backendProjectId: projectId as string | null,
    projects: [
      {
        backendId: projectId,
        name: "Before",
        revision: 1,
        status: "进行中",
        updated: "",
        episode: "",
      },
    ] as Card[],
    episodes: [{ id: "ep-local", title: "Synthetic episode" }],
    selectedEpisodeId: "ep-local",
    put: vi.fn(),
    go: vi.fn(),
    setEditor: vi.fn<(editor: Editor) => void>(),
    setProjects: vi.fn<(update: (old: Card[]) => Card[]) => void>(),
  };
}
let view = modelView();
let transport: Partial<StudioTransport & AppPreferencesGateway>;
// Isolate the model read view and transport only; both persistence adapters,
// the local journal and the settings UI execute normally.
vi.mock("./model", () => ({ useDemo: () => view }));
vi.mock("../api/studio", () => ({ createStudioTransport: () => transport }));

function preferences(
  revision = 1,
  name = "Original",
  bio = "Original signature",
): AppPreferencesResponse {
  return {
    request_id: "local-test",
    data: {
      saved: true,
      revision,
      user_name: name,
      display_bio: bio,
      ui_language: "zh-CN",
      ui_theme: "dark-cinematic",
      created_at: "2026-10-10T00:00:00Z",
      updated_at: "2026-10-10T00:00:00Z",
    },
  };
}
function project(revision = 1, name = "Before"): ProjectData {
  return {
    id: projectId,
    name,
    revision,
    aspect_ratio: "9:16",
    source_language: "zh-CN",
    target_duration_seconds: 90,
    status: "active",
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  };
}
function userApi() {
  let saved = preferences();
  const api = {
    getAppPreferences: vi
      .fn<AppPreferencesGateway["getAppPreferences"]>()
      .mockImplementation(async () => ({ kind: "FOUND", receipt: saved })),
    saveAppPreferences: vi
      .fn<AppPreferencesGateway["saveAppPreferences"]>()
      .mockImplementation(async (command) => {
        saved = preferences(command.expected_revision + 1, command.user_name, command.display_bio);
        return { kind: "SAVED", receipt: saved };
      }),
  };
  transport = api;
  return api;
}
function projectApi() {
  view.page = "projectSettings";
  let saved = project();
  const api = {
    getProject: vi
      .fn<StudioTransport["getProject"]>()
      .mockImplementation(async () => ({ data: saved, request_id: "get" })),
    updateProject: vi
      .fn<NonNullable<StudioTransport["updateProject"]>>()
      .mockImplementation(async (_id, command) => {
        saved = {
          ...saved,
          revision: command.expectedRevision + 1,
          name: command.name ?? saved.name,
        };
        return { kind: "SUCCEEDED", receipt: { data: saved, request_id: "patch" } };
      }),
  };
  transport = api;
  return api;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
async function ready(label = "昵称") {
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
}
beforeEach(() => {
  localStorage.clear();
  view = modelView();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operation);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("persisted local user settings", () => {
  test("normalizes input and reports saved only after exact readback", async () => {
    const api = userApi();
    render(<SettingsPage />);
    await ready();
    change("昵称", "  New name  ");
    click("创作默认值");
    change("创作签名", "New signature");
    click("保存用户设置");
    expect(await screen.findByText("设置已保存并从本地工作区读回。")).toBeVisible();
    expect(api.saveAppPreferences).toHaveBeenCalledWith({
      expected_revision: 1,
      user_name: "New name",
      display_bio: "New signature",
      ui_language: "zh-CN",
      ui_theme: "dark-cinematic",
    });
    expect(api.getAppPreferences).toHaveBeenCalledTimes(2);
    expect(view.put).toHaveBeenCalledWith("userName", "New name");
    expect(screen.getByRole("button", { name: "保存用户设置" })).toBeDisabled();
    click("界面语言");
    expect(screen.getByText("界面语言：简体中文（当前版本）")).toBeVisible();
    click("外观");
    expect(screen.getByText("外观：深色电影工作台（当前版本）")).toBeVisible();
  });

  test.each(["match", "different"] as const)(
    "UNKNOWN is unlocked by explicit GET (%s) without resubmitting",
    async (mode) => {
      const api = userApi();
      api.saveAppPreferences.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
      render(<SettingsPage />);
      await ready();
      change("昵称", "Draft");
      click("保存用户设置");
      expect(await screen.findByText(/保存结果未知；草稿保留/)).toBeVisible();
      expect(screen.getByRole("button", { name: "保存用户设置" })).toBeDisabled();
      api.getAppPreferences.mockResolvedValue({
        kind: "FOUND",
        receipt: preferences(2, mode === "match" ? "Draft" : "Other"),
      });
      click("重新读取已保存设置");
      expect(
        await screen.findByText(
          mode === "match"
            ? /已读到与草稿一致的持久设置；先前提交结果无法单独归因/
            : /已读到最新设置；未保存草稿仍保留/,
        ),
      ).toBeVisible();
      expect(api.saveAppPreferences).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("昵称")).toHaveValue("Draft");
      if (mode === "match")
        expect(screen.getByRole("button", { name: "保存用户设置" })).toBeDisabled();
      else expect(screen.getByRole("button", { name: "保存用户设置" })).toBeEnabled();
    },
  );

  test.each([403, 409, 422])(
    "rejection %s preserves draft and correct recovery policy",
    async (status) => {
      const api = userApi();
      api.saveAppPreferences.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code: "DENIED",
        request_id: "post",
      });
      render(<SettingsPage />);
      await ready();
      change("昵称", "Draft");
      click("保存用户设置");
      expect(
        await screen.findByText(
          status === 409
            ? /设置修订已变化/
            : status === 422
              ? /设置输入未通过校验/
              : /设置保存被拒绝/,
        ),
      ).toBeVisible();
      expect(screen.getByLabelText("昵称")).toHaveValue("Draft");
      if (status === 422)
        expect(screen.getByRole("button", { name: "保存用户设置" })).toBeEnabled();
      else expect(screen.getByRole("button", { name: "保存用户设置" })).toBeDisabled();
      expect(api.getAppPreferences).toHaveBeenCalledTimes(1);
    },
  );

  test.each([" ", "x".repeat(81), "bad\u0001name"])(
    "invalid nickname blocks transport (%#)",
    async (name) => {
      const api = userApi();
      render(<SettingsPage />);
      await ready();
      change("昵称", name);
      click("保存用户设置");
      expect(await screen.findByText(/昵称需为 1 至 80 个字符/)).toBeVisible();
      expect(api.saveAppPreferences).not.toHaveBeenCalled();
    },
  );

  test("failed refresh retains draft and keeps save disabled", async () => {
    const api = userApi();
    render(<SettingsPage />);
    await ready();
    change("昵称", "Draft");
    api.getAppPreferences.mockRejectedValue(new Error("offline"));
    click("重新读取已保存设置");
    expect(await screen.findByText(/偏好读取失败；当前草稿和原已读值均保留/)).toBeVisible();
    expect(screen.getByLabelText("昵称")).toHaveValue("Draft");
    expect(screen.getByRole("button", { name: "保存用户设置" })).toBeDisabled();
    click("取消");
    expect(screen.getByLabelText("昵称")).toHaveValue("Original");
    expect(api.saveAppPreferences).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "leave destination depends on project selection (%s)",
    async (selected) => {
      userApi();
      view.backendProjectId = selected ? projectId : null;
      render(<SettingsPage />);
      await ready();
      const label = selected ? "返回项目" : "返回项目中心";
      click(label);
      expect(view.go).toHaveBeenCalledWith(selected ? "project" : "projects");
      view.go.mockClear();
      change("昵称", "Dirty");
      click(label);
      expect(view.go).not.toHaveBeenCalled();
      const editor = view.setEditor.mock.calls.at(-1)?.[0];
      expect(editor?.title).toBe("放弃未保存的用户设置？");
      editor?.save?.({});
      expect(view.go).toHaveBeenCalledWith(selected ? "project" : "projects");
    },
  );

  test("late initial read after unmount does not update model", async () => {
    const api = userApi();
    let finish:
      | ((result: Awaited<ReturnType<AppPreferencesGateway["getAppPreferences"]>>) => void)
      | undefined;
    api.getAppPreferences.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const mounted = render(<SettingsPage />);
    mounted.unmount();
    await act(async () => {
      finish?.({ kind: "FOUND", receipt: preferences() });
    });
    expect(view.put).not.toHaveBeenCalled();
  });
});

describe("persisted project settings", () => {
  test("rename is revision-pinned and updates cards only from verified response", async () => {
    const api = projectApi();
    render(<SettingsPage />);
    await ready("项目名称");
    view.setProjects.mockClear();
    change("项目名称", "  Renamed  ");
    click("保存项目名称");
    expect(await screen.findByText("项目名称已保存，并从本地工作区读回确认。")).toBeVisible();
    expect(api.updateProject).toHaveBeenCalledWith(projectId, {
      expectedRevision: 1,
      name: "Renamed",
    });
    expect(api.getProject).toHaveBeenCalledTimes(2);
    const update = view.setProjects.mock.calls[0]?.[0];
    expect(update?.(view.projects)).toMatchObject([
      { name: "Renamed", revision: 2, episode: "REV 2" },
    ]);
    expect(screen.getByLabelText("项目名称")).toHaveValue("Renamed");
    expect(localStorage.getItem(`aivora.project-update.v1.${projectId}`)).toBeNull();
  });

  test.each([" ", "字".repeat(81), "bad\u0001name"])(
    "invalid project name never PATCHes (%#)",
    async (name) => {
      const api = projectApi();
      render(<SettingsPage />);
      await ready("项目名称");
      change("项目名称", name);
      click("保存项目名称");
      expect(await screen.findByText(/项目名称需为 1 至 80 个字符/)).toBeVisible();
      expect(api.updateProject).not.toHaveBeenCalled();
    },
  );

  test("trim-only edit becomes clean without a PATCH", async () => {
    const api = projectApi();
    render(<SettingsPage />);
    await ready("项目名称");
    change("项目名称", " Before ");
    click("保存项目名称");
    expect(screen.getByLabelText("项目名称")).toHaveValue("Before");
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  test.each(["match", "different"] as const)(
    "UNKNOWN rename requires explicit close after read (%s)",
    async (mode) => {
      const api = projectApi();
      api.updateProject.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
      render(<SettingsPage />);
      await ready("项目名称");
      change("项目名称", "Draft");
      click("保存项目名称");
      expect(await screen.findByText(/项目更新结果未知；原操作已锁定/)).toBeVisible();
      expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
      api.getProject.mockResolvedValue({
        data: project(2, mode === "match" ? "Draft" : "Other"),
        request_id: "get",
      });
      click("重新读取项目");
      expect(await screen.findByText(/已只读核对当前项目；原更新仍锁定/)).toBeVisible();
      expect(localStorage.getItem(`aivora.project-update.v1.${projectId}`)).not.toBeNull();
      click("核对并结束未知记录");
      expect(
        await screen.findByText(/未知记录已结束；当前项目已读回，无法归因原 PATCH/),
      ).toBeVisible();
      expect(localStorage.getItem(`aivora.project-update.v1.${projectId}`)).toBeNull();
      expect(screen.getByLabelText("项目名称")).toHaveValue("Draft");
      expect(api.updateProject).toHaveBeenCalledTimes(1);
    },
  );

  test.each([403, 409, 422] as const)(
    "definite PATCH rejection %s keeps draft until refresh",
    async (status) => {
      const api = projectApi();
      api.updateProject.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code: "DENIED",
        request_id: "patch",
      });
      render(<SettingsPage />);
      await ready("项目名称");
      change("项目名称", "Draft");
      click("保存项目名称");
      expect(await screen.findByText(/项目更新被拒绝/)).toBeVisible();
      expect(screen.getByLabelText("项目名称")).toHaveValue("Draft");
      expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
      click("重新读取项目");
      expect(await screen.findByText(/已读取最新项目；未保存草稿保留/)).toBeVisible();
      expect(screen.getByRole("button", { name: "保存项目名称" })).toBeEnabled();
    },
  );

  test.each([
    "id",
    "aspect_ratio",
    "source_language",
    "revision",
    "target_duration_seconds",
  ] as const)("bad initial %s does not fill a demo default", async (field) => {
    const api = projectApi();
    const invalid = {
      ...project(),
      [field]: field === "revision" ? 0 : field === "target_duration_seconds" ? 10 : "bad",
    };
    api.getProject.mockResolvedValue({ data: invalid, request_id: "get" });
    render(<SettingsPage />);
    expect(await screen.findByText(/项目读取内容无效；未填入演示默认设置/)).toBeVisible();
    expect(screen.getByLabelText("项目名称")).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
    expect(view.put).not.toHaveBeenCalled();
  });

  test("old project read cannot regress a newer card revision", async () => {
    projectApi();
    view.projects[0] = { ...view.projects[0]!, revision: 5, name: "Newer card" };
    render(<SettingsPage />);
    await ready("项目名称");
    expect(view.setProjects).not.toHaveBeenCalled();
    expect(view.put).not.toHaveBeenCalled();
  });

  test("cancel restores current name; dirty leave requires explicit discard", async () => {
    projectApi();
    render(<SettingsPage />);
    await ready("项目名称");
    change("项目名称", "Dirty");
    click("取消");
    expect(screen.getByLabelText("项目名称")).toHaveValue("Before");
    change("项目名称", "Dirty");
    click("返回项目");
    expect(view.go).not.toHaveBeenCalled();
    const editor = view.setEditor.mock.calls.at(-1)?.[0];
    expect(editor?.title).toBe("离开未保存的项目名称？");
    editor?.save?.({});
    expect(view.go).toHaveBeenCalledWith("project");
  });

  test("corrupt journal is retained and prevents rename", async () => {
    const api = projectApi();
    localStorage.setItem(`aivora.project-update.v1.${projectId}`, "{");
    render(<SettingsPage />);
    expect(await screen.findByText("本地项目更新记录不可读取。")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(localStorage.getItem(`aivora.project-update.v1.${projectId}`)).toBe("{");
  });
});
