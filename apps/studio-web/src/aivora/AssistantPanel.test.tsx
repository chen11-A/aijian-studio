import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AssistantPanel } from "./AssistantPanel";
import { EditorDialog } from "./Common";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "./model";
import type { TaskQueueResponse } from "../api/studio";

afterEach(() => {
  cleanup();
  delete window.aijian;
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function Harness() {
  const demo = useDemo();
  return (
    <>
      <AssistantPanel />
      <EditorDialog />
      <output aria-label="assistant-state">
        {JSON.stringify({
          draft: demo.aiDraft,
          messages: demo.messages,
          references: demo.references,
          page: demo.page,
        })}
      </output>
    </>
  );
}

function state() {
  return JSON.parse(screen.getByLabelText("assistant-state").textContent ?? "{}") as {
    draft: string;
    messages: { role: string; text: string }[];
    references: string[];
    page: string;
  };
}

function showTasks() {
  fireEvent.click(screen.getByLabelText("助手工具"));
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "助手内容" })).getByRole("button", {
      name: "切换到任务",
    }),
  );
}
function open() {
  window.history.replaceState({}, "", "#project");
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <Harness />
    </DemoProvider>,
  );
}

describe("assistant panel local-only interaction", () => {
  it("copies a suggestion into the draft and saves it as a local message", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "解释当前对象" }));
    expect(screen.getByRole("textbox", { name: "AI 输入" })).toHaveValue("解释当前对象");
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(state()).toMatchObject({
      draft: "",
      messages: [{ role: "user", text: "解释当前对象" }],
    });
    expect(screen.getByText("你 · 本地消息，未发送")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看关联对象与引用" })).toBeInTheDocument();
  });

  it("keeps references in local context and exposes the empty task and page context views", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "上下文" }));
    expect(screen.getByRole("heading", { name: "当前创作上下文" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "引用当前对象" }));
    expect(state().references).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("助手工具"));
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "助手内容" })).getByRole("button", {
        name: "切换到任务",
      }),
    );
    expect(
      screen.getByText("当前项目尚未连接本地工作区；不会读取或创建制作任务。"),
    ).toBeInTheDocument();
  });

  it("adds a chosen reference through the local editor without contacting an AI service", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "引用素材" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("引用演示素材");
    fireEvent.change(screen.getByLabelText("选择素材"), { target: { value: "城市全景" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(state().references).toEqual(["城市全景"]);
    expect(screen.getByRole("button", { name: "移除引用 城市全景" })).toBeInTheDocument();
  });
});

const remoteProjectId = `prj_${"a".repeat(32)}`;
const remoteQueue = {
  data: {
    project_id: remoteProjectId,
    summary: { total: 1, attention: 0, active: 1, completed: 0 },
    tasks: [
      {
        proposal_id: null,
        node: {
          workflow_run_id: `wfr_${"1".repeat(32)}`,
          node_run_id: `node_${"2".repeat(32)}`,
          node_key: "story.extract",
          node_type: "story.extract",
          status: "RUNNING",
          responsible_role: "编剧",
          upstream_gate: "G1",
          input_hash: `sha256:${"b".repeat(64)}`,
          input_version_ids: [`ver_${"3".repeat(32)}`],
          output_version_id: null,
          attempt_count: 1,
          max_attempts: 2,
          updated_at: "2026-08-04T09:31:00Z",
        },
        attempt: {
          attempt_id: `att_${"4".repeat(32)}`,
          number: 1,
          execution_mode: "local",
          status: "RUNNING",
          provider_model: null,
          provider_job_id: null,
          retry_disposition: null,
          error_code: null,
          output_version_id: null,
          started_at: "2026-08-04T09:30:00Z",
          finished_at: null,
          updated_at: "2026-08-04T09:31:00Z",
        },
        task: {
          task_id: `task_${"5".repeat(32)}`,
          kind: "local.story.extract",
          status: "LEASED",
          priority: 70,
          available_at: "2026-08-04T09:30:00Z",
          lease_generation: 1,
          lease_expires_at: "2026-08-04T09:32:00Z",
          heartbeat_at: "2026-08-04T09:31:00Z",
          updated_at: "2026-08-04T09:31:00Z",
        },
        cost: {
          status: "NOT_RECORDED",
          currency: null,
          reserved: null,
          accrued: null,
          billed: null,
          budget_limit: null,
          retry_increment_limit: null,
        },
        presentation: {
          status_label: "正在本地执行",
          next_action_label: "查看最近检查点",
          allowed_actions: ["VIEW_DETAILS"],
        },
      },
    ],
  },
  request_id: "req_queue",
} as unknown as TaskQueueResponse;
function openRemote(listTasks = vi.fn().mockResolvedValue(remoteQueue), projects = true) {
  const project = {
    id: remoteProjectId,
    name: "雾城来信",
    aspect_ratio: "9:16",
    target_duration_seconds: 90,
    source_language: "zh-CN",
    status: "active",
    revision: 1,
    created_at: "2026-08-04T09:00:00Z",
    updated_at: "2026-08-04T09:00:00Z",
  };
  window.aijian = {
    health: vi.fn().mockResolvedValue({ status: "ok" }),
    listProjects: vi
      .fn()
      .mockResolvedValue({ data: projects ? [project] : [], request_id: "req_projects" }),
    listSources: vi.fn().mockResolvedValue({ data: [], request_id: "req_sources" }),
    listProviderConnections: vi.fn().mockResolvedValue({ data: [], request_id: "req_providers" }),
    listProjectTasks: listTasks,
  } as unknown as Window["aijian"];
  const sample = createAivoraSampleFixture();
  render(
    <DemoProvider
      fixture={{
        ...sample,
        projects: projects ? [{ ...sample.projects[0]!, backendId: remoteProjectId }] : [],
        values: {
          ...sample.values,
          projectId: projects ? "1" : "",
          title: projects ? "雾城来信" : "",
        },
      }}
    >
      <Harness />
    </DemoProvider>,
  );
  return listTasks;
}

describe("real task queue in the assistant", () => {
  it("does not read a queue without a real project", async () => {
    const listTasks = openRemote(vi.fn(), false);
    showTasks();
    await screen.findByText("当前项目尚未连接本地工作区；不会读取或创建制作任务。");
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("shows real task identity, exact inputs, honest cost, and filter empty state", async () => {
    const listTasks = openRemote();
    showTasks();
    expect(await screen.findByText("故事提取 · 正在本地执行")).toBeInTheDocument();
    expect(screen.getByText(`task_${"5".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText(`ver_${"3".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText(/编剧 · 上游 G1 · 尝试 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText("成本：未知，成本账本尚未接入")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "需处理" }));
    expect(screen.getByText("当前筛选条件下没有任务")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "执行中" }));
    await waitFor(() => expect(screen.getByText("故事提取 · 正在本地执行")).toBeInTheDocument());
    expect(listTasks).toHaveBeenCalledWith(remoteProjectId);
  });

  it("keeps the queue unreadable error explicit and retries the same real project", async () => {
    const listTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(remoteQueue);
    openRemote(listTasks);
    showTasks();

    expect(await screen.findByRole("alert")).toHaveTextContent("任务队列暂时无法读取。");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("故事提取 · 正在本地执行")).toBeInTheDocument();
    expect(listTasks).toHaveBeenNthCalledWith(1, remoteProjectId);
    expect(listTasks).toHaveBeenNthCalledWith(2, remoteProjectId);
  });
});
