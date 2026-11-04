import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoverEditor } from "../CoverEditor";
import { SubtitleStyle } from "../SubtitleStyle";
import { coverEditorData } from "./coverEditor";
import { SAMPLE_PROJECT, sampleProjectJson } from "./sampleProject";
import { subtitleStyleData } from "./subtitleStyle";

function edited(change: (project: typeof SAMPLE_PROJECT) => void): unknown {
  const project = JSON.parse(JSON.stringify(SAMPLE_PROJECT)) as typeof SAMPLE_PROJECT;
  change(project);
  return project;
}

describe("subtitleStyleData", () => {
  it("previews the first line of dialogue and chooses no style for the user", () => {
    expect(subtitleStyleData(sampleProjectJson())).toEqual({
      ok: true,
      props: {
        value: "",
        sampleLine: "打烊了。要买书的话，明天来吧，全场五折。",
        sampleSource: "第 1 场第 2 个镜头",
      },
      missing: [],
    });
    const picked = subtitleStyleData(sampleProjectJson(), { value: "bold" });
    expect(picked.ok && picked.props.value).toBe("bold");
  });

  it("says there is nothing to preview without dialogue", () => {
    const silent = edited((project) => {
      for (const shot of project.shots) shot.line = " ";
    });
    expect(subtitleStyleData(silent)).toEqual({
      ok: false,
      empty: { title: "还没有台词", detail: "拆好镜头、写上台词以后，才能看到字幕的样子。" },
      missing: [],
    });
    expect(subtitleStyleData(null)).toMatchObject({
      ok: false,
      empty: { title: "作品记录读不出来" },
    });
  });

  it("gives SubtitleStyle a line and waits for a choice", () => {
    const adapted = subtitleStyleData(sampleProjectJson());
    if (!adapted.ok) throw new Error("no line");
    render(<SubtitleStyle {...adapted.props} onChange={vi.fn()} onApply={vi.fn()} />);
    expect(screen.getByTestId("wide-line")).toHaveTextContent(
      "打烊了。要买书的话，明天来吧，全场五折。",
    );
    expect(screen.getByRole("button", { name: "用这个样式" })).toBeDisabled();
  });
});

describe("coverEditorData", () => {
  it("uses the work's name, the episode and the first still the export uses", () => {
    expect(
      coverEditorData(sampleProjectJson(), { mediaUrl: (path) => `img:${path.slice(-12)}` }),
    ).toEqual({
      ok: true,
      props: { title: "雨夜旧书店", subtitle: "第 1 集", backgroundUrl: "img:/s1-1-t2.png" },
      missing: [],
    });
  });

  it("does not put the placeholder name on a cover", () => {
    const blank = edited((project) => {
      project.seriesTitle = "未命名作品";
      project.title = "未命名作品";
      project.episodeTitle = "";
      for (const shot of project.shots) {
        shot.takes = [];
        shot.poster = "";
      }
      project.shots[2]!.stills = [{ id: "a", prompt: "", url: "https://x/still.png" }];
    });
    expect(coverEditorData(blank)).toEqual({
      ok: true,
      props: { title: "", backgroundUrl: "https://x/still.png" },
      missing: [],
    });
    const bare = edited((project) => {
      project.shots = [];
    });
    const adapted = coverEditorData(bare);
    expect(adapted.ok && adapted.props.backgroundUrl).toBeUndefined();
    expect(coverEditorData("x")).toMatchObject({ ok: false });
  });

  it("gives CoverEditor a title with the 「AI 生成」 mark on by default", () => {
    const adapted = coverEditorData(sampleProjectJson(), { mediaUrl: () => "" });
    if (!adapted.ok) throw new Error("unreadable");
    render(<CoverEditor {...adapted.props} onTitleChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "片名" })).toHaveValue("雨夜旧书店");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});
