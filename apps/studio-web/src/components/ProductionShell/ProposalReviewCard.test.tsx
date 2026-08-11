import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ArtifactProposalResponse, TaskQueueResponse } from "../../api/studio";
import { ProposalReviewCard } from "./ProposalReviewCard";

const projectId = `prj_${"1".repeat(32)}`;
const proposalId = `prp_${"2".repeat(32)}`;
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";

function queue(status: "NEEDS_REVIEW" | "SUCCEEDED" = "NEEDS_REVIEW"): TaskQueueResponse {
  return {
    data: {
      project_id: projectId,
      summary: { total: 1, attention: 0, active: 0, completed: status === "SUCCEEDED" ? 1 : 0 },
      tasks: [
        {
          proposal_id: proposalId,
          node: {
            workflow_run_id: `wfr_${"3".repeat(32)}`,
            node_run_id: `node_${"4".repeat(32)}`,
            node_key: "source.extract",
            node_type: "source.extract",
            status,
            responsible_role: "编剧 Agent",
            upstream_gate: "G1",
            input_hash: `sha256:${"5".repeat(64)}`,
            input_version_ids: [`ver_${"6".repeat(32)}`],
            output_version_id: status === "SUCCEEDED" ? `ver_${"7".repeat(32)}` : null,
            attempt_count: 1,
            max_attempts: 2,
            updated_at: "2026-08-11T09:00:00Z",
          },
          attempt: {
            attempt_id: `att_${"8".repeat(32)}`,
            number: 1,
            execution_mode: "local",
            status: status === "SUCCEEDED" ? "SUCCEEDED" : "RUNNING",
            provider_model: null,
            provider_job_id: null,
            retry_disposition: null,
            error_code: null,
            output_version_id: status === "SUCCEEDED" ? `ver_${"7".repeat(32)}` : null,
            started_at: "2026-08-11T08:59:00Z",
            finished_at: status === "SUCCEEDED" ? "2026-08-11T09:00:00Z" : null,
            updated_at: "2026-08-11T09:00:00Z",
          },
          task: {
            task_id: `task_${"9".repeat(32)}`,
            kind: "local.source.extract",
            status: "COMPLETED",
            priority: 70,
            available_at: "2026-08-11T08:58:00Z",
            lease_generation: 1,
            lease_expires_at: null,
            heartbeat_at: null,
            updated_at: "2026-08-11T09:00:00Z",
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
            status_label: "等待人工审阅",
            next_action_label: "查看提案",
            allowed_actions: ["VIEW_DETAILS"],
          },
        },
      ],
    },
    request_id: requestId,
  };
}

const proposal = {
  data: {
    project_id: projectId,
    proposal_id: proposalId,
    producer_attempt_id: `att_${"8".repeat(32)}`,
    proposal_hash: `sha256:${"a".repeat(64)}`,
    created_at: "2026-08-11T09:00:00Z",
    proposal: {
      schema_version: "1.0.0",
      proposal_id: proposalId,
      project_id: projectId,
      target_artifact_type: "SourceExtraction",
      payload: { summary: "从原文提取一条可审阅事件" },
      payload_hash: `sha256:${"b".repeat(64)}`,
      source_spans: [
        {
          source_span_id: `spn_${"c".repeat(32)}`,
          source_document_id: `src_${"d".repeat(32)}`,
          source_block_id: `srcb_${"e".repeat(32)}`,
          start_byte: 0,
          end_byte: 24,
          claim: "林见收到一封未署名的信",
          quote_hash: `sha256:${"f".repeat(64)}`,
        },
      ],
      claims: [],
      diff: [{ op: "add", path: "/events/0", value: "收到未署名来信" }],
      dependencies: [],
      impacts: [{ artifact_type: "SourceExtraction", artifact_id: null, impact: "CREATE" }],
      cost: { currency: "USD", estimated_micros: 0, actual_micros: 0 },
      confidence_basis_points: 9000,
      capability_losses: [],
      qc: [{ check_id: "source-span.required", status: "PASS", details: "证据已绑定" }],
      producer_agent_run_id: `agr_${"1".repeat(32)}`,
      producer_skill_run_id: `skr_${"2".repeat(32)}`,
    },
  },
  request_id: requestId,
} satisfies ArtifactProposalResponse;

