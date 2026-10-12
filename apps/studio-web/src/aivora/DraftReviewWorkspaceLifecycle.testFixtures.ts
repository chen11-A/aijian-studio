import { vi } from "vitest";
import type {
  DraftReviewRevisionData,
  DraftReviewRevisionGateway,
  DraftReviewRevisionResult,
} from "./adapters/draftReviewRevision";
import type { DraftExportGateway } from "./adapters/draftExport";
import {
  approval,
  candidate,
  plan,
  requestId,
  revisionData,
  revisionScope,
  sourceJob,
  candidateJob,
} from "./adapters/draftReviewRevision.testFixtures";

const found = (data: DraftReviewRevisionData): DraftReviewRevisionResult => ({
  kind: "FOUND",
  receipt: { data, request_id: requestId },
});
export function reviewRevisionLifecycle(data = revisionData()) {
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
