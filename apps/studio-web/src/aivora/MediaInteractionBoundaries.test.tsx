import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EditorDialog } from "./Common";
import { MediaPages } from "./MediaPages";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";

function State() {
  const model = useDemo();
  return (
    <output aria-label="local media state">
      {JSON.stringify({
        page: model.page,
        time: model.time,
        shots: model.shots,
        annotations: model.annotations,
        playing: model.playing,
        values: model.values,
        selected: model.selectedShot,
        toast: model.toast,
      })}
    </output>
  );
}
function open(
  page: string,
  configure?: (fixture: ReturnType<typeof createAivoraSampleFixture>) => void,
) {
  window.history.replaceState({}, "", `#${page}`);
  const fixture = createAivoraSampleFixture();
  configure?.(fixture);
  return render(
    <DemoProvider fixture={fixture}>
      <MediaPages />
      <EditorDialog />
      <State />
    </DemoProvider>,
  );
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
function state() {
  return JSON.parse(screen.getByLabelText("local media state").textContent ?? "{}");
}
const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  localStorage.clear();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (showModalDescriptor)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModalDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "close", closeDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("local sample media editing never represents produced media", () => {
  test("adds a bounded shot and selects its original end position", () => {
    open("storyboard");
    const before = state();
    click("添加镜头");
    change("镜头名称", "Added sample");
    change("时长（秒）", "2.5");
    click("保存演示修改");
    const current = state();
    expect(current.shots).toHaveLength(before.shots.length + 1);
    expect(current.shots.at(-1)).toMatchObject({ name: "Added sample", duration: 2.5 });
    expect(current.selected).toBe(current.shots.at(-1).id);
    expect(current.time).toBe(
      before.shots.reduce((sum: number, shot: { duration: number }) => sum + shot.duration, 0),
    );
    expect(current.playing).toBe(false);
  });

  test.each(["0", "31"])("invalid shot duration %s leaves the sample untouched", (duration) => {
    open("storyboard");
    const before = state().shots;
    click("添加镜头");
    change("时长（秒）", duration);
    click("保存演示修改");
    expect(state().shots).toEqual(before);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  test("play at the end restarts the static preview, pause stops timer advances", () => {
    vi.useFakeTimers();
    open("storyboard");
    const slider = screen.getByRole("slider", { name: "预演位置" });
    fireEvent.change(slider, { target: { value: slider.getAttribute("max") } });
    click("播放分镜预演");
    expect(state()).toMatchObject({ time: 0, playing: true });
    act(() => vi.advanceTimersByTime(500));
    expect(state().time).toBe(0.5);
    click("暂停分镜预演");
    act(() => vi.advanceTimersByTime(500));
    expect(state()).toMatchObject({ time: 0.5, playing: false });
  });

  test("generation selects a shot, retains candidate scroll and records only local issues", async () => {
    open("generation");
    change("当前制作镜头", "2");
    expect(state().selected).toBe(2);
    const candidates = screen.getByLabelText("候选版本内容");
    fireEvent.wheel(candidates, { deltaY: 50 });
    expect(candidates.scrollLeft).toBe(50);
    fireEvent.scroll(candidates);
    expect(state().values.generationCandidateScroll).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: /参考样例 3/ }));
    await act(async () => click("保存演示修改"));
    expect(state().values["candidate-2"]).toBe("3");
    fireEvent.click(screen.getAllByRole("button", { name: "标记待调整" })[0]!);
    change("问题描述", "Synthetic framing issue");
    await act(async () => click("保存演示修改"));
    expect(state().values["shotIssue-2"]).toBe("Synthetic framing issue");
    expect(screen.getByText("尚未生成")).toBeVisible();
  });

  test("review creates a quantized range, edits its text and never enables execution", async () => {
    open("review");
    click("选择范围批注");
    change("开始时间（秒）", "1.1");
    change("结束时间（秒）", "2.2");
    change("批注内容", "Synthetic range");
    await act(async () => click("保存演示修改"));
    expect(state().annotations.at(-1)).toMatchObject({
      start: 26 / 24,
      end: 53 / 24,
      text: "Synthetic range",
    });
    click("审核完成 · 查看修改方案");
    expect(state().page).toBe("changes");
    const row = screen.getByText("Synthetic range").closest("article");
    if (!row) throw new Error("Expected change row");
    fireEvent.click(within(row).getByRole("button", { name: "编辑方案" }));
    change("修改要求", "Revised range");
    await act(async () => click("保存演示修改"));
    expect(state().annotations.at(-1).text).toBe("Revised range");
    fireEvent.click(within(row).getByRole("button", { name: "查看影响" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("真实费用未知");
    expect(screen.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  });

  test.each([
    ["4", "3"],
    ["0", "241"],
  ])("invalid annotation range %s to %s is not retained", (start, end) => {
    open("review");
    const before = state().annotations;
    click("选择范围批注");
    change("开始时间（秒）", start!);
    change("结束时间（秒）", end!);
    change("批注内容", "Invalid range");
    click("保存演示修改");
    expect(state().annotations).toEqual(before);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  test("review filters current-shot annotations and reports no matches honestly", async () => {
    const { container } = open("review");
    click("按时间");
    change("批注筛选", "当前镜头");
    change("批注排序", "最新添加");
    await act(async () => click("保存演示修改"));
    expect(screen.getByRole("button", { name: "最新" })).toBeVisible();
    const matching = state().annotations.filter(
      (note: { start: number }) => note.start >= 60 && note.start < 90,
    );
    expect(container.querySelectorAll(".v2-review-note")).toHaveLength(matching.length);
    click("最新");
    change("批注筛选", "音量");
    await act(async () => click("保存演示修改"));
    const expected = state().annotations.filter(
      (note: { category: string }) => note.category === "音量",
    );
    expect(container.querySelectorAll(".v2-review-note")).toHaveLength(expected.length);
  });

  test("change filtering resets scroll and keeps unselected notes intact", () => {
    open("changes");
    const before = state().annotations;
    const rows = screen.getByLabelText("修改方案内容");
    fireEvent.scroll(rows, { target: { scrollTop: 100 } });
    expect(state().values.changeItemsScroll).toBe("100");
    change("批注分组", "字幕");
    expect(state().values.changeItemsScroll).toBe("0");
    expect(state().annotations).toEqual(before);
    expect(within(rows).getAllByRole("checkbox")).toHaveLength(
      before.filter((note: { category: string }) => note.category === "字幕").length,
    );
    click("返回审片");
    expect(state().page).toBe("review");
  });

  test.each(["storyboard", "review", "generation"])("%s enlarges only reference stills", (page) => {
    open(page);
    click("放大参考画面");
    expect(screen.getByRole("dialog")).toHaveTextContent("参考静帧");
    expect(screen.getByRole("dialog").querySelector("video")).toBeNull();
  });

  test("sample export proposal and scrolling do not create formal approval", () => {
    open("export");
    fireEvent.scroll(screen.getByLabelText("导出检查内容"), { target: { scrollTop: 80 } });
    expect(state().values.exportCheckScroll).toBe("80");
    click("演示草稿导出");
    expect(screen.getByRole("button", { name: "批准并导出正式版" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开目录 · 无输出" })).toBeDisabled();
  });

  test.each([
    ["storyboard", "确认分镜并进入制作", "generation"],
    ["generation", "进入成片组装", "assembly"],
    ["review", "返回制作", "assembly"],
  ])("%s navigation by %s stays within the local sample", (page, button, target) => {
    open(page!);
    click(button!);
    expect(state().page).toBe(target);
  });
});
