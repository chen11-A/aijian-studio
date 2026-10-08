import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AssistantPanel } from "./AssistantPanel";
import { DemoApp } from "./DemoApp";
import { EditorDialog } from "./Common";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

type AssistantSeed = {
  messages?: { role: string; text: string }[];
  task?: { id: number; name: string; status: string; page: "story" };
  professional?: boolean;
};

function AssistantSeedState({ seed }: { seed?: AssistantSeed }) {
  const demo = useDemo();
  useEffect(() => {
    if (seed?.messages) demo.setMessages(seed.messages);
    if (seed?.task) demo.setTasks([seed.task]);
    if (seed?.professional) demo.setProfessional(true);
  }, [seed]);
  return null;
}

function AssistantHarness({ seed }: { seed?: AssistantSeed }) {
  const demo = useDemo();
  return (
    <>
      <AssistantSeedState seed={seed} />
      <AssistantPanel />
      <EditorDialog />
      <output aria-label="c19-assistant-state">
        {JSON.stringify({
          draft: demo.aiDraft,
          references: demo.references,
          page: demo.page,
          tasks: demo.tasks,
          professional: demo.professional,
        })}
      </output>
    </>
  );
}
function openAssistant(page = "project", seed?: AssistantSeed) {
  window.history.replaceState({}, "", `#${page}`);
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <AssistantHarness seed={seed} />
    </DemoProvider>,
  );
}
function assistantState() {
  return JSON.parse(screen.getByLabelText("c19-assistant-state").textContent ?? "{}") as {
    draft: string;
    references: string[];
    page: string;
    tasks: { name: string }[];
    professional: boolean;
  };
}

