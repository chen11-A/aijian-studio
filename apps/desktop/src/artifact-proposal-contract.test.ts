import { describe, expect, test, vi } from "vitest";

import {
  ARTIFACT_PROPOSAL_CHANNELS,
  createArtifactProposalPreload,
  isArtifactProposalResponse,
  registerArtifactProposalHandlers,
} from "./artifact-proposal-contract";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const projectId = `prj_${"1".repeat(32)}`;
const proposalId = `prp_${"2".repeat(32)}`;

const response = {
  data: {
    project_id: projectId,
    proposal_id: proposalId,
    producer_attempt_id: `att_${"3".repeat(32)}`,
    proposal_hash: `sha256:${"4".repeat(64)}`,
    created_at: "2026-08-11T09:00:00Z",
    proposal: {
      schema_version: "1.0.0",
      proposal_id: proposalId,
      project_id: projectId,
      target_artifact_type: "SourceExtraction",
      payload: { summary: "A source-grounded extraction" },
      payload_hash: `sha256:${"5".repeat(64)}`,
      source_spans: [
        {
          source_span_id: `spn_${"6".repeat(32)}`,
          source_document_id: `src_${"7".repeat(32)}`,
          source_block_id: `srcb_${"8".repeat(32)}`,
          start_byte: 0,
          end_byte: 12,
          claim: "The letter is unsigned.",
          quote_hash: `sha256:${"9".repeat(64)}`,
        },
      ],
      claims: [
        {
          claim_id: `clm_${"a".repeat(32)}`,
          text: "The letter is unsigned.",
          invented: false,
          source_span_ids: [`spn_${"6".repeat(32)}`],
        },
      ],
      diff: [],
      dependencies: [],
      impacts: [],
      cost: { currency: "USD", estimated_micros: 0, actual_micros: 0 },
      confidence_basis_points: 9200,
      capability_losses: [],
      qc: [{ check_id: "source.evidence", status: "PASS", details: "Evidence bound" }],
      producer_agent_run_id: `agr_${"b".repeat(32)}`,
      producer_skill_run_id: `skr_${"c".repeat(32)}`,
    },
  },
  request_id: requestId,
};

describe("artifact proposal read boundary", () => {
  test("accepts only the exact project-scoped published response", () => {
    expect(isArtifactProposalResponse(response, projectId, proposalId)).toBe(true);

    const detached = structuredClone(response);
    detached.data.proposal.project_id = `prj_${"d".repeat(32)}`;
    expect(isArtifactProposalResponse(detached, projectId, proposalId)).toBe(false);

    const invalidRange = structuredClone(response);
    invalidRange.data.proposal.source_spans[0]!.end_byte = 0;
    expect(isArtifactProposalResponse(invalidRange, projectId, proposalId)).toBe(false);

    const extra = structuredClone(response) as unknown as { data: Record<string, unknown> };
    extra.data.api_key = "must-not-cross-ipc";
    expect(isArtifactProposalResponse(extra, projectId, proposalId)).toBe(false);

    const nestedSecret = structuredClone(response) as unknown as {
      data: { proposal: { payload: Record<string, unknown> } };
    };
    nestedSecret.data.proposal.payload = { nested: { api_key: "must-not-cross-ipc" } };
    expect(isArtifactProposalResponse(nestedSecret, projectId, proposalId)).toBe(false);
  });

  test("keeps the preload and main handler exact-keyed and read-only", async () => {
    expect(ARTIFACT_PROPOSAL_CHANNELS).toEqual({ get: "proposals:get" });
    expect(Object.isFrozen(ARTIFACT_PROPOSAL_CHANNELS)).toBe(true);

    const invoke = vi.fn().mockResolvedValue(response);
    const preload = createArtifactProposalPreload(invoke);
    await expect(preload.getArtifactProposal(projectId, proposalId)).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledWith("proposals:get", projectId, proposalId);

    const listeners = new Map<
      string,
      (event: object, scopedProjectId: string, scopedProposalId: string) => Promise<unknown>
    >();
    const client = { getArtifactProposal: vi.fn().mockResolvedValue(response) };
    registerArtifactProposalHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => client,
    );
    await listeners.get("proposals:get")!({}, projectId, proposalId);
    expect([...listeners]).toHaveLength(1);
    expect(client.getArtifactProposal).toHaveBeenCalledWith(projectId, proposalId);
  });
});
