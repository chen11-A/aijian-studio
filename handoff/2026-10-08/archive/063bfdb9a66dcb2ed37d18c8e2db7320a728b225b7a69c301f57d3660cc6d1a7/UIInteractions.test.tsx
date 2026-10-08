import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DemoApp } from "./DemoApp";
import { DemoProvider, useDemo } from "./model";
import { EditorDialog } from "./Common";

afterEach(cleanup);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
function open(page = "project") {
  window.history.replaceState({}, "", `?layout=classic&timeline=classic#${page}`);
  return render(<DemoApp />);
}
function details(label: string) {
  const trigger = screen.getByLabelText(label);
  return { trigger, panel: trigger.closest("details")! };
}
describe("workbench menu dismissal", () => {
  it("closes the user menu outside and on Escape, returning keyboard focus", () => {
    open();
    const { trigger, panel } = details("用户菜单");
    fireEvent.click(trigger);
    expect(panel).toHaveAttribute("open");
    fireEvent.pointerDown(document.body);
    expect(panel).not.toHaveAttribute("open");
    fireEvent.click(trigger);
    act(() => within(panel).getByText("用户中心").focus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });
  it("closes after navigation and when focus leaves the menu", () => {
    open();
    const { trigger, panel } = details("用户菜单");
    fireEvent.click(trigger);
    fireEvent.click(within(panel).getByText("用户中心"));
    expect(panel).not.toHaveAttribute("open");
    fireEvent.click(trigger);
    act(() => screen.getByLabelText("作品选择").focus());
    expect(panel).not.toHaveAttribute("open");
  });
  it("keeps only one menu open and dismisses the AI menu outside", () => {
    open();
    const user = details("用户菜单");
    const ai = details("助手工具");
    fireEvent.click(user.trigger);
    fireEvent.click(ai.trigger);
    expect(user.panel).not.toHaveAttribute("open");
    expect(ai.panel).toHaveAttribute("open");
    fireEvent.click(document.body);
    expect(ai.panel).not.toHaveAttribute("open");
  });
  it("clears the AI menu when its panel is collapsed", () => {
    open();
    const ai = details("助手工具");
    fireEvent.click(ai.trigger);
    fireEvent.click(within(ai.panel).getByText("收起助手面板"));
    fireEvent.click(screen.getByLabelText("展开 AI 助手"));
    expect(ai.panel).not.toHaveAttribute("open");
  });
  it("dismisses scene actions outside without removing their accessible actions", () => {
    open("scenes");
    const trigger = screen.getByText("详细信息", { selector: "summary" });
    fireEvent.click(trigger);
    const panel = trigger.closest("details")!;
    expect(within(panel).getByText("新增场景")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(panel).not.toHaveAttribute("open");
  });
});
describe("one current workbench layout", () => {
  it.each(["scenes", "characters", "storyboard", "assembly", "review"])(
    "uses the current %s layout even with old URL options and hides comparison switches",
    (page) => {
      const { container } = open(page);
      expect(screen.queryByRole("group", { name: /布局对比/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /旧版|新版候选|新版时间轴/ })).not.toBeInTheDocument();
      const selector = page === "scenes" ? ".v21-scenes" : page === "characters" ? ".v21-characters" : `.v21-${page}-body`;
      expect(container.querySelector(selector)).not.toBeNull();
    },
  );
});
function EditHarness() {
  const d = useDemo();
  return <><button onClick={() => d.setEditor({ title: "编辑测试", fields: [{ key: "name", label: "名称", value: "原名称" }], save: () => {} })}>编辑</button><EditorDialog /></>;
}
describe("unsaved editor input", () => {
  it("keeps dirty input on outside/Escape dismissal until explicitly discarded", () => {
    render(<DemoProvider><EditHarness /></DemoProvider>);
    fireEvent.click(screen.getByText("编辑"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "未保存的新名称" } });
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toHaveValue("未保存的新名称");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("closes unchanged or reverted fields without a discard prompt", () => {
    render(<DemoProvider><EditHarness /></DemoProvider>);
    fireEvent.click(screen.getByText("编辑"));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "改动" } });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "原名称" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