describe("C19 assistant real interaction boundaries", () => {
  it("saves a ctrl-enter draft locally and lets the user inspect its captured context", () => {
    openAssistant("review");
    const input = screen.getByRole("textbox", { name: "AI 输入" });
    fireEvent.change(input, { target: { value: "保留结尾停顿" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(screen.getByText("你 · 本地消息，未发送")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看关联对象与引用" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("发送时的上下文快照");
    expect(screen.getByRole("dialog")).toHaveTextContent("Shot 003 · 似曾相识");
  });

  it("keeps attachment references local, deduplicates them, and allows removal", () => {
    openAssistant();
    const image = new File(["x"], "look.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("AI 图片附件"), { target: { files: [image, image] } });
    expect(assistantState().references).toEqual(["look.png"]);
    fireEvent.click(screen.getByRole("button", { name: "移除引用 look.png" }));
    expect(assistantState().references).toEqual([]);
  });

  it("opens the honest microphone boundary instead of requesting audio access", () => {
    openAssistant();
    fireEvent.click(screen.getByRole("button", { name: "语音输入暂未接入" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "演示版未连接语音服务，也不会请求麦克风权限",
    );
  });

  it("shows review annotations in context and toggles back to the local conversation", () => {
    openAssistant("review");
    fireEvent.click(screen.getByLabelText("上下文"));
    expect(screen.getByText("当前批注")).toBeInTheDocument();
    expect(screen.getByText("此时点无批注")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("上下文"));
    expect(screen.queryByText("当前批注")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "定位当前批注" })).toBeInTheDocument();
  });

  it("keeps non-image attachments in the same local reference list", () => {
    openAssistant();
    const notes = new File(["brief"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("AI 附件"), { target: { files: [notes] } });
    expect(screen.getByRole("button", { name: "移除引用 notes.txt" })).toBeInTheDocument();
  });
  it("uses the composer context control to show the selected project context", () => {
    openAssistant("storyboard");
    fireEvent.click(screen.getByRole("button", { name: "分镜" }));
    expect(screen.getByRole("heading", { name: "当前创作上下文" })).toBeInTheDocument();
    expect(screen.getByText("当前时间")).toBeInTheDocument();
    expect(screen.getByText("引用版本")).toBeInTheDocument();
  });

  it("shows a local session history with the captured reference after an explicit message", () => {
    openAssistant("storyboard");
    fireEvent.click(screen.getByLabelText("上下文"));
    fireEvent.click(screen.getByRole("button", { name: "引用当前对象" }));
    fireEvent.click(screen.getByLabelText("上下文"));
    fireEvent.change(screen.getByRole("textbox", { name: "AI 输入" }), {
      target: { value: "核对这个镜头" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    fireEvent.click(screen.getByLabelText("助手工具"));
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "助手内容" })).getByRole("button", {
        name: "会话历史",
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("核对这个镜头");
    expect(screen.getByRole("dialog")).toHaveTextContent("关联对象");
  });
  it("uses page-specific local context without starting a generation request", () => {
    openAssistant("story");
    expect(screen.getByText(/样例故事已整理为插画、人物、结构与待确认项/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更清楚地说明核心冲突" })).toBeInTheDocument();
    cleanup();
    openAssistant("characters");
    expect(screen.getByText(/三个视角使用同一角色样例/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "侧面发型更利落一些" })).toBeInTheDocument();
  });
  it("keeps tool navigation local and exposes the assistant collapse action", () => {
    openAssistant();
    fireEvent.click(screen.getByLabelText("助手工具"));
    const nav = within(screen.getByRole("navigation", { name: "助手内容" }));
    fireEvent.click(nav.getByRole("button", { name: "切换到建议" }));
    expect(screen.getByRole("heading", { name: "围绕当前创作的建议" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("助手工具"));
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "助手内容" })).getByRole("button", {
        name: "收起助手面板",
      }),
    );
    expect(assistantState().page).toBe("project");
  });

  it("keeps saved assistant suggestions in the local proposal flow", async () => {
    openAssistant("project", { messages: [{ role: "assistant", text: "先核对镜头衔接。" }] });
    await screen.findByText("历史演示说明 · 非实时回复");
    fireEvent.click(screen.getByRole("button", { name: "查看方案" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("AI 修改建议 · 旧演示记录");
    fireEvent.click(screen.getByRole("button", { name: "确认演示方案" }));
    await waitFor(() =>
      expect(assistantState().tasks.map((task) => task.name)).toContain("AI 修改建议 · 旧演示记录"),
    );
  });

  it("records the visible assistant scroll position without sending a request", () => {
    openAssistant();
    const body = document.querySelector<HTMLElement>("[data-scroll-region='ai-chat']")!;
    fireEvent.scroll(body, { target: { scrollTop: 48 } });
    expect(body).toBeInTheDocument();
  });

  it("navigates a local intent and sends professional collapse to the inspector", async () => {
    openAssistant("project", {
      task: { id: 7, name: "核对故事方向", status: "本地意图", page: "story" },
      professional: true,
    });
    fireEvent.click(screen.getByLabelText("助手工具"));
    const nav = within(screen.getByRole("navigation", { name: "助手内容" }));
    fireEvent.click(nav.getByRole("button", { name: "切换到任务" }));
    await screen.findByText("核对故事方向");
    fireEvent.click(screen.getByRole("button", { name: /核对故事方向/ }));
    await waitFor(() => expect(assistantState().page).toBe("story"));
    fireEvent.click(screen.getByLabelText("助手工具"));
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "助手内容" })).getByRole("button", {
        name: "收起助手面板",
      }),
    );
    expect(assistantState().page).toBe("story");
  });
});

describe("C19 workspace controls", () => {
  function openWorkspace(page = "project") {
    window.history.replaceState({}, "", `#${page}`);
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
  }

  it("changes the selected project and episode through the visible workspace controls", () => {
    openWorkspace();
    fireEvent.change(screen.getByLabelText("作品选择"), { target: { value: "2" } });
    expect(document.querySelector(".demo-root")).toHaveAttribute("data-page", "project");
    fireEvent.change(screen.getByLabelText("剧集选择"), { target: { value: "第 2 集 · 回声" } });
    expect(screen.getByLabelText("剧集选择")).toHaveValue("第 2 集 · 回声");
  });

  it("switches professional dock tabs and returns to the normal workspace mode", () => {
    openWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    expect(screen.getByRole("tab", { name: "Inspector" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Aivora AI" }));
    expect(screen.getByRole("tab", { name: "Aivora AI" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "普通模式" }));
    expect(screen.queryByRole("tab", { name: "Inspector" })).not.toBeInTheDocument();
  });

  it("uses the demo dropdown to show a controlled unavailable state and reset its workspace", () => {
    openWorkspace();
    fireEvent.click(screen.getByText("UI 演示 · 样例", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("演示页面"), { target: { value: "services" } });
    fireEvent.change(screen.getByLabelText("页面状态"), { target: { value: "unavailable" } });
    expect(screen.getByRole("status")).toHaveTextContent("正在读取安全配置…");
    fireEvent.click(screen.getByRole("button", { name: "重置演示" }));
    expect(document.querySelector(".demo-root")).toHaveAttribute("data-page", "project");
  });

  it("moves focus to main content and routes the service indicator through the local shell", () => {
    openWorkspace();
    fireEvent.click(screen.getByRole("link", { name: "跳到主要内容" }));
    expect(document.getElementById("demo-scroll")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "未连接真实服务" }));
    expect(document.querySelector(".demo-root")).toHaveAttribute("data-page", "services");
  });

  it("opens the local notification dialog when no task notification exists", () => {
    openWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "暂无新通知。这里会展示本次演示中的任务进度。",
    );
  });

  it("expands the management assistant rail without changing the global page", () => {
    openWorkspace("home");
    expect(document.querySelector(".demo-root")).toHaveAttribute("data-page", "home");
    fireEvent.click(screen.getByRole("button", { name: "展开 AI 助手" }));
    expect(document.querySelector(".demo-root")).toHaveClass("has-rail");
    expect(document.querySelector(".demo-root")).toHaveAttribute("data-page", "home");
  });

  it("keeps project-only pages behind the selected-project boundary", () => {
    const fixture = createAivoraSampleFixture();
    fixture.projects = [];
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={fixture} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "尚未选择真实项目。创建或选择项目后，才会读取此页面的内容。",
    );
    expect(document.querySelector(".demo-root")).toHaveClass("management-shell");
  });
});
