import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DemoApp } from "./DemoApp";
import { createAivoraSampleFixture, type DemoFixture } from "./model";
import type * as ModelModule from "./model";

let forceBackendMismatch = false;
vi.mock("./model", async (original) => {
  const actual = await original<typeof ModelModule>();
  return {
    ...actual,
    useDemo: () => {
      const model = actual.useDemo();
      return forceBackendMismatch ? { ...model, backendProjectId: "prj_different" } : model;
    },
  };
});

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
  localStorage.clear();
  forceBackendMismatch = false;
});

function realFixture(source = ""): DemoFixture {
  const fixture = createAivoraSampleFixture();
  fixture.projects = [
    {
      ...fixture.projects[0]!,
      id: 1,
      name: "雨停之前",
      backendId: "prj_1a873ac935c7473a8a7cbf6ef221c9a9",
    },
  ];
  fixture.values = { projectId: "1", title: "雨停之前", source };
  fixture.characters = [];
  fixture.outfits = [];
  fixture.locations = [];
  fixture.shots = [];
  fixture.annotations = [];
  return fixture;
}

it.each(["侧栏故事", "继续故事理解", "查看剧本"])(
  "empty real project: %s reaches a visible real import entry",
  (entry) => {
    window.history.replaceState({}, "", "#project");
    render(<DemoApp fixture={realFixture()} />);
    expect(screen.getByText("《雨停之前》的本地工作区项目。")).toBeInTheDocument();
    const button =
      entry === "侧栏故事"
        ? within(screen.getByRole("complementary", { name: "主导航" })).getByRole("button", {
            name: "故事 / 剧本",
          })
        : screen.getByRole("button", { name: entry });
    fireEvent.click(button);
    expect(screen.getByText("当前项目尚未导入真实来源，故事与剧本内容暂不可读取。")).toBeVisible();
    const main = within(screen.getByRole("main"));
    expect(main.queryByText("核心冲突")).not.toBeInTheDocument();
    expect(main.queryByLabelText("对白编辑")).not.toBeInTheDocument();
    expect(main.queryByText(/演示剧本/)).not.toBeInTheDocument();
    fireEvent.click(main.getByRole("button", { name: "前往来源输入" }));
    fireEvent.click(main.getByRole("button", { name: "粘贴故事" }));
    expect(main.getByLabelText("外部原文正文")).toBeVisible();
    expect(main.getByRole("button", { name: "作为外部原文导入" })).toBeVisible();
  },
);

it.each(["story", "script"])(
  "%s preserves no-project, missing-backend and mismatched-backend protection",
  (page) => {
    for (const boundary of ["no-project", "no-backend", "mismatch"]) {
      const fixture = realFixture();
      if (boundary === "no-project") fixture.projects = [];
      if (boundary === "no-backend") delete fixture.projects![0]!.backendId;
      forceBackendMismatch = boundary === "mismatch";
      window.history.replaceState({}, "", `#${page}`);
      render(<DemoApp fixture={fixture} />);
      const main = within(screen.getByRole("main"));
      expect(
        main.getByText("尚未选择真实项目。创建或选择项目后，才会读取此页面的内容。"),
      ).toBeVisible();
      expect(main.queryByRole("button", { name: "前往来源输入" })).not.toBeInTheDocument();
      expect(main.queryByRole("button", { name: "粘贴故事" })).not.toBeInTheDocument();
      expect(main.queryByText("核心冲突")).not.toBeInTheDocument();
      expect(main.queryByLabelText("对白编辑")).not.toBeInTheDocument();
      cleanup();
    }
  },
);

it("existing source remains readable from the top-level story page", () => {
  window.history.replaceState({}, "", "#story");
  render(<DemoApp fixture={realFixture("原项目真实正文：雨停之前。")} />);
  expect(screen.queryByRole("button", { name: "前往来源输入" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看原文" }));
  expect(within(screen.getByRole("dialog")).getByText("原项目真实正文：雨停之前。")).toBeVisible();
});
