import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryboardContent } from "./adapters/episodeStoryboard";
import { StoryboardTextPreview } from "./StoryboardTextPreview";

const content = {
  fps: 24,
  shots: [
    {
      ordinal: 1,
      duration_frames: 24,
      title: "桥边",
      description: "两人隔河看见彼此",
      camera: "远景",
      action: "停下",
      dialogue: "找到你了",
    },
    {
      ordinal: 2,
      duration_frames: 24,
      title: "",
      description: "",
      camera: "",
      action: "",
      dialogue: "",
    },
  ],
} as StoryboardContent;

afterEach(cleanup);

describe("storyboard text preview", () => {
  it("plays authored text cards and seeks without generating media", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now() + 2000);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    render(<StoryboardTextPreview content={content} />);
    expect(screen.getByText("两人隔河看见彼此")).toBeInTheDocument();
    expect(screen.getByText("机位：远景")).toBeInTheDocument();
    expect(screen.getByText("动作：停下")).toBeInTheDocument();
    expect(screen.getByText("对白：找到你了")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "播放文字预演" }));
    fireEvent.click(screen.getByRole("button", { name: "回到开头" }));
    fireEvent.change(screen.getByLabelText("分镜预演进度"), { target: { value: "30" } });
    expect(screen.getByText("未命名镜头")).toBeInTheDocument();
    expect(screen.getByText("填写画面描述后在这里预演。")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("explains an empty storyboard", () => {
    render(<StoryboardTextPreview content={{ ...content, shots: [] }} />);
    expect(screen.getByText("添加镜头后，可按镜头时长播放文字分镜。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放文字预演" })).toBeDisabled();
  });
});
