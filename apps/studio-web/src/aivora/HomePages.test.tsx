import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HomePages } from "./HomePages";
import { StoryPages } from "./StoryPages";
import { DemoApp } from "./DemoApp";
import { EditorDialog } from "./Common";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";

afterEach(() => {
  cleanup();
  delete window.aijian;
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function PageHarness() {
  const demo = useDemo();
  return (
    <>
      <HomePages />
      <EditorDialog />
      <output aria-label="home-page-state">
        {JSON.stringify({ page: demo.page, references: demo.references })}
      </output>
    </>
  );
}
function OriginalEntryHarness() {
  return (
    <>
      <HomePages />
      <StoryPages />
      <EditorDialog />
    </>
  );
}

function ProjectHarness() {
  const demo = useDemo();
  return (
    <>
      <HomePages />
      <EditorDialog />
      <output aria-label="project-list-state">
        {JSON.stringify({
          page: demo.page,
          projects: demo.projects,
          selectedEpisodeId: demo.selectedEpisodeId,
          episodeState: demo.episodeState,
        })}
      </output>
    </>
  );
}
function ScenarioHarness({
  page,
  scenario,
}: {
  page: "launch" | "home" | "project";
  scenario: "error" | "loading" | "unavailable";
}) {
  const demo = useDemo();
  useEffect(() => {
    demo.go(page);
    demo.setScenario(scenario);
  }, [page, scenario]);
  return (
    <>
      <HomePages />
      <EditorDialog />
      <output aria-label="home-scenario-state">
        {JSON.stringify({
          page: demo.page,
          scenario: demo.scenario,
          toast: demo.toast,
          projects: demo.projects.length,
        })}
      </output>
    </>
  );
}
function bridge() {
  return {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "test" },
    }),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: `prj_${"a".repeat(32)}`,
          name: "真实项目记录",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
  } as unknown as NonNullable<Window["aijian"]>;
}

