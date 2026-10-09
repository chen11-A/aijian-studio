import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { localWorkbenchTransport } from "./localWorkbench";

const projectId = `prj_${"a".repeat(32)}`;
const versionId = `ver_${"b".repeat(32)}`;
const artifactId = `art_${"c".repeat(32)}`;
const otherVersion = `ver_${"d".repeat(32)}`;
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const date = "2026-09-14T00:00:00Z";
const content = { summary: "事实摘要：海边的一封信 🌊" };
const hash = `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`;
const transport = localWorkbenchTransport();
const fetchMock = vi.fn<typeof fetch>();
function extraction() {
  return {
    project_id: projectId,
    head: {
      artifact_id: artifactId,
      latest_version_id: versionId,
      review_version_id: null,
      review_submission_id: null,
      accepted_version_id: null,
      revision: 2,
      review_evidence_revision: 0,
      updated_at: date,
    },
    version: {
      id: versionId,
      artifact_id: artifactId,
      version_number: 1,
      schema_version: "1.0.0",
      content: { ...content },
      content_hash: hash,
      parent_version_id: null,
      change_summary: "从原文提取",
      created_at: date,
    },
    source_spans: [
      {
        id: `spn_${"1".repeat(32)}`,
        fact_id: `spn_${"2".repeat(32)}`,
        source_document_id: `src_${"3".repeat(32)}`,
        source_block_id: `srcb_${"4".repeat(32)}`,
        role: "supports",
        start_byte: 0,
        end_byte: 12,
        claim: "一封信",
        quote_hash: `sha256:${"5".repeat(64)}`,
      },
    ],
    dependencies: [
      { upstream_version_id: otherVersion, relationship: "derived_from", impact: "blocking" },
    ],
    provenance: {
      producer_attempt_id: `att_${"6".repeat(32)}`,
      proposal_id: `prp_${"7".repeat(32)}`,
    },
  };
}
function acceptance(current = true) {
  return {
    acceptance_id: `pda_${"8".repeat(32)}`,
    project_id: projectId,
    source_extraction_version_id: versionId,
    source_extraction_content_hash: hash,
    proposal_id: `prp_${"7".repeat(32)}`,
    accepted_as_draft_at: date,
    latest_version_id: current ? versionId : otherVersion,
    latest_head_revision: 2,
    current,
  };
}
function reply(data: unknown, etag: string, status = 200) {
  return new Response(JSON.stringify({ data, request_id: requestId }), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId, ETag: `"${etag}"` },
  });
}
function rejection(status: number, code: string, retryable = false) {
  return new Response(
    JSON.stringify({
      error: { code, message: "rejected", retryable, details: {} },
      request_id: requestId,
    }),
    { status, headers: { "Content-Type": "application/json", "X-Request-ID": requestId } },
  );
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("source extraction readback", () => {
  test.each([false, true])(
    "verifies Unicode hash and exact %s version identity",
    async (historical) => {
      const data = extraction();
      if (historical) data.head.latest_version_id = otherVersion;
      fetchMock.mockResolvedValue(reply(data, historical ? hash : "revision-2"));
      const result = historical
        ? await transport.getSourceExtractionVersion(projectId, versionId)
        : await transport.getSourceExtraction(projectId);
      expect(result).toEqual({ kind: "FOUND", receipt: { data, request_id: requestId } });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `/api/v1/projects/${projectId}/source-extraction${historical ? `/versions/${versionId}` : ""}`,
        expect.objectContaining({ method: "GET", redirect: "error", cache: "no-store" }),
      );
    },
  );
  test.each<[string, (data: ReturnType<typeof extraction>) => void]>([
    [
      "cross-project receipt",
      (data) => {
        data.project_id = `prj_${"e".repeat(32)}`;
      },
    ],
    [
      "wrong latest version",
      (data) => {
        data.head.latest_version_id = otherVersion;
      },
    ],
    [
      "tampered content",
      (data) => {
        data.version.content.summary += " changed";
      },
    ],
    [
      "wrong hash",
      (data) => {
        data.version.content_hash = `sha256:${"0".repeat(64)}`;
      },
    ],
    [
      "invalid artifact binding",
      (data) => {
        data.version.artifact_id = `art_${"e".repeat(32)}`;
      },
    ],
    [
      "missing spans",
      (data) => {
        data.source_spans = [];
      },
    ],
    [
      "missing dependencies",
      (data) => {
        data.dependencies = [];
      },
    ],
    [
      "duplicate dependency",
      (data) => {
        data.dependencies.push({ ...data.dependencies[0]! });
      },
    ],
    [
      "wrong span role",
      (data) => {
        data.source_spans[0]!.role = "unknown";
      },
    ],
    [
      "empty byte range",
      (data) => {
        data.source_spans[0]!.end_byte = 0;
      },
    ],
    [
      "negative byte offset",
      (data) => {
        data.source_spans[0]!.start_byte = -1;
      },
    ],
    [
      "nonblocking dependency",
      (data) => {
        data.dependencies[0]!.impact = "informational";
      },
    ],
    [
      "wrong relationship",
      (data) => {
        data.dependencies[0]!.relationship = "references";
      },
    ],
    [
      "unbound proposal",
      (data) => {
        data.provenance.proposal_id = "invalid";
      },
    ],
    [
      "unbound attempt",
      (data) => {
        data.provenance.producer_attempt_id = "invalid";
      },
    ],
  ])("never exposes %s as FOUND", async (_label, change) => {
    const data = extraction();
    change(data);
    fetchMock.mockResolvedValue(reply(data, "revision-2"));
    expect(await transport.getSourceExtraction(projectId)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("rejects an extra untrusted receipt field", async () => {
    fetchMock.mockResolvedValue(reply({ ...extraction(), extra: true }, "revision-2"));
    expect(await transport.getSourceExtraction(projectId)).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  test("does not accept a latest-revision ETag for an immutable version", async () => {
    fetchMock.mockResolvedValue(reply(extraction(), "revision-2"));
    expect(await transport.getSourceExtractionVersion(projectId, versionId)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  test("historical reads bind the requested version even if the ETag matches", async () => {
    fetchMock.mockResolvedValue(reply(extraction(), hash));
    expect(await transport.getSourceExtractionVersion(projectId, otherVersion)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  test("hash verification failure stays unknown", async () => {
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn().mockRejectedValue(new Error("unavailable")) },
    });
    fetchMock.mockResolvedValue(reply(extraction(), "revision-2"));
    expect(await transport.getSourceExtraction(projectId)).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  test.each([
    [404, "SOURCE_EXTRACTION_NOT_FOUND", { kind: "NOT_FOUND" }],
    [409, "SOURCE_EXTRACTION_INCONSISTENT", { kind: "INCONSISTENT", request_id: requestId }],
    [500, "SOURCE_EXTRACTION_NOT_FOUND", { kind: "REMOTE_UNKNOWN" }],
    [404, "PROJECT_NOT_FOUND", { kind: "REMOTE_UNKNOWN" }],
  ] as const)("classifies verified %i %s", async (status, code, expected) => {
    fetchMock.mockResolvedValue(rejection(status, code));
    expect(await transport.getSourceExtraction(projectId)).toEqual(expected);
  });
  test("a retryable 404 cannot establish absence", async () => {
    fetchMock.mockResolvedValue(rejection(404, "SOURCE_EXTRACTION_NOT_FOUND", true));
    expect(await transport.getSourceExtraction(projectId)).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  test("rejects invalid path identities without sending requests", async () => {
    await expect(transport.getSourceExtraction("../escape")).rejects.toThrow("canonical project");
    await expect(transport.getSourceExtractionVersion(projectId, "../escape")).rejects.toThrow(
      "canonical version",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("source proposal acceptance", () => {
  test.each([false, true])(
    "preserves current=%s without treating historical acceptance as current",
    async (current) => {
      const data = acceptance(current);
      fetchMock.mockResolvedValue(reply(data, hash));
      expect(await transport.getSourceProposalAcceptanceForVersion(projectId, versionId)).toEqual({
        kind: "FOUND",
        receipt: {
          data: {
            acceptance_id: data.acceptance_id,
            project_id: projectId,
            source_extraction_version_id: versionId,
            source_extraction_content_hash: hash,
            latest_version_id: data.latest_version_id,
            current,
          },
        },
      });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `/api/v1/projects/${projectId}/source-extraction/versions/${versionId}/proposal-acceptance`,
        expect.objectContaining({ method: "GET" }),
      );
    },
  );
  test.each([
    { current: false },
    { latest_version_id: otherVersion },
    { latest_head_revision: 0 },
    { project_id: `prj_${"f".repeat(32)}` },
    { source_extraction_version_id: otherVersion },
    { accepted_as_draft_at: "not-a-date" },
    { acceptance_id: "invalid" },
    { source_extraction_content_hash: "invalid" },
    { proposal_id: "invalid" },
    { extra: true },
  ])("refuses inconsistent acceptance: %j", async (patch) => {
    fetchMock.mockResolvedValue(reply({ ...acceptance(), ...patch }, hash));
    expect(await transport.getSourceProposalAcceptanceForVersion(projectId, versionId)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("rejects an acceptance without its content ETag", async () => {
    fetchMock.mockResolvedValue(reply(acceptance(), "revision-2"));
    expect(await transport.getSourceProposalAcceptanceForVersion(projectId, versionId)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  test.each([
    [401, "SIDECAR_AUTH_REQUIRED"],
    [403, "SIDECAR_REQUEST_REJECTED"],
    [404, "SOURCE_PROPOSAL_ACCEPTANCE_NOT_FOUND"],
    [409, "SOURCE_PROPOSAL_ACCEPTANCE_INCONSISTENT"],
    [422, "VALIDATION_ERROR"],
  ] as const)("preserves verified %i %s", async (status, code) => {
    fetchMock.mockResolvedValue(rejection(status, code));
    expect(await transport.getSourceProposalAcceptanceForVersion(projectId, versionId)).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code,
      request_id: requestId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
