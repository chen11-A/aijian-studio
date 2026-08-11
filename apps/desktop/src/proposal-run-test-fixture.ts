import { createHash } from "node:crypto";

import type { CreatedProposalRunResponse, ProposalRunCreateCommand } from "./proposal-run-contract";
import { proposalRunIdempotencyKey } from "./proposal-run-contract";

export const proposalRunProjectId = `prj_${"a".repeat(32)}`;
export const proposalRunCommand: ProposalRunCreateCommand = {
  operation_id: "7e0df32e-299a-4bb7-b77e-b85f20c41d61",
  input: {
    agent_definition: { definition_id: "writer.source-analyst", version: "1.0.0" },
    skill_definition: { definition_id: "source.extract", version: "1.0.0" },
    source_manifest_version_id: `ver_${"1".repeat(32)}`,
    source_document_id: `src_${"2".repeat(32)}`,
    source_block_id: `srcb_${"3".repeat(32)}`,
    start_byte: 0,
    end_byte: 24,
  },
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function createdProposalRunResponse(
  sourceOverride: { ref?: string; byte_count?: number } = {},
): CreatedProposalRunResponse {
  const clientKeyHash = hash({ value: proposalRunIdempotencyKey(proposalRunCommand) });
  const identitySeed = {
    project_id: proposalRunProjectId,
    client_idempotency_key_hash: clientKeyHash,
  };
  const executionIdempotencyKey = `proposal-run:${hash(identitySeed)}`;
  const agentRunId = `agr_${hash({ ...identitySeed, kind: "agent" }).slice(7, 39)}`;
  const skillRunId = `skr_${hash({ ...identitySeed, kind: "skill" }).slice(7, 39)}`;
  const sourceContentHash = `sha256:${"4".repeat(64)}`;
  const sourceSpanId = `spn_${hash({
    project_id: proposalRunProjectId,
    source_document_id: proposalRunCommand.input.source_document_id,
    source_block_id: proposalRunCommand.input.source_block_id,
    start_byte: proposalRunCommand.input.start_byte,
    end_byte: proposalRunCommand.input.end_byte,
    content_sha256: sourceContentHash.slice(7),
  }).slice(7, 39)}`;
  const entries = [
    {
      kind: "ROLE_INVARIANTS" as const,
      ref: "agent:writer.source-analyst",
      version: "1.0.0",
      content_hash: `sha256:${"1".repeat(64)}`,
      trust_level: "SYSTEM_INSTRUCTION" as const,
      byte_count: 10,
      truncation_reason: null,
    },
    {
      kind: "SKILL_INSTRUCTIONS" as const,
      ref: "skill:source.extract",
      version: "1.0.0",
      content_hash: `sha256:${"2".repeat(64)}`,
      trust_level: "SYSTEM_INSTRUCTION" as const,
      byte_count: 11,
      truncation_reason: null,
    },
    {
      kind: "APPROVED_ARTIFACT" as const,
      ref: `artifact:SourceManifest/${proposalRunCommand.input.source_manifest_version_id}`,
      version: "1.0.0",
      content_hash: `sha256:${"3".repeat(64)}`,
      trust_level: "APPROVED_ARTIFACT" as const,
      byte_count: 12,
      truncation_reason: null,
    },
    {
      kind: "SOURCE_SPAN" as const,
      ref: sourceOverride.ref ?? `source:${sourceSpanId}`,
      version: "source-v1",
      content_hash: sourceContentHash,
      trust_level: "UNTRUSTED_CONTENT" as const,
      byte_count: sourceOverride.byte_count ?? 24,
      truncation_reason: null,
    },
    {
      kind: "TASK_OUTPUT_SCHEMA" as const,
      ref: "schema:SourceExtractionProposal",
      version: "1.0.0",
      content_hash: `sha256:${"5".repeat(64)}`,
      trust_level: "SYSTEM_INSTRUCTION" as const,
      byte_count: 13,
      truncation_reason: null,
    },
  ];
  const totalByteCount = entries.reduce((total, entry) => total + entry.byte_count, 0);
  const manifestPayload = {
    project_id: proposalRunProjectId,
    agent_definition: proposalRunCommand.input.agent_definition,
    skill_definition: proposalRunCommand.input.skill_definition,
    entries,
    total_byte_count: totalByteCount,
  };
  const manifestHash = hash(manifestPayload);
  const contextManifestId = `ctx_${manifestHash.slice(7, 39)}`;
  const inputHash = hash({
    project_id: proposalRunProjectId,
    ...proposalRunCommand.input,
    context_manifest_hash: manifestHash,
  });
  const capabilitySnapshotHash = hash({
    provider_connection_id: "provider:local-fake",
    model_id: "deterministic-fake-v1",
    capabilities: ["LOCAL_FAKE_TEXT"],
  });
  const fingerprintPayload = {
    project_id: proposalRunProjectId,
    agent_run_id: agentRunId,
    skill_run_id: skillRunId,
    output_artifact_type: "SourceExtraction",
    agent_definition_id: "writer.source-analyst",
    agent_version: "1.0.0",
    skill_definition_id: "source.extract",
    skill_version: "1.0.0",
    prompt_version: "prompt.source-extract@1.0.0",
    policy_version: "policy.local-safe@1.0.0",
    provider_connection_id: "provider:local-fake",
    model_id: "deterministic-fake-v1",
    capability_snapshot_hash: capabilitySnapshotHash,
    input_hash: inputHash,
    output_schema_version: "1.0.0",
    idempotency_key: executionIdempotencyKey,
  };
  const attemptId = `att_${"b".repeat(32)}`;
  return {
    data: {
      project_id: proposalRunProjectId,
      run_id: agentRunId,
      agent_run: {
        schema_version: "1.0.0",
        agent_run_id: agentRunId,
        project_id: proposalRunProjectId,
        agent_definition: proposalRunCommand.input.agent_definition,
        status: "PENDING",
        delegated_skill_run_ids: [skillRunId],
      },
      skill_run: {
        schema_version: "1.0.0",
        skill_run_id: skillRunId,
        project_id: proposalRunProjectId,
        agent_run_id: agentRunId,
        skill_definition: proposalRunCommand.input.skill_definition,
        context_manifest_id: contextManifestId,
        status: "PENDING",
        proposal_id: null,
      },
      context_manifest: {
        schema_version: "1.0.0",
        context_manifest_id: contextManifestId,
        ...manifestPayload,
        manifest_hash: manifestHash,
      },
      agent_revision: 1,
      skill_revision: 1,
      created_at: "2026-08-11T05:00:00Z",
      updated_at: "2026-08-11T05:00:00Z",
      task: {
        workflow_run_id: `wfr_${"9".repeat(32)}`,
        node_run_id: `node_${"a".repeat(32)}`,
        attempt_id: attemptId,
        task_id: `task_${"c".repeat(32)}`,
      },
      attempt: {
        schema_version: "1.0.0",
        attempt_id: attemptId,
        ...fingerprintPayload,
        attempt_fingerprint: hash(fingerprintPayload),
      },
    },
    request_id: "88ed7974-adc3-4e35-a5c8-38b9674fc45c",
  };
}
