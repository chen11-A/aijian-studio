import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { afterCheck, startQueue, TaskCenterStory } from "./TaskCenter.story";
import { STORIES, StoryGallery, storyFromSearch } from "./stories/gallery";
import {
  sampleShotSpans,
  sampleTasks,
  SCENE_SHOT_SECONDS,
  TITLE_SECONDS,
} from "./stories/sampleData";
import { STORY_PAGES } from "./stories/StoryFrame";

afterEach(() => {
  vi.useRealTimers();
});

describe("story pages", () => {
  it.each(STORY_PAGES.map((page) => page.id))("%s says it shows example data", (id) => {
    const { container } = render(<StoryGallery search={`?story=${id}`} />);
    expect(screen.getByText("示例数据")).toBeInTheDocument();
    expect(container.querySelector(`.pro-root[data-story="${id}"]`)).not.toBeNull();
    expect(container.querySelector(".nx-root")).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "其他示例" });
    expect(within(nav).getAllByRole("link")).toHaveLength(STORY_PAGES.length);
  });

  it("reads the story and state from the address", () => {
    expect(storyFromSearch("?story=sound-panel&state=fine")).toEqual({
      story: "sound-panel",
      state: "fine",
    });
    expect(storyFromSearch("?story=nope")).toEqual({ story: "task-center", state: undefined });
    expect(Object.keys(STORIES)).toEqual(STORY_PAGES.map((page) => page.id));
  });

  it.each([
    ["task-center", ["recovery", "checked", "running", "loading", "empty", "error"]],
    ["export-check", ["issues", "checking", "clean", "error", "invalid"]],
    ["sound-panel", ["simple", "fine"]],
    ["take-picker", ["three", "two", "one", "generating"]],
    ["subtitle-style", ["clear", "bold"]],
    ["cover-editor", ["on", "off", "untitled"]],
  ])("%s renders every example state", (story, states) => {
    for (const state of states) {
      const view = render(<StoryGallery search={`?story=${story}&state=${state}`} />);
      const current = within(screen.getByRole("navigation", { name: "示例状态" })).getByRole(
        "link",
        {
          current: "page",
        },
      );
      expect(current).toHaveAttribute("href", `?story=${story}&state=${state}`);
      view.unmount();
    }
  });
});

describe("example data", () => {
  it("matches the test novel: 65 shots, 4 分 34 秒 with the title card", () => {
    const spans = sampleShotSpans();
    expect(spans).toHaveLength(SCENE_SHOT_SECONDS.flat().length);
    expect(spans).toHaveLength(65);
    expect(spans[0]).toEqual({ id: "scene-1-shot-1", start: TITLE_SECONDS, end: 7 });
    expect(spans.at(-1)?.end).toBe(274);
    const tasks = sampleTasks();
    expect(tasks.filter((task) => task.kind === "video")).toHaveLength(130);
    expect(tasks.filter((task) => task.kind === "image")).toHaveLength(95);
    expect(tasks.filter((task) => task.kind === "voice")).toHaveLength(33);
    expect(tasks.filter((task) => task.status === "uncertain")).toHaveLength(2);
    expect(tasks.filter((task) => task.status === "queued")).toHaveLength(46);
  });

  it("finds one job and requeues the other after the lookup, then starts two", () => {
    const checked = afterCheck(sampleTasks());
    expect(checked.filter((task) => task.status === "requeued")).toHaveLength(1);
    expect(checked.some((task) => task.status === "uncertain")).toBe(false);
    expect(startQueue(checked).filter((task) => task.status === "running")).toHaveLength(2);
  });
});

