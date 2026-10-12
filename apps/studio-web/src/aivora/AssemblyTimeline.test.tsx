import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssemblyTimeline } from "./AssemblyTimeline";
import { AssemblyTrackEditor } from "./AssemblyTrackEditor";
import { emptyAssembly } from "./adapters/assemblyEditing";
import { frameTimecode } from "./timeline-model";
import {
  assemblyTimecodeFrame,
  timelinePointerFrame,
  timelineLanes,
} from "./assembly-timeline-model";
import type { AssemblyContent } from "./adapters/episodeMediaAssembly";
import { ASSEMBLY_TIMEBASES } from "./adapters/assemblyEditing";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function content(): AssemblyContent {
  const c = emptyAssembly("project", "episode");
  c.total_frames = 150;
  c.visual_segments = [0, 1].map((i) => ({
    segment_id: `clip${i}`,
    media_kind: "image",
    media: { asset_id: "asset", asset_version_id: "version", sha256: "a".repeat(64) },
    start_frame: i * 75,
    end_frame: (i + 1) * 75,
    source_in_frame: 0,
    embedded_audio: "MUTE",
  }));
  return c;
}
function setup(c = content(), locked = false) {
  const callbacks = {
    onEdit: vi.fn((_content: AssemblyContent) => true),
    onNotice: vi.fn(),
    onUndo: vi.fn(),
  };
  function App() {
    const [frame, setFrame] = useState(85),
      [selected, setSelected] = useState("clip1");
    return (
      <AssemblyTrackEditor
        content={c}
        library={null}
        frame={frame}
        selected={selected}
        locked={locked}
        onFrame={setFrame}
        onSelect={(id, at) => {
          setSelected(id);
          setFrame(at);
        }}
        newId={() => "split"}
        viewKey="project/episode/saved/hash"
        canUndo
        canRedo
        {...callbacks}
      />
    );
  }
  const view = render(<App />);
  return {
    ...callbacks,
    view,
    region: screen.getByRole("region", { name: "生产时间轴快捷键区域" }),
    frame: screen.getByLabelText("剪切位置（序列帧）"),
    code: screen.getByLabelText("定位时间码"),
  };
}
describe("production assembly timeline boundaries", () => {
  it("round trips all supported rational rates and DF minute, hour and maximum-frame boundaries", () => {
    const c = content();
    c.total_frames = 1_000_000;
    for (const { value: timebase } of ASSEMBLY_TIMEBASES) {
      c.sequence_timebase = timebase;
      const { num, den } = timebase.frame_rate,
        mode = timebase.timecode_mode;
      for (const at of [0, 1, 1798, 1799, 1800, 17981, 17982, 107891, 107892, 999999])
        expect(assemblyTimecodeFrame(frameTimecode(at, num / den, mode), c)).toBe(at);
      expect(assemblyTimecodeFrame(frameTimecode(c.total_frames, num / den, mode), c)).toBeNull();
    }
    c.sequence_timebase = { frame_rate: { num: 30000, den: 1001 }, timecode_mode: "DROP_FRAME" };
    for (const code of [
      "00:01:00:00",
      "00:01:00:01",
      "-1:00:00:00",
      "00:60:00:00",
      "00:00:00:30",
      "",
      "0:1:0:2",
    ])
      expect(assemblyTimecodeFrame(code, c)).toBeNull();
    expect(assemblyTimecodeFrame("00:01:00:02", c)).toBe(1800);
    expect(assemblyTimecodeFrame("00:10:00:00", c)).toBe(17982);
    c.sequence_timebase = {
      frame_rate: { num: 30, den: 1 },
      timecode_mode: "DROP_FRAME",
    } as unknown as AssemblyContent["sequence_timebase"];
    expect(assemblyTimecodeFrame("00:00:00:00", c)).toBeNull();
    c.total_frames = 0;
    expect(assemblyTimecodeFrame("00:00:00:00", c)).toBeNull();
    c.sequence_timebase = { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" };
    c.total_frames = 1;
    expect(assemblyTimecodeFrame("00:00:00:00", c)).toBe(0);
    expect(assemblyTimecodeFrame("00:00:00:01", c)).toBeNull();
  });
  it("maps real scaled and scrolled pixel positions to integer frames with endpoint clamping", () => {
    expect(timelinePointerFrame(85 * 0.000123 + 0.00001, 0.000123, 1_000_000)).toBe(85);
    expect(timelinePointerFrame(-12, 4, 150)).toBe(0);
    expect(timelinePointerFrame(600, 4, 150)).toBe(149);
    expect(timelinePointerFrame(1, 0, 150)).toBe(0);
    expect(timelinePointerFrame(NaN, 1, 150)).toBe(0);
  });
  it("jumps valid timecode, rejects end and skipped labels, Escape explicitly restores the view draft", () => {
    const s = setup();
    fireEvent.change(s.code, { target: { value: "00:00:05:24" } });
    fireEvent.keyDown(s.code, { key: "Enter" });
    expect(s.frame).toHaveValue(149);
    fireEvent.change(s.code, { target: { value: "00:00:06:00" } });
    fireEvent.click(screen.getByRole("button", { name: "定位" }));
    expect(s.frame).toHaveValue(149);
    expect(s.onNotice).toHaveBeenCalledOnce();
    expect(s.code).toHaveValue("00:00:06:00");
    fireEvent.keyDown(s.code, { key: "Escape" });
    expect(s.code).toHaveValue("00:00:05:24");
    expect(s.onEdit).not.toHaveBeenCalled();
  });
  it("scopes frame, clip, zoom and edit keys to the actual region; input, button, IME and modifiers retain their behavior", () => {
    const s = setup();
    fireEvent.keyDown(s.region, { key: "ArrowLeft" });
    expect(s.frame).toHaveValue(84);
    fireEvent.keyDown(s.region, { key: "ArrowRight", shiftKey: true });
    expect(s.frame).toHaveValue(94);
    fireEvent.keyDown(s.region, { key: "Home" });
    expect(s.frame).toHaveValue(0);
    fireEvent.keyDown(s.region, { key: "ArrowLeft" });
    expect(s.frame).toHaveValue(0);
    fireEvent.keyDown(s.region, { key: "End" });
    expect(s.frame).toHaveValue(149);
    fireEvent.keyDown(s.region, { key: "ArrowRight" });
    expect(s.frame).toHaveValue(149);
    for (const target of [
      s.frame,
      s.code,
      screen.getByRole("button", { name: "适应窗口" }),
      screen.getByLabelText("片段时长（帧）"),
    ])
      fireEvent.keyDown(target, { key: "Delete" });
    for (const event of [
      { key: "Delete", isComposing: true },
      { key: "Delete", keyCode: 229 },
      { key: "Delete", altKey: true },
      { key: "Delete", metaKey: true },
      { key: "Delete", repeat: true },
      { key: "b", ctrlKey: true, repeat: true },
    ])
      fireEvent.keyDown(s.region, event);
    expect(s.onEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(s.region, { key: "ArrowUp" });
    expect(s.frame).toHaveValue(0);
    fireEvent.keyDown(s.region, { key: "ArrowDown" });
    expect(s.frame).toHaveValue(75);
    fireEvent.keyDown(s.region, { key: "+", shiftKey: true });
    expect(screen.getByText("2×")).toBeVisible();
    fireEvent.keyDown(s.region, { key: "f" });
    expect(screen.getByText("1×")).toBeVisible();
    fireEvent.keyDown(s.region, { key: "z", ctrlKey: true });
    fireEvent.keyDown(s.region, { key: "z", ctrlKey: true, shiftKey: true });
    expect(s.onUndo.mock.calls).toEqual([[false], [true]]);
  });
  it("blocks clip navigation, split, delete and undo during unapplied trim while view positioning remains safe", () => {
    const s = setup();
    fireEvent.change(screen.getByLabelText("片段时长（帧）"), { target: { value: "65" } });
    fireEvent.keyDown(s.region, { key: "ArrowUp" });
    expect(s.frame).toHaveValue(85);
    fireEvent.keyDown(s.region, { key: "b", ctrlKey: true });
    fireEvent.keyDown(s.region, { key: "Delete" });
    fireEvent.keyDown(s.region, { key: "z", ctrlKey: true });
    expect(s.onEdit).not.toHaveBeenCalled();
    expect(s.onUndo).not.toHaveBeenCalled();
    expect(screen.getByLabelText("片段时长（帧）")).toHaveValue(65);
    fireEvent.keyDown(s.region, { key: "ArrowRight" });
    expect(s.frame).toHaveValue(86);
  });
  it("uses the existing split callback and exact current content; locked UNKNOWN never edits", () => {
    const s = setup();
    fireEvent.keyDown(s.region, { key: "b", ctrlKey: true });
    const changed = s.onEdit.mock.calls[0]![0];
    expect(changed.visual_segments.map((v) => [v.segment_id, v.start_frame, v.end_frame])).toEqual([
      ["clip0", 0, 75],
      ["clip1", 75, 85],
      ["split", 85, 150],
    ]);
    s.view.unmount();
    const blocked = setup(content(), true);
    fireEvent.keyDown(blocked.region, { key: "b", ctrlKey: true });
    fireEvent.keyDown(blocked.region, { key: "Delete" });
    fireEvent.keyDown(blocked.region, { key: "z", ctrlKey: true });
    expect(blocked.onEdit).not.toHaveBeenCalled();
    expect(blocked.onUndo).not.toHaveBeenCalled();
  });
  it("measures fit width, anchors zoom and clamps after resize without edits or frame changes", () => {
    let measuredWidth = 600;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => measuredWidth);
    const s = setup();
    const viewport = screen.getByLabelText("可缩放序列轨道"),
      canvas = viewport.firstElementChild as HTMLElement;
    expect(canvas.style.width).toBe("600px");
    fireEvent.click(screen.getByRole("button", { name: "放大时间轴" }));
    expect(canvas.style.width).toBe("1200px");
    expect(viewport.scrollLeft).toBe(340);
    measuredWidth = 300;
    fireEvent(window, new Event("resize"));
    expect(canvas.style.width).toBe("600px");
    expect(viewport.scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "适应窗口" }));
    expect(canvas.style.width).toBe("300px");
    expect(viewport.scrollLeft).toBe(0);
    expect(s.frame).toHaveValue(85);
    expect(s.onEdit).not.toHaveBeenCalled();
  });
  it("resets timecode and zoom on exact context identity change while keeping current dirty content on rerender", () => {
    const c = content(),
      noop = vi.fn();
    const props = {
      content: c,
      library: null,
      frame: 85,
      selected: "clip1",
      selectionLocked: false,
      audioOnly: false,
      canSplit: false,
      canUndo: false,
      canRedo: false,
      onFrame: noop,
      onSelect: noop,
      onSplit: noop,
      onRemove: noop,
      onUndo: noop,
      onNotice: noop,
    };
    const view = render(<AssemblyTimeline key="A/v1/hash/25" {...props} />);
    fireEvent.change(screen.getByLabelText("定位时间码"), { target: { value: "00:00:04:00" } });
    fireEvent.click(screen.getByRole("button", { name: "放大时间轴" }));
    view.rerender(
      <AssemblyTimeline key="A/v1/hash/25" {...props} content={{ ...c, total_frames: 175 }} />,
    );
    expect(screen.getByText("2×")).toBeVisible();
    expect(screen.getByLabelText("定位时间码")).toHaveValue("00:00:04:00");
    view.rerender(
      <AssemblyTimeline
        key="B/v2/hash/24"
        {...props}
        content={{
          ...c,
          sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
        }}
      />,
    );
    expect(screen.getByText("1×")).toBeVisible();
    expect(screen.getByLabelText("定位时间码")).toHaveValue("00:00:03:13");
  });
});

