import { describe, expect, it, vi } from "vitest";
import { desktopDraftExports } from "./draftExports";
import type { AijianDesktopBridge } from "./studio";
import { revisionIdentity } from "../aivora/adapters/draftReviewRevision";
import {
  approval,
  candidate,
  plan,
  recheck,
  source,
  sourceJob,
} from "../aivora/adapters/draftReviewRevision.testFixtures";
const methods = [
  "listDraftReviewRevisionPlans",
  "getDraftReviewRevisionScope",
  "createDraftReviewRevisionPlan",
  "approveDraftReviewRevisionPlan",
  "attachDraftReviewRevisionCandidate",
  "recheckDraftReviewRevisionCandidate",
] as const;
function setup() {
  return {
    listDraftExports: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    getDraftExport: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    createDraftExportFromPicker: vi.fn(async () => ({ kind: "PICKER_CANCELLED" as const })),
    cancelDraftExport: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    listDraftReviewNotes: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    createDraftReviewNote: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    resolveDraftReviewNote: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    ...Object.fromEntries(
      methods.map((method) => [method, vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const }))]),
    ),
  };
}
describe("optional desktop manual revision capability", () => {
  it.each(methods)(
    "keeps notes/export usable but revision unavailable when %s is absent",
    (method) => {
      const gateway = desktopDraftExports({
        ...setup(),
        [method]: undefined,
      } as unknown as AijianDesktopBridge);
      expect(gateway?.revision).toBeUndefined();
      expect(gateway?.review?.createDraftReviewNote).toBeTypeOf("function");
      expect(gateway?.createFromPicker).toBeTypeOf("function");
    },
  );
  it("forwards all six exact scoped methods without rewriting replies or widening capabilities", async () => {
    const bridge = setup();
    const gateway = desktopDraftExports(bridge as unknown as AijianDesktopBridge)?.revision;
    expect(gateway).toBeDefined();
    const scope = [sourceJob.project_id, sourceJob.episode_id, sourceJob.operation_id] as const;
    const create = {
      ...revisionIdentity(source),
      plan_id: plan.plan_id,
      note_ids: [plan.notes[0]!.note_id],
      affected_segment_ids: [plan.affected_segments[0]!.segment_id],
      instruction: plan.instruction,
    };
    const approve = { approval_id: approval.approval_id, expected_plan_hash: plan.plan_hash };
    const attach = {
      ...revisionIdentity(candidate.target),
      candidate_id: candidate.candidate_id,
      expected_plan_hash: plan.plan_hash,
      approval_id: approval.approval_id,
      candidate_operation_id: candidate.target.operation_id,
      change_summary: candidate.change_summary,
    };
    const check = {
      recheck_id: recheck.recheck_id,
      expected_candidate_hash: candidate.candidate_hash,
      outcome: recheck.outcome,
      reason: recheck.reason,
    };
    const calls = [
      [methods[0], [...scope]],
      [methods[1], [...scope]],
      [methods[2], [...scope, create]],
      [methods[3], [...scope, plan.plan_id, approve]],
      [methods[4], [...scope, plan.plan_id, attach]],
      [methods[5], [...scope, plan.plan_id, candidate.candidate_id, check]],
    ] as const;
    await expect(gateway!.listDraftReviewRevisionPlans(...scope)).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    await gateway!.getDraftReviewRevisionScope(...scope);
    await gateway!.createDraftReviewRevisionPlan(...scope, create);
    await gateway!.approveDraftReviewRevisionPlan(...scope, plan.plan_id, approve);
    await gateway!.attachDraftReviewRevisionCandidate(...scope, plan.plan_id, attach);
    await gateway!.recheckDraftReviewRevisionCandidate(
      ...scope,
      plan.plan_id,
      candidate.candidate_id,
      check,
    );
    for (const [method, args] of calls)
      expect(bridge[method as keyof typeof bridge]).toHaveBeenCalledWith(...args);
    expect(bridge.createDraftExportFromPicker).not.toHaveBeenCalled();
    expect(bridge.createDraftReviewNote).not.toHaveBeenCalled();
    expect(Object.keys(gateway!)).toEqual(methods);
  });
});