describe("task center example", () => {
  it("walks through 查一下 → 接着做", () => {
    vi.useFakeTimers();
    render(<TaskCenterStory />);
    fireEvent.click(screen.getByRole("button", { name: "查一下，再接着做" }));
    expect(screen.getByRole("button", { name: "正在查…" })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    fireEvent.click(screen.getByRole("button", { name: "接着做 47 段" }));
    expect(screen.queryByRole("region", { name: "意外关闭后接着做" })).toBeNull();
    expect(screen.getByText("示例里不会真的去做。刚才点了：接着做")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部暂停" }));
    expect(screen.getByText(/刚才点了：全部暂停/)).toBeInTheDocument();
  });

  it("logs retries, removals and the other buttons", () => {
    render(<TaskCenterStory state="checked" />);
    fireEvent.click(screen.getByRole("button", { name: "再试一次" }));
    expect(screen.getByText(/按原样再试 scene-2-shot-21-take-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改描述再试" }));
    expect(screen.getByText(/用建议的描述再试 scene-2-shot-22-take-1/)).toBeInTheDocument();
    const requeued = screen
      .getByRole("button", { name: /第 2 场第 23 个镜头 · B 版/ })
      .closest("li");
    fireEvent.click(within(requeued!).getByRole("button", { name: "移出队列" }));
    expect(screen.getByText(/移出队列 scene-2-shot-23-take-2/)).toBeInTheDocument();
  });

  it("logs the bulk retry, reload and storyboard buttons", () => {
    const first = render(<TaskCenterStory state="running" />);
    fireEvent.click(screen.getByRole("button", { name: "失败的全部重试（2）" }));
    expect(screen.getByText(/失败的全部重试/, { selector: ".nx-story-note" })).toBeInTheDocument();
    first.unmount();
    const second = render(<TaskCenterStory state="error" />);
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(screen.getByText(/重新读取/, { selector: ".nx-story-note" })).toBeInTheDocument();
    second.unmount();
    render(<TaskCenterStory state="empty" />);
    fireEvent.click(screen.getByRole("button", { name: "去分镜" }));
    expect(screen.getByText(/去分镜/, { selector: ".nx-story-note" })).toBeInTheDocument();
  });
});

describe("other examples", () => {
  it("logs 去修 and 直接导出", () => {
    render(<StoryGallery search="?story=export-check" />);
    fireEvent.click(screen.getByRole("button", { name: "去修：这里的画面停住不动了。" }));
    expect(screen.getByText(/去修 freeze-157.90-159.00（regenerate_shot）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "直接导出" }));
    expect(screen.getByText(/刚才点了：直接导出/)).toBeInTheDocument();
  });

  it("changes the mood, volumes and preview in the sound example", () => {
    render(<StoryGallery search="?story=sound-panel&state=fine" />);
    fireEvent.click(screen.getByRole("radio", { name: "平静" }));
    expect(screen.getByText("这个情绪还没有选配乐。")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "这一场的音量" }), {
      target: { value: "0" },
    });
    expect(screen.getByText(/这一场的音量 0（静音）/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: /配乐/ }), { target: { value: "20" } });
    expect(screen.getByText(/配乐 20（给混音的增益 -14.0 dB）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "有人说话时，配乐自动变小" }));
    expect(screen.getByRole("switch", { name: "有人说话时，配乐自动变小" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "试听这一场" }));
    expect(screen.getByText(/刚才点了：试听这一场$/)).toBeInTheDocument();
  });

  it("switches versions in the take example", () => {
    render(<StoryGallery search="?story=take-picker" />);
    fireEvent.click(screen.getByRole("button", { name: "用C 版" }));
    expect(screen.getByText(/用 scene-2-shot-17-take-3/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem", { name: "C 版" })).getByText("正在用这一版"),
    ).toBeInTheDocument();
  });

  it("changes and applies the subtitle style", () => {
    render(<StoryGallery search="?story=subtitle-style" />);
    fireEvent.click(screen.getByRole("radio", { name: /醒目黄字/ }));
    fireEvent.click(screen.getByRole("button", { name: "用这个样式" }));
    expect(screen.getByText(/用这个样式 bold/)).toBeInTheDocument();
  });

  it("edits the cover and logs the mark and save", () => {
    render(<StoryGallery search="?story=cover-editor" />);
    fireEvent.change(screen.getByRole("textbox", { name: "片名" }), {
      target: { value: "灯还亮着" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "副标题" }), {
      target: { value: "第 2 集" },
    });
    expect(within(screen.getByTestId("cover-tall")).getByText("灯还亮着")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "「AI 生成」标识" }));
    expect(screen.getByText(/关掉「AI 生成」标识/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "「AI 生成」标识" }));
    expect(screen.getByText(/打开「AI 生成」标识/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "用这个封面" }));
    expect(screen.getByText(/刚才点了：用这个封面$/)).toBeInTheDocument();
  });
});
