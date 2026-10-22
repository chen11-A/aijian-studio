import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DemoApp } from "./DemoApp";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";
import { SAMPLE_LINE, SAMPLE_SCENE, ShortFilmGuide } from "./ShortFilmGuide";

const PROJECT_ID = `prj_${"b".repeat(32)}`;

afterEach(() => {
  cleanup();
  delete window.aijian;
  window.localStorage.clear();
});

function Harness() {
  const demo = useDemo();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    demo.go("project");
  }, [demo]);
  return (
    <>
      <div aria-label="guide-state">{`${demo.page}:${demo.professional ? "pro" : "simple"}`}</div>
      <ShortFilmGuide />
    </>
  );
}

function connectedBridge(createStoryFilm: unknown) {
  window.aijian = {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "test" },
    }),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: PROJECT_ID,
          name: "雾城来信",
          status: "active",
          revision: 1,
          updated_at: "2026-10-22T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    createStoryFilm,
  } as unknown as Window["aijian"];
}

describe("simple story-to-film navigation", () => {
  it("shows the four steps and a provider choice, and keeps the full nav behind professional mode", () => {
    window.history.replaceState({}, "", "#project");
    render(<DemoApp />);
    const stages = screen.getByRole("navigation", { name: "创作阶段" });
    expect(within(stages).getByRole("button", { name: "故事" })).toBeInTheDocument();
    expect(within(stages).queryByRole("button", { name: "分镜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分镜" })).not.toBeInTheDocument();
    fireEvent.click(within(stages).getByRole("button", { name: "画面" }));
    const provider = screen.getByRole("combobox", { name: "用什么生成" });
    expect(within(provider).getAllByRole("option").length).toBeGreaterThan(1);
    expect(within(provider).getByRole("option", { name: /本地占位/ })).toBeInTheDocument();
    expect(screen.getAllByText(/不花钱/).length).toBeGreaterThan(0);
    fireEvent.click(
      within(screen.getByLabelText("短片向导")).getByRole("button", { name: "专业模式" }),
    );
    expect(screen.getByRole("button", { name: "分镜" })).toBeInTheDocument();
  });

  it("keeps the full navigation in the fixture without professional mode", () => {
    window.history.replaceState({}, "", "#project");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    expect(screen.getByRole("button", { name: "分镜" })).toBeInTheDocument();
    expect(screen.queryByLabelText("短片向导")).not.toBeInTheDocument();
  });

  it("walks every step and explains that the web preview cannot export", () => {
    render(
      <DemoProvider>
        <Harness />
      </DemoProvider>,
    );
    const guide = screen.getByLabelText("短片向导");
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
        name: "成片",
      }),
    );
    expect(within(guide).getByText(/大约两秒的草稿视频/)).toBeInTheDocument();
    fireEvent.click(within(guide).getByRole("button", { name: "上一步" }));
    fireEvent.change(screen.getByLabelText("旁白"), { target: { value: "信从雾里来" } });
    fireEvent.change(screen.getByLabelText("字幕"), { target: { value: "雾城来信" } });
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "开始做成片" }));
    expect(within(guide).getByRole("status")).toHaveTextContent("网页预览不能生成成片");
    fireEvent.click(within(guide).getByRole("button", { name: "回首页开始" }));
    expect(screen.getByLabelText("guide-state")).toHaveTextContent("home:simple");
    fireEvent.click(within(guide).getByRole("button", { name: "专业模式" }));
    expect(screen.getByLabelText("guide-state")).toHaveTextContent("home:pro");
  });

  it("confirms a metered call, then saves a stub film with picture and sound", async () => {
    const createStoryFilm = vi.fn(async (_projectId: string, input: { provider: string }) => {
      if (input.provider === "xai_api_key") {
        return {
          data: {
            status: "BLOCKED",
            message: "先确认再花钱。",
            fix: "可以改用本地占位。",
            suggested_provider: "stub",
          },
        };
      }
      if (input.provider === "chatgpt") {
        return {
          data: {
            status: "BLOCKED",
            message: "",
            fix: "ChatGPT 不能生成画面。",
            suggested_provider: "grok_subscription",
          },
        };
      }
      return {
        data: {
          status: "SUCCEEDED",
          message: "草稿成片已经保存。",
          output_path: "/tmp/wucheng-draft.mp4",
          duration_seconds: "2.000000",
          has_video: true,
          has_audio: true,
        },
      };
    });
    connectedBridge(createStoryFilm);
    render(
      <DemoProvider>
        <Harness />
      </DemoProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByText(/还没有保存到电脑上的作品/)).not.toBeInTheDocument(),
    );
    const guide = screen.getByLabelText("短片向导");
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "灯塔夜班" } });
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.change(screen.getByLabelText("用什么生成"), { target: { value: "xai_api_key" } });
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.change(screen.getByLabelText("旁白"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("字幕"), { target: { value: "  雾城来信  " } });
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "确认花钱并继续" }));
    expect(await within(guide).findByRole("status")).toHaveTextContent("先确认再花钱");
    expect(screen.getByText("可以改用本地占位。")).toBeInTheDocument();
    fireEvent.click(within(guide).getByRole("button", { name: "上一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "上一步" }));
    fireEvent.change(screen.getByLabelText("用什么生成"), { target: { value: "chatgpt" } });
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "开始做成片" }));
    expect(await screen.findByText("ChatGPT 不能生成画面。")).toBeInTheDocument();
    fireEvent.click(within(guide).getByRole("button", { name: "上一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "上一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "上一步" }));
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "   " } });
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.change(screen.getByLabelText("用什么生成"), { target: { value: "stub" } });
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "开始做成片" }));
    expect(await screen.findByText(/有画面也有声音/)).toBeInTheDocument();
    expect(screen.getByText(/\/tmp\/wucheng-draft\.mp4/)).toBeInTheDocument();
    expect(createStoryFilm).toHaveBeenLastCalledWith(PROJECT_ID, {
      scene_label: SAMPLE_SCENE,
      narration: SAMPLE_LINE,
      subtitle: "雾城来信",
      provider: "stub",
      confirmed: false,
      voice_id: "eve",
    });
  });

  it("keeps a failed export in the guide and omits a path when none was saved", async () => {
    const createStoryFilm = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: { status: "SUCCEEDED", message: "做好了", has_video: false, has_audio: true },
      });
    connectedBridge(createStoryFilm);
    render(
      <DemoProvider>
        <Harness />
      </DemoProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByText(/还没有保存到电脑上的作品/)).not.toBeInTheDocument(),
    );
    const guide = screen.getByLabelText("短片向导");
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "下一步" }));
    fireEvent.click(within(guide).getByRole("button", { name: "开始做成片" }));
    expect(await within(guide).findByRole("status")).toHaveTextContent("成片没有做完");
    fireEvent.click(within(guide).getByRole("button", { name: "开始做成片" }));
    expect(await within(guide).findByRole("status")).toHaveTextContent("做好了");
    expect(screen.queryByText(/文件在本机/)).not.toBeInTheDocument();
  });
});
