import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  acceptSourceExtractionProposal,
  originalRemoteSourceExtractCommand,
  originalSub2APISourceExtractCommand,
  queueRemoteSourceExtract,
  queueSub2APISourceExtract,
  readOriginalRemoteSourceExtract,
  readRemoteSourceExtractJournal,
  readSourceExtractionAcceptance,
  readSub2APISourceExtractJournal,
  type RemoteSourceExtractIdentity,
  type RemoteSourceExtractOperation,
} from "./remoteSourceExtract";

const projectId = `prj_${"1".repeat(32)}`;
const runId = `agr_${"2".repeat(32)}`;
const proposalId = `prp_${"3".repeat(32)}`;
const versionId = `ver_${"4".repeat(32)}`;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const identity: RemoteSourceExtractIdentity = {
  projectId,
  manifestVersionId: versionId,
  manifestContentHash: `sha256:${"5".repeat(64)}`,
  sourceDocumentId: `src_${"6".repeat(32)}`,
  sourceBlockId: `srcb_${"7".repeat(32)}`,
  sourceBlockHash: `sha256:${"8".repeat(64)}`,
  startByte: 0,
  endByte: 12,
  connectionId: `pcn_${"9".repeat(32)}`,
  connectionRevision: 1,
  modelId: "fixture-model",
};
const operation: RemoteSourceExtractOperation = {
  ...identity,
  operationId,
  status: "QUEUED",
  runId,
  rejection: null,
};
const cpaKey = `aivora.remote-source-extract.v1.${projectId}`;
const subKey = `aivora.sub2api-source-extract.v1.${projectId}`;
const acceptanceKey = `aivora.source-extraction-acceptance.v1.${projectId}.${proposalId}`;
function setup(sub2api = false) {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  const command = (
    sub2api ? originalSub2APISourceExtractCommand : originalRemoteSourceExtractCommand
  )(operation);
  // Transport contract validation is upstream. Exercise the exact identity fields
  // this coordinator uses, retaining its real journal and persistence checks.
  const receipt = {
    request_id: operationId,
    data: {
      project_id: projectId,
      run_id: runId,
      agent_run: {
        agent_run_id: runId,
        project_id: projectId,
        agent_definition: command.input.source.agent_definition,
      },
      skill_run: {
        agent_run_id: runId,
        project_id: projectId,
        skill_definition: command.input.source.skill_definition,
        proposal_id: proposalId,
      },
    },
  };
  const capability = {
    create: vi.fn().mockResolvedValue({ kind: "QUEUED", receipt }),
    readOriginal: vi.fn().mockResolvedValue({ kind: "FOUND_RUN", receipt }),
    approve: vi.fn(),
    readApproval: vi.fn(),
  };
  const queue = sub2api ? queueSub2APISourceExtract : queueRemoteSourceExtract;
  const read = sub2api ? readSub2APISourceExtractJournal : readRemoteSourceExtractJournal;
  return { values, storage, capability, queue, read, receipt, key: sub2api ? subKey : cpaKey };
}
beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const sub2api of [false, true])
  describe(sub2api ? "Sub2API queue journal" : "CPA queue journal", () => {
    test("persists UNKNOWN before POST then records exact queued receipt", async () => {
      const h = setup(sub2api);
      h.capability.create.mockImplementation(async () => {
        expect(h.read(h.storage, projectId)).toMatchObject({
          kind: "VALID",
          operation: { operationId, status: "UNKNOWN", runId: null },
        });
        return { kind: "QUEUED", receipt: h.receipt };
      });
      await expect(h.queue(h.capability, h.storage, identity)).resolves.toMatchObject({
        kind: "QUEUED",
        operation,
      });
      await expect(h.queue(h.capability, h.storage, identity)).resolves.toMatchObject({
        kind: "TRACKED",
      });
      expect(h.capability.create).toHaveBeenCalledTimes(1);
    });
    test.each([
      "projectId",
      "manifestVersionId",
      "manifestContentHash",
      "sourceDocumentId",
      "sourceBlockId",
      "sourceBlockHash",
      "connectionId",
      "modelId",
    ] as const)("rejects invalid identity %s before persistence", async (field) => {
      const h = setup(sub2api);
      await expect(
        h.queue(h.capability, h.storage, { ...identity, [field]: "" }),
      ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
      expect(h.storage.setItem).not.toHaveBeenCalled();
      expect(h.capability.create).not.toHaveBeenCalled();
    });
    test.each([
      { startByte: -1 },
      { endByte: 0 },
      { endByte: 65537 },
      { startByte: 0.5 },
      { connectionRevision: 0 },
      { connectionRevision: 2147483648 },
      { modelId: " leading" },
      { modelId: "line\nbreak" },
      { modelId: "x".repeat(121) },
    ])("rejects invalid boundary %j", async (change) => {
      const h = setup(sub2api);
      expect((await h.queue(h.capability, h.storage, { ...identity, ...change })).kind).toBe(
        "UNAVAILABLE",
      );
      expect(h.capability.create).not.toHaveBeenCalled();
    });
    test.each([
      "{",
      "null",
      "[]",
      "x".repeat(2049),
      JSON.stringify({ ...operation, extra: true }),
      JSON.stringify({ ...operation, status: "UNKNOWN", runId }),
    ])("preserves corrupt record %s and blocks POST", async (raw) => {
      const h = setup(sub2api);
      h.values.set(h.key, raw);
      expect(h.read(h.storage, projectId)).toEqual({ kind: "BLOCKED" });
      expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("UNAVAILABLE");
      expect(h.values.get(h.key)).toBe(raw);
      expect(h.capability.create).not.toHaveBeenCalled();
    });
    test.each(["throw", "lost-write", "read-error", "missing-capability", "missing-uuid"])(
      "%s prevents dispatch",
      async (fault) => {
        const h = setup(sub2api);
        if (fault === "throw")
          h.storage.setItem.mockImplementation(() => {
            throw new Error("full");
          });
        if (fault === "lost-write") h.storage.setItem.mockImplementation(() => {});
        if (fault === "read-error")
          h.storage.getItem.mockImplementation(() => {
            throw new Error("blocked");
          });
        if (fault === "missing-uuid") vi.stubGlobal("crypto", {});
        expect(
          (
            await h.queue(
              fault === "missing-capability" ? undefined : h.capability,
              h.storage,
              identity,
            )
          ).kind,
        ).toBe("UNAVAILABLE");
        expect(h.capability.create).not.toHaveBeenCalled();
      },
    );
    test.each([
      "throw",
      "UNKNOWN",
      "wrong-project",
      "wrong-run",
      "wrong-agent",
      "wrong-skill",
      "persist-failure",
    ])("%s remains UNKNOWN and cannot resubmit", async (fault) => {
      const h = setup(sub2api);
      if (fault === "throw") h.capability.create.mockRejectedValue(new Error("lost"));
      else if (fault === "UNKNOWN")
        h.capability.create.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
      else if (fault === "wrong-project") h.receipt.data.project_id = "wrong";
      else if (fault === "wrong-run") h.receipt.data.run_id = "wrong";
      else if (fault === "wrong-agent")
        h.receipt.data.agent_run.agent_definition = sub2api
          ? { definition_id: "writer.source-analyst", version: "1.1.0" }
          : { definition_id: "writer.source-analyst-sub2api", version: "1.0.0" };
      else if (fault === "wrong-skill")
        h.receipt.data.skill_run.skill_definition = sub2api
          ? { definition_id: "source.extract", version: "1.1.0" }
          : { definition_id: "source.extract-sub2api", version: "1.0.0" };
      else
        h.storage.setItem.mockImplementation((key, value) => {
          if (h.values.has(key)) throw new Error("full");
          h.values.set(key, value);
        });
      expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("UNKNOWN");
      expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("TRACKED");
      expect(h.capability.create).toHaveBeenCalledTimes(1);
    });
    test.each(["removed", "changed", "corrupt"])(
      "ignores reply after original journal is %s",
      async (fault) => {
        const h = setup(sub2api);
        h.capability.create.mockImplementation(async () => {
          if (fault === "removed") h.values.delete(h.key);
          if (fault === "changed")
            h.values.set(
              h.key,
              JSON.stringify({
                ...operation,
                status: "UNKNOWN",
                runId: null,
                modelId: "different",
              }),
            );
          if (fault === "corrupt") h.values.set(h.key, "{");
          return { kind: "QUEUED", receipt: h.receipt };
        });
        expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("UNAVAILABLE");
        expect(h.capability.create).toHaveBeenCalledTimes(1);
      },
    );
    test("blocks a parallel provider journal", async () => {
      const h = setup(sub2api);
      h.values.set(sub2api ? cpaKey : subKey, JSON.stringify(operation));
      expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("UNAVAILABLE");
      expect(h.capability.create).not.toHaveBeenCalled();
    });
    const errors: [number, string][] = sub2api
      ? [
          [401, "SIDECAR_AUTH_REQUIRED"],
          [403, "SIDECAR_REQUEST_REJECTED"],
          [404, "PROJECT_NOT_FOUND"],
          [409, "SUB2API_QUEUE_CONFLICT"],
          [409, "SUB2API_SCOPE_CONFLICT"],
          [422, "VALIDATION_ERROR"],
          [422, "SUB2API_INPUT_REJECTED"],
          [428, "IDEMPOTENCY_KEY_REQUIRED"],
          [503, "SUB2API_EXECUTION_UNAVAILABLE"],
        ]
      : [
          [401, "SIDECAR_AUTH_REQUIRED"],
          [403, "SIDECAR_REQUEST_REJECTED"],
          [404, "PROJECT_NOT_FOUND"],
          [404, "SOURCE_MANIFEST_NOT_FOUND"],
          [404, "PROPOSAL_RUN_NOT_FOUND"],
          [409, "PROPOSAL_RUN_INPUT_REJECTED"],
          [409, "IDEMPOTENCY_KEY_REUSED"],
          [422, "VALIDATION_ERROR"],
        ];
    test.each(errors)("records definite %s/%s rejection without retry", async (status, code) => {
      const h = setup(sub2api);
      h.capability.create.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code,
        request_id: operationId,
      });
      expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("REJECTED");
      expect(h.read(h.storage, projectId)).toMatchObject({
        kind: "VALID",
        operation: { rejection: { status, code, requestId: operationId } },
      });
      expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("TRACKED");
      expect(h.capability.create).toHaveBeenCalledTimes(1);
    });
    test.each([
      [500, "INTERNAL_ERROR", operationId],
      [409, "UNRECOGNIZED", operationId],
      [422, "VALIDATION_ERROR", "bad-request-id"],
    ])("ambiguous error %s/%s retains UNKNOWN", async (status, code, request_id) => {
      const h = setup(sub2api);
      h.capability.create.mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code,
        request_id,
      });
      expect((await h.queue(h.capability, h.storage, identity)).kind).toBe("UNKNOWN");
    });
  });