describe("project centre filtering", () => {
  it("shows an explicit no-result state and restores the project list read from the desktop bridge", async () => {
    window.history.replaceState({}, "", "#projects");
    const desktop = bridge()!;
    window.aijian = desktop;
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );

    expect(await screen.findByText("真实项目记录", { exact: true })).toBeInTheDocument();
    expect(desktop.listProjects).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索项目" }), {
      target: { value: "不存在的项目" },
    });
    expect(screen.getByRole("heading", { name: "没有符合条件的项目" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() =>
      expect(screen.getByText("真实项目记录", { exact: true })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "没有符合条件的项目" })).not.toBeInTheDocument();
  });

  it("keeps the launch and existing-content paths inside the local demonstration workflow", () => {
    window.history.replaceState({}, "", "#launch");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <PageHarness />
      </DemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入 UI 演示" }));
    expect(screen.getByRole("heading", { name: "创作首页" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续已有的演示项目，或从一段故事开始。" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("从已有内容开始");
    fireEvent.change(screen.getByLabelText("下一步"), { target: { value: "添加参考图片" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(JSON.parse(screen.getByLabelText("home-page-state").textContent!)).toMatchObject({
      page: "home",
      references: ["雨夜街道"],
    });
  });

  it("routes a selected inspiration template into the original-brief workflow", () => {
    window.history.replaceState({}, "", "#home");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <PageHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "继续已有的演示项目，或从一段故事开始。" }));
    fireEvent.change(screen.getByLabelText("下一步"), { target: { value: "从灵感模板开始" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(JSON.parse(screen.getByLabelText("home-page-state").textContent ?? "{}").page).toBe(
      "source",
    );
  });
  it("carries entered inspiration into the original brief form without mutating source", () => {
    window.history.replaceState({}, "", "#home");
    const fixture = createAivoraSampleFixture();
    fixture.values.input = "雨夜里的原创城市故事";
    render(
      <DemoProvider fixture={fixture}>
        <OriginalEntryHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "继续已有的演示项目，或从一段故事开始。" }));
    fireEvent.change(screen.getByLabelText("下一步"), { target: { value: "从灵感模板开始" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("保存原创灵感草稿");
    expect(screen.getByLabelText("原创来源说明")).toHaveValue("雨夜里的原创城市故事");
  });

  it("does not fabricate a favorite and opens only the project record provided by the desktop bridge", async () => {
    window.history.replaceState({}, "", "#projects");
    window.aijian = bridge();
    render(
      <DemoProvider>
        <ProjectHarness />
      </DemoProvider>,
    );

    const project = await screen.findByRole("button", { name: "管理真实项目记录" });
    fireEvent.click(project);
    fireEvent.change(screen.getByLabelText("操作"), {
      target: { value: "收藏 / 取消收藏（待接入）" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存真实项目修改" }));
    expect(
      JSON.parse(screen.getByLabelText("project-list-state").textContent!).projects[0],
    ).toMatchObject({
      name: "真实项目记录",
      favorite: false,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存真实项目修改" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "打开项目" }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByLabelText("project-list-state").textContent!)).toMatchObject({
        page: "project",
      }),
    );
    expect(screen.getByRole("button", { name: "打开项目中心" })).toBeVisible();
    expect(
      screen.getByText(
        "当前展示的是本地工作区项目与剧集状态；后续内容以已读取的来源与审核状态为准。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/近未来记忆都市/)).not.toBeInTheDocument();
  });

  it("keeps a direct project-centre entry visible when no real project is selected", async () => {
    window.history.replaceState({}, "", "#project");
    const desktop = bridge()!;
    vi.mocked(desktop.listProjects).mockResolvedValue({ request_id: "empty", data: [] });
    window.aijian = desktop;
    render(
      <DemoProvider>
        <ProjectHarness />
      </DemoProvider>,
    );

    expect(await screen.findByRole("heading", { name: "还没有项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开项目中心" }));
    expect(
      JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}"),
    ).toMatchObject({
      page: "projects",
    });
  });
  it("replaces an empty worktree state after a fresh desktop refresh", async () => {
    window.history.replaceState({}, "", "#projects");
    const desktop = bridge()!;
    vi.mocked(desktop.listProjects)
      .mockResolvedValueOnce({ request_id: "empty", data: [] })
      .mockResolvedValueOnce({
        request_id: "projects",
        data: [
          {
            id: "prj_test",
            name: "刷新后项目",
            status: "active",
            revision: 2,
            updated_at: "2026-09-14T00:00:00Z",
            created_at: "2026-09-14T00:00:00Z",
            aspect_ratio: "9:16",
            source_language: "zh-CN",
            target_duration_seconds: 60,
          },
        ],
      });
    window.aijian = desktop;
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );

    expect(await screen.findByRole("heading", { name: "还没有项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新项目列表" }));
    expect(await screen.findByText("刷新后项目", { exact: true })).toBeInTheDocument();
    expect(desktop.listProjects).toHaveBeenCalledTimes(2);
  });

  it("shows an unavailable-workspace state and recovers only after an explicit retry", async () => {
    window.history.replaceState({}, "", "#projects");
    const desktop = bridge()!;
    vi.mocked(desktop.health).mockRejectedValueOnce(new Error("offline"));
    window.aijian = desktop;
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "本地工作区暂时无法读取" }),
    ).toBeInTheDocument();
    expect(desktop.listProjects).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
    expect(await screen.findByText("真实项目记录", { exact: true })).toBeInTheDocument();
    expect(desktop.listProjects).toHaveBeenCalledTimes(1);
  });

  it("keeps the launch error recoverable and never enables entry while initialization is loading", async () => {
    window.history.replaceState({}, "", "#launch");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <ScenarioHarness page="launch" scenario="loading" />
      </DemoProvider>,
    );
    expect(await screen.findByRole("button", { name: "正在初始化" })).toBeDisabled();
    cleanup();
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <ScenarioHarness page="launch" scenario="error" />
      </DemoProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("初始化失败，入口仍保留");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(
      JSON.parse(screen.getByLabelText("home-scenario-state").textContent ?? "{}").scenario,
    ).toBe("normal");
  });

  it("keeps the desktop-workspace failure boundary when an unavailable page is requested", async () => {
    window.history.replaceState({}, "", "#home");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <ScenarioHarness page="home" scenario="unavailable" />
      </DemoProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "本地工作区暂时无法读取" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试读取" })).toBeEnabled();
  });

  it("rejects a new-project save before a workspace connection and retains the local project list", async () => {
    window.history.replaceState({}, "", "#home");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <PageHarness />
      </DemoProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByLabelText("作品名称"), { target: { value: "不能直接创建" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps project-home stage and footer navigation inside the demonstration state", async () => {
    window.history.replaceState({}, "", "#project");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <PageHarness />
      </DemoProvider>,
    );
    await screen.findByRole("heading", { name: "项目创作首页" });
    fireEvent.click(screen.getByRole("button", { name: /角色与世界/ }));
    expect(JSON.parse(screen.getByLabelText("home-page-state").textContent ?? "{}").page).toBe(
      "characters",
    );
    fireEvent.click(screen.getByRole("button", { name: "项目中心" }));
    expect(JSON.parse(screen.getByLabelText("home-page-state").textContent ?? "{}").page).toBe(
      "projects",
    );
  });

  it("keeps project settings and script navigation within the local UI", async () => {
    window.history.replaceState({}, "", "#project");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <PageHarness />
      </DemoProvider>,
    );
    await screen.findByRole("heading", { name: "项目创作首页" });
    fireEvent.click(screen.getAllByRole("button", { name: "项目设置" })[1]!);
    expect(JSON.parse(screen.getByLabelText("home-page-state").textContent ?? "{}").page).toBe(
      "projectSettings",
    );
    cleanup();
    window.history.replaceState({}, "", "#project");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <PageHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看剧本" }));
    expect(JSON.parse(screen.getByLabelText("home-page-state").textContent ?? "{}").page).toBe(
      "script",
    );
  });

  it("archives through a receipt and authoritative readback but refuses unsupported deletion", async () => {
    window.history.replaceState({}, "", "#projects");
    const desktop = bridge();
    const archived = {
      id: `prj_${"a".repeat(32)}`,
      name: "真实项目记录",
      status: "archived",
      revision: 2,
      updated_at: "2026-09-14T00:00:00Z",
    };
    desktop.updateProject = vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      receipt: { request_id: "updated", data: archived },
    });
    desktop.getProject = vi.fn().mockResolvedValue({ request_id: "readback", data: archived });
    window.aijian = desktop;
    render(
      <DemoProvider>
        <ProjectHarness />
      </DemoProvider>,
    );
    const name = await screen.findByRole("button", { name: "管理真实项目记录" });
    fireEvent.click(name);
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "归档" } });
    fireEvent.click(screen.getByRole("button", { name: "保存真实项目修改" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}").projects[0],
      ).toMatchObject({ status: "已归档" }),
    );
    expect(desktop.updateProject).toHaveBeenCalledWith(archived.id, {
      expectedRevision: 1,
      status: "archived",
    });
    expect(desktop.getProject).toHaveBeenCalledWith(archived.id);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "筛选项目" }), {
      target: { value: "已归档" },
    });
    fireEvent.click(screen.getByRole("button", { name: "管理真实项目记录" }));
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "删除（待影响核对）" } });
    fireEvent.click(screen.getByRole("button", { name: "保存真实项目修改" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}").projects,
      ).toHaveLength(1),
    );
    expect(desktop.updateProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "确认删除" })).not.toBeInTheDocument();
  });
});