describe("independent implementation findings", () => {
  it("subtracts the real viewport border before ruler and segment integer mapping", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientLeft", "get").mockReturnValue(1);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 0, 602, 200),
    );
    const c = content();
    c.total_frames = 3000;
    const calls = {
      onFrame: vi.fn(),
      onSelect: vi.fn(),
      onSplit: vi.fn(),
      onRemove: vi.fn(),
      onUndo: vi.fn(),
      onNotice: vi.fn(),
    };
    render(
      <AssemblyTimeline
        content={c}
        library={null}
        frame={0}
        selected=""
        selectionLocked={false}
        audioOnly={false}
        canSplit={false}
        canUndo={false}
        canRedo={false}
        {...calls}
      />,
    );
    fireEvent.click(screen.getByLabelText("帧刻度定位"), { clientX: 121, detail: 1 });
    expect(calls.onFrame).toHaveBeenLastCalledWith(100);
    fireEvent.click(screen.getByRole("button", { name: "定位片段 clip1" }), {
      clientX: 121,
      detail: 1,
    });
    expect(calls.onSelect).toHaveBeenLastCalledWith("clip1", 100);
  });
  it("invalidates unapplied timecode when an external frame moves away and back", () => {
    const s = setup();
    fireEvent.change(s.code, { target: { value: "00:00:04:00" } });
    fireEvent.keyDown(s.region, { key: "ArrowRight" });
    fireEvent.keyDown(s.region, { key: "ArrowLeft" });
    expect(s.code).toHaveValue("00:00:03:10");
    fireEvent.keyDown(s.code, { key: "Enter" });
    expect(s.frame).toHaveValue(85);
    expect(s.onEdit).not.toHaveBeenCalled();
  });
  it("respects already-consumed region keyboard events", () => {
    const s = setup();
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    event.preventDefault();
    fireEvent(s.region, event);
    expect(s.onEdit).not.toHaveBeenCalled();
  });
  it("packs overlapping audio/subtitle intervals into separately targetable rows without mutating data", () => {
    const intervals = [
        { segment_id: "late", start_frame: 20, end_frame: 30 },
        { segment_id: "long", start_frame: 0, end_frame: 30 },
        { segment_id: "early", start_frame: 0, end_frame: 20 },
      ],
      before = JSON.stringify(intervals);
    const lanes = timelineLanes(intervals);
    expect(lanes.map((lane) => lane.map((s) => s.segment_id))).toEqual([
      ["early", "late"],
      ["long"],
    ]);
    expect(JSON.stringify(intervals)).toBe(before);
    const c = content();
    c.audio_segments = [0, 1].map((i) => ({
      segment_id: `audio${i}`,
      track_kind: i === 0 ? "BGM" : "SFX",
      media: c.visual_segments[0]!.media,
      start_frame: 0,
      end_frame: 100,
      source_in_sample: 0,
    }));
    const noop = vi.fn();
    render(
      <AssemblyTimeline
        content={c}
        library={null}
        frame={0}
        selected=""
        selectionLocked={false}
        audioOnly
        canSplit={false}
        canUndo={false}
        canRedo={false}
        onFrame={noop}
        onSelect={noop}
        onSplit={noop}
        onRemove={noop}
        onUndo={noop}
        onNotice={noop}
      />,
    );
    const first = screen.getByRole("button", { name: "定位片段 audio0" }),
      second = screen.getByRole("button", { name: "定位片段 audio1" });
    expect(first.parentElement).not.toBe(second.parentElement);
    fireEvent.click(first);
    fireEvent.click(second);
    expect(noop.mock.calls).toEqual([
      ["audio0", 0],
      ["audio1", 0],
    ]);
  });
});

