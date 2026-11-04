import { describe, expect, it, vi } from "vitest";
import type { SourceExtractionResponse } from "../../api/studio";
import {
  readAcceptedSummary,
  sameAcceptedSummary,
  summaryStartingScene,
  type SummaryGateway,
} from "./acceptedSourceSummary";
const project = `prj_${"a".repeat(32)}`,
  version = `ver_${"b".repeat(32)}`;
const hash = `sha256:${"c".repeat(64)}`,
  acceptance = `pda_${"d".repeat(32)}`;
function setup() {
  const data: SourceExtractionResponse["data"] = {
    project_id: project,
    head: {
      artifact_id: `art_${"e".repeat(32)}`,
      latest_version_id: version,
      review_version_id: null,
      review_submission_id: null,
      accepted_version_id: null,
      revision: 1,
      review_evidence_revision: 1,
      updated_at: "2026-10-08T00:00:00Z",
    },
    version: {
      id: version,
      artifact_id: `art_${"e".repeat(32)}`,
      version_number: 1,
      schema_version: "1.0.0",
      content: { summary: "测试人物在雨中归还一本书。" },
      content_hash: hash,
      parent_version_id: null,
      change_summary: "accepted proposal",
      created_at: "2026-10-08T00:00:00Z",
    },
    source_spans: [],
    dependencies: [],
    provenance: {
      producer_attempt_id: `att_${"f".repeat(32)}`,
      proposal_id: `prp_${"1".repeat(32)}`,
    },
  };
  const accepted = {
    acceptance_id: acceptance,
    project_id: project,
    source_extraction_version_id: version,
    source_extraction_content_hash: hash,
    latest_version_id: version,
    current: true,
  };
  const gateway: SummaryGateway = {
    getSourceExtraction: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data, request_id: "test" } }),
    getSourceProposalAcceptanceForVersion: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: { data: accepted } }),
  };
  return { data, accepted, gateway };
}
describe("accepted source summary starting material", () => {
  it("reads only an exact current human acceptance and retains its binding", async () => {
    const { gateway } = setup();
    const value = await readAcceptedSummary(gateway, project);
    expect(value).toEqual({
      kind: "FOUND",
      value: {
        summary: "测试人物在雨中归还一本书。",
        contentHash: hash,
        binding: { sourceVersionId: version, acceptanceId: acceptance },
      },
    });
    expect(gateway.getSourceProposalAcceptanceForVersion).toHaveBeenCalledExactlyOnceWith(
      project,
      version,
    );
  });
  it.each(["project", "version", "hash", "current", "summary"])(
    "rejects inconsistent %s",
    async (field) => {
      const { gateway, accepted, data } = setup();
      if (field === "project") accepted.project_id = `prj_${"9".repeat(32)}`;
      if (field === "version") accepted.latest_version_id = `ver_${"9".repeat(32)}`;
      if (field === "hash") accepted.source_extraction_content_hash = `sha256:${"9".repeat(64)}`;
      if (field === "current") accepted.current = false;
      if (field === "summary") data.version.content.summary = "   ";
      expect(await readAcceptedSummary(gateway, project)).toEqual({ kind: "UNKNOWN" });
    },
  );
  it("does not import unaccepted candidates or hide failed reads", async () => {
    const { gateway } = setup();
    vi.mocked(gateway.getSourceProposalAcceptanceForVersion).mockResolvedValue({
      kind: "NOT_FOUND",
    });
    expect(await readAcceptedSummary(gateway, project)).toEqual({ kind: "EMPTY" });
    vi.mocked(gateway.getSourceExtraction).mockRejectedValue(new Error("offline"));
    expect(await readAcceptedSummary(gateway, project)).toEqual({ kind: "UNKNOWN" });
  });
  it("makes editable source material without pretending to generate scenes", () => {
    const scene = summaryStartingScene("原样保留的摘要。");
    expect(scene?.heading).toBe("来源摘要 · 待改编");
    expect(scene?.blocks).toHaveLength(1);
    expect(scene?.blocks[0]).toMatchObject({
      kind: "ACTION",
      text: "原样保留的摘要。",
      speaker: null,
      delivery: null,
    });
    expect(summaryStartingScene(" ")).toBeNull();
    expect(summaryStartingScene("x".repeat(10001))).toBeNull();
  });
  it("requires unchanged content, version, and acceptance at import time", () => {
    const value = {
      summary: "summary",
      contentHash: hash,
      binding: { sourceVersionId: version, acceptanceId: acceptance },
    };
    expect(sameAcceptedSummary(value, structuredClone(value))).toBe(true);
    for (const next of [
      { ...value, summary: "changed" },
      { ...value, contentHash: "changed" },
      { ...value, binding: { ...value.binding, sourceVersionId: "changed" } },
      { ...value, binding: { ...value.binding, acceptanceId: "changed" } },
    ])
      expect(sameAcceptedSummary(value, next)).toBe(false);
  });
});