it("uses only real episode list/detail/create calls and keeps an unknown create locked through refresh", async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "#projects");
  const projectId = `prj_${"a".repeat(32)}`;
  const episodeId = `ep_${"b".repeat(32)}`;
  const episode = {
    id: episodeId,
    project_id: projectId,
    title: "真实第一集",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  const desktop = {
    ...bridge(),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "真实项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [episode] }),
    getEpisode: vi.fn().mockResolvedValue({ request_id: "episode", data: episode }),
    createEpisode: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(
    <DemoProvider>
      <ProjectHarness />
    </DemoProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "打开项目" }));
  const episodeButton = await screen.findByRole("button", { name: "真实第一集" });
  fireEvent.click(episodeButton);
  await waitFor(() => expect(desktop.getEpisode).toHaveBeenCalledWith(projectId, episodeId));
  fireEvent.click(screen.getByRole("button", { name: "新建剧集" }));
  fireEvent.change(screen.getByLabelText("剧集名称"), { target: { value: "未知结果集" } });
  fireEvent.click(screen.getByRole("button", { name: "创建剧集" }));
  await waitFor(() => expect(desktop.createEpisode).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("button", { name: "我已核对结果，允许新建" })).toBeDisabled();
  const listCallsBeforeRefresh = desktop.listEpisodes.mock.calls.length;
  fireEvent.click(screen.getAllByRole("button", { name: "刷新剧集列表" }).at(-1)!);
  await waitFor(() =>
    expect(desktop.listEpisodes).toHaveBeenCalledTimes(listCallsBeforeRefresh + 1),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "我已核对结果，允许新建" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "我已核对结果，允许新建" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "我已核对结果，允许新建" }),
    ).not.toBeInTheDocument(),
  );
});

