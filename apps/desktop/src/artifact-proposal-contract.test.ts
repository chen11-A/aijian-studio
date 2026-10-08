import { describe, expect, test, vi } from "vitest";

import {
  ARTIFACT_PROPOSAL_CHANNELS,
  createArtifactProposalPreload,
  isArtifactProposalDraftAcceptanceResponse,
  isArtifactProposalRejectionResponse,
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

const acceptanceResponse = {
  data: {
    acceptance_id: `pda_${"d".repeat(32)}`,
    project_id: projectId,
    proposal_id: proposalId,
    draft_version_id: `ver_${"e".repeat(32)}`,
    actor_id: "local-reviewer",
    accepted_as_draft_at: "2026-08-11T09:05:00Z",
    replayed: false,
  },
  request_id: requestId,
};

const rejectionResponse = {
  data: {
    rejection_id: `pdr_${"f".repeat(32)}`,
    project_id: projectId,
    proposal_id: proposalId,
    proposal_hash: `sha256:${"4".repeat(64)}`,
    reason_code: "SOURCE_EVIDENCE",
    comment: "原文证据不足。",
    actor_id: "local-reviewer",
    rejected_at: "2026-08-11T09:06:00Z",
    replayed: false,
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
    expect(ARTIFACT_PROPOSAL_CHANNELS).toEqual({
      get: "proposals:get",
      acceptAsDraft: "proposals:accept-as-draft",
      reject: "proposals:reject",
    });
    expect(Object.isFrozen(ARTIFACT_PROPOSAL_CHANNELS)).toBe(true);

    const acceptanceResult = { kind: "SUCCEEDED", receipt: acceptanceResponse } as const;
    const rejectionResult = { kind: "SUCCEEDED", receipt: rejectionResponse } as const;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(acceptanceResult)
      .mockResolvedValueOnce(rejectionResult);
    const preload = createArtifactProposalPreload(invoke);
    await expect(preload.getArtifactProposal(projectId, proposalId)).resolves.toEqual(response);
    await expect(
      preload.acceptArtifactProposalAsDraft(projectId, proposalId, {
        parent_version_id: null,
        expected_head_revision: null,
      }),
    ).resolves.toEqual(acceptanceResult);
    await expect(
      preload.rejectArtifactProposal(projectId, proposalId, {
        reason_code: "SOURCE_EVIDENCE",
        comment: "原文证据不足。",
      }),
    ).resolves.toEqual(rejectionResult);
    expect(invoke).toHaveBeenCalledWith("proposals:get", projectId, proposalId);
    expect(invoke).toHaveBeenNthCalledWith(2, "proposals:accept-as-draft", projectId, proposalId, {
      parent_version_id: null,
      expected_head_revision: null,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "proposals:reject", projectId, proposalId, {
      reason_code: "SOURCE_EVIDENCE",
      comment: "原文证据不足。",
    });

    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    const client = {
      getArtifactProposal: vi.fn().mockResolvedValue(response),
      acceptArtifactProposalAsDraft: vi.fn().mockResolvedValue(acceptanceResult),
      rejectArtifactProposal: vi.fn().mockResolvedValue(rejectionResult),
    };
    registerArtifactProposalHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => client,
    );
    await listeners.get("proposals:get")!({}, projectId, proposalId);
    await listeners.get("proposals:accept-as-draft")!({}, projectId, proposalId, {
      parent_version_id: null,
      expected_head_revision: null,
    });
    await listeners.get("proposals:reject")!({}, projectId, proposalId, {
      reason_code: "SOURCE_EVIDENCE",
      comment: "原文证据不足。",
    });
    expect([...listeners]).toHaveLength(3);
    expect(client.getArtifactProposal).toHaveBeenCalledWith(projectId, proposalId);
    expect(client.acceptArtifactProposalAsDraft).toHaveBeenCalledWith(projectId, proposalId, {
      parent_version_id: null,
      expected_head_revision: null,
    });
    expect(client.rejectArtifactProposal).toHaveBeenCalledWith(projectId, proposalId, {
      reason_code: "SOURCE_EVIDENCE",
      comment: "原文证据不足。",
    });
  });

  test("validates project-scoped terminal decision responses", () => {
    expect(
      isArtifactProposalDraftAcceptanceResponse(acceptanceResponse, projectId, proposalId),
    ).toBe(true);
    expect(isArtifactProposalRejectionResponse(rejectionResponse, projectId, proposalId)).toBe(
      true,
    );

    const detached = structuredClone(acceptanceResponse);
    detached.data.project_id = `prj_${"0".repeat(32)}`;
    expect(isArtifactProposalDraftAcceptanceResponse(detached, projectId, proposalId)).toBe(false);
    const extra = structuredClone(rejectionResponse) as unknown as {
      data: Record<string, unknown>;
    };
    extra.data.token = "must-not-cross-ipc";
    expect(isArtifactProposalRejectionResponse(extra, projectId, proposalId)).toBe(false);

    const nonCanonical = structuredClone(rejectionResponse);
    nonCanonical.data.comment = "  证据不足。\r\n";
    expect(isArtifactProposalRejectionResponse(nonCanonical, projectId, proposalId)).toBe(false);

    const oversized = structuredClone(rejectionResponse);
    oversized.data.comment = "证".repeat(4001);
    expect(isArtifactProposalRejectionResponse(oversized, projectId, proposalId)).toBe(false);
  });
});
