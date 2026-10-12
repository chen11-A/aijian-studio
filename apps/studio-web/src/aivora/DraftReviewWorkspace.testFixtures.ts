import { vi } from "vitest";
import type { DraftExportGateway } from "./adapters/draftExport";
import {
  source,
  sourceJob,
  savedNote,
  requestId,
  candidateData,
  revisionScope,
} from "./adapters/draftReviewRevision.testFixtures";

export function reviewWorkspaceGateway(): DraftExportGateway {
  return {
    list: vi.fn(async () => ({
      kind: "LISTED" as const,
      receipt: { data: { items: [sourceJob] }, request_id: requestId },
    })),
    get: vi.fn(async () => ({
      kind: "FOUND" as const,
      receipt: { data: sourceJob, request_id: requestId },
    })),
    createFromPicker: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    cancel: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    review: {
      listDraftReviewNotes: vi.fn(async () => ({
        kind: "FOUND" as const,
        receipt: {
          data: {
            target: source,
            output_verified: true,
            version_status: "CURRENT" as const,
            current_assembly_version_id: source.assembly_version_id,
            current_assembly_content_hash: source.assembly_content_hash,
            notes: [savedNote],
            manual_review_only: true as const,
          },
          request_id: requestId,
        },
      })),
      createDraftReviewNote: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      resolveDraftReviewNote: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    },
    revision: {
      listDraftReviewRevisionPlans: vi.fn(async () => ({
        kind: "FOUND" as const,
        receipt: { data: candidateData(), request_id: requestId },
      })),
      getDraftReviewRevisionScope: vi.fn(async () => ({
        kind: "FOUND" as const,
        receipt: { data: revisionScope(), request_id: requestId },
      })),
      createDraftReviewRevisionPlan: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      approveDraftReviewRevisionPlan: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      attachDraftReviewRevisionCandidate: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
      recheckDraftReviewRevisionCandidate: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" as const })),
    },
  };
}