it("restores a saved episode through its exact ID even when the current list page omits it", async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "#project");
  const projectId = `prj_${"c".repeat(32)}`;
  const episodeId = `ep_${"d".repeat(32)}`;
  window.localStorage.setItem(
    "aivora.c2b.workspace-selection.v1",
    JSON.stringify({
      version: 1,
      selection: { projectId, episodeId },
      createMarkers: {},
    }),
  );
  const episode = {
    id: episodeId,
    project_id: projectId,
    title: "列表外恢复集",
    position: "2",
    revision: "4",
    target_duration_seconds: null,
    is_default: false,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  const desktop = {
    ...bridge(),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "恢复项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [] }),
    getEpisode: vi.fn().mockResolvedValue({ request_id: "episode", data: episode }),
    createEpisode: vi.fn(),
    listSources: vi.fn().mockRejectedValue(new Error("source unavailable")),
  };
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(<DemoApp />);
  await waitFor(() => expect(desktop.getEpisode).toHaveBeenCalledWith(projectId, episodeId));
  expect(await screen.findByRole("option", { name: "列表外恢复集" })).toHaveValue(episodeId);
  expect(screen.getByLabelText("剧集选择")).toHaveValue(episodeId);
  expect(desktop.listSources).toHaveBeenCalledWith(projectId);
});

it("clears a removed saved episode and exposes a retryable read error", async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "#project");
  const projectId = `prj_${"e".repeat(32)}`;
  const episodeId = `ep_${"f".repeat(32)}`;
  window.localStorage.setItem(
    "aivora.c2b.workspace-selection.v1",
    JSON.stringify({
      version: 1,
      selection: { projectId, episodeId },
      createMarkers: {},
    }),
  );
  const desktop = {
    ...bridge(),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "删除后项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [] }),
    getEpisode: vi.fn().mockRejectedValue(new Error("episode removed")),
    createEpisode: vi.fn(),
  };
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(
    <DemoProvider>
      <ProjectHarness />
    </DemoProvider>,
  );
  expect(
    await screen.findByText("真实剧集读取失败；已清空当前选择，请刷新后重试。"),
  ).toBeInTheDocument();
  expect(JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}")).toMatchObject(
    {
      selectedEpisodeId: null,
      episodeState: "error",
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "刷新剧集列表" }));
  await waitFor(() => expect(desktop.listEpisodes).toHaveBeenCalledTimes(2));
});

