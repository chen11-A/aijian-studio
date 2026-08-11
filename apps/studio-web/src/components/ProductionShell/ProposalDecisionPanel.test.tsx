import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ProposalDecisionCapability } from "../../api/studio";
import { ProposalDecisionPanel } from "./ProposalDecisionPanel";

const projectId = `prj_${"1".repeat(32)}`;
const proposalId = `prp_${"2".repeat(32)}`;
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";

function capability(): ProposalDecisionCapability {
  return {
    acceptAsDraft: vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      receipt: {
        data: {
          acceptance_id: `pda_${"3".repeat(32)}`,
          project_id: projectId,
          proposal_id: proposalId,
          draft_version_id: `ver_${"4".repeat(32)}`,
          actor_id: "local-reviewer",
          accepted_as_draft_at: "2026-08-11T09:05:00Z",
          replayed: false,
        },
        request_id: requestId,
      },
    }),
    reject: vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      receipt: {
        data: {
          rejection_id: `pdr_${"5".repeat(32)}`,
          project_id: projectId,
          proposal_id: proposalId,
          proposal_hash: `sha256:${"6".repeat(64)}`,
          reason_code: "SOURCE_EVIDENCE",
          comment: "原文证据不足。",
          actor_id: "local-reviewer",
          rejected_at: "2026-08-11T09:06:00Z",
          replayed: false,
        },
        request_id: requestId,
      },
    }),
  };
}

function panel(decisions: ProposalDecisionCapability | null = capability()) {
  return (
    <ProposalDecisionPanel
      projectId={projectId}
      proposalId={proposalId}
      targetArtifactType="SourceExtraction"
      capability={decisions ?? undefined}
      onRefresh={vi.fn()}
    />
  );
}

describe("proposal decision panel", () => {
  test("does not expose a write control without the Electron capability", () => {
    render(panel(null));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("keeps the Electron capability read-only at the 390px review viewport", () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      render(panel(capability()));
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });

  test("limits the current acceptance slice to source extraction", () => {
    render(
      <ProposalDecisionPanel
        projectId={projectId}
        proposalId={proposalId}
        targetArtifactType="Screenplay"
        capability={capability()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("当前切片仅支持来源提取提案的决定操作。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /接受|退回/ })).not.toBeInTheDocument();
  });

  test("confirms that acceptance creates only a draft and preserves the receipt", async () => {
    const decisions = capability();
    render(panel(decisions));

    fireEvent.click(screen.getByRole("button", { name: "接受为 DRAFT" }));
    const confirmationTitle = screen.getByText("接受为 DRAFT？");
    expect(confirmationTitle).toHaveFocus();
    expect(screen.getByText(/不批准、不发布、不推进 Gate/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认创建 DRAFT" }));

    expect(await screen.findByText("已创建不可变 DRAFT")).toBeInTheDocument();
    expect(screen.getByText(/尚未批准、发布或推进 Gate/)).toBeInTheDocument();
    expect(decisions.acceptAsDraft).toHaveBeenCalledWith(projectId, proposalId, {
      parent_version_id: null,
      expected_head_revision: null,
    });
  });

  test("requires and normalizes a named rejection comment", async () => {
    const decisions = capability();
    render(panel(decisions));
    fireEvent.click(screen.getByRole("button", { name: "退回并填写意见" }));
    expect(screen.getByText("具名退回提案")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "确认具名退回" }));
    expect(screen.getByText("请填写具体退回意见。")).toBeInTheDocument();
    const commentField = screen.getByLabelText("退回意见");
    expect(commentField).toHaveFocus();
    expect(commentField).toHaveAttribute("aria-describedby", "proposal-rejection-comment-error");

    fireEvent.change(commentField, {
      target: { value: "  原文证据不足。\r\n  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认具名退回" }));
    expect(await screen.findByText("已记录具名退回")).toBeInTheDocument();
    expect(screen.getByText(/按 原文证据 退回/)).toBeInTheDocument();
    expect(screen.getByText(/不会自动重生成/)).toBeInTheDocument();
    expect(decisions.reject).toHaveBeenCalledWith(projectId, proposalId, {
      reason_code: "SOURCE_EVIDENCE",
      comment: "原文证据不足。",
    });
  });

  test("retries a remote-unknown decision with the exact frozen payload", async () => {
    const decisions = capability();
    vi.mocked(decisions.acceptAsDraft)
      .mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" })
      .mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    render(panel(decisions));
    fireEvent.click(screen.getByRole("button", { name: "接受为 DRAFT" }));
    fireEvent.click(screen.getByRole("button", { name: "确认创建 DRAFT" }));
    expect(await screen.findByText("操作结果暂时无法确认")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用原请求重试" }));
    await waitFor(() => expect(decisions.acceptAsDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(decisions.acceptAsDraft).mock.calls[0]).toEqual(
      vi.mocked(decisions.acceptAsDraft).mock.calls[1],
    );
  });

  test("maps an IPC rejection to remote unknown and retries the frozen request", async () => {
    const decisions = capability();
    vi.mocked(decisions.acceptAsDraft)
      .mockRejectedValueOnce(new Error("renderer bridge destroyed"))
      .mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    render(panel(decisions));
    fireEvent.click(screen.getByRole("button", { name: "接受为 DRAFT" }));
    fireEvent.click(screen.getByRole("button", { name: "确认创建 DRAFT" }));
    expect(await screen.findByText("操作结果暂时无法确认")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用原请求重试" }));
    await waitFor(() => expect(decisions.acceptAsDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(decisions.acceptAsDraft).mock.calls[0]).toEqual(
      vi.mocked(decisions.acceptAsDraft).mock.calls[1],
    );
  });

  test("does not retry a definite conflict", async () => {
    const decisions = capability();
    vi.mocked(decisions.acceptAsDraft).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "ARTIFACT_PROPOSAL_ACCEPTANCE_CONFLICT",
      request_id: requestId,
    });
    render(panel(decisions));
    fireEvent.click(screen.getByRole("button", { name: "接受为 DRAFT" }));
    fireEvent.click(screen.getByRole("button", { name: "确认创建 DRAFT" }));
    expect(await screen.findByText("决定未执行")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重试/ })).not.toBeInTheDocument();
    expect(decisions.acceptAsDraft).toHaveBeenCalledOnce();
  });

  test("serializes same-tick confirmation clicks", async () => {
    let resolveDecision: ((value: { kind: "REMOTE_UNKNOWN" }) => void) | undefined;
    const decisions = capability();
    vi.mocked(decisions.acceptAsDraft).mockReturnValue(
      new Promise((resolve) => {
        resolveDecision = resolve;
      }),
    );
    render(panel(decisions));
    fireEvent.click(screen.getByRole("button", { name: "接受为 DRAFT" }));
    const confirm = screen.getByRole("button", { name: "确认创建 DRAFT" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(decisions.acceptAsDraft).toHaveBeenCalledOnce();
    resolveDecision?.({ kind: "REMOTE_UNKNOWN" });
    expect(await screen.findByText("操作结果暂时无法确认")).toBeInTheDocument();
  });
});
