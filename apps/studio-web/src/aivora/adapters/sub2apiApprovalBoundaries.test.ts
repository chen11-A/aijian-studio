import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  Sub2APICallApprovalResponse,
  Sub2APISourceExtractOperationResponse,
} from "../../api/studio";
import {
  approveSub2APIOneCall,
  originalSub2APISourceExtractCommand,
  readOriginalSub2APISourceExtract,
  readSub2APICallApprovalJournal,
  readSub2APIOneCallApproval,
  type RemoteSourceExtractOperation,
  type Sub2APISourceExtractReadOutcome,
} from "./remoteSourceExtract";

const hash = `sha256:${"a".repeat(64)}`;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = `agr_${"6".repeat(32)}`;
const approvalId = `apv_${"9".repeat(32)}`;
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
  modelId: "fixture-model",
  operationId,
  status: "QUEUED",
  runId,
  rejection: null,
};
const queueKey = `aivora.sub2api-source-extract.v1.${operation.projectId}`;
const approvalKey = `aivora.sub2api-one-call-approval.v1.${operation.projectId}.${runId}`;
function setup() {
  const command = originalSub2APISourceExtractCommand(operation);
  const receipt: Sub2APISourceExtractOperationResponse = {
    request_id: operationId,
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
  };
  const approved: Sub2APICallApprovalResponse = {
    request_id: operationId,
    data: {
      scope: structuredClone(receipt.data.scope),
      approval_id: approvalId,
      status: "APPROVED_ONE_CALL",
      approved_at: "2026-10-10T00:00:00Z",
      expires_at: "2026-10-10T00:10:00Z",
      allowed_calls: 1,
      cost_decision: "UNKNOWN_COST_ACCEPTED",
      cost: structuredClone(receipt.data.cost),
    },
  };
  const capability = {
    create: vi.fn(),
    readOriginal: vi.fn().mockResolvedValue({ kind: "FOUND", runId, receipt }),
    approve: vi.fn().mockResolvedValue({ kind: "APPROVED", receipt: approved }),
    readApproval: vi.fn().mockResolvedValue({ kind: "FOUND", receipt: approved }),
  };
  const values = new Map<string, string>([[queueKey, JSON.stringify(operation)]]);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  const read: Extract<Sub2APISourceExtractReadOutcome, { kind: "FOUND" }> = {
    kind: "FOUND",
    runId,
    response: receipt,
    queueBinding: "VERIFIED",
  };
  const approve = () => approveSub2APIOneCall(capability, storage, operation, read, true);
  const readApproval = () => readSub2APIOneCallApproval(capability, storage, operation, read);
  return { capability, receipt, approved, values, storage, read, approve, readApproval };
}
// Deliberately corrupt server-boundary fixtures without weakening production DTOs.
function corrupt(target: object, path: string, value: unknown) {
  const parts = path.split(".");
  let object = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) object = object[part] as Record<string, unknown>;
  object[parts.at(-1)!] = value;
}
beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const scopeFields = [
  "scope.project_id",
  "scope.task_id",
  "scope.attempt_id",
  "scope.attempt_fingerprint",
  "scope.origin_mode",
  "scope.source.agent_definition.definition_id",
  "scope.source.agent_definition.version",
  "scope.source.skill_definition.definition_id",
  "scope.source.skill_definition.version",
  "scope.source.source_manifest_version_id",
  "scope.source.source_document_id",
  "scope.source.source_block_id",
  "scope.source.start_byte",
  "scope.source.end_byte",
  "scope.selection.connection_id",
  "scope.selection.connection_revision",
  "scope.selection.model_id",
  "cost.status",
  "cost.currency",
  "cost.estimated_micros",
  "cost.actual_micros",
  "cost.upstream_status",
  "cost.upstream_actual_micros",
  "cost.budget_enforcement",
];