it("keeps a pending create locked across a concurrent refresh and a reopen until an explicit fresh read", async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "#projects");
  const projectId = `prj_${"1".repeat(32)}`;
  const episode = {
    id: `ep_${"2".repeat(32)}`,
    project_id: projectId,
    title: "已有剧集",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  let settleCreate: ((value: { kind: "REMOTE_UNKNOWN" }) => void) | undefined;
  const desktop = {
    ...bridge(),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "待核对项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [episode] }),
    getEpisode: vi.fn().mockResolvedValue({ request_id: "episode", data: episode }),
    createEpisode: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          settleCreate = resolve;
        }),
    ),
  };
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(
    <DemoProvider>
      <ProjectHarness />
    </DemoProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "打开项目" }));
  await screen.findByRole("button", { name: "已有剧集" });
  fireEvent.click(screen.getByRole("button", { name: "新建剧集" }));
  fireEvent.change(screen.getByLabelText("剧集名称"), { target: { value: "尚在发送" } });
  fireEvent.click(screen.getByRole("button", { name: "创建剧集" }));
  await waitFor(() => expect(desktop.createEpisode).toHaveBeenCalledTimes(1));
  const callsBeforeRefresh = desktop.listEpisodes.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "刷新剧集列表" }));
  await waitFor(() => expect(desktop.listEpisodes).toHaveBeenCalledTimes(callsBeforeRefresh + 1));
  expect(await screen.findByRole("button", { name: "我已核对结果，允许新建" })).toBeDisabled();
  expect(screen.getByText("正在创建剧集，请等待结果后再试。")).toBeInTheDocument();

  cleanup();
  window.history.replaceState({}, "", "#project");
  render(
    <DemoProvider>
      <ProjectHarness />
    </DemoProvider>,
  );
  const acknowledgement = await screen.findByRole("button", { name: "我已核对结果，允许新建" });
  expect(acknowledgement).toBeDisabled();
  expect(screen.getByText("上次创建结果待确认，请刷新列表后核对。")).toBeInTheDocument();
  const callsBeforeReopenRefresh = desktop.listEpisodes.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "刷新剧集列表" }));
  await waitFor(() =>
    expect(desktop.listEpisodes).toHaveBeenCalledTimes(callsBeforeReopenRefresh + 1),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "我已核对结果，允许新建" })).toBeEnabled(),
  );
  // The originating request remains deliberately unresolved; no retry is issued.
  expect(settleCreate).toBeTypeOf("function");
});

it("does not let an old A create response alter a later A -> B -> A selection", async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "#projects");
  const projectA = `prj_${"3".repeat(32)}`;
  const projectB = `prj_${"4".repeat(32)}`;
  const existingA = {
    id: `ep_${"5".repeat(32)}`,
    project_id: projectA,
    title: "A 的已有剧集",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  const existingB = {
    ...existingA,
    id: `ep_${"6".repeat(32)}`,
    project_id: projectB,
    title: "B 的已有剧集",
  };
  const lateEpisode = { ...existingA, id: `ep_${"7".repeat(32)}`, title: "A 的迟到新剧集" };
  let settleCreate:
    | ((value: {
        kind: "SUCCEEDED";
        receipt: { request_id: string; data: typeof lateEpisode };
      }) => void)
    | undefined;
  const desktop = {
    ...bridge(),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectA,
          name: "项目 A",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
        {
          id: projectB,
          name: "项目 B",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listEpisodes: vi.fn().mockImplementation((projectId: string) =>
      Promise.resolve({
        request_id: `episodes-${projectId}`,
        data: projectId === projectA ? [existingA] : [existingB],
      }),
    ),
    getEpisode: vi.fn().mockImplementation((projectId: string, episodeId: string) =>
      Promise.resolve({
        request_id: `episode-${episodeId}`,
        data: projectId === projectA ? existingA : existingB,
      }),
    ),
    createEpisode: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          settleCreate = resolve;
        }),
    ),
  };
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(
    <DemoProvider>
      <ProjectHarness />
    </DemoProvider>,
  );
  await screen.findByText("项目 A", { exact: true });
  fireEvent.click(screen.getAllByRole("button", { name: "打开项目" })[0]!);
  await screen.findByRole("button", { name: "A 的已有剧集" });
  fireEvent.click(screen.getByRole("button", { name: "新建剧集" }));
  fireEvent.change(screen.getByLabelText("剧集名称"), { target: { value: "A 的迟到新剧集" } });
  fireEvent.click(screen.getByRole("button", { name: "创建剧集" }));
  await waitFor(() => expect(desktop.createEpisode).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "项目中心" }));
  fireEvent.click((await screen.findAllByRole("button", { name: "打开项目" }))[1]!);
  await screen.findByRole("button", { name: "B 的已有剧集" });
  fireEvent.click(screen.getByRole("button", { name: "项目中心" }));
  fireEvent.click((await screen.findAllByRole("button", { name: "打开项目" }))[0]!);
  await screen.findByRole("button", { name: "A 的已有剧集" });
  settleCreate?.({ kind: "SUCCEEDED", receipt: { request_id: "late-create", data: lateEpisode } });
  await waitFor(() => expect(desktop.listEpisodes).toHaveBeenCalledWith(projectA, undefined));
  expect(screen.queryByRole("button", { name: "A 的迟到新剧集" })).not.toBeInTheDocument();
  expect(
    JSON.parse(window.localStorage.getItem("aivora.c2b.workspace-selection.v1") ?? "{}"),
  ).toMatchObject({
    createMarkers: { [projectA]: "PENDING" },
  });
});

