import { createHash } from "node:crypto";

import type { components } from "@aijian/contracts";

import { hasOnlyKeys, isRecord } from "./api-contract-guards";

export type RemoteSourceExtractCreateInput = {
  source: {
    agent_definition: { definition_id: "writer.source-analyst"; version: "1.1.0" };
    skill_definition: { definition_id: "source.extract"; version: "1.1.0" };
    source_manifest_version_id: string;
    source_document_id: string;
    source_block_id: string;
    start_byte: number;
    end_byte: number;
  };
  selection: { connection_id: string; connection_revision: number; model_id: string };
};
export type RemoteSourceExtractCreateCommand = {
  operation_id: string;
  input: RemoteSourceExtractCreateInput;
};
export type RemoteSourceExtractCreatedResponse =
  components["schemas"]["CreatedProposalRunResponse"];
export type RemoteSourceExtractRunResponse = components["schemas"]["ProposalRunResponse"];
export type RemoteSourceExtractCreateResult =
  | { kind: "QUEUED"; receipt: RemoteSourceExtractCreatedResponse; replayed: boolean }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type RemoteSourceExtractOriginalRunResult =
  | { kind: "FOUND_RUN"; receipt: RemoteSourceExtractRunResponse; binding: "UNVERIFIED" }
  | { kind: "NOT_FOUND"; binding: "UNVERIFIED" }
  | { kind: "REMOTE_UNKNOWN"; binding: "UNVERIFIED" };
export type SourceExtractionResponse = {
  data: {
    project_id: string;
    head: {
      artifact_id: string;
      latest_version_id: string;
      review_version_id: string | null;
      review_submission_id: string | null;
      accepted_version_id: string | null;
      revision: number;
      review_evidence_revision: number;
      updated_at: string;
    };
    version: {
      id: string;
      artifact_id: string;
      version_number: number;
      schema_version: "1.0.0";
      content: { summary: string };
      content_hash: string;
      parent_version_id: string | null;
      change_summary: string;
      created_at: string;
    };
    source_spans: Array<{
      id: string;
      fact_id: string;
      source_document_id: string;
      source_block_id: string;
      role: "supports" | "contradicts" | "context";
      start_byte: number;
      end_byte: number;
      claim: string;
      quote_hash: string;
    }>;
    dependencies: Array<{
      upstream_version_id: string;
      relationship: string;
      impact: "blocking" | "advisory" | "render_only";
    }>;
    provenance: { producer_attempt_id: string; proposal_id: string };
  };
  request_id: string;
};
export type SourceExtractionReadResult =
  | { kind: "FOUND"; receipt: SourceExtractionResponse }
  | { kind: "NOT_FOUND" }
  | { kind: "INCONSISTENT"; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export const REMOTE_SOURCE_EXTRACT_CHANNELS = Object.freeze({
  create: "remote-source-extract:create",
  readOriginalRun: "remote-source-extract:read-original-run",
  getSourceExtraction: "source-extraction:get",
  getSourceExtractionVersion: "source-extraction:get-version",
} as const);

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const SOURCE_ID = /^src_[0-9a-f]{32}$/;
const SOURCE_BLOCK_ID = /^srcb_[0-9a-f]{32}$/;
const CONNECTION_ID = /^pcn_[0-9a-f]{32}$/;
const AGENT_RUN_ID = /^agr_[0-9a-f]{32}$/;
const SKILL_RUN_ID = /^skr_[0-9a-f]{32}$/;
const CONTEXT_ID = /^ctx_[0-9a-f]{32}$/;
const ARTIFACT_ID = /^art_[0-9a-f]{32}$/;
const SUBMISSION_ID = /^sub_[0-9a-f]{32}$/;
const SOURCE_SPAN_ID = /^spn_[0-9a-f]{32}$/;
const PROPOSAL_ID = /^prp_[0-9a-f]{32}$/;
const WORKFLOW_RUN_ID = /^wfr_[0-9a-f]{32}$/;
const NODE_RUN_ID = /^node_[0-9a-f]{32}$/;
const ATTEMPT_ID = /^att_[0-9a-f]{32}$/;
const TASK_ID = /^task_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_STATUSES = new Set(["PENDING", "RUNNING", "NEEDS_REVIEW", "SUCCEEDED", "FAILED", "CANCELLED"]);
const SKILL_STATUSES = new Set(["PENDING", "RUNNING", "NEEDS_REVIEW", "SUCCEEDED", "FAILED", "CANCEL_REQUESTED", "CANCELLED", "REMOTE_UNKNOWN"]);
const CONTEXT_KINDS = ["ROLE_INVARIANTS", "SKILL_INSTRUCTIONS", "APPROVED_ARTIFACT", "SOURCE_SPAN", "TASK_OUTPUT_SCHEMA"];
const TRUST_LEVELS = ["SYSTEM_INSTRUCTION", "SYSTEM_INSTRUCTION", "APPROVED_ARTIFACT", "UNTRUSTED_CONTENT", "SYSTEM_INSTRUCTION"];
const SENSITIVE_SUFFIXES = ["apikey", "accesstoken", "refreshtoken", "privatekey", "signingkey", "password", "passwd", "secret", "cookie", "authorization", "credential", "credentials", "bearer", "auth", "token"];

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    hasOnlyKeys(value, keys) && keys.every((key) => Object.hasOwn(value, key));
}