describe("Sub2API original read validates pinned scope", () => {
  test.each(scopeFields)("%s mismatch cannot authorize an approval", async (field) => {
    const h = setup();
    corrupt(h.receipt.data, field, "wrong");
    const read = await readOriginalSub2APISourceExtract(h.capability, h.storage, operation);
    expect(read.kind).toBe("REMOTE_UNKNOWN");
    expect((await approveSub2APIOneCall(h.capability, h.storage, operation, read, true)).kind).toBe(
      "UNAVAILABLE",
    );
    expect(h.capability.approve).not.toHaveBeenCalled();
  });
  test("automatic retry permission invalidates the source read", async () => {
    const h = setup();
    corrupt(h.receipt.data, "automatic_retry_allowed", true);
    expect((await readOriginalSub2APISourceExtract(h.capability, h.storage, operation)).kind).toBe(
      "REMOTE_UNKNOWN",
    );
  });
  test.each(["NOT_FOUND", "DEFINITE_SERVER_ERROR", "REMOTE_UNKNOWN", "throw"])(
    "read %s never mutates the queue",
    async (kind) => {
      const h = setup();
      const before = h.values.get(queueKey);
      h.capability.readOriginal.mockResolvedValue({
        kind,
        request_id: operationId,
        status: 409,
        code: "CONFLICT",
      });
      if (kind === "throw") h.capability.readOriginal.mockRejectedValue(new Error("offline"));
      expect(
        (await readOriginalSub2APISourceExtract(h.capability, h.storage, operation)).kind,
      ).toBe(kind === "throw" ? "REMOTE_UNKNOWN" : kind);
      expect(h.values.get(queueKey)).toBe(before);
      expect(h.capability.create).not.toHaveBeenCalled();
    },
  );
});

