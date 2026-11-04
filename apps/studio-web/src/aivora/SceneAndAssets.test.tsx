import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AssetsPage, ScenePage } from "./SceneAndAssets";
import { EditorDialog } from "./Common";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";

afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function SceneHarness() {
  const demo = useDemo();
  return (
    <>
      <button onClick={() => demo.setScenario("empty")}>清空场景参考</button>
      <button onClick={() => demo.setScenario("error")}>场景读取失败</button>
      <ScenePage />
      <EditorDialog />
      <output aria-label="场景状态">
        {JSON.stringify({
          state: demo.value("scene-1-state"),
          confirmed: demo.value("scene-1-confirmed"),
          page: demo.page,
        })}
      </output>
    </>
  );
}

function AssetsHarness() {
  const demo = useDemo();
  return (
    <>
      <AssetsPage />
      <EditorDialog />
      <output aria-label="素材状态">
        {JSON.stringify({ references: demo.references, selected: demo.value("assetSelected") })}
      </output>
    </>
  );
}

describe("scene environment selection", () => {
  it("records the chosen environment and clears a prior scene confirmation", () => {
    const fixture = createAivoraSampleFixture();
    fixture.values["scene-1-confirmed"] = "true";
    window.history.replaceState({}, "", "#scenes");
    render(
      <DemoProvider fixture={fixture}>
        <SceneHarness />
      </DemoProvider>,
    );

    expect(screen.getByText("当前场景已确认")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "环境状态" }), {
      target: { value: "傍晚" },
    });
    expect(screen.getByText("当前场景待确认")).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("场景状态").textContent!)).toMatchObject({
      state: "傍晚",
      confirmed: "false",
    });
  });
});

describe("scene and asset local workflows", () => {
  it("saves an explicit scene detail change and confirms all scenes before moving to storyboard", async () => {
    window.history.replaceState({}, "", "#scenes");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <SceneHarness />
      </DemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "空间设定" }));
    fireEvent.change(screen.getByLabelText("光线与氛围"), { target: { value: "柔和反光" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设定" }));
    expect(screen.getByText("柔和反光")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "确认场景并进入分镜" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("核对本集全部场景");
    fireEvent.click(screen.getByRole("button", { name: "确认全部场景并进入分镜" }));
    expect(JSON.parse(screen.getByLabelText("场景状态").textContent!)).toMatchObject({
      confirmed: "true",
      page: "storyboard",
    });
  });

  it("blocks scene confirmation while reference loading is empty or failed and recovers only on the explicit retry", () => {
    window.history.replaceState({}, "", "#scenes");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <SceneHarness />
      </DemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "清空场景参考" }));
    expect(screen.getByRole("heading", { name: "尚无场景参考" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认场景并进入分镜" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "查看样例参考" }));
    expect(screen.getByRole("button", { name: "确认场景并进入分镜" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "场景读取失败" }));
    expect(screen.getByRole("heading", { name: "场景参考加载失败" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByRole("button", { name: "确认场景并进入分镜" })).toBeEnabled();
  });

  it("filters assets locally and returns from a no-match state without inventing assets", () => {
    window.history.replaceState({}, "", "#assets");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <AssetsHarness />
      </DemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "视频" }));
    expect(screen.getByRole("heading", { name: "没有匹配的素材" })).toBeInTheDocument();
    expect(screen.getByText("当前仅有内置图片样例，尚无真实视频或音频。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看全部样例" }));
    expect(screen.getByRole("button", { name: "大屏查看故事参考" })).toBeInTheDocument();
  });

  it("adds and removes an asset reference only through its local preview confirmation", async () => {
    window.history.replaceState({}, "", "#assets");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <AssetsHarness />
      </DemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "故事参考详情与引用" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("故事参考");
    fireEvent.click(screen.getByRole("button", { name: "添加项目引用" }));
    expect(JSON.parse(screen.getByLabelText("素材状态").textContent!)).toMatchObject({
      selected: "story",
      references: ["故事参考"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "故事参考详情与引用" }));
    fireEvent.click(screen.getByRole("button", { name: "移除项目引用" }));
    expect(JSON.parse(screen.getByLabelText("素材状态").textContent!)).toMatchObject({
      references: [],
    });
  });
});
