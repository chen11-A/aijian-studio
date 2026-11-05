import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MOODS, SoundPanel, type SoundPanelProps } from "./SoundPanel";

function renderPanel(props: Partial<SoundPanelProps> = {}) {
  const handlers = {
    onMoodChange: vi.fn(),
    onMasterChange: vi.fn(),
    onLaneChange: vi.fn(),
  };
  const view = render(
    <SoundPanel
      sceneTitle="第 2 场 · 码头仓库"
      durationLabel="1 分 36 秒"
      mood="激烈"
      music={{ title: "短兵相接", reason: "从推倒书架开始进鼓。" }}
      master={85}
      lanes={{ dialogue: 100, ambience: 50, sfx: 80, score: 30 }}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, ...handlers };
}

describe("SoundPanel", () => {
  it("shows only the music mood and one volume at first", () => {
    const { container } = renderPanel();
    expect(screen.getAllByRole("radio")).toHaveLength(MOODS.length);
    expect(screen.getByRole("radio", { name: "激烈" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("短兵相接")).toBeInTheDocument();
    expect(screen.getByText("为什么选它：从推倒书架开始进鼓。")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.getByRole("slider", { name: "这一场的音量" })).toHaveValue("85");
    expect(screen.queryByRole("slider", { name: /对白/ })).toBeNull();
    expect(container.textContent).not.toMatch(/分贝|dB/);
  });

  it("opens 细调 with the four layers", () => {
    const { container } = renderPanel();
    const toggle = screen.getByRole("button", { name: "细调" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "收起细调" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("slider", { name: /对白/ })).toHaveValue("100");
    expect(screen.getByRole("slider", { name: /环境音/ })).toHaveValue("50");
    expect(screen.getByRole("slider", { name: /音效/ })).toHaveValue("80");
    expect(screen.getByRole("slider", { name: /配乐/ })).toHaveValue("30");
    expect(container.textContent).not.toMatch(/分贝|dB/);
    fireEvent.click(screen.getByRole("button", { name: "收起细调" }));
    expect(screen.queryByRole("slider", { name: /对白/ })).toBeNull();
  });

  it("reports volumes on 0–100 together with the mixer gain", () => {
    const { onMasterChange, onLaneChange } = renderPanel({ defaultFineOpen: true });
    fireEvent.change(screen.getByRole("slider", { name: "这一场的音量" }), {
      target: { value: "70" },
    });
    expect(onMasterChange).toHaveBeenCalledWith(70, -3);
    fireEvent.change(screen.getByRole("slider", { name: /配乐/ }), { target: { value: "20" } });
    expect(onLaneChange).toHaveBeenCalledWith("score", 20, -14);
    fireEvent.change(screen.getByRole("slider", { name: /对白/ }), { target: { value: "0" } });
    expect(onLaneChange).toHaveBeenLastCalledWith("dialogue", 0, -40);
  });

  it("picks one mood at a time, by click or arrow keys", () => {
    const { onMoodChange } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "温暖" }));
    expect(onMoodChange).toHaveBeenLastCalledWith("温暖");
    const current = screen.getByRole("radio", { name: "激烈" });
    expect(current).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "温暖" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(current, { key: "ArrowRight" });
    expect(onMoodChange).toHaveBeenLastCalledWith("悲伤");
    expect(screen.getByRole("radio", { name: "悲伤" })).toHaveFocus();
    fireEvent.keyDown(current, { key: "Tab" });
    expect(onMoodChange).toHaveBeenCalledTimes(2);
  });

  it("switches score ducking under 细调", () => {
    const onDuckMusicChange = vi.fn();
    renderPanel({ defaultFineOpen: true, duckMusic: true, onDuckMusicChange });
    const duck = screen.getByRole("switch", { name: "有人说话时，配乐自动变小" });
    expect(duck).toHaveAttribute("aria-checked", "true");
    fireEvent.click(duck);
    expect(onDuckMusicChange).toHaveBeenCalledWith(false);
  });

  it("says when the scene has no music yet, and offers a preview", () => {
    const onPreview = vi.fn();
    renderPanel({ music: null, onPreview });
    expect(screen.getByText("这一场还没有配乐。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "试听这一场" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("leaves out ducking when the caller does not handle it", () => {
    renderPanel({ defaultFineOpen: true, master: 140 });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("slider", { name: "这一场的音量" })).toHaveValue("100");
  });

  it("says what is missing instead of making up a mood, a volume or a layer", () => {
    const { container, onMoodChange } = renderPanel({
      mood: null,
      music: { title: "导入的音乐" },
      master: null,
      lanes: { dialogue: 80 },
      laneNotes: { score: "配乐是整部片子一起调的，在时间线的音乐轨上调。" },
      defaultFineOpen: true,
    });
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
    const first = screen.getByRole("radio", { name: MOODS[0] });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("还没有选这一场的配乐情绪。")).toBeInTheDocument();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onMoodChange).toHaveBeenLastCalledWith(MOODS[0]);
    expect(screen.getByText("导入的音乐")).toBeInTheDocument();
    expect(screen.queryByText(/为什么选它/)).toBeNull();
    expect(screen.queryByRole("slider", { name: "这一场的音量" })).toBeNull();
    expect(screen.getByText("还不能单独调。")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.getByRole("slider", { name: /对白/ })).toHaveValue("80");
    expect(screen.getByText("这一场没有环境音。")).toBeInTheDocument();
    expect(screen.getByText("这一场没有音效。")).toBeInTheDocument();
    expect(screen.getByText("配乐是整部片子一起调的，在时间线的音乐轨上调。")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/分贝|dB/);
  });

  it("shows a note about the mood next to a chosen one", () => {
    renderPanel({ moodNote: "导演写的是「低音弦乐」，不在这八个里。" });
    expect(screen.getByRole("radio", { name: "激烈" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("导演写的是「低音弦乐」，不在这八个里。")).toBeInTheDocument();
  });
});
