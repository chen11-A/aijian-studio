import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Sub2APICallApprovalResponse,
  Sub2APISourceExtractCapability,
  Sub2APISourceExtractOperationResponse,
} from "../../api/studio";
import {
  approveSub2APIOneCall,
  originalSub2APISourceExtractCommand,
  readOriginalSub2APISourceExtract,
  type RemoteSourceExtractOperation,
} from "./remoteSourceExtract";
const hash = `sha256:${"a".repeat(64)}`;
const operation: RemoteSourceExtractOperation = {
  projectId: `prj_${"1".repeat(32)}`,
  manifestVersionId: `ver_${"2".repeat(32)}`,
  manifestContentHash: hash,
  sourceDocumentId: `src_${"3".repeat(32)}`,
  sourceBlockId: `srcb_${"4".repeat(32)}`,
  sourceBlockHash: hash,
  startByte: 0,
  endByte: 10,
  connectionId: `pcn_${"5".repeat(32)}`,
  connectionRevision: 1,
  modelId: "test-model",
  operationId: "00000000-0000-4000-8000-000000000001",
  status: "QUEUED",
  runId: `agr_${"6".repeat(32)}`,
  rejection: null,
};
function setup() {
  const command = originalSub2APISourceExtractCommand(operation);
  const receipt: Sub2APISourceExtractOperationResponse = {
    data: {
      scope: {
        project_id: operation.projectId,
        task_id: `task_${"7".repeat(32)}`,
        attempt_id: `att_${"8".repeat(32)}`,
        source: command.input.source,
        selection: command.input.selection,
        origin_mode: "LOCAL_LOOPBACK_HTTP",
        origin_hash: hash,
        input_hash: hash,
        context_manifest_hash: hash,
        attempt_fingerprint: hash,
      },
      attempt_status: "QUEUED",
      approval_id: null,
      proposal_id: null,
      content_status: "PENDING",
      automatic_retry_allowed: false,
      cost: {
        status: "UNKNOWN",
        currency: null,
        estimated_micros: null,
        actual_micros: null,
        upstream_status: "UNKNOWN",
        upstream_actual_micros: null,
        budget_enforcement: "UNENFORCED",
      },
    },
    request_id: "local-test",
  };
  const approved: Sub2APICallApprovalResponse = {
    data: {
      scope: structuredClone(receipt.data.scope),
      approval_id: `apv_${"9".repeat(32)}`,
      status: "APPROVED_ONE_CALL",
      approved_at: "2026-10-08T00:00:00Z",
      expires_at: "2026-10-08T00:10:00Z",
      allowed_calls: 1,
      cost_decision: "UNKNOWN_COST_ACCEPTED",
      cost: receipt.data.cost,
    },
    request_id: "local-test",
  };
  const capability: Sub2APISourceExtractCapability = {
    create: vi.fn(),
    readApproval: vi.fn(),
    readOriginal: vi.fn().mockResolvedValue({ kind: "FOUND", runId: operation.runId, receipt }),
    approve: vi.fn().mockResolvedValue({ kind: "APPROVED", receipt: approved }),
  };
  localStorage.setItem(
    `aivora.sub2api-source-extract.v1.${operation.projectId}`,
    JSON.stringify(operation),
  );
  return { receipt, approved, capability };
}
beforeEach(() => {
  localStorage.clear();
});
describe("Sub2API renderer scope modes", () => {
  it("preserves loopback through original read and one-time approval readback", async () => {
    const { capability } = setup();
    const read = await readOriginalSub2APISourceExtract(capability, localStorage, operation);
    expect(read.kind).toBe("FOUND");
    const result = await approveSub2APIOneCall(capability, localStorage, operation, read, true);
    expect(result.kind).toBe("APPROVED");
    expect(capability.approve).toHaveBeenCalledTimes(1);
  });
  it("treats a returned approval with another mode as unknown and never retries", async () => {
    const { capability, approved } = setup();
    const read = await readOriginalSub2APISourceExtract(capability, localStorage, operation);
    approved.data.scope.origin_mode = "PUBLIC_HTTPS";
    expect(
      (await approveSub2APIOneCall(capability, localStorage, operation, read, true)).kind,
    ).toBe("UNKNOWN");
    expect(
      (await approveSub2APIOneCall(capability, localStorage, operation, read, true)).kind,
    ).toBe("TRACKED");
    expect(capability.approve).toHaveBeenCalledTimes(1);
  });
});
