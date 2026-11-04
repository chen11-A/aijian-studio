import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { WorldPage } from "./WorldPage";
import { EditorDialog } from "./Common";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";

afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function WorldHarness() {
  const demo = useDemo();
  const fixture = createAivoraSampleFixture();
  return (
    <>
      <button
        onClick={() => {
          demo.setProjects(fixture.projects);
          demo.put("projectId", "1");
          demo.put("title", "已读取项目");
        }}
      >
        载入项目
      </button>
      <button onClick={() => demo.setScenario("error")}>制造读取失败</button>
      <WorldPage />
      <EditorDialog />
      <output aria-label="world-state">
        {JSON.stringify({
          page: demo.page,
          confirmed: demo.value("worldConfirmed"),
          editor: demo.editor?.title,
          note: demo.value("worldNote"),
        })}
      </output>
    </>
  );
}

function state() {
  return JSON.parse(screen.getByLabelText("world-state").textContent ?? "{}");
}

describe("fixture world page project boundary", () => {
  it("shows no world facts until a project is loaded, then controls the ready and blocked paths", () => {
    render(
      <DemoProvider fixture={{}}>
        <WorldHarness />
      </DemoProvider>,
    );

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "尚未选择真实项目，无法读取世界设定或确认世界观。",
    );
    fireEvent.click(screen.getByRole("button", { name: "载入项目" }));
    expect(screen.getByRole("button", { name: "确认世界观" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "详细设定" }));
    expect(state().editor).toBe("详细世界设定");

    fireEvent.click(screen.getByRole("button", { name: "制造读取失败" }));
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("世界参考加载失败");
    expect(screen.getByRole("button", { name: "确认世界观" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "确认世界观" }));
    expect(state()).toMatchObject({ page: "scenes", confirmed: "true" });
  });

  it("opens distinct detail and reference views only after the project boundary is present", () => {
    render(
      <DemoProvider fixture={{}}>
        <WorldHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "载入项目" }));
    fireEvent.click(screen.getByRole("button", { name: "详细设定" }));
    expect(state().editor).toBe("详细世界设定");
    fireEvent.click(screen.getByRole("button", { name: "全屏查看世界观" }));
    expect(state().editor).toBe("已读取项目 · 世界参考");
  });

  it("saves an edited world drawer as an unconfirmed local draft", () => {
    render(
      <DemoProvider fixture={{}}>
        <WorldHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "载入项目" }));
    fireEvent.click(screen.getByRole("button", { name: "详细设定" }));
    fireEvent.change(screen.getByLabelText("世界定位与核心规则"), {
      target: { value: "新的本地世界规则" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设定" }));
    expect(state()).toMatchObject({ confirmed: "false", note: "新的本地世界规则" });
  });
});
