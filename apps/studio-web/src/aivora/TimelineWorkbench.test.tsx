import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MediaPages } from "./MediaPages";
import { EditorDialog } from "./Common";
import { DemoProvider, createAivoraSampleFixture } from "./model";
import { anchoredScroll, frameTimecode, parseTimecode, rulerStep } from "./timeline-model";
import { TimelineWorkbench } from "./TimelineWorkbench";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function openTimeline(page: string) {
  window.history.replaceState({}, "", `?timeline=modern#${page}`);
  return render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <MediaPages />
      <EditorDialog />
    </DemoProvider>,
  );
}

function enterTimecode(value: string) {
  const field = screen.getByRole("textbox", { name: "当前时间码" });
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
  return field;
}

describe("frame-accurate timeline controls", () => {
  it("round trips every frame in the four-minute sequence, including its end boundary", () => {
    for (let frame = 0; frame <= 5760; frame++)
      expect(parseTimecode(frameTimecode(frame), 5760)).toBe(frame);
    for (const bad of ["00:60:00:00", "00:00:60:00", "0:00:00:00", "-1:00:00:00"])
      expect(parseTimecode(bad, 5760)).toBeNull();
  });
  it("uses the contract's 30000/1001 drop-frame labels without changing frame duration", () => {
    expect(frameTimecode(1800, 30000 / 1001, "DROP_FRAME")).toBe("00:01:00:02");
    expect(parseTimecode("00:01:00:02", 2000, 30000 / 1001, "DROP_FRAME")).toBe(1800);
    expect(parseTimecode("00:01:00:00", 2000, 30000 / 1001, "DROP_FRAME")).toBeNull();
    expect(parseTimecode("00:01:00:00", 2000, 30000 / 1001, "NON_DROP_FRAME")).toBe(1800);
  });
  it("keeps zoom anchors stable and clamps both scroll edges", () => {
    expect(anchoredScroll(2034, 6, 300, 992, 5760)).toBe(11904);
    expect(anchoredScroll(0, 6, 300, 992, 5760)).toBe(0);
    expect(anchoredScroll(5760, 6, 0, 992, 5760)).toBe(33568);
    for (const scale of [0.12, 0.17, 0.5, 1, 3, 6])
      expect(rulerStep(scale) * scale).toBeGreaterThanOrEqual(100);
    expect(rulerStep(6, 6)).toBe(1);
  });
  it("keeps a valid interval when a reversed mark is attempted and clears it explicitly", () => {
    openTimeline("review");
    enterTimecode("00:00:03:00");
    fireEvent.click(screen.getByRole("button", { name: "设入点 I" }));
    enterTimecode("00:00:02:00");
    fireEvent.click(screen.getByRole("button", { name: "设出点 O" }));
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("O 未设");
    enterTimecode("00:00:04:00");
    fireEvent.click(screen.getByRole("button", { name: "设出点 O" }));
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("24 帧");
    fireEvent.click(screen.getByRole("button", { name: "清除范围" }));
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("点击标尺定位");
  });
  it("seeks a typed timecode, steps one frame both ways and rejects invalid fields", () => {
    openTimeline("storyboard");
    const seek = screen.getByRole("slider", { name: "预演位置" });
    expect(seek).toHaveAttribute("max", "240");
    enterTimecode("00:00:01:12");
    expect(seek).toHaveValue("1.5");
    fireEvent.click(screen.getByRole("button", { name: "下一帧" }));
    expect(Number((seek as HTMLInputElement).value)).toBeCloseTo(37 / 24);
    fireEvent.click(screen.getByRole("button", { name: "上一帧" }));
    expect(seek).toHaveValue("1.5");
    expect(enterTimecode("00:00:01:24")).toHaveAttribute("aria-invalid", "true");
    expect(seek).toHaveValue("1.5");
    expect(enterTimecode("00:04:00:01")).toHaveAttribute("aria-invalid", "true");
    expect(seek).toHaveValue("1.5");
  });
  it("uses a real 30 fps timebase for timecode, seek, and marked ranges", () => {
    const seek = vi.fn();
    function ControlledTimeline() {
      const [frame, setFrame] = useState(45);
      return (
        <TimelineWorkbench
          seek={(seconds) => {
            seek(seconds);
            setFrame(Math.round(seconds * 30));
          }}
          gutter={64}
          timeline={{
            totalFrames: 300,
            frame,
            frameRate: { num: 30, den: 1 },
            timecodeMode: "NON_DROP_FRAME",
            clipEndFrames: [150, 300],
          }}
        >
          <div />
        </TimelineWorkbench>
      );
    }
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <ControlledTimeline />
      </DemoProvider>,
    );
    expect(screen.getByRole("textbox", { name: "当前时间码" })).toHaveValue("00:00:01:15");
    const position = screen.getByLabelText("组装位置");
    expect(position).toHaveAttribute("max", "10");
    expect(position).toHaveValue("1.5");
    fireEvent.change(position, { target: { value: "2" } });
    expect(seek).toHaveBeenLastCalledWith(2);
    enterTimecode("00:00:02:00");
    expect(seek).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "设入点 I" }));
    expect(enterTimecode("00:00:01:30")).toHaveAttribute("aria-invalid", "true");
    enterTimecode("00:00:03:00");
    fireEvent.click(screen.getByRole("button", { name: "设出点 O" }));
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("30 帧");
  });
  it("derives accessible seek duration and its end frame from a rational formal timebase", () => {
    const seek = vi.fn();
    function RationalTimeline() {
      const [frame, setFrame] = useState(0);
      return (
        <TimelineWorkbench
          seek={(seconds) => {
            seek(seconds);
            setFrame(Math.round((seconds * 30000) / 1001));
          }}
          gutter={64}
          timeline={{
            totalFrames: 3000,
            frame,
            frameRate: { num: 30000, den: 1001 },
            timecodeMode: "NON_DROP_FRAME",
            clipEndFrames: [3000],
          }}
        >
          <div />
        </TimelineWorkbench>
      );
    }
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <RationalTimeline />
      </DemoProvider>,
    );
    const position = screen.getByLabelText("组装位置");
    expect(Number((position as HTMLInputElement).max)).toBeCloseTo((3000 * 1001) / 30000);
    fireEvent.change(position, { target: { value: ((3000 * 1001) / 30000).toString() } });
    expect(seek.mock.calls.at(-1)?.[0]).toBeCloseTo((3000 * 1001) / 30000);
    expect(screen.getByLabelText("组装位置")).toHaveValue((3000 / (30000 / 1001)).toString());
  });

  it("lets review annotations use a marked interval rather than an unrelated default range", () => {
    openTimeline("review");
    enterTimecode("00:00:01:00");
    fireEvent.click(screen.getByRole("button", { name: "设入点 I" }));
    enterTimecode("00:00:03:00");
    fireEvent.click(screen.getByRole("button", { name: "设出点 O" }));
    expect(screen.getByLabelText("已选时间范围")).toHaveTextContent("48 帧");
    fireEvent.click(screen.getByRole("button", { name: "选择范围批注" }));
    expect(screen.getByLabelText("开始时间（秒）")).toHaveValue(1);
    expect(screen.getByLabelText("结束时间（秒）")).toHaveValue(3);
    expect(screen.getByRole("button", { name: "暂无真实视频，不能播放" })).toBeDisabled();
  });

  it.each(["storyboard", "review"])("provides frame-level zoom and a fit command on %s", (page) => {
    openTimeline(page);
    const zoom = screen.getByRole("slider", { name: "时间轴缩放" });
    fireEvent.change(zoom, { target: { value: "6" } });
    expect(screen.getByLabelText("时间轴比例")).toHaveTextContent("6.00 px/帧");
    fireEvent.click(screen.getByRole("button", { name: "适应全片" }));
    expect(screen.getByLabelText("时间轴比例")).toHaveTextContent("全片");
  });
});
