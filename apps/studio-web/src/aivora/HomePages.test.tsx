import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HomePages } from "./HomePages";
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

function ProjectHarness() {
  const demo = useDemo();
  return (
    <>
      <HomePages />
      <EditorDialog />
      <output aria-label="project-list-state">
        {JSON.stringify({ page: demo.page, projects: demo.projects })}
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
          id: "prj_test",
          name: "真实项目记录",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
  } as unknown as Window["aijian"];
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

  it("turns a selected inspiration template into an unapproved local source draft", () => {
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

  it("manages and opens only the project record provided by the desktop bridge", async () => {
    window.history.replaceState({}, "", "#projects");
    window.aijian = bridge();
    render(
      <DemoProvider>
        <ProjectHarness />
      </DemoProvider>,
    );

    const project = await screen.findByRole("button", { name: "真实项目记录" });
    fireEvent.click(project);
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "收藏 / 取消收藏" } });
    fireEvent.click(screen.getByRole("button", { name: "确认修改演示项目" }));
    expect(
      JSON.parse(screen.getByLabelText("project-list-state").textContent!).projects[0],
    ).toMatchObject({
      name: "真实项目记录",
      favorite: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "打开项目" }));
    expect(JSON.parse(screen.getByLabelText("project-list-state").textContent!)).toMatchObject({
      page: "project",
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

  it("archives and then explicitly deletes only the in-memory desktop project record", async () => {
    window.history.replaceState({}, "", "#projects");
    window.aijian = bridge();
    render(
      <DemoProvider>
        <ProjectHarness />
      </DemoProvider>,
    );
    const name = await screen.findByRole("button", { name: "真实项目记录" });
    fireEvent.click(name);
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "归档" } });
    fireEvent.click(screen.getByRole("button", { name: "确认修改演示项目" }));
    expect(
      JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}").projects[0],
    ).toMatchObject({ status: "已归档" });
    fireEvent.change(screen.getByRole("combobox", { name: "筛选项目" }), {
      target: { value: "已归档" },
    });
    fireEvent.click(screen.getByRole("button", { name: "管理真实项目记录" }));
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "删除" } });
    fireEvent.click(screen.getByRole("button", { name: "确认修改演示项目" }));
    const confirm = await screen.findByRole("button", { name: "确认删除" });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByLabelText("project-list-state").textContent ?? "{}").projects,
      ).toEqual([]),
    );
  });
});