function sensitive(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(sensitive);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) || sensitive(child);
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Remote source extract identity is not JSON compatible");
  return encoded;
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function definition(value: unknown, id: string): boolean {
  return exact(value, ["definition_id", "version"]) &&
    value.definition_id === id && value.version === "1.1.0";
}

function dateTime(value: unknown): boolean {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

export function isRemoteSourceExtractCreateCommand(value: unknown): value is RemoteSourceExtractCreateCommand {
  if (!exact(value, ["operation_id", "input"]) ||
      typeof value.operation_id !== "string" || !UUID.test(value.operation_id) ||
      !exact(value.input, ["source", "selection"])) return false;
  const { source, selection } = value.input;
  return exact(source, ["agent_definition", "skill_definition", "source_manifest_version_id",
    "source_document_id", "source_block_id", "start_byte", "end_byte"]) &&
    definition(source.agent_definition, "writer.source-analyst") &&
    definition(source.skill_definition, "source.extract") &&
    typeof source.source_manifest_version_id === "string" && VERSION_ID.test(source.source_manifest_version_id) &&
    typeof source.source_document_id === "string" && SOURCE_ID.test(source.source_document_id) &&
    typeof source.source_block_id === "string" && SOURCE_BLOCK_ID.test(source.source_block_id) &&
    Number.isSafeInteger(source.start_byte) && Number(source.start_byte) >= 0 &&
    Number.isSafeInteger(source.end_byte) && Number(source.end_byte) > Number(source.start_byte) &&
    Number(source.end_byte) - Number(source.start_byte) <= 64 * 1024 &&
    exact(selection, ["connection_id", "connection_revision", "model_id"]) &&
    typeof selection.connection_id === "string" && CONNECTION_ID.test(selection.connection_id) &&
    Number.isSafeInteger(selection.connection_revision) && Number(selection.connection_revision) >= 1 &&
    Number(selection.connection_revision) <= 2_147_483_647 &&
    typeof selection.model_id === "string" && selection.model_id.length <= 120 &&
    /^\S(?:.*\S)?$/.test(selection.model_id) && !/[\r\n\u0000-\u001f\u007f]/.test(selection.model_id);
}

export function isRemoteSourceExtractProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID.test(value);
}

export function isSourceExtractionVersionId(value: unknown): value is string {
  return typeof value === "string" && VERSION_ID.test(value);
}

export function remoteSourceExtractIdempotencyKey(command: RemoteSourceExtractCreateCommand): string {
  return `remote-source-extract:create:v1:${command.operation_id}`;
}

function identity(projectId: string, command: RemoteSourceExtractCreateCommand) {
  const clientKeyHash = hash({ value: remoteSourceExtractIdempotencyKey(command) });
  const seed = { project_id: projectId, client_idempotency_key_hash: clientKeyHash };
  return {
    runId: `agr_${hash({ ...seed, kind: "agent" }).slice(7, 39)}`,
    skillRunId: `skr_${hash({ ...seed, kind: "skill" }).slice(7, 39)}`,
    executionKey: `proposal-run:${hash(seed)}`,
  };
}

export function remoteSourceExtractRunId(projectId: string, command: RemoteSourceExtractCreateCommand): string {
  return identity(projectId, command).runId;
}

function contextEntry(value: unknown, index: number): value is Record<string, unknown> {
  return exact(value, ["kind", "ref", "version", "content_hash", "byte_count",
    "trust_level", "truncation_reason"]) &&
    value.kind === CONTEXT_KINDS[index] && value.trust_level === TRUST_LEVELS[index] &&
    typeof value.ref === "string" && value.ref.length > 0 &&
    typeof value.version === "string" && value.version.length > 0 &&
    typeof value.content_hash === "string" && HASH.test(value.content_hash) &&
    Number.isSafeInteger(value.byte_count) && Number(value.byte_count) >= 0 &&
    (value.truncation_reason === null || typeof value.truncation_reason === "string");
}

