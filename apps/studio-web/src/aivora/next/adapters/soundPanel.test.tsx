import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SoundPanel } from "../SoundPanel";
import { SAMPLE_PROJECT, sampleProjectJson } from "./sampleProject";
import { soundPanelData } from "./soundPanel";

function edited(change: (project: typeof SAMPLE_PROJECT) => void): unknown {
  const project = JSON.parse(JSON.stringify(SAMPLE_PROJECT)) as typeof SAMPLE_PROJECT;
  change(project);
  return project;
}

function ready(value: unknown, sceneId: string) {
  const adapted = soundPanelData(value, sceneId);
  if (!adapted.ok) throw new Error(adapted.empty.title);
  return adapted.props;
}

describe("soundPanelData", () => {
  it("reads one scene: its mood, its voices, and the film's music", () => {
    expect(ready(sampleProjectJson(), "scene-1")).toEqual({
      sceneTitle: "第 1 场 · 雨夜旧书店",
      durationLabel: "10 秒",
      mood: "不安",
      music: { title: "导入的音乐" },
      master: null,
      lanes: { dialogue: 100 },
      laneNotes: {
        ambience: "还没有环境声的声音文件。",
        sfx: "还没有音效的声音文件。",
        score: "配乐是整部片子一起调的，在时间线的音乐轨上调。",
      },
    });
    const fight = ready(sampleProjectJson(), "scene-2");
    expect(fight.mood).toBe("激烈");
    expect(fight.laneNotes?.dialogue).toBe("这一场还没有配音。");
  });

  it("does not choose a mood the shots do not agree on", () => {
    const hospital = ready(sampleProjectJson(), "scene-3");
    expect(hospital.mood).toBeNull();
    expect(hospital.moodNote).toBe("这一场的镜头写了不同的配乐情绪：温暖、释然，慢钢琴。");
    const odd = edited((project) => {
      project.shots[6]!.sound.musicMood = "低音弦乐";
      project.shots[7]!.sound.musicMood = "";
    });
    expect(ready(odd, "scene-3")).toMatchObject({
      mood: null,
      moodNote: "导演写的是「低音弦乐」，不在这八个里。",
    });
  });

  it("reads voice volumes the way the timeline does", () => {
    const value = edited((project) => {
      project.audioClips.push({
        ...project.audioClips[0]!,
        id: "voice-scene-1-shot-3",
        shotId: "scene-1-shot-3",
        gainDb: -80,
      });
      project.audioClips.splice(1, 1);
    });
    expect(ready(value, "scene-1")).toMatchObject({
      lanes: {},
      music: null,
    });
    expect(ready(value, "scene-1").laneNotes).toMatchObject({
      dialogue: "这一场各镜头的台词音量不一样。",
      score: "还没有导入配乐。",
    });
    const noGain = edited((project) => {
      delete (project.audioClips[0] as { gainDb?: number }).gainDb;
    });
    const adapted = soundPanelData(noGain, "scene-1");
    expect(adapted.ok && adapted.props.lanes).toEqual({ dialogue: 100 });
    expect(adapted.missing).toEqual(["audioClips[0].gainDb"]);
  });

  it("leaves out the length when a shot has none or the scene has no shots", () => {
    const value = edited((project) => {
      delete (project.shots[0] as { seconds?: number }).seconds;
      project.scenes.push({ ...project.scenes[0]!, id: "scene-4", no: 4, title: "第 4 场" });
    });
    expect(ready(value, "scene-1").durationLabel).toBeUndefined();
    expect(ready(value, "scene-4")).toMatchObject({ sceneTitle: "第 4 场", mood: null });
    expect(ready(value, "scene-4").durationLabel).toBeUndefined();
  });

  it("says so when there is no scene to show", () => {
    expect(soundPanelData(sampleProjectJson(), "scene-9")).toEqual({
      ok: false,
      empty: { title: "找不到这一场", detail: "作品里没有编号为 scene-9 的场。" },
      missing: [],
    });
    expect(soundPanelData({ title: "x", scenes: [] }, "scene-1")).toMatchObject({
      ok: false,
      empty: { title: "还没有分场" },
    });
    expect(soundPanelData(7, "scene-1")).toMatchObject({
      ok: false,
      empty: { title: "作品记录读不出来" },
    });
  });

  it("gives SoundPanel a scene it can draw, with notes where there is nothing to set", () => {
    const onLaneChange = vi.fn();
    render(
      <SoundPanel
        {...ready(sampleProjectJson(), "scene-1")}
        defaultFineOpen
        onMoodChange={vi.fn()}
        onMasterChange={vi.fn()}
        onLaneChange={onLaneChange}
      />,
    );
    expect(screen.getByRole("radio", { name: "不安" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("还不能单独调。")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    fireEvent.change(screen.getByRole("slider", { name: /台词/ }), { target: { value: "50" } });
    expect(onLaneChange).toHaveBeenCalledWith("dialogue", 50, -6);
    expect(screen.getByText("配乐是整部片子一起调的，在时间线的音乐轨上调。")).toBeInTheDocument();
  });
});
