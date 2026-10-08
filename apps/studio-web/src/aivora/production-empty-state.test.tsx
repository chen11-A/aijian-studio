import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CharacterPage } from "./CharacterPage";
import { DemoApp } from "./DemoApp";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";

afterEach(() => cleanup());

describe("production empty project state", () => {
  it.each([
    ["launch", "开始一个好故事"],
    ["home", "你的故事，从这里开始"],
    ["project", "项目创作首页"],
    ["projects", "项目中心"],
    ["source", "故事输入与来源"],
    ["story", "故事理解"],
    ["script", "剧本"],
    ["characters", "角色与世界"],
    ["character", "角色模型与本集造型"],
    ["world", "世界观"],
    ["scenes", "场景"],
    ["storyboard", "分镜"],
    ["generation", "制作"],
    ["assembly", "成片组装"],
    ["review", "审片"],
    ["changes", "修改方案"],
    ["assets", "素材库"],
    ["voice", "声音制作"],
    ["export", "成片预览与导出"],
    ["services", "AI 服务与模型"],
    ["costs", "用量与费用"],
    ["settings", "用户中心与设置"],
    ["projectSettings", "项目设置"],
  ])("renders %s without sample domain facts", (page, heading) => {
    window.history.replaceState({}, "", `#${page}`);

    render(<DemoApp />);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText("苏晚", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("雨夜街道", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("城市入夜", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/记忆可以被读取、交易和修改/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认世界观" })).not.toBeInTheDocument();
  });

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
      expect(screen.getByText(/才会读取此页面的内容/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "确认世界观" })).not.toBeInTheDocument();
    },
  );
});