describe("CPA original read and human acceptance", () => {
  test.each(["FOUND_RUN", "NOT_FOUND", "REMOTE_UNKNOWN", "throw", "wrong-run"])(
    "read %s never queues again",
    async (kind) => {
      const h = setup();
      h.values.set(cpaKey, JSON.stringify(operation));
      if (kind === "throw") h.capability.readOriginal.mockRejectedValue(new Error("offline"));
      else if (kind === "wrong-run") h.receipt.data.run_id = "wrong";
      else h.capability.readOriginal.mockResolvedValue({ kind, receipt: h.receipt });
      const result = await readOriginalRemoteSourceExtract(h.capability, h.storage, operation);
      expect(result.kind).toBe(kind === "throw" || kind === "wrong-run" ? "REMOTE_UNKNOWN" : kind);
      if (result.kind === "FOUND_RUN") expect(result).toEqual({ kind, runId, proposalId });
      expect(h.capability.create).not.toHaveBeenCalled();
    },
  );
  test.each(["missing", "changed", "late-change"])(
    "read %s discards stale identity",
    async (fault) => {
      const h = setup();
      if (fault !== "missing")
        h.values.set(
          cpaKey,
          JSON.stringify(fault === "changed" ? { ...operation, modelId: "different" } : operation),
        );
      if (fault === "late-change")
        h.capability.readOriginal.mockImplementation(async () => {
          h.values.delete(cpaKey);
          return { kind: "FOUND_RUN", receipt: h.receipt };
        });
      expect((await readOriginalRemoteSourceExtract(h.capability, h.storage, operation)).kind).toBe(
        "UNAVAILABLE",
      );
    },
  );
  test.each([
    "success",
    "throw",
    "rejected",
    "wrong-project",
    "wrong-proposal",
    "wrong-version",
    "write-failure",
    "late-change",
  ])("acceptance %s preserves intent and never retries", async (fault) => {
    const h = setup();
    h.values.set(cpaKey, JSON.stringify(operation));
    const data = { project_id: projectId, proposal_id: proposalId, draft_version_id: versionId };
    if (fault === "wrong-project") data.project_id = "wrong";
    if (fault === "wrong-proposal") data.proposal_id = "wrong";
    if (fault === "wrong-version") data.draft_version_id = "wrong";
    const acceptAsDraft = vi.fn().mockImplementation(async () => {
      expect(readSourceExtractionAcceptance(h.storage, projectId, proposalId)).toMatchObject({
        kind: "VALID",
        acceptance: { status: "UNKNOWN" },
      });
      if (fault === "throw") throw new Error("lost");
      if (fault === "late-change") h.values.set(acceptanceKey, "{");
      if (fault === "write-failure")
        h.storage.setItem.mockImplementation(() => {
          throw new Error("full");
        });
      return fault === "rejected"
        ? { kind: "DEFINITE_SERVER_ERROR", status: 409, code: "CONFLICT" }
        : { kind: "SUCCEEDED", receipt: { data } };
    });
    const transport = { proposalDecisions: { acceptAsDraft, reject: vi.fn() } };
    const result = await acceptSourceExtractionProposal(
      transport,
      h.storage,
      operation,
      proposalId,
      null,
      null,
    );
    expect(result.kind).toBe(
      fault === "success" ? "ACCEPTED" : fault === "late-change" ? "UNAVAILABLE" : "UNKNOWN",
    );
    expect(
      (
        await acceptSourceExtractionProposal(
          transport,
          h.storage,
          operation,
          proposalId,
          null,
          null,
        )
      ).kind,
    ).toBe(fault === "late-change" ? "UNAVAILABLE" : "TRACKED");
    expect(acceptAsDraft).toHaveBeenCalledTimes(1);
    expect(h.capability.create).not.toHaveBeenCalled();
  });
});
