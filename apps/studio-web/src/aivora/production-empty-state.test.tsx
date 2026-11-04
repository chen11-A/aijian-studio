import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CharacterPage } from "./CharacterPage";
import { DemoApp } from "./DemoApp";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";

afterEach(() => cleanup());

function expectProfessionalShell() {
  expect(
    screen.getByRole("heading", { name: "写下你的故事，或者一句话的想法" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开示例" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新建作品" })).toBeInTheDocument();
  for (const stage of ["剧本", "角色与场景", "分镜", "剪辑"]) {
    expect(screen.getByRole("button", { name: new RegExp(stage) })).toBeInTheDocument();
  }
  expect(screen.queryByRole("button", { name: "普通模式" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "专业模式" })).not.toBeInTheDocument();
  expect(screen.queryByText("苏晚", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("雨夜街道", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("城市入夜", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/记忆可以被读取、交易和修改/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认世界观" })).not.toBeInTheDocument();
}

describe("production empty project state", () => {
  it.each([
    "launch",
    "home",
    "project",
    "projects",
    "source",
    "story",
    "script",
    "characters",
    "character",
    "world",
    "scenes",
    "storyboard",
    "assembly",
    "review",
    "changes",
    "assets",
    "services",
    "costs",
    "settings",
    "projectSettings",
  ])("renders %s in the professional workspace without sample domain facts", (page) => {
    window.history.replaceState({}, "", `#${page}`);
    window.localStorage.clear();

    render(<DemoApp />);

    expectProfessionalShell();
  });

  it.each(["generation", "voice", "export"])(
    "renders the %s route in the professional workspace before a project exists",
    (page) => {
      window.history.replaceState({}, "", `#${page}`);
      window.localStorage.clear();

      render(<DemoApp />);

      expectProfessionalShell();
      expect(screen.queryByLabelText("媒体任务沙箱")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("配音方案沙箱")).not.toBeInTheDocument();
    },
  );

  it("updates an already-mounted character page to its empty state", () => {
    function CharacterStateHarness() {
      const demo = useDemo();
      return (
        <>
          <CharacterPage />
          <button onClick={() => demo.setCharacters([])}>清空角色</button>
        </>
      );
    }

    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <CharacterStateHarness />
      </DemoProvider>,
    );

    expect(screen.getByText("苏晚", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空角色" }));
    expect(screen.getByRole("heading", { name: "角色模型与本集造型" })).toBeInTheDocument();
    expect(screen.queryByText("苏晚", { exact: true })).not.toBeInTheDocument();
  });

  it.each([
    ["story", "故事理解"],
    ["script", "剧本"],
    ["world", "世界观"],
    ["assets", "素材库"],
    ["voice", "声音制作"],
  ])(
    "keeps %s empty after a project exists but its domain records have not loaded",
    (page, heading) => {
      const sample = createAivoraSampleFixture();
      window.history.replaceState({}, "", `#${page}`);
      render(
        <DemoApp
          fixture={{ projects: sample.projects, values: { projectId: "1", title: "已创建项目" } }}
        />,
      );

      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByText(/可以打开示例「雾城来信」/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "确认世界观" })).not.toBeInTheDocument();
    },
  );
});
