import { createHash } from "node:crypto";

import type { components } from "@aijian/contracts";

import type { LocalApiClient } from "./api-client";
import { hasOnlyKeys, isRecord } from "./api-contract-guards";

export type ProposalRunCreateInput = components["schemas"]["CreateProposalRunRequest"];
export type CreatedProposalRunResponse = components["schemas"]["CreatedProposalRunResponse"];
export type ProposalRunCreateCommand = {
  operation_id: string;
  input: ProposalRunCreateInput;
};
export type ProposalRunCreateResult =
  | { kind: "SUCCEEDED"; receipt: CreatedProposalRunResponse; replayed: boolean }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export const PROPOSAL_RUN_CHANNELS = Object.freeze({ create: "proposal-runs:create" } as const);

type ProposalRunClient = Pick<LocalApiClient, "createProposalRun">;
type ProposalRunInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const SOURCE_ID = /^src_[0-9a-f]{32}$/;
const SOURCE_BLOCK_ID = /^srcb_[0-9a-f]{32}$/;
const AGENT_RUN_ID = /^agr_[0-9a-f]{32}$/;
const SKILL_RUN_ID = /^skr_[0-9a-f]{32}$/;
const CONTEXT_ID = /^ctx_[0-9a-f]{32}$/;
const PROPOSAL_ID = /^prp_[0-9a-f]{32}$/;
const WORKFLOW_RUN_ID = /^wfr_[0-9a-f]{32}$/;
const NODE_RUN_ID = /^node_[0-9a-f]{32}$/;
const ATTEMPT_ID = /^att_[0-9a-f]{32}$/;
const TASK_ID = /^task_[0-9a-f]{32}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENT_STATUSES = new Set([
  "PENDING",
  "RUNNING",
  "NEEDS_REVIEW",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
const SKILL_STATUSES = new Set([
  "PENDING",
  "RUNNING",
  "NEEDS_REVIEW",
  "SUCCEEDED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "REMOTE_UNKNOWN",
]);
const CONTEXT_KINDS = new Set([
  "ROLE_INVARIANTS",
  "SKILL_INSTRUCTIONS",
  "APPROVED_ARTIFACT",
  "SOURCE_SPAN",
  "TASK_OUTPUT_SCHEMA",
]);
const TRUST_LEVELS = new Set(["SYSTEM_INSTRUCTION", "APPROVED_ARTIFACT", "UNTRUSTED_CONTENT"]);
const SENSITIVE_KEY_SUFFIXES = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "signingkey",
  "password",
  "passwd",
  "secret",
  "cookie",
  "authorization",
  "credential",
  "credentials",
  "bearer",
  "auth",
  "token",
] as const;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) || hasSensitiveKey(child)
    );
  });
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isSafeNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Proposal run identity is not JSON compatible");
  return encoded;
}

function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function proposalRunIdempotencyKey(command: ProposalRunCreateCommand): string {
  return `proposal-run:create:v1:${command.operation_id}`;
}

function isDefinitionRef(
  value: unknown,
  definitionId: "writer.source-analyst" | "source.extract",
): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["definition_id", "version"]) &&
    value.definition_id === definitionId &&
    value.version === "1.0.0"
  );
}

export function isProposalRunCreateCommand(value: unknown): value is ProposalRunCreateCommand {
  if (!isRecord(value) || !hasOnlyKeys(value, ["operation_id", "input"])) return false;
  if (typeof value.operation_id !== "string" || !OPERATION_ID.test(value.operation_id))
    return false;
  const input = value.input;
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, [
      "agent_definition",
      "skill_definition",
      "source_manifest_version_id",
      "source_document_id",
      "source_block_id",
      "start_byte",
      "end_byte",
    ])
  ) {
    return false;
  }
  return (
    isDefinitionRef(input.agent_definition, "writer.source-analyst") &&
    isDefinitionRef(input.skill_definition, "source.extract") &&
    typeof input.source_manifest_version_id === "string" &&
    VERSION_ID.test(input.source_manifest_version_id) &&
    typeof input.source_document_id === "string" &&
    SOURCE_ID.test(input.source_document_id) &&
    typeof input.source_block_id === "string" &&
    SOURCE_BLOCK_ID.test(input.source_block_id) &&
    Number.isSafeInteger(input.start_byte) &&
    Number(input.start_byte) >= 0 &&
    Number.isSafeInteger(input.end_byte) &&
    Number(input.end_byte) > Number(input.start_byte) &&
    Number(input.end_byte) - Number(input.start_byte) <= 64 * 1024
  );
}

