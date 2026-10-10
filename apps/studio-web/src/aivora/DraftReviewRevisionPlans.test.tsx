import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftReviewRevisionPlans } from "./DraftReviewRevisionPlans";
import {
  revisionIdentity,
  type DraftReviewRevisionData,
  type DraftReviewRevisionGateway,
  type DraftReviewRevisionResult,
} from "./adapters/draftReviewRevision";
import { revisionRecoveryKey } from "./adapters/draftReviewRevisionRecovery";
import { revisionInputKey } from "./useDraftReviewRevisionInput";
import type { DraftExportGateway } from "./adapters/draftExport";
import {
  approval,
  candidate,
  candidateData,
  candidateJob,
  plan,
  plannedData,
  requestId,
  revisionData,
  revisionScope,
  savedNote,
  source,
  sourceJob,
  sourceSegment,
} from "./adapters/draftReviewRevision.testFixtures";
const found = (data: DraftReviewRevisionData): DraftReviewRevisionResult => ({
  kind: "FOUND",
  receipt: { data, request_id: requestId },
});
function setup(data = revisionData()) {
  let saved = data;
  const gateway: DraftReviewRevisionGateway = {
    listDraftReviewRevisionPlans: vi.fn(async () => found(saved)),
    getDraftReviewRevisionScope: vi.fn(async () => ({
      kind: "FOUND" as const,
      receipt: {
        data: { ...revisionScope(), output_verified: saved.output_verified },
        request_id: requestId,
      },
    })),
    createDraftReviewRevisionPlan: vi.fn(async (_p, _e, _o, input) => {
      saved = {
        ...saved,
        plans: [
          ...saved.plans,
          {
            plan: { ...plan, plan_id: input.plan_id, instruction: input.instruction },
            approval: null,
            candidates: [],
          },
        ],
      };
      return found(saved);
    }),
    approveDraftReviewRevisionPlan: vi.fn(async (_p, _e, _o, planId, input) => {
      saved = {
        ...saved,
        plans: saved.plans.map((item) =>
          item.plan.plan_id === planId
            ? {
                ...item,
                approval: {
                  ...approval,
                  plan_id: planId,
                  approval_id: input.approval_id,
                  plan_hash: input.expected_plan_hash,
                },
              }
            : item,
        ),
      };
      return found(saved);
    }),
    attachDraftReviewRevisionCandidate: vi.fn(async (_p, _e, _o, planId, input) => {
      saved = {
        ...saved,
        plans: saved.plans.map((item) =>
          item.plan.plan_id === planId
            ? {
                ...item,
                candidates: [
                  ...item.candidates,
                  {
                    candidate: {
                      ...candidate,
                      candidate_id: input.candidate_id,
                      plan_id: planId,
                      plan_hash: input.expected_plan_hash,
                      approval_id: input.approval_id,
                      change_summary: input.change_summary,
                    },
                    output_verified: true,
                    recheck: null,
                  },
                ],
              }
            : item,
        ),
      };
      return found(saved);
    }),
    recheckDraftReviewRevisionCandidate: vi.fn(async (_p, _e, _o, planId, candidateId, input) => {
      saved = {
        ...saved,
        plans: saved.plans.map((item) =>
          item.plan.plan_id === planId
            ? {
                ...item,
                candidates: item.candidates.map((entry) =>
                  entry.candidate.candidate_id === candidateId
                    ? {
                        ...entry,
                        recheck: {
                          recheck_id: input.recheck_id,
                          candidate_id: candidateId,
                          candidate_hash: input.expected_candidate_hash,
                          outcome: input.outcome,
                          reason: input.reason,
                          actor_id: "local-user",
                          created_at: "2026-10-09T20:08:00Z",
                        },
                      }
                    : entry,
                ),
              }
            : item,
        ),
      };
      return found(saved);
    }),
  };
  const exports: DraftExportGateway = {
    list: vi.fn(async () => ({
      kind: "LISTED" as const,
      receipt: {
        data: {
          items: [
            sourceJob,
            candidateJob,
            {
              ...candidateJob,
              operation_id: `dmp_${"e".repeat(32)}`,
              created_at: "2026-10-09T19:00:00Z",
              output_filename: "early-DRAFT.mp4",
            },
          ],
        },
        request_id: requestId,
      },
    })),
    get: vi.fn(async () => ({
      kind: "FOUND" as const,
      receipt: { data: candidateJob, request_id: requestId },
    })),
    createFromPicker: vi.fn(async () => ({ kind: "PICKER_CANCELLED" as const })),
    cancel: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    preview: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    reveal: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
  };
  return { gateway, exports, getSaved: () => saved };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "查看 / 建立人工修改计划" }));
  await screen.findByLabelText("人工修改指令");
}
function compose() {
  fireEvent.click(screen.getByRole("checkbox", { name: /原版第 12 帧/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /VISUAL.*seg_visual_1/ }));
  fireEvent.change(screen.getByLabelText("人工修改指令"), { target: { value: plan.instruction } });
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("manual revision panel", () => {
  it("mounts lazily and completes a distinct save, explicit approval, later candidate and human recheck", async () => {
    const { gateway, exports, getSaved } = setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    expect(gateway.listDraftReviewRevisionPlans).not.toHaveBeenCalled();
    await open();
    compose();
    fireEvent.click(screen.getByRole("button", { name: "保存人工修改计划" }));
    await screen.findByRole("button", { name: "明确批准此人工修改计划" });
    expect(gateway.createDraftReviewRevisionPlan).toHaveBeenCalledWith(
      sourceJob.project_id,
      sourceJob.episode_id,
      sourceJob.operation_id,
      {
        ...revisionIdentity(source),
        plan_id: expect.stringMatching(/^drp_[0-9a-f]{32}$/),
        note_ids: [savedNote.note_id],
        affected_segment_ids: [sourceSegment.segment_id],
        instruction: plan.instruction,
      },
    );
    expect(gateway.approveDraftReviewRevisionPlan).not.toHaveBeenCalled();
    expect(gateway.attachDraftReviewRevisionCandidate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "关联此精确候选草稿" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "明确批准此人工修改计划" }));
    expect(gateway.approveDraftReviewRevisionPlan).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "明确批准此人工修改计划" }));
    const entry = await waitFor(() => {
      const value = getSaved().plans[0]!;
      expect(value.approval).not.toBeNull();
      return value;
    });
    const select = await screen.findByLabelText(`计划 ${entry.plan.plan_id} 候选草稿`);
    expect(within(select).queryByRole("option", { name: /early-DRAFT/ })).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: /source-DRAFT/ })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: candidateJob.operation_id } });
    fireEvent.change(screen.getByLabelText(`计划 ${entry.plan.plan_id} 人工修改摘要`), {
      target: { value: candidate.change_summary },
    });
    fireEvent.click(screen.getByRole("button", { name: "关联此精确候选草稿" }));
    await screen.findByRole("button", { name: "保存此候选人工复核记录" });
    const linked = getSaved().plans[0]!.candidates[0]!.candidate;
    expect(gateway.recheckDraftReviewRevisionCandidate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(`候选 ${linked.candidate_id} 人工复核结果`), {
      target: { value: "MANUALLY_CHECKED" },
    });
    fireEvent.change(screen.getByLabelText(`候选 ${linked.candidate_id} 人工复核说明`), {
      target: { value: "人工核对候选动作，原评论保留" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存此候选人工复核记录" }));
    await screen.findByText("人工复核记录：已人工核对");
    expect(gateway.recheckDraftReviewRevisionCandidate).toHaveBeenCalledWith(
      sourceJob.project_id,
      sourceJob.episode_id,
      sourceJob.operation_id,
      entry.plan.plan_id,
      linked.candidate_id,
      {
        recheck_id: expect.stringMatching(/^drk_[0-9a-f]{32}$/),
        expected_candidate_hash: linked.candidate_hash,
        outcome: "MANUALLY_CHECKED",
        reason: "人工核对候选动作，原评论保留",
      },
    );
    expect(exports.createFromPicker).not.toHaveBeenCalled();
    expect(exports.cancel).not.toHaveBeenCalled();
    expect(screen.getByText(/原评论不会自动处理/)).toBeInTheDocument();
    expect(localStorage.getItem(revisionRecoveryKey(sourceJob))).toBeNull();
  });
  it("blocks uncovered note frames and preserves input until matched readback", async () => {
    const { gateway, exports } = setup();
    vi.mocked(gateway.getDraftReviewRevisionScope).mockResolvedValue({
      kind: "FOUND",
      receipt: {
        data: { ...revisionScope(), segments: [{ ...sourceSegment, start_frame: 20 }] },
        request_id: requestId,
      },
    });
    render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    compose();
    expect(screen.getByRole("button", { name: "保存人工修改计划" })).toBeDisabled();
    expect(screen.getByText(/每条评论帧号须落在至少一个已选原片段内/)).toBeInTheDocument();
    expect(gateway.createDraftReviewRevisionPlan).not.toHaveBeenCalled();
    expect(localStorage.getItem(revisionInputKey(sourceJob))).toContain(plan.instruction);
  });
  it("keeps unknown original submit, pauses new edits and only retries on explicit action", async () => {
    const { gateway, exports } = setup();
    vi.mocked(gateway.createDraftReviewRevisionPlan).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    compose();
    fireEvent.click(screen.getByRole("button", { name: "保存人工修改计划" }));
    await screen.findByRole("button", { name: "明确重试原修改提交" });
    expect(screen.getByLabelText("人工修改指令")).toHaveValue(plan.instruction);
    expect(screen.getByLabelText("人工修改指令")).toBeDisabled();
    const original = vi.mocked(gateway.createDraftReviewRevisionPlan).mock.calls[0]![3];
    view.unmount();
    render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    expect(gateway.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重新读取修改计划（只读）" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "明确重试原修改提交" })).toBeEnabled(),
    );
    expect(gateway.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "明确重试原修改提交" }));
    await waitFor(() => expect(gateway.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(2));
    expect(vi.mocked(gateway.createDraftReviewRevisionPlan).mock.calls[1]![3]).toEqual(original);
    expect(confirm).toHaveBeenCalled();
  });
  it("shows separate original/candidate frames and out-of-scope warnings, missing candidate blocks recheck", async () => {
    const data = candidateData();
    data.plans[0]!.candidates[0] = {
      ...data.plans[0]!.candidates[0]!,
      output_verified: false,
      candidate: {
        ...candidate,
        comparison: { ...candidate.comparison, out_of_scope_segment_ids: ["seg_extra"] },
      },
    };
    const { gateway, exports } = setup(data);
    render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    expect(screen.getByText(/计划范围外的片段变化：seg_extra/)).toBeInTheDocument();
    expect(screen.getByText(/原版帧号不会自动映射为候选帧号/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放候选版草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存此候选人工复核记录" })).toBeDisabled();
    expect(screen.getByText(/候选文件缺失或变化/)).toBeInTheDocument();
  });
  it("missing source preserves plan history but pauses new plan and approval", async () => {
    const { gateway, exports } = setup({ ...plannedData(), output_verified: false });
    render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    expect(screen.getByText(plan.instruction)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "明确批准此人工修改计划" })).toBeDisabled();
    expect(screen.getByLabelText("人工修改指令")).toBeDisabled();
  });
  it("older desktop has a narrow capability fallback with no read calls", async () => {
    render(<DraftReviewRevisionPlans job={sourceJob} notes={[savedNote]} />);
    fireEvent.click(screen.getByRole("button", { name: "查看 / 建立人工修改计划" }));
    expect(await screen.findByText(/尚未提供人工修改计划保存能力/)).toBeInTheDocument();
  });
  it("retains cache across reopen and keeps another exact original file empty", async () => {
    const { gateway, exports } = setup();
    const view = render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    compose();
    view.unmount();
    const reopened = render(
      <DraftReviewRevisionPlans
        job={sourceJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    expect(screen.getByLabelText("人工修改指令")).toHaveValue(plan.instruction);
    reopened.unmount();
    const nextJob = { ...sourceJob, output_sha256: "a".repeat(64) };
    vi.mocked(gateway.listDraftReviewRevisionPlans).mockResolvedValue(
      found({ ...revisionData(), source: { ...source, output_sha256: "a".repeat(64) } }),
    );
    vi.mocked(gateway.getDraftReviewRevisionScope).mockResolvedValue({
      kind: "FOUND",
      receipt: {
        data: { ...revisionScope(), source: { ...source, output_sha256: "a".repeat(64) } },
        request_id: requestId,
      },
    });
    render(
      <DraftReviewRevisionPlans
        job={nextJob}
        notes={[savedNote]}
        gateway={gateway}
        exports={exports}
      />,
    );
    await open();
    expect(screen.getByLabelText("人工修改指令")).toHaveValue("");
  });
});
