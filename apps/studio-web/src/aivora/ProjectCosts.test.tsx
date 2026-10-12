import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TaskQueueResponse } from "../api/studio";
import { useTaskQueue } from "../domain/use-task-queue";
import { ProjectCosts } from "./ProjectCosts";

const projectA = `prj_${"1".repeat(32)}`,
  projectB = `prj_${"2".repeat(32)}`;
function response(
  projectId: string,
  status: "REMOTE_UNKNOWN" | "SUCCEEDED" | "CANCELLED" = "REMOTE_UNKNOWN",
): TaskQueueResponse {
  return {
    request_id: "00000000-0000-4000-8000-000000000001",
    data: {
      project_id: projectId,
      summary: { total: 1, active: 0, attention: 1, completed: 0 },
      tasks: [
        {
          proposal_id: null,
          node: {
            workflow_run_id: `wfr_${"3".repeat(32)}`,
            node_run_id: `node_${"4".repeat(32)}`,
            node_key: "story.extract",
            node_type: "story.extract",
            status: "RECONCILIATION_REQUIRED",
            responsible_role: "编剧",
            upstream_gate: "G1",
            input_hash: `sha256:${"5".repeat(64)}`,
            input_version_ids: [`ver_${"6".repeat(32)}`],
            output_version_id: null,
            attempt_count: 1,
            max_attempts: 1,
            updated_at: "2026-10-11T00:00:00Z",
          },
          attempt: {
            attempt_id: `att_${"7".repeat(32)}`,
            number: 1,
            execution_mode: "remote",
            status,
            provider_model: "configured-model",
            provider_job_id: null,
            retry_disposition: "REMOTE_UNKNOWN",
            error_code: null,
            output_version_id: null,
            started_at: null,
            finished_at: null,
            updated_at: "2026-10-11T00:00:00Z",
          },
          task: {
            task_id: `task_${projectId.slice(4)}`,
            kind: "remote.story.extract",
            status: "COMPLETED",
            priority: 50,
            available_at: "2026-10-11T00:00:00Z",
            lease_generation: 1,
            lease_expires_at: null,
            heartbeat_at: null,
            updated_at: "2026-10-11T00:00:00Z",
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
            status_label: "需要核对供应商任务",
            next_action_label: "查看证据，禁止重复提交",
            allowed_actions: ["VIEW_DETAILS"],
          },
        },
      ],
    },
  };
}
function Harness({
  projectId,
  loadTasks,
}: {
  projectId: string;
  loadTasks: (id: string) => Promise<TaskQueueResponse>;
}) {
  const queue = useTaskQueue({ projectId, loadTasks });
  return <ProjectCosts projectId={projectId} queue={queue} />;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["REMOTE_UNKNOWN", "SUCCEEDED", "CANCELLED"] as const)(
  "keeps unrecorded amounts unknown after %s without granting retry or budget",
  async (status) => {
    const loadTasks = vi.fn(async () => response(projectA, status));
    render(<Harness projectId={projectA} loadTasks={loadTasks} />);
    await screen.findByText(`task_${projectA.slice(4)}`);
    expect(screen.getByText("configured-model")).toBeInTheDocument();
    expect(screen.getAllByText("未知").length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText(/0\.00|￥|¥/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预算设置待接入" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /重试|提交|批准/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取项目任务账本（只读）" }));
    expect(loadTasks).toHaveBeenCalledTimes(2);
  },
);
it("has separate unconfigured, empty, failed and wrong-project states", async () => {
  const loadTasks = vi.fn(async () => response(projectA));
  const result = render(<Harness projectId="" loadTasks={loadTasks} />);
  expect(screen.getByText(/先选择真实作品/)).toBeInTheDocument();
  expect(loadTasks).not.toHaveBeenCalled();
  result.rerender(<Harness projectId={projectB} loadTasks={loadTasks} />);
  await screen.findByText(/项目任务账本未可靠读回/);
  expect(screen.queryByText(`task_${projectA.slice(4)}`)).not.toBeInTheDocument();
  loadTasks.mockResolvedValue({
    ...response(projectB),
    data: {
      ...response(projectB).data,
      tasks: [],
      summary: { total: 0, active: 0, attention: 0, completed: 0 },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "重新读取项目任务账本（只读）" }));
  await screen.findByText(/尚无任务记录.*不代表费用为零/);
  loadTasks.mockRejectedValueOnce(Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "重新读取项目任务账本（只读）" }));
  await screen.findByText(/项目任务账本未可靠读回/);
});
it("ignores late A readback after A→B→A", async () => {
  let complete!: (value: TaskQueueResponse) => void;
  const loadTasks = vi
    .fn<(id: string) => Promise<TaskQueueResponse>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(response(projectB))
    .mockResolvedValueOnce(response(projectA));
  const result = render(<Harness projectId={projectA} loadTasks={loadTasks} />);
  result.rerender(<Harness projectId={projectB} loadTasks={loadTasks} />);
  await screen.findByText(`task_${projectB.slice(4)}`);
  result.rerender(<Harness projectId={projectA} loadTasks={loadTasks} />);
  await screen.findByText(`task_${projectA.slice(4)}`);
  const obsolete = response(projectA);
  obsolete.data.tasks[0]!.attempt.provider_model = "obsolete-model";
  await act(async () => complete(obsolete));
  expect(screen.queryByText("obsolete-model")).not.toBeInTheDocument();
  expect(screen.queryByText(`task_${projectB.slice(4)}`)).not.toBeInTheDocument();
});