it("associates actual fps errors with the timecode field and clears them on valid jump, Escape and external seek", () => {
  const s = setup();
  const id = s.code.getAttribute("aria-describedby")!;
  expect(document.getElementById(id)).toHaveTextContent("帧号 00–24");
  fireEvent.change(s.code, { target: { value: "00:00:00:25" } });
  fireEvent.keyDown(s.code, { key: "Enter" });
  expect(s.code).toHaveAttribute("aria-invalid", "true");
  expect(document.getElementById(id)).toHaveAttribute("role", "alert");
  expect(s.frame).toHaveValue(85);
  fireEvent.keyDown(s.code, { key: "Escape" });
  expect(s.code).toHaveAttribute("aria-invalid", "false");
  fireEvent.change(s.code, { target: { value: "invalid" } });
  fireEvent.keyDown(s.code, { key: "Enter" });
  fireEvent.keyDown(s.region, { key: "ArrowRight" });
  expect(s.code).toHaveAttribute("aria-invalid", "false");
  expect(s.code).toHaveValue("00:00:03:11");
  fireEvent.change(s.code, { target: { value: "00:00:03:10" } });
  fireEvent.keyDown(s.code, { key: "Enter" });
  expect(s.frame).toHaveValue(85);
  expect(s.code).toHaveAttribute("aria-invalid", "false");
});