describe("one-call approval persistence and recovery", () => {
  test.each(["APPROVED", "CONSUMED"] as const)(
    "%s is persisted once with exact scope",
    async (kind) => {
      const h = setup();
      if (kind === "CONSUMED") h.approved.data.status = "CONSUMED";
      h.capability.approve.mockImplementation(async () => {
        expect(readSub2APICallApprovalJournal(h.storage, operation.projectId, runId)).toMatchObject(
          { kind: "VALID", approval: { status: "UNKNOWN", approvalId: null } },
        );
        return { kind, receipt: h.approved };
      });
      expect((await h.approve()).kind).toBe(kind);
      expect((await h.approve()).kind).toBe("TRACKED");
      expect(h.capability.approve).toHaveBeenCalledTimes(1);
      expect(h.capability.approve.mock.calls[0]?.[2]).toMatchObject({
        input: { allowed_calls: 1, unknown_cost_accepted: true },
      });
    },
  );
  test.each([
    ...scopeFields,
    "scope.origin_hash",
    "scope.input_hash",
    "scope.context_manifest_hash",
    "allowed_calls",
    "cost_decision",
    "approval_id",
    "status",
  ])("approval %s mismatch remains UNKNOWN", async (field) => {
    const h = setup();
    corrupt(h.approved.data, field, "wrong");
    expect((await h.approve()).kind).toBe("UNKNOWN");
    expect((await h.approve()).kind).toBe("TRACKED");
    expect(h.capability.approve).toHaveBeenCalledTimes(1);
  });
  test.each([
    "consent",
    "queue-binding",
    "content",
    "already-approved",
    "rejected",
    "missing-capability",
    "missing-uuid",
  ])("%s prevents approval", async (fault) => {
    const h = setup();
    if (fault === "queue-binding") h.read.queueBinding = "UNVERIFIED";
    if (fault === "content") h.receipt.data.content_status = "PROPOSAL_READY";
    if (fault === "already-approved") h.receipt.data.approval_id = approvalId;
    if (fault === "missing-uuid") vi.stubGlobal("crypto", {});
    const op = fault === "rejected" ? { ...operation, status: "REJECTED" as const } : operation;
    expect(
      (
        await approveSub2APIOneCall(
          fault === "missing-capability" ? undefined : h.capability,
          h.storage,
          op,
          h.read,
          fault !== "consent",
        )
      ).kind,
    ).toBe("UNAVAILABLE");
    expect(h.capability.approve).not.toHaveBeenCalled();
  });
  test.each(["{", "null", "[]", "x".repeat(2049), JSON.stringify({ extra: true })])(
    "corrupt approval %s is preserved",
    async (raw) => {
      const h = setup();
      h.values.set(approvalKey, raw);
      expect(readSub2APICallApprovalJournal(h.storage, operation.projectId, runId).kind).toBe(
        "BLOCKED",
      );
      expect((await h.approve()).kind).toBe("UNAVAILABLE");
      expect(h.values.get(approvalKey)).toBe(raw);
    },
  );
  test.each([
    "throw",
    "unknown",
    "server-error",
    "persist-failure",
    "late-change",
    "prewrite-failure",
  ])("%s cannot be retried automatically", async (fault) => {
    const h = setup();
    if (fault === "prewrite-failure")
      h.storage.setItem.mockImplementation(() => {
        throw new Error("full");
      });
    h.capability.approve.mockImplementation(async () => {
      if (fault === "throw") throw new Error("lost");
      if (fault === "unknown") return { kind: "REMOTE_UNKNOWN" };
      if (fault === "server-error")
        return {
          kind: "DEFINITE_SERVER_ERROR",
          status: 409,
          code: "CONFLICT",
          request_id: operationId,
        };
      if (fault === "persist-failure")
        h.storage.setItem.mockImplementation(() => {
          throw new Error("full");
        });
      if (fault === "late-change") h.values.set(approvalKey, "{");
      return { kind: "APPROVED", receipt: h.approved };
    });
    expect((await h.approve()).kind).toBe(
      fault === "prewrite-failure" || fault === "late-change" ? "UNAVAILABLE" : "UNKNOWN",
    );
    expect(h.capability.approve).toHaveBeenCalledTimes(fault === "prewrite-failure" ? 0 : 1);
    expect((await h.approve()).kind).toBe(
      fault === "prewrite-failure" || fault === "late-change" ? "UNAVAILABLE" : "TRACKED",
    );
  });
  test("UNKNOWN recovers by GET and consumed approval never regresses to approved", async () => {
    const h = setup();
    h.capability.approve.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    await h.approve();
    expect((await h.readApproval()).kind).toBe("FOUND");
    expect(readSub2APICallApprovalJournal(h.storage, operation.projectId, runId)).toMatchObject({
      approval: { status: "APPROVED", approvalId },
    });
    h.approved.data.status = "CONSUMED";
    expect((await h.readApproval()).kind).toBe("FOUND");
    h.approved.data.status = "APPROVED_ONE_CALL";
    expect((await h.readApproval()).kind).toBe("REMOTE_UNKNOWN");
    expect(readSub2APICallApprovalJournal(h.storage, operation.projectId, runId)).toMatchObject({
      approval: { status: "CONSUMED" },
    });
    expect(h.capability.approve).toHaveBeenCalledTimes(1);
  });
  test.each([
    "NOT_FOUND",
    "DEFINITE_SERVER_ERROR",
    "REMOTE_UNKNOWN",
    "throw",
    "wrong-scope",
    "corrupt-journal",
    "write-failure",
  ])("approval GET %s preserves original pending identity", async (kind) => {
    const h = setup();
    h.capability.approve.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    await h.approve();
    if (kind === "throw") h.capability.readApproval.mockRejectedValue(new Error("offline"));
    else if (kind === "wrong-scope") h.approved.data.scope.origin_hash = `sha256:${"b".repeat(64)}`;
    else if (kind === "corrupt-journal") h.values.set(approvalKey, "{");
    else if (kind === "write-failure")
      h.storage.setItem.mockImplementation(() => {
        throw new Error("full");
      });
    else
      h.capability.readApproval.mockResolvedValue({
        kind,
        request_id: operationId,
        status: 409,
        code: "CONFLICT",
      });
    expect((await h.readApproval()).kind).toBe(
      ["NOT_FOUND", "DEFINITE_SERVER_ERROR"].includes(kind) ? kind : "REMOTE_UNKNOWN",
    );
    expect(h.capability.approve).toHaveBeenCalledTimes(1);
  });
});