describe("proposal review card", () => {
  test("renders a real review proposal with evidence, change and cost summaries", async () => {
    const listTasks = vi.fn().mockResolvedValue(queue());
    render(
      <ProposalReviewCard
        projectId={projectId}
        listTasks={listTasks}
        getProposal={vi.fn().mockResolvedValue(proposal)}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在读取 AI 提案");
    expect(await screen.findByRole("heading", { name: "来源提取提案" })).toBeInTheDocument();
    expect(screen.getByText("从原文提取一条可审阅事件")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("1 条")).toBeInTheDocument();
    expect(screen.getByText("林见收到一封未署名的信")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新待审提案" }));
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /接受|退回/ })).not.toBeInTheDocument();
  });

  test("keeps completed proposals out of the pending review card", async () => {
    const getProposal = vi.fn();
    render(
      <ProposalReviewCard
        projectId={projectId}
        listTasks={vi.fn().mockResolvedValue(queue("SUCCEEDED"))}
        getProposal={getProposal}
      />,
    );

    expect(await screen.findByText("暂无待审提案")).toBeInTheDocument();
    expect(getProposal).not.toHaveBeenCalled();
  });

  test("shows an actionable error state and retries the same project", async () => {
    const listTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(queue());
    render(
      <ProposalReviewCard
        projectId={projectId}
        listTasks={listTasks}
        getProposal={vi.fn().mockResolvedValue(proposal)}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("提案暂时无法读取");
    fireEvent.click(screen.getByRole("button", { name: "重新读取提案" }));
    expect(await screen.findByRole("heading", { name: "来源提取提案" })).toBeInTheDocument();
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2));
  });

  test("does not report a quality check that has not run as passed", async () => {
    const pendingQc = {
      ...proposal,
      data: {
        ...proposal.data,
        proposal: {
          ...proposal.data.proposal,
          qc: [{ check_id: "source-span.required", status: "NOT_RUN" as const, details: "待执行" }],
        },
      },
    } satisfies ArtifactProposalResponse;
    render(
      <ProposalReviewCard
        projectId={projectId}
        listTasks={vi.fn().mockResolvedValue(queue())}
        getProposal={vi.fn().mockResolvedValue(pendingQc)}
      />,
    );

    expect(await screen.findByText("未运行")).toHaveClass("qc-pending");
    expect(screen.queryByText("已通过")).not.toBeInTheDocument();
  });

  test("ignores a stale task response after switching projects", async () => {
    const nextProjectId = `prj_${"3".repeat(32)}`;
    let resolveFirst: ((value: TaskQueueResponse) => void) | undefined;
    const firstQueue = new Promise<TaskQueueResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const nextQueue = {
      ...queue(),
      data: { ...queue().data, project_id: nextProjectId },
    } satisfies TaskQueueResponse;
    const listTasks = vi.fn((requestedProjectId: string) =>
      requestedProjectId === projectId ? firstQueue : Promise.resolve(nextQueue),
    );
    const getProposal = vi.fn().mockResolvedValue(proposal);
    const view = render(
      <ProposalReviewCard projectId={projectId} listTasks={listTasks} getProposal={getProposal} />,
    );

    view.rerender(
      <ProposalReviewCard
        projectId={nextProjectId}
        listTasks={listTasks}
        getProposal={getProposal}
      />,
    );
    expect(await screen.findByRole("heading", { name: "来源提取提案" })).toBeInTheDocument();
    resolveFirst?.(queue());
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2));
    expect(getProposal).toHaveBeenCalledTimes(1);
    expect(getProposal).toHaveBeenCalledWith(nextProjectId, proposalId);
  });
});