it("clears a failed refreshed project view but retains and restores the exact saved episode", async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "#projects");
  const projectId = `prj_${"c".repeat(32)}`;
  const episode = {
    id: `ep_${"d".repeat(32)}`,
    project_id: projectId,
    title: "可恢复的精确剧集",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  const project = {
    id: projectId,
    name: "可恢复项目 A",
    status: "active",
    revision: 1,
    updated_at: "2026-09-14T00:00:00Z",
  };
  window.localStorage.setItem(
    "aivora.c2b.workspace-selection.v1",
    JSON.stringify({
      version: 1,
      selection: { projectId, episodeId: episode.id },
      createMarkers: {},
    }),
  );
  let failProjects = false;
  const desktop = {
    ...bridge(),
    listProjects: vi
      .fn()
      .mockImplementation(() =>
        failProjects
          ? Promise.reject(new Error("desktop unavailable"))
          : Promise.resolve({ request_id: "projects", data: [project] }),
      ),
    listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [episode] }),
    getEpisode: vi.fn().mockResolvedValue({ request_id: "episode", data: episode }),
    createEpisode: vi.fn(),
  };
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(<DemoApp />);
  await waitFor(() => expect(desktop.getEpisode).toHaveBeenCalledWith(projectId, episode.id));
  expect(screen.getByLabelText("作品选择")).not.toHaveValue("");

  failProjects = true;
  fireEvent.click(screen.getByRole("button", { name: "本地工作区已连接" }));
  expect(
    await screen.findByRole("heading", { name: "本地工作区暂时无法读取" }),
  ).toBeInTheDocument();
  expect((screen.getByLabelText("作品选择") as HTMLSelectElement).value).toBe("");
  expect(
    JSON.parse(window.localStorage.getItem("aivora.c2b.workspace-selection.v1") ?? "{}"),
  ).toMatchObject({
    selection: { projectId, episodeId: episode.id },
  });

  failProjects = false;
  fireEvent.click(screen.getByRole("button", { name: "连接本地工作区" }));
  await waitFor(() => expect(desktop.getEpisode).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("作品选择")).not.toHaveValue("");
  expect(desktop.getEpisode).toHaveBeenLastCalledWith(projectId, episode.id);
});
it("persists a newly created project and automatically restores its exact default episode", async () => {
  window.history.replaceState({}, "", "#projects");
  const projectA = `prj_${"8".repeat(32)}`;
  const projectB = `prj_${"9".repeat(32)}`;
  const defaultA = {
    id: `ep_${"b".repeat(32)}`,
    project_id: projectA,
    title: "A 默认剧集",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  const defaultB = {
    id: `ep_${"a".repeat(32)}`,
    project_id: projectB,
    title: "B 默认剧集",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  const desktop = {
    ...bridge(),
    listProjects: vi
      .fn()
      .mockResolvedValueOnce({
        request_id: "projects-a",
        data: [
          {
            id: projectA,
            name: "旧项目 A",
            status: "active",
            revision: 1,
            updated_at: "2026-09-14T00:00:00Z",
          },
        ],
      })
      .mockResolvedValue({
        request_id: "projects-b",
        data: [
          {
            id: projectA,
            name: "旧项目 A",
            status: "active",
            revision: 1,
            updated_at: "2026-09-14T00:00:00Z",
          },
          {
            id: projectB,
            name: "新项目 B",
            status: "active",
            revision: 1,
            updated_at: "2026-09-14T00:00:00Z",
          },
        ],
      }),
    createProject: vi.fn().mockResolvedValue({
      request_id: "create-b",
      data: {
        id: projectB,
        name: "新项目 B",
        status: "active",
        revision: 1,
        updated_at: "2026-09-14T00:00:00Z",
      },
    }),
    listEpisodes: vi.fn().mockImplementation((projectId: string) =>
      Promise.resolve({
        request_id: `episodes-${projectId}`,
        data: projectId === projectB ? [defaultB] : [defaultA],
      }),
    ),
    getEpisode: vi.fn().mockImplementation((projectId: string) =>
      Promise.resolve({
        request_id: `default-${projectId}`,
        data: projectId === projectB ? defaultB : defaultA,
      }),
    ),
    createEpisode: vi.fn(),
  };
  window.localStorage.setItem(
    "aivora.c2b.workspace-selection.v1",
    JSON.stringify({
      version: 1,
      selection: { projectId: projectA, episodeId: defaultA.id },
      createMarkers: {},
    }),
  );
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(
    <DemoProvider>
      <ProjectHarness />
    </DemoProvider>,
  );
  await waitFor(() => expect(desktop.getEpisode).toHaveBeenCalledWith(projectA, defaultA.id));
  fireEvent.click(await screen.findByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByLabelText("作品名称"), { target: { value: "新项目 B" } });
  fireEvent.click(screen.getByRole("button", { name: "创建真实项目" }));
  await waitFor(() => expect(desktop.getEpisode).toHaveBeenCalledWith(projectB, defaultB.id));
  expect(
    JSON.parse(window.localStorage.getItem("aivora.c2b.workspace-selection.v1") ?? "{}"),
  ).toMatchObject({
    selection: { projectId: projectB, episodeId: defaultB.id },
  });
  cleanup();
  window.history.replaceState({}, "", "#project");
  render(<DemoApp />);
  expect(await screen.findByRole("option", { name: "B 默认剧集" })).toHaveValue(defaultB.id);
  expect(screen.getByLabelText("剧集选择")).toHaveValue(defaultB.id);
});

it("preserves the exact selected episode when the same real project is reopened from project centre", async () => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "#projects");
  const projectId = `prj_${"e".repeat(32)}`;
  const first = {
    id: `ep_${"1".repeat(32)}`,
    project_id: projectId,
    title: "第 1 集",
    position: "1",
    revision: "1",
    target_duration_seconds: null,
    is_default: true,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
  };
  const second = {
    ...first,
    id: `ep_${"2".repeat(32)}`,
    title: "第 2 集",
    position: "2",
    is_default: false,
  };
  const desktop = {
    ...bridge(),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "同一作品",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listEpisodes: vi.fn().mockResolvedValue({ request_id: "episodes", data: [first, second] }),
    getEpisode: vi.fn().mockImplementation((_projectId: string, episodeId: string) =>
      Promise.resolve({
        request_id: `episode-${episodeId}`,
        data: episodeId === second.id ? second : first,
      }),
    ),
    createEpisode: vi.fn(),
  };
  window.aijian = desktop as unknown as NonNullable<Window["aijian"]>;
  render(
    <DemoProvider>
      <ProjectHarness />
    </DemoProvider>,
  );

  fireEvent.click((await screen.findAllByRole("button", { name: "打开项目" }))[0]!);
  await screen.findByRole("button", { name: "第 2 集" });
  await waitFor(() =>
    expect(
      JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}"),
    ).toMatchObject({ selectedEpisodeId: first.id }),
  );
  expect(
    JSON.parse(window.localStorage.getItem("aivora.c2b.workspace-selection.v1") ?? "{}"),
  ).toMatchObject({
    selection: { projectId, episodeId: first.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "第 2 集" }));
  await waitFor(() =>
    expect(
      JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}"),
    ).toMatchObject({
      selectedEpisodeId: second.id,
    }),
  );
  expect(
    JSON.parse(window.localStorage.getItem("aivora.c2b.workspace-selection.v1") ?? "{}"),
  ).toMatchObject({
    selection: { projectId, episodeId: second.id },
  });
  desktop.getEpisode.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "项目中心" }));
  fireEvent.click((await screen.findAllByRole("button", { name: "打开项目" }))[0]!);

  await waitFor(() => {
    expect(desktop.getEpisode).toHaveBeenCalledWith(projectId, second.id);
    expect(
      JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}"),
    ).toMatchObject({
      selectedEpisodeId: second.id,
    });
  });
});