function runData(value: unknown, projectId: string, command: RemoteSourceExtractCreateCommand, fresh: boolean): value is Record<string, unknown> {
  if (!isRecord(value) || value.project_id !== projectId || !isRemoteSourceExtractCreateCommand(command)) return false;
  const ids = identity(projectId, command);
  const agent = value.agent_run;
  const skill = value.skill_run;
  const context = value.context_manifest;
  if (value.run_id !== ids.runId || !AGENT_RUN_ID.test(ids.runId) ||
      !Number.isSafeInteger(value.agent_revision) || Number(value.agent_revision) < 1 ||
      !Number.isSafeInteger(value.skill_revision) || Number(value.skill_revision) < 1 ||
      !dateTime(value.created_at) || !dateTime(value.updated_at) ||
      Date.parse(value.created_at as string) > Date.parse(value.updated_at as string) ||
      !exact(agent, ["schema_version", "agent_run_id", "project_id", "agent_definition", "status", "delegated_skill_run_ids"]) ||
      agent.schema_version !== "1.0.0" || agent.agent_run_id !== ids.runId || agent.project_id !== projectId ||
      !definition(agent.agent_definition, "writer.source-analyst") ||
      typeof agent.status !== "string" || !AGENT_STATUSES.has(agent.status) ||
      !Array.isArray(agent.delegated_skill_run_ids) || agent.delegated_skill_run_ids.length !== 1 ||
      agent.delegated_skill_run_ids[0] !== ids.skillRunId ||
      !exact(skill, ["schema_version", "skill_run_id", "project_id", "agent_run_id", "skill_definition", "context_manifest_id", "status", "proposal_id"]) ||
      skill.schema_version !== "1.0.0" || skill.skill_run_id !== ids.skillRunId ||
      !SKILL_RUN_ID.test(ids.skillRunId) || skill.project_id !== projectId ||
      skill.agent_run_id !== ids.runId || !definition(skill.skill_definition, "source.extract") ||
      typeof skill.status !== "string" || !SKILL_STATUSES.has(skill.status) ||
      !(skill.proposal_id === null ||
        (typeof skill.proposal_id === "string" && PROPOSAL_ID.test(skill.proposal_id))) ||
      !exact(context, ["schema_version", "context_manifest_id", "project_id", "agent_definition", "skill_definition", "entries", "total_byte_count", "manifest_hash"]) ||
      context.schema_version !== "1.0.0" || context.project_id !== projectId ||
      context.context_manifest_id !== skill.context_manifest_id ||
      typeof context.context_manifest_id !== "string" || !CONTEXT_ID.test(context.context_manifest_id) ||
      !definition(context.agent_definition, "writer.source-analyst") ||
      !definition(context.skill_definition, "source.extract") ||
      !Array.isArray(context.entries) || context.entries.length !== 5 ||
      !context.entries.every((entry, index) => contextEntry(entry, index)) ||
      !Number.isSafeInteger(context.total_byte_count) || Number(context.total_byte_count) < 0 ||
      typeof context.manifest_hash !== "string" || !HASH.test(context.manifest_hash)) return false;

  const legalStatus =
    (agent.status === "PENDING" && skill.status === "PENDING" && skill.proposal_id === null) ||
    (agent.status === "RUNNING" && skill.status === "RUNNING" && skill.proposal_id === null) ||
    (agent.status === "NEEDS_REVIEW" && skill.status === "NEEDS_REVIEW" && typeof skill.proposal_id === "string") ||
    (agent.status === "SUCCEEDED" && skill.status === "SUCCEEDED" && typeof skill.proposal_id === "string") ||
    (agent.status === "FAILED" && skill.status === "FAILED") ||
    (agent.status === "CANCELLED" && skill.status === "CANCELLED") ||
    (skill.status === "REMOTE_UNKNOWN" && agent.status === "RUNNING" && skill.proposal_id === null);
  if (!legalStatus || (fresh && agent.status !== "PENDING")) return false;

  const entries = context.entries as [Record<string, unknown>, Record<string, unknown>,
    Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
  const [role, instructions, approved, source, schema] = entries;
  const input = command.input.source;
  const sourceHash = source.content_hash as string;
  const spanId = `spn_${hash({ project_id: projectId, source_document_id: input.source_document_id,
    source_block_id: input.source_block_id, start_byte: input.start_byte,
    end_byte: input.end_byte, content_sha256: sourceHash.slice(7) }).slice(7, 39)}`;
  if (role.ref !== "agent:writer.source-analyst" ||
      role.version !== input.agent_definition.version ||
      instructions.ref !== "skill:source.extract" ||
      instructions.version !== input.skill_definition.version ||
      approved.ref !== `artifact:SourceManifest/${input.source_manifest_version_id}` ||
      approved.version !== "1.0.0" || source.ref !== `source:${spanId}` ||
      source.version !== "source-v1" || source.byte_count !== input.end_byte - input.start_byte ||
      schema.ref !== "schema:SourceExtractionProposal" || schema.version !== "1.0.0" ||
      context.total_byte_count !== entries.reduce((total, entry) => total + Number(entry.byte_count), 0)) return false;
  const manifestHash = hash({ project_id: projectId, agent_definition: context.agent_definition,
    skill_definition: context.skill_definition, entries: context.entries,
    total_byte_count: context.total_byte_count });
  return context.manifest_hash === manifestHash &&
    context.context_manifest_id === `ctx_${manifestHash.slice(7, 39)}`;
}

function envelope(value: unknown): value is { data: Record<string, unknown>; request_id: string } {
  return exact(value, ["data", "request_id"]) &&
    typeof value.request_id === "string" && REQUEST_ID.test(value.request_id) &&
    isRecord(value.data) && !sensitive(value);
}

export function isRemoteSourceExtractCreatedResponse(
  value: unknown, projectId: string, command: RemoteSourceExtractCreateCommand, fresh: boolean,
): value is RemoteSourceExtractCreatedResponse {
  if (!isRemoteSourceExtractProjectId(projectId) || !envelope(value) ||
      !exact(value.data, ["project_id", "run_id", "agent_run", "skill_run", "context_manifest",
        "agent_revision", "skill_revision", "created_at", "updated_at", "task", "attempt"]) ||
      !runData(value.data, projectId, command, fresh)) return false;
  const task = value.data.task;
  const attempt = value.data.attempt;
  const ids = identity(projectId, command);
  const input = command.input;
  const context = value.data.context_manifest as Record<string, unknown>;
  const inputHash = hash({ project_id: projectId, ...input.source,
    context_manifest_hash: context.manifest_hash,
    remote_connection_id: input.selection.connection_id,
    remote_connection_revision: input.selection.connection_revision,
    remote_model_id: input.selection.model_id });
  const capabilityHash = hash({ connection_id: input.selection.connection_id,
    connection_revision: input.selection.connection_revision, model_id: input.selection.model_id,
    capabilities: ["TEXT"] });
  const fingerprint = { project_id: projectId, agent_run_id: ids.runId,
    skill_run_id: ids.skillRunId, output_artifact_type: "SourceExtraction",
    agent_definition_id: "writer.source-analyst", agent_version: "1.1.0",
    skill_definition_id: "source.extract", skill_version: "1.1.0",
    prompt_version: "prompt.source-extract@1.0.0",
    policy_version: "policy.cpa-loopback-text@1.0.0",
    provider_connection_id: input.selection.connection_id, model_id: input.selection.model_id,
    capability_snapshot_hash: capabilityHash, input_hash: inputHash,
    output_schema_version: "1.0.0", idempotency_key: ids.executionKey };
  return exact(task, ["workflow_run_id", "node_run_id", "attempt_id", "task_id"]) &&
    typeof task.workflow_run_id === "string" && WORKFLOW_RUN_ID.test(task.workflow_run_id) &&
    typeof task.node_run_id === "string" && NODE_RUN_ID.test(task.node_run_id) &&
    typeof task.attempt_id === "string" && ATTEMPT_ID.test(task.attempt_id) &&
    typeof task.task_id === "string" && TASK_ID.test(task.task_id) &&
    exact(attempt, ["schema_version", "attempt_id", ...Object.keys(fingerprint), "attempt_fingerprint"]) &&
    attempt.schema_version === "1.0.0" && attempt.attempt_id === task.attempt_id &&
    Object.entries(fingerprint).every(([key, expected]) => attempt[key] === expected) &&
    attempt.attempt_fingerprint === hash(fingerprint);
}

export function isRemoteSourceExtractOriginalRunResponse(
  value: unknown, projectId: string, command: RemoteSourceExtractCreateCommand,
): value is RemoteSourceExtractRunResponse {
  return isRemoteSourceExtractProjectId(projectId) && envelope(value) &&
    exact(value.data, ["project_id", "run_id", "agent_run", "skill_run", "context_manifest",
      "agent_revision", "skill_revision", "created_at", "updated_at"]) &&
    runData(value.data, projectId, command, false);
}

export function isSourceExtractionResponse(
  value: unknown, projectId: string, versionId?: string,
): value is SourceExtractionResponse {
  if (!isRemoteSourceExtractProjectId(projectId) ||
      (versionId !== undefined && !isSourceExtractionVersionId(versionId)) ||
      !envelope(value) ||
      !exact(value.data, ["project_id", "head", "version", "source_spans",
        "dependencies", "provenance"]) || value.data.project_id !== projectId) return false;
  const { head, version, source_spans: spans, dependencies, provenance } = value.data;
  if (!exact(head, ["artifact_id", "latest_version_id", "review_version_id",
        "review_submission_id", "accepted_version_id", "revision",
        "review_evidence_revision", "updated_at"]) ||
      typeof head.artifact_id !== "string" || !ARTIFACT_ID.test(head.artifact_id) ||
      typeof head.latest_version_id !== "string" || !VERSION_ID.test(head.latest_version_id) ||
      !(head.review_version_id === null ||
        (typeof head.review_version_id === "string" && VERSION_ID.test(head.review_version_id))) ||
      !(head.review_submission_id === null ||
        (typeof head.review_submission_id === "string" && SUBMISSION_ID.test(head.review_submission_id))) ||
      !(head.accepted_version_id === null ||
        (typeof head.accepted_version_id === "string" && VERSION_ID.test(head.accepted_version_id))) ||
      !Number.isSafeInteger(head.revision) || Number(head.revision) < 1 ||
      !Number.isSafeInteger(head.review_evidence_revision) ||
      Number(head.review_evidence_revision) < 0 || !dateTime(head.updated_at) ||
      !exact(version, ["id", "artifact_id", "version_number", "schema_version",
        "content", "content_hash", "parent_version_id", "change_summary", "created_at"]) ||
      typeof version.id !== "string" || !VERSION_ID.test(version.id) ||
      version.id !== (versionId ?? head.latest_version_id) ||
      version.artifact_id !== head.artifact_id ||
      !Number.isSafeInteger(version.version_number) || Number(version.version_number) < 1 ||
      version.schema_version !== "1.0.0" ||
      !exact(version.content, ["summary"]) ||
      typeof version.content.summary !== "string" ||
      [...version.content.summary].length < 1 || [...version.content.summary].length > 10_000 ||
      typeof version.content_hash !== "string" || !HASH.test(version.content_hash) ||
      version.content_hash !== hash(version.content) ||
      !(version.parent_version_id === null ||
        (typeof version.parent_version_id === "string" && VERSION_ID.test(version.parent_version_id))) ||
      typeof version.change_summary !== "string" || !dateTime(version.created_at) ||
      !Array.isArray(spans) || spans.length < 1 ||
      !Array.isArray(dependencies) || dependencies.length !== 1 ||
      !exact(provenance, ["producer_attempt_id", "proposal_id"]) ||
      typeof provenance.producer_attempt_id !== "string" ||
      !ATTEMPT_ID.test(provenance.producer_attempt_id) ||
      typeof provenance.proposal_id !== "string" || !PROPOSAL_ID.test(provenance.proposal_id))
    return false;
  if (!spans.every((span) => exact(span, ["id", "fact_id", "source_document_id",
      "source_block_id", "role", "start_byte", "end_byte", "claim", "quote_hash"]) &&
    typeof span.id === "string" && SOURCE_SPAN_ID.test(span.id) &&
    typeof span.fact_id === "string" && SOURCE_SPAN_ID.test(span.fact_id) &&
    typeof span.source_document_id === "string" && SOURCE_ID.test(span.source_document_id) &&
    typeof span.source_block_id === "string" && SOURCE_BLOCK_ID.test(span.source_block_id) &&
    (span.role === "supports" || span.role === "contradicts" || span.role === "context") &&
    Number.isSafeInteger(span.start_byte) && Number(span.start_byte) >= 0 &&
    Number.isSafeInteger(span.end_byte) && Number(span.end_byte) > Number(span.start_byte) &&
    typeof span.claim === "string" && [...span.claim].length >= 1 &&
    [...span.claim].length <= 1000 && typeof span.quote_hash === "string" &&
    HASH.test(span.quote_hash))) return false;
  return dependencies.every((dependency) =>
    exact(dependency, ["upstream_version_id", "relationship", "impact"]) &&
    typeof dependency.upstream_version_id === "string" &&
    VERSION_ID.test(dependency.upstream_version_id) &&
    dependency.relationship === "derived_from" && dependency.impact === "blocking");
}