function isResponseDefinitionRef(value: unknown, definitionId: string): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["definition_id", "version"]) &&
    value.definition_id === definitionId &&
    value.version === "1.0.0"
  );
}

function isContextEntry(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "kind",
      "ref",
      "version",
      "content_hash",
      "byte_count",
      "trust_level",
      "truncation_reason",
    ])
  )
    return false;
  return (
    typeof value.kind === "string" &&
    CONTEXT_KINDS.has(value.kind) &&
    typeof value.ref === "string" &&
    value.ref.length > 0 &&
    typeof value.version === "string" &&
    value.version.length > 0 &&
    typeof value.content_hash === "string" &&
    CONTENT_HASH.test(value.content_hash) &&
    isSafeNonNegativeInteger(value.byte_count) &&
    typeof value.trust_level === "string" &&
    TRUST_LEVELS.has(value.trust_level) &&
    (value.truncation_reason === undefined ||
      value.truncation_reason === null ||
      typeof value.truncation_reason === "string")
  );
}

function contextEntry(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function isCreatedProposalRunResponse(
  value: unknown,
  projectId: string,
  command: ProposalRunCreateCommand,
  fresh: boolean,
): value is CreatedProposalRunResponse {
  if (
    !PROJECT_ID.test(projectId) ||
    !isProposalRunCreateCommand(command) ||
    !isRecord(value) ||
    !hasExactKeys(value, ["data", "request_id"]) ||
    typeof value.request_id !== "string" ||
    !REQUEST_ID.test(value.request_id) ||
    hasSensitiveKey(value)
  )
    return false;
  const data = value.data;
  if (
    !isRecord(data) ||
    !hasExactKeys(data, [
      "project_id",
      "run_id",
      "agent_run",
      "skill_run",
      "context_manifest",
      "agent_revision",
      "skill_revision",
      "created_at",
      "updated_at",
      "task",
      "attempt",
    ]) ||
    data.project_id !== projectId ||
    typeof data.run_id !== "string" ||
    !AGENT_RUN_ID.test(data.run_id) ||
    !Number.isSafeInteger(data.agent_revision) ||
    Number(data.agent_revision) < 1 ||
    !Number.isSafeInteger(data.skill_revision) ||
    Number(data.skill_revision) < 1 ||
    !isDateTime(data.created_at) ||
    !isDateTime(data.updated_at) ||
    Date.parse(data.created_at) > Date.parse(data.updated_at)
  )
    return false;

  const agent = data.agent_run;
  const skill = data.skill_run;
  const context = data.context_manifest;
  const task = data.task;
  const attempt = data.attempt;
  if (
    !isRecord(agent) ||
    !isRecord(skill) ||
    !isRecord(context) ||
    !isRecord(task) ||
    !isRecord(attempt)
  )
    return false;
  const clientKeyHash = canonicalSha256({ value: proposalRunIdempotencyKey(command) });
  const identitySeed = {
    project_id: projectId,
    client_idempotency_key_hash: clientKeyHash,
  };
  const executionIdempotencyKey = `proposal-run:${canonicalSha256(identitySeed)}`;
  const agentRunId = `agr_${canonicalSha256({ ...identitySeed, kind: "agent" }).slice(7, 39)}`;
  const skillRunId = `skr_${canonicalSha256({ ...identitySeed, kind: "skill" }).slice(7, 39)}`;
  if (
    !hasExactKeys(agent, [
      "schema_version",
      "agent_run_id",
      "project_id",
      "agent_definition",
      "status",
      "delegated_skill_run_ids",
    ]) ||
    agent.schema_version !== "1.0.0" ||
    agent.agent_run_id !== data.run_id ||
    agent.agent_run_id !== agentRunId ||
    agent.project_id !== projectId ||
    !isResponseDefinitionRef(agent.agent_definition, "writer.source-analyst") ||
    typeof agent.status !== "string" ||
    !AGENT_STATUSES.has(agent.status) ||
    !Array.isArray(agent.delegated_skill_run_ids) ||
    agent.delegated_skill_run_ids.length !== 1
  )
    return false;
  if (
    !hasExactKeys(skill, [
      "schema_version",
      "skill_run_id",
      "project_id",
      "agent_run_id",
      "skill_definition",
      "context_manifest_id",
      "status",
      "proposal_id",
    ]) ||
    skill.schema_version !== "1.0.0" ||
    typeof skill.skill_run_id !== "string" ||
    !SKILL_RUN_ID.test(skill.skill_run_id) ||
    skill.skill_run_id !== skillRunId ||
    agent.delegated_skill_run_ids[0] !== skill.skill_run_id ||
    skill.project_id !== projectId ||
    skill.agent_run_id !== data.run_id ||
    !isResponseDefinitionRef(skill.skill_definition, "source.extract") ||
    typeof skill.context_manifest_id !== "string" ||
    !CONTEXT_ID.test(skill.context_manifest_id) ||
    typeof skill.status !== "string" ||
    !SKILL_STATUSES.has(skill.status) ||
    !(
      skill.proposal_id === null ||
      (typeof skill.proposal_id === "string" && PROPOSAL_ID.test(skill.proposal_id))
    )
  )
    return false;
  const legalStatusPair =
    (agent.status === "PENDING" && skill.status === "PENDING" && skill.proposal_id === null) ||
    (agent.status === "RUNNING" && skill.status === "RUNNING" && skill.proposal_id === null) ||
    (agent.status === "NEEDS_REVIEW" &&
      skill.status === "NEEDS_REVIEW" &&
      typeof skill.proposal_id === "string") ||
    (agent.status === "SUCCEEDED" &&
      skill.status === "SUCCEEDED" &&
      typeof skill.proposal_id === "string") ||
    (agent.status === "FAILED" && skill.status === "FAILED") ||
    (agent.status === "CANCELLED" && skill.status === "CANCELLED");
  if (!legalStatusPair || (fresh && agent.status !== "PENDING")) return false;

  if (
    !hasExactKeys(context, [
      "schema_version",
      "context_manifest_id",
      "project_id",
      "agent_definition",
      "skill_definition",
      "entries",
      "total_byte_count",
      "manifest_hash",
    ]) ||
    context.schema_version !== "1.0.0" ||
    context.context_manifest_id !== skill.context_manifest_id ||
    context.project_id !== projectId ||
    !isResponseDefinitionRef(context.agent_definition, "writer.source-analyst") ||
    !isResponseDefinitionRef(context.skill_definition, "source.extract") ||
    !Array.isArray(context.entries) ||
    context.entries.length !== 5 ||
    !context.entries.every(isContextEntry) ||
    !isSafeNonNegativeInteger(context.total_byte_count) ||
    typeof context.manifest_hash !== "string" ||
    !CONTENT_HASH.test(context.manifest_hash)
  )
    return false;
  const entries = context.entries.map(contextEntry);
  if (entries.some((entry) => entry === null)) return false;
  const [roleEntry, skillEntry, approvedEntry, sourceEntry, schemaEntry] = entries as [
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  const sourceContentDigest =
    typeof sourceEntry.content_hash === "string" ? sourceEntry.content_hash.slice(7) : "";
  const sourceSpanId = `spn_${canonicalSha256({
    project_id: projectId,
    source_document_id: command.input.source_document_id,
    source_block_id: command.input.source_block_id,
    start_byte: command.input.start_byte,
    end_byte: command.input.end_byte,
    content_sha256: sourceContentDigest,
  }).slice(7, 39)}`;
  if (
    roleEntry.kind !== "ROLE_INVARIANTS" ||
    roleEntry.ref !== "agent:writer.source-analyst" ||
    roleEntry.version !== "1.0.0" ||
    roleEntry.trust_level !== "SYSTEM_INSTRUCTION" ||
    skillEntry.kind !== "SKILL_INSTRUCTIONS" ||
    skillEntry.ref !== "skill:source.extract" ||
    skillEntry.version !== "1.0.0" ||
    skillEntry.trust_level !== "SYSTEM_INSTRUCTION" ||
    approvedEntry.kind !== "APPROVED_ARTIFACT" ||
    approvedEntry.ref !== `artifact:SourceManifest/${command.input.source_manifest_version_id}` ||
    approvedEntry.version !== "1.0.0" ||
    approvedEntry.trust_level !== "APPROVED_ARTIFACT" ||
    sourceEntry.kind !== "SOURCE_SPAN" ||
    sourceEntry.ref !== `source:${sourceSpanId}` ||
    sourceEntry.version !== "source-v1" ||
    sourceEntry.trust_level !== "UNTRUSTED_CONTENT" ||
    sourceEntry.byte_count !== command.input.end_byte - command.input.start_byte ||
    schemaEntry.kind !== "TASK_OUTPUT_SCHEMA" ||
    schemaEntry.ref !== "schema:SourceExtractionProposal" ||
    schemaEntry.version !== "1.0.0" ||
    schemaEntry.trust_level !== "SYSTEM_INSTRUCTION" ||
    Number(context.total_byte_count) !==
      entries.reduce((total, entry) => total + Number(entry?.byte_count), 0)
  )
    return false;
  const expectedManifestHash = canonicalSha256({
    project_id: projectId,
    agent_definition: context.agent_definition,
    skill_definition: context.skill_definition,
    entries: context.entries,
    total_byte_count: context.total_byte_count,
  });
  if (
    context.manifest_hash !== expectedManifestHash ||
    context.context_manifest_id !== `ctx_${expectedManifestHash.slice(7, 39)}`
  )
    return false;

  const inputHash = canonicalSha256({
    project_id: projectId,
    ...command.input,
    context_manifest_hash: expectedManifestHash,
  });
  const capabilitySnapshotHash = canonicalSha256({
    provider_connection_id: "provider:local-fake",
    model_id: "deterministic-fake-v1",
    capabilities: ["LOCAL_FAKE_TEXT"],
  });

  if (
    !hasExactKeys(task, ["workflow_run_id", "node_run_id", "attempt_id", "task_id"]) ||
    typeof task.workflow_run_id !== "string" ||
    !WORKFLOW_RUN_ID.test(task.workflow_run_id) ||
    typeof task.node_run_id !== "string" ||
    !NODE_RUN_ID.test(task.node_run_id) ||
    typeof task.attempt_id !== "string" ||
    !ATTEMPT_ID.test(task.attempt_id) ||
    typeof task.task_id !== "string" ||
    !TASK_ID.test(task.task_id)
  )
    return false;

  return (
    hasExactKeys(attempt, [
      "schema_version",
      "attempt_id",
      "project_id",
      "agent_run_id",
      "skill_run_id",
      "output_artifact_type",
      "agent_definition_id",
      "agent_version",
      "skill_definition_id",
      "skill_version",
      "prompt_version",
      "policy_version",
      "provider_connection_id",
      "model_id",
      "capability_snapshot_hash",
      "input_hash",
      "output_schema_version",
      "idempotency_key",
      "attempt_fingerprint",
    ]) &&
    attempt.schema_version === "1.0.0" &&
    attempt.attempt_id === task.attempt_id &&
    attempt.project_id === projectId &&
    attempt.agent_run_id === data.run_id &&
    attempt.skill_run_id === skill.skill_run_id &&
    attempt.output_artifact_type === "SourceExtraction" &&
    attempt.agent_definition_id === command.input.agent_definition.definition_id &&
    attempt.agent_version === command.input.agent_definition.version &&
    attempt.skill_definition_id === command.input.skill_definition.definition_id &&
    attempt.skill_version === command.input.skill_definition.version &&
    attempt.prompt_version === "prompt.source-extract@1.0.0" &&
    attempt.policy_version === "policy.local-safe@1.0.0" &&
    attempt.provider_connection_id === "provider:local-fake" &&
    attempt.model_id === "deterministic-fake-v1" &&
    attempt.capability_snapshot_hash === capabilitySnapshotHash &&
    attempt.input_hash === inputHash &&
    attempt.output_schema_version === "1.0.0" &&
    attempt.idempotency_key === executionIdempotencyKey &&
    attempt.attempt_fingerprint ===
      canonicalSha256({
        project_id: projectId,
        agent_run_id: agentRunId,
        skill_run_id: skillRunId,
        output_artifact_type: "SourceExtraction",
        agent_definition_id: command.input.agent_definition.definition_id,
        agent_version: command.input.agent_definition.version,
        skill_definition_id: command.input.skill_definition.definition_id,
        skill_version: command.input.skill_definition.version,
        prompt_version: "prompt.source-extract@1.0.0",
        policy_version: "policy.local-safe@1.0.0",
        provider_connection_id: "provider:local-fake",
        model_id: "deterministic-fake-v1",
        capability_snapshot_hash: capabilitySnapshotHash,
        input_hash: inputHash,
        output_schema_version: "1.0.0",
        idempotency_key: executionIdempotencyKey,
      })
  );
}

export function createProposalRunPreload(invoke: ProposalRunInvoke): {
  createProposalRun(
    projectId: string,
    command: ProposalRunCreateCommand,
  ): Promise<ProposalRunCreateResult>;
} {
  return {
    createProposalRun: (projectId, command) =>
      invoke(PROPOSAL_RUN_CHANNELS.create, projectId, command) as Promise<ProposalRunCreateResult>,
  };
}

export function registerProposalRunHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => ProposalRunClient,
): void {
  handle(PROPOSAL_RUN_CHANNELS.create, (event, projectId, command) => {
    const client = clientFor(event);
    if (
      typeof projectId !== "string" ||
      !PROJECT_ID.test(projectId) ||
      !isProposalRunCreateCommand(command)
    ) {
      return Promise.reject(new Error("Proposal run IPC requires an exact proposal run command"));
    }
    return client.createProposalRun(projectId, command);
  });
}
