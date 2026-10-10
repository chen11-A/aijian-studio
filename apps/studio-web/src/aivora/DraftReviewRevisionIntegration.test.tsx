import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftReviewNotes } from "./DraftReviewNotes";
import type { DraftReviewGateway } from "./adapters/draftReview";
import type { DraftReviewRevisionGateway } from "./adapters/draftReviewRevision";
import { emptyRevisionInput, revisionInputKey } from "./useDraftReviewRevisionInput";
import {
  candidate,
  candidateData,
  requestId,
  revisionScope,
  savedNote,
  source,
  sourceJob,
} from "./adapters/draftReviewRevision.testFixtures";
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("existing notes to manual revision exact-source integration", () => {
  it("uses preserved review target hashes for OUTPUT_CHANGED jobs with nulled output metadata", async () => {
    const failedJob = {
      ...sourceJob,
      status: "FAILED" as const,
      output_sha256: null,
      output_bytes: null,
      output_path: null,
      error_code: "OUTPUT_CHANGED",
    };
    const notes: DraftReviewGateway = {
      listDraftReviewNotes: vi.fn(async () => ({
        kind: "FOUND" as const,
        receipt: {
          data: {
            target: source,
            output_verified: false,
            current_assembly_version_id: candidate.target.assembly_version_id,
            current_assembly_content_hash: candidate.target.assembly_content_hash,
            version_status: "OLDER_VERSION" as const,
            notes: [savedNote],
            manual_review_only: true as const,
          },
          request_id: requestId,
        },
      })),
      createDraftReviewNote: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      resolveDraftReviewNote: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    };
    const revision: DraftReviewRevisionGateway = {
      listDraftReviewRevisionPlans: vi.fn(async () => ({
        kind: "FOUND" as const,
        receipt: { data: { ...candidateData(), output_verified: false }, request_id: requestId },
      })),
      getDraftReviewRevisionScope: vi.fn(async () => ({
        kind: "FOUND" as const,
        receipt: { data: { ...revisionScope(), output_verified: false }, request_id: requestId },
      })),
      createDraftReviewRevisionPlan: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      approveDraftReviewRevisionPlan: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      attachDraftReviewRevisionCandidate: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      recheckDraftReviewRevisionCandidate: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    };
    localStorage.setItem(
      revisionInputKey(sourceJob),
      JSON.stringify({ ...emptyRevisionInput, instruction: "原文件失效前保留的输入" }),
    );
    render(<DraftReviewNotes job={failedJob} gateway={notes} revision={revision} />);
    fireEvent.click(screen.getByRole("button", { name: "查看 / 添加手工核对记录" }));
    await screen.findByText("第 12 帧");
    fireEvent.click(screen.getByRole("button", { name: "查看 / 建立人工修改计划" }));
    const instruction = await screen.findByLabelText("人工修改指令");
    expect(instruction).toHaveValue("原文件失效前保留的输入");
    expect(instruction).toBeDisabled();
    expect(screen.getByText(`候选 ${candidate.candidate_id}`)).toBeInTheDocument();
    const reason = screen.getByLabelText(`候选 ${candidate.candidate_id} 人工复核说明`);
    expect(reason).toBeEnabled();
    fireEvent.change(reason, { target: { value: "原文件缺失，已独立核对仍可验证的候选" } });
    expect(screen.getByRole("button", { name: "保存此候选人工复核记录" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "播放原版草稿" })).toBeDisabled();
    expect(revision.listDraftReviewRevisionPlans).toHaveBeenCalledWith(
      source.project_id,
      source.episode_id,
      source.operation_id,
    );
    expect(notes.resolveDraftReviewNote).not.toHaveBeenCalled();
  });
});
