import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ProjectData, TaskQueueResponse } from "../../api/studio";
import { TaskQueueWorkspace } from "./TaskQueueWorkspace";

const project = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 1,
  created_at: "2026-08-04T09:00:00Z",
  updated_at: "2026-08-04T09:00:00Z",
} satisfies ProjectData;

const response = {
  data: {
    project_id: project.id,
    summary: { total: 1, attention: 0, active: 1, completed: 0 },
    tasks: [
      {
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
  request_id: "e6225937-1243-427b-bc98-56eda28e9dd3",
} satisfies TaskQueueResponse;

describe("task queue workspace", () => {
  test("shows production identity, exact inputs, checkpoint and honest cost state", async () => {
    render(
      <TaskQueueWorkspace project={project} loadTasks={vi.fn().mockResolvedValue(response)} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在读取制作任务");
    expect(await screen.findByRole("heading", { name: "故事提取" })).toBeInTheDocument();
    expect(screen.getByText("编剧 · 需要先确认原文")).toBeInTheDocument();
    expect(screen.getByText("正在本地执行")).toBeInTheDocument();
    expect(screen.getByText("尝试 1 / 2")).toBeInTheDocument();
    expect(screen.getByText("1 份内容")).toBeInTheDocument();
    expect(screen.getByText(`ver_${"3".repeat(32)}`)).toBeInTheDocument();
    expect(screen.getByText("费用暂未记录")).toBeInTheDocument();
    expect(screen.getByText("2026/08/04 17:31:00")).toBeInTheDocument();
  });

  test("shows an actionable empty state", async () => {
    const empty = structuredClone(response);
    empty.data.tasks = [];
    empty.data.summary = { total: 0, attention: 0, active: 0, completed: 0 };
    render(<TaskQueueWorkspace project={project} loadTasks={vi.fn().mockResolvedValue(empty)} />);

    expect(await screen.findByText("还没有制作任务")).toBeInTheDocument();
    expect(screen.getByText("在故事设定里确认原文后，任务会出现在这里。")).toBeInTheDocument();
  });

  test("keeps the project visible and can retry a failed read", async () => {
    const loadTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response);
    render(<TaskQueueWorkspace project={project} loadTasks={loadTasks} />);

    expect(await screen.findByText("任务队列暂时无法读取")).toBeInTheDocument();
    expect(screen.getByText("雾城来信")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(loadTasks).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "故事提取" })).toBeInTheDocument();
  });

  test("filters tasks without hiding an honest empty result", async () => {
    render(
      <TaskQueueWorkspace project={project} loadTasks={vi.fn().mockResolvedValue(response)} />,
    );
    await screen.findByRole("heading", { name: "故事提取" });

    fireEvent.click(screen.getByRole("button", { name: "需处理" }));
    expect(screen.getByRole("status")).toHaveTextContent("当前筛选条件下没有任务");
    fireEvent.click(screen.getByRole("button", { name: "执行中" }));
    expect(await screen.findByRole("heading", { name: "故事提取" })).toBeInTheDocument();
  });
});
