import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { localWorkbenchTransport } from "./localWorkbench";
import type { ProductionBriefCreateCommand, ProductionBriefResponse } from "./studio";

const projectId = `prj_${"a".repeat(32)}`;
const versionId = `ver_${"b".repeat(32)}`;
const artifactId = `art_${"c".repeat(32)}`;
const otherVersion = `ver_${"d".repeat(32)}`;
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const date = "2026-09-14T00:00:00Z";
const hash = `sha256:${"e".repeat(64)}`;
const base = `/api/v1/projects/${projectId}/production-brief`;
const transport = localWorkbenchTransport();
const fetchMock = vi.fn<typeof fetch>();
function command(): ProductionBriefCreateCommand {
  return {
    operation_id: requestId,
    input: {
      content: {
        schema_version: "1.0.0",
        creative_entry: { kind: "original_idea", origin_statement: "合成原创", references: [] },
        creative: {
          premise: "海边的信",
          intent: "寻找",
          audience: null,
          genre: null,
          style: null,
          constraints: [],
        },
        delivery: {
          language: "zh-CN",
          width_px: 1080,
          height_px: 1920,
          display_aspect_ratio: { num: 9, den: 16 },
          frame_rate: { num: 24, den: 1 },
        },
        duration_intent: { work_seconds: null, episode_mode: "unspecified", episode_seconds: null },
        budget_intent: { state: "unknown", currency: null, amount_micros: null },
        rights_declaration: { state: "unknown", statement: null },
      },
      parent_version_id: null,
      expected_revision: null,
      change_summary: "合成简报",
    },
  };
}
function receipt(input = command().input): ProductionBriefResponse["data"] {
  return {
    project_id: projectId,
    head: {
      artifact_id: artifactId,
      latest_version_id: versionId,
      review_version_id: null,
      review_submission_id: null,
      accepted_version_id: null,
      revision: 1,
      review_evidence_revision: 0,
      updated_at: date,
    },
    version: {
      id: versionId,
      artifact_id: artifactId,
      version_number: 1,
      schema_version: "1.0.0",
      content: input.content,
      content_hash: hash,
      parent_version_id: input.parent_version_id,
      change_summary: input.change_summary,
      created_at: date,
    },
  };
}
function reply(data: unknown, etag: string, status = 200) {
  return Response.json(
    { data, request_id: requestId },
    {
      status,
      headers: { "X-Request-ID": requestId, ETag: `"${etag}"` },
    },
  );
}
function rejection(status: number, code: string) {
  return Response.json(
    {
      request_id: requestId,
      error: {
        code,
        message: "rejected",
        retryable: false,
        details: {},
      },
    },
    { status, headers: { "X-Request-ID": requestId } },
  );
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("production brief reads", () => {
  test.each([false, true])("verifies latest or historical identity %s", async (historical) => {
    const data = receipt();
    if (historical) data.head.latest_version_id = otherVersion;
    fetchMock.mockResolvedValue(reply(data, historical ? hash : "revision-1"));
    expect(
      await (historical
        ? transport.getProductionBriefVersion(projectId, versionId)
        : transport.getProductionBrief(projectId)),
    ).toEqual({ data, request_id: requestId });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${base}${historical ? `/versions/${versionId}` : ""}`,
      expect.objectContaining({ method: "GET" }),
    );
  });
  test("only a verified latest missing artifact is null", async () => {
    fetchMock.mockImplementation(async () => rejection(404, "ARTIFACT_NOT_FOUND"));
    expect(await transport.getProductionBrief(projectId)).toBeNull();
    await expect(transport.getProductionBriefVersion(projectId, versionId)).rejects.toThrow(
      "could not be verified",
    );
  });
  test.each(["wrong ETag", "wrong project", "wrong version", "untrusted 404"])(
    "refuses %s",
    async (fault) => {
      const data = receipt();
      if (fault === "wrong project") data.project_id = `prj_${"f".repeat(32)}`;
      if (fault === "wrong version") data.version.id = otherVersion;
      fetchMock.mockResolvedValue(
        fault === "untrusted 404"
          ? rejection(404, "PROJECT_NOT_FOUND")
          : reply(data, fault === "wrong ETag" ? hash : "revision-1"),
      );
      await expect(transport.getProductionBrief(projectId)).rejects.toThrow(
        "could not be verified",
      );
    },
  );
});

describe("production brief writes", () => {
  test.each([false, true])(
    "uses the operation-bound key and preserves a historical replay %s",
    async (replayed) => {
      const input = command();
      const data = receipt(input.input);
      if (replayed) {
        data.head.latest_version_id = otherVersion;
        data.head.revision = 8;
      }
      fetchMock.mockResolvedValue(reply(data, `revision-${data.head.revision}`, 201));
      expect(await transport.createProductionBriefVersion(projectId, input)).toEqual({
        kind: "SUCCEEDED",
        receipt: { data, request_id: requestId },
      });
      const key = `production-brief:create:v1:${createHash("sha256").update(`${projectId}\0${requestId}`).digest("hex")}`;
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${base}/versions`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(input.input),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
        }),
      );
    },
  );
  test("fills optional defaults before comparing the server's normalized content", async () => {
    const input = command();
    const partial = {
      operation_id: input.operation_id,
      input: {
        content: {
          ...input.input.content,
          schema_version: undefined,
          creative_entry: { kind: "original_idea", origin_statement: "合成原创" },
          creative: { premise: "海边的信", intent: "寻找" },
        },
        change_summary: input.input.change_summary,
      },
    };
    fetchMock.mockResolvedValue(reply(receipt(), "revision-1", 201));
    expect(
      await transport.createProductionBriefVersion(
        projectId,
        partial as unknown as ProductionBriefCreateCommand,
      ),
    ).toMatchObject({ kind: "SUCCEEDED" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(input.input);
  });
  test("preserves declared budget, rights and source-adaptation identity", async () => {
    const input = command();
    input.input.content.creative_entry = {
      kind: "source_adaptation",
      adaptation_statement: "合成改编",
      source_document_id: `src_${"1".repeat(32)}`,
      source_manifest_version_id: otherVersion,
      source_block_ids: [`srcb_${"2".repeat(32)}`],
    };
    input.input.content.budget_intent = { state: "declared", currency: "CNY", amount_micros: 0 };
    input.input.content.rights_declaration = {
      state: "user_declared",
      statement: "仅合成测试声明",
    };
    input.input.content.duration_intent = {
      work_seconds: 300,
      episode_mode: "per_episode",
      episode_seconds: 60,
    };
    input.input.content.creative.audience = "测试受众";
    fetchMock.mockResolvedValue(reply(receipt(input.input), "revision-1", 201));
    expect(await transport.createProductionBriefVersion(projectId, input)).toMatchObject({
      kind: "SUCCEEDED",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(input.input);
  });
  test.each<[string, (input: ProductionBriefCreateCommand) => void]>([
    [
      "invalid operation",
      (input) => {
        input.operation_id = "not-a-uuid";
      },
    ],
    [
      "invalid parent",
      (input) => {
        input.input.parent_version_id = "invalid";
      },
    ],
    [
      "zero revision",
      (input) => {
        input.input.expected_revision = 0;
      },
    ],
    [
      "empty change summary",
      (input) => {
        input.input.change_summary = " ";
      },
    ],
    [
      "empty premise",
      (input) => {
        input.input.content.creative.premise = " ";
      },
    ],
    [
      "repeated constraints",
      (input) => {
        input.input.content.creative.constraints = ["x", "x"];
      },
    ],
    [
      "unreduced aspect ratio",
      (input) => {
        input.input.content.delivery.display_aspect_ratio = { num: 18, den: 32 };
      },
    ],
    [
      "aspect-size mismatch",
      (input) => {
        input.input.content.delivery.width_px = 1920;
      },
    ],
    [
      "zero frame rate",
      (input) => {
        input.input.content.delivery.frame_rate.num = 0;
      },
    ],
    [
      "oversized denominator",
      (input) => {
        input.input.content.delivery.frame_rate.den = 2147483648;
      },
    ],
    [
      "unknown budget with amount",
      (input) => {
        input.input.content.budget_intent.amount_micros = 5;
      },
    ],
    [
      "unknown rights with statement",
      (input) => {
        input.input.content.rights_declaration.statement = "unbound";
      },
    ],
    [
      "duplicate references",
      (input) => {
        input.input.content.creative_entry = {
          kind: "original_idea",
          origin_statement: "合成原创",
          references: [
            { reference_kind: "research", description: "same" },
            { reference_kind: "research", description: "same" },
          ],
        };
      },
    ],
    [
      "empty adaptation blocks",
      (input) => {
        input.input.content.creative_entry = {
          kind: "source_adaptation",
          adaptation_statement: "合成",
          source_document_id: `src_${"1".repeat(32)}`,
          source_manifest_version_id: otherVersion,
          source_block_ids: [],
        };
      },
    ],
  ])("rejects %s before HTTP", async (_label, mutate) => {
    const input = command();
    mutate(input);
    await expect(transport.createProductionBriefVersion(projectId, input)).rejects.toThrow(
      "Invalid production brief command",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each(["parent", "summary", "content", "etag"])(
    "does not confirm mismatched %s",
    async (fault) => {
      const data = receipt();
      if (fault === "parent") data.version.parent_version_id = otherVersion;
      if (fault === "summary") data.version.change_summary = "another command";
      if (fault === "content") data.version.content.creative.intent = "another intent";
      fetchMock.mockResolvedValue(reply(data, fault === "etag" ? hash : "revision-1", 201));
      expect(await transport.createProductionBriefVersion(projectId, command())).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  test.each([
    [409, "ARTIFACT_DEPENDENCY_INVALID"],
    [422, "VALIDATION_ERROR"],
    [428, "PRECONDITION_REQUIRED"],
  ] as const)("preserves verified %i %s without retry", async (status, code) => {
    fetchMock.mockResolvedValue(rejection(status, code));
    expect(await transport.createProductionBriefVersion(projectId, command())).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code,
      request_id: requestId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("lost write receipt stays unknown without replay", async () => {
    fetchMock.mockRejectedValue(new Error("lost"));
    expect(await transport.createProductionBriefVersion(projectId, command())).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("failed idempotency-key calculation sends no request", async () => {
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn().mockRejectedValue(new Error("unavailable")) },
    });
    expect(await transport.createProductionBriefVersion(projectId, command())).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
