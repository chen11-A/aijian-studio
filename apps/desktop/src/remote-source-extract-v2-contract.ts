import { createHash } from "node:crypto";

import {
  isArtifactProposalResponse,
  type ArtifactProposalResponse,
} from "@aijian/contracts/artifact-proposal";
import type { components } from "@aijian/contracts";
import { hasRequestId, isRecord } from "./api-contract-guards";

export type UnknownRemoteCost = {
  status: "UNKNOWN";
  currency: null;
  estimated_micros: null;
  actual_micros: null;
  upstream_status: "UNKNOWN";
  upstream_actual_micros: null;
  budget_enforcement: "UNVERIFIED" | "UNENFORCED";
};
export type SourceExtractionProposalV2 = {
  schema_version: "2.0.0";
  execution_provider: "SUB2API";
  approval_id: string;
  proposal_id: string;
  project_id: string;
  target_artifact_type: "SourceExtraction";
  payload: { summary: string };
  payload_hash: string;
  source_spans: components["schemas"]["ProposalSourceSpanV1"][];
  claims: components["schemas"]["ProposalClaimV1"][];
  diff: components["schemas"]["JsonPatchOperationV1"][];
  dependencies: components["schemas"]["ProposalDependencyV1"][];
  impacts: components["schemas"]["ProposalImpactV1"][];
  cost: UnknownRemoteCost;
  confidence_basis_points: number;
  capability_losses: components["schemas"]["CapabilityLossV1"][];
  qc: components["schemas"]["ProposalQcV1"][];
  producer_agent_run_id: string;
  producer_skill_run_id: string;
};
export type SourceExtractionProposalV2Response = {
  data: {
    project_id: string;
    proposal_id: string;
    proposal: SourceExtractionProposalV2;
    producer_attempt_id: string;
    proposal_hash: string;
    created_at: string;
  };
  request_id: string;
};
export type VersionedSourceExtractionProposalResponse =
  | ArtifactProposalResponse
  | SourceExtractionProposalV2Response;
export type VersionedSourceExtractionProposalReadResult =
  | { kind: "FOUND_V1"; receipt: ArtifactProposalResponse }
  | { kind: "FOUND_V2"; receipt: SourceExtractionProposalV2Response }
  | { kind: "NOT_FOUND"; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export type Sub2APISource = {
  agent_definition: { definition_id: "writer.source-analyst-sub2api"; version: "1.0.0" };
  skill_definition: { definition_id: "source.extract-sub2api"; version: "1.0.0" };
  source_manifest_version_id: string;
  source_document_id: string;
  source_block_id: string;
  start_byte: number;
  end_byte: number;
};
export type Sub2APISelection = {
  connection_id: string;
  connection_revision: number;
  model_id: string;
};
export type Sub2APIQueueCommand = {
  operation_id: string;
  input: { source: Sub2APISource; selection: Sub2APISelection };
};
export type Sub2APIApprovalCommand = {
  operation_id: string;
  input: {
    task_id: string;
    attempt_id: string;
    expected_attempt_fingerprint: string;
    unknown_cost_accepted: true;
    allowed_calls: 1;
  };
};
export type Sub2APIScope = {
  project_id: string;
  task_id: string;
  attempt_id: string;
  selection: Sub2APISelection;
  source: Sub2APISource;
  origin_hash: string;
  input_hash: string;
  context_manifest_hash: string;
  attempt_fingerprint: string;
};
export type Sub2APIOperationResponse = {
  data: {
    scope: Sub2APIScope;
    attempt_status: string;
    approval_id: string | null;
    proposal_id: string | null;
    content_status: "PENDING" | "PROPOSAL_READY" | "FAILED" | "REMOTE_UNKNOWN";
    cost: UnknownRemoteCost;
    automatic_retry_allowed: false;
  };
  request_id: string;
};
export type Sub2APIApprovalResponse = {
  data: {
    approval_id: string;
    scope: Sub2APIScope;
    status: "APPROVED_ONE_CALL" | "CONSUMED" | "EXPIRED" | "REVOKED";
    approved_at: string;
    expires_at: string;
    allowed_calls: 1;
    cost_decision: "UNKNOWN_COST_ACCEPTED";
    cost: UnknownRemoteCost;
  };
  request_id: string;
};
export type Sub2APIQueueReceipt = components["schemas"]["CreatedProposalRunResponse"];
export type Sub2APIDefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: 401 | 403 | 404 | 409 | 422 | 428 | 503;
  code: string;
  request_id: string;
};
export type Sub2APIQueueResult =
  | { kind: "QUEUED"; receipt: Sub2APIQueueReceipt; replayed: boolean }
  | Sub2APIDefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type Sub2APIOperationReadResult =
  | { kind: "FOUND"; runId: string; receipt: Sub2APIOperationResponse }
  | { kind: "NOT_FOUND"; request_id: string }
  | Sub2APIDefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type Sub2APIApprovalResult =
  | { kind: "APPROVED"; receipt: Sub2APIApprovalResponse }
  | { kind: "CONSUMED"; receipt: Sub2APIApprovalResponse }
  | Sub2APIDefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type Sub2APIApprovalReadResult =
  | { kind: "FOUND"; receipt: Sub2APIApprovalResponse }
  | { kind: "NOT_FOUND"; request_id: string }
  | Sub2APIDefiniteError
  | { kind: "REMOTE_UNKNOWN" };

export const SUB2API_CHANNELS = Object.freeze({
  queue: "sub2api-source-extract:queue",
  operation: "sub2api-source-extract:read-original-operation",
  approve: "sub2api-source-extract:approve-one-call",
  approval: "sub2api-source-extract:read-approval",
} as const);

export const VERSIONED_SOURCE_EXTRACTION_PROPOSAL_CHANNEL =
  "source-extraction:read-versioned-proposal";

const PROJECT = /^prj_[0-9a-f]{32}$/;
const PROPOSAL = /^prp_[0-9a-f]{32}$/;
const APPROVAL = /^[a-z]{3}_[0-9a-f]{32}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONNECTION = /^pcn_[0-9a-f]{32}$/;
const TASK = /^task_[0-9a-f]{32}$/;
const ATTEMPT = /^att_[0-9a-f]{32}$/;
const AGENT_RUN = /^agr_[0-9a-f]{32}$/;
const SKILL_RUN = /^skr_[0-9a-f]{32}$/;
const SOURCE_SPAN = /^spn_[0-9a-f]{32}$/;
const SOURCE = /^src_[0-9a-f]{32}$/;
const SOURCE_BLOCK = /^srcb_[0-9a-f]{32}$/;
const CLAIM = /^clm_[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const ARTIFACT = /^art_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const DEFINITION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const ARTIFACT_TYPE = /^[A-Z][A-Za-z0-9]{1,79}$/;
const SENSITIVE_SUFFIXES = [
  "apikey", "accesstoken", "refreshtoken", "privatekey", "signingkey",
  "password", "passwd", "secret", "cookie", "authorization",
  "credential", "credentials", "bearer", "auth", "token",
];

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function integer(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= min && value <= max;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Sub2API identity is not JSON compatible");
  return encoded;
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function sub2APIQueueIdempotencyKey(command: Sub2APIQueueCommand): string {
  return `sub2api-source-extract:create:v1:${command.operation_id}`;
}

export function sub2APIApprovalIdempotencyKey(command: Sub2APIApprovalCommand): string {
  return `sub2api-source-extract:approve:v1:${command.operation_id}`;
}

function identitySeed(projectId: string, command: Sub2APIQueueCommand) {
  const clientKeyHash = hash({ value: sub2APIQueueIdempotencyKey(command) });
  return { project_id: projectId, client_idempotency_key_hash: clientKeyHash };
}

export function sub2APIRunId(projectId: string, command: Sub2APIQueueCommand): string {
  return `agr_${hash({ ...identitySeed(projectId, command), kind: "agent" }).slice(7, 39)}`;
}

function sub2APISkillRunId(projectId: string, command: Sub2APIQueueCommand): string {
  return `skr_${hash({ ...identitySeed(projectId, command), kind: "skill" }).slice(7, 39)}`;
}

function sub2APIExecutionKey(projectId: string, command: Sub2APIQueueCommand): string {
  return `sub2api-source-extract:${hash(identitySeed(projectId, command))}`;
}

function sub2APICapabilityHash(selection: Sub2APISelection): string {
  return hash({
    connection_id: selection.connection_id,
    connection_revision: selection.connection_revision,
    model_id: selection.model_id,
    capabilities: ["TEXT"],
  });
}

function expectedAttemptFingerprint(
  projectId: string, command: Sub2APIQueueCommand, inputHash: string,
): string {
  const source = command.input.source;
  const selection = command.input.selection;
  return hash({
    project_id: projectId,
    agent_run_id: sub2APIRunId(projectId, command),
    skill_run_id: sub2APISkillRunId(projectId, command),
    output_artifact_type: "SourceExtraction",
    agent_definition_id: source.agent_definition.definition_id,
    agent_version: source.agent_definition.version,
    skill_definition_id: source.skill_definition.definition_id,
    skill_version: source.skill_definition.version,
    prompt_version: "prompt.source-extract-sub2api@1.0.0",
    policy_version: "policy.sub2api-one-call-unknown-cost@1.0.0",
    provider_connection_id: selection.connection_id,
    model_id: selection.model_id,
    capability_snapshot_hash: sub2APICapabilityHash(selection),
    input_hash: inputHash,
    output_schema_version: "1.0.0",
    idempotency_key: sub2APIExecutionKey(projectId, command),
  });
}

export function isSub2APIQueueCommand(value: unknown): value is Sub2APIQueueCommand {
  if (!isRecord(value) || !exact(value, ["operation_id", "input"]) ||
      typeof value.operation_id !== "string" || !UUID_V4.test(value.operation_id) ||
      !isRecord(value.input) || !exact(value.input, ["source", "selection"])) return false;
  const { source, selection } = value.input;
  return isRecord(source) && exact(source, [
    "agent_definition", "skill_definition", "source_manifest_version_id",
    "source_document_id", "source_block_id", "start_byte", "end_byte",
  ]) && isRecord(source.agent_definition) &&
    exact(source.agent_definition, ["definition_id", "version"]) &&
    source.agent_definition.definition_id === "writer.source-analyst-sub2api" &&
    source.agent_definition.version === "1.0.0" &&
    isRecord(source.skill_definition) &&
    exact(source.skill_definition, ["definition_id", "version"]) &&
    source.skill_definition.definition_id === "source.extract-sub2api" &&
    source.skill_definition.version === "1.0.0" &&
    typeof source.source_manifest_version_id === "string" &&
    VERSION.test(source.source_manifest_version_id) &&
    typeof source.source_document_id === "string" && SOURCE.test(source.source_document_id) &&
    typeof source.source_block_id === "string" &&
    SOURCE_BLOCK.test(source.source_block_id) &&
    integer(source.start_byte, 0, Number.MAX_SAFE_INTEGER) &&
    integer(source.end_byte, 1, Number.MAX_SAFE_INTEGER) &&
    Number(source.end_byte) > Number(source.start_byte) &&
    Number(source.end_byte) - Number(source.start_byte) <= 64 * 1024 &&
    isRecord(selection) && exact(selection, [
      "connection_id", "connection_revision", "model_id",
    ]) && typeof selection.connection_id === "string" &&
    CONNECTION.test(selection.connection_id) &&
    integer(selection.connection_revision, 1, 2_147_483_647) &&
    typeof selection.model_id === "string" && selection.model_id.length <= 200 &&
    /^\S(?:.*\S)?$/.test(selection.model_id) &&
    !/[\r\n\u0000-\u001f\u007f]/.test(selection.model_id);
}

export function isSub2APIApprovalCommand(value: unknown): value is Sub2APIApprovalCommand {
  if (!isRecord(value) || !exact(value, ["operation_id", "input"]) ||
      typeof value.operation_id !== "string" || !UUID_V4.test(value.operation_id) ||
      !isRecord(value.input) || !exact(value.input, [
        "task_id", "attempt_id", "expected_attempt_fingerprint",
        "unknown_cost_accepted", "allowed_calls",
      ])) return false;
  const input = value.input;
  return typeof input.task_id === "string" && TASK.test(input.task_id) &&
    typeof input.attempt_id === "string" && ATTEMPT.test(input.attempt_id) &&
    typeof input.expected_attempt_fingerprint === "string" &&
    HASH.test(input.expected_attempt_fingerprint) &&
    input.unknown_cost_accepted === true && input.allowed_calls === 1;
}

function sensitive(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(sensitive);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
      sensitive(child);
  });
}

function span(value: unknown): boolean {
  return isRecord(value) && only(value, [
    "source_span_id", "source_document_id", "source_block_id", "start_byte",
    "end_byte", "claim", "quote_hash",
  ]) &&
    typeof value.source_span_id === "string" && SOURCE_SPAN.test(value.source_span_id) &&
    typeof value.source_document_id === "string" && SOURCE.test(value.source_document_id) &&
    typeof value.source_block_id === "string" && SOURCE_BLOCK.test(value.source_block_id) &&
    integer(value.start_byte, 0, Number.MAX_SAFE_INTEGER) &&
    integer(value.end_byte, 1, Number.MAX_SAFE_INTEGER) &&
    Number(value.end_byte) > Number(value.start_byte) &&
    typeof value.claim === "string" && value.claim.length > 0 && value.claim.length <= 1000 &&
    typeof value.quote_hash === "string" && HASH.test(value.quote_hash);
}

function claim(value: unknown, spanIds: ReadonlySet<string>): boolean {
  return isRecord(value) && only(value, ["claim_id", "text", "invented", "source_span_ids"]) &&
    typeof value.claim_id === "string" && CLAIM.test(value.claim_id) &&
    typeof value.text === "string" && value.text.length > 0 && value.text.length <= 2000 &&
    typeof value.invented === "boolean" &&
    Array.isArray(value.source_span_ids) && value.source_span_ids.length <= 100 &&
    value.source_span_ids.every((id) => typeof id === "string" && spanIds.has(id)) &&
    (value.invented || value.source_span_ids.length > 0);
}

function diff(value: unknown): boolean {
  return isRecord(value) && only(value, ["op", "path", "value"]) &&
    (value.op === "add" || value.op === "remove" || value.op === "replace") &&
    typeof value.path === "string" && value.path.startsWith("/");
}

function dependency(value: unknown): boolean {
  return isRecord(value) && only(value, ["artifact_type", "version_id", "approval_required"]) &&
    typeof value.artifact_type === "string" && ARTIFACT_TYPE.test(value.artifact_type) &&
    typeof value.version_id === "string" && VERSION.test(value.version_id) &&
    value.approval_required === true;
}

function impact(value: unknown): boolean {
  return isRecord(value) && only(value, ["artifact_type", "artifact_id", "impact"]) &&
    typeof value.artifact_type === "string" && ARTIFACT_TYPE.test(value.artifact_type) &&
    (value.artifact_id === null ||
      (typeof value.artifact_id === "string" && ARTIFACT.test(value.artifact_id))) &&
    (value.impact === "CREATE" || value.impact === "STALE" || value.impact === "INVALIDATE");
}

function capabilityLoss(value: unknown): boolean {
  return isRecord(value) && only(value, ["code", "description"]) &&
    typeof value.code === "string" && DEFINITION.test(value.code) &&
    typeof value.description === "string" &&
    value.description.length > 0 && value.description.length <= 1000;
}

function qc(value: unknown): boolean {
  return isRecord(value) && only(value, ["check_id", "status", "details"]) &&
    typeof value.check_id === "string" && DEFINITION.test(value.check_id) &&
    (value.status === "PASS" || value.status === "FAIL" || value.status === "NOT_RUN") &&
    typeof value.details === "string" && value.details.length > 0 &&
    value.details.length <= 1000;
}

function unknownCost(value: unknown): value is UnknownRemoteCost {
  return isRecord(value) && exact(value, [
    "status", "currency", "estimated_micros", "actual_micros", "upstream_status",
    "upstream_actual_micros", "budget_enforcement",
  ]) && value.status === "UNKNOWN" && value.currency === null &&
    value.estimated_micros === null && value.actual_micros === null &&
    value.upstream_status === "UNKNOWN" && value.upstream_actual_micros === null &&
    (value.budget_enforcement === "UNVERIFIED" ||
      value.budget_enforcement === "UNENFORCED");
}

export function isVersionedSourceExtractionProposalId(
  projectId: unknown, proposalId: unknown,
): boolean {
  return typeof projectId === "string" && PROJECT.test(projectId) &&
    typeof proposalId === "string" && PROPOSAL.test(proposalId);
}

export function isSub2APIProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT.test(value);
}

export function isSourceExtractionProposalV2Response(
  value: unknown, projectId: string, proposalId: string, requestId?: string | null,
): value is SourceExtractionProposalV2Response {
  if (!isVersionedSourceExtractionProposalId(projectId, proposalId) ||
      !isRecord(value) || !exact(value, ["data", "request_id"]) ||
      !hasRequestId(value) || (requestId !== undefined && value.request_id !== requestId) ||
      !isRecord(value.data) || !exact(value.data, [
        "project_id", "proposal_id", "proposal", "producer_attempt_id",
        "proposal_hash", "created_at",
      ])) return false;
  const data = value.data;
  if (data.project_id !== projectId || data.proposal_id !== proposalId ||
      typeof data.producer_attempt_id !== "string" ||
      !ATTEMPT.test(data.producer_attempt_id) ||
      typeof data.proposal_hash !== "string" || !HASH.test(data.proposal_hash) ||
      typeof data.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(data.created_at) ||
      Number.isNaN(Date.parse(data.created_at)) || !isRecord(data.proposal)) return false;
  const proposal = data.proposal;
  if (!exact(proposal, [
    "schema_version", "execution_provider", "approval_id", "proposal_id", "project_id",
    "target_artifact_type", "payload", "payload_hash", "source_spans", "claims", "diff",
    "dependencies", "impacts", "cost", "confidence_basis_points", "capability_losses",
    "qc", "producer_agent_run_id", "producer_skill_run_id",
  ]) || proposal.schema_version !== "2.0.0" ||
      proposal.execution_provider !== "SUB2API" ||
      typeof proposal.approval_id !== "string" || !APPROVAL.test(proposal.approval_id) ||
      proposal.proposal_id !== proposalId || proposal.project_id !== projectId ||
      proposal.target_artifact_type !== "SourceExtraction" ||
      !isRecord(proposal.payload) || !exact(proposal.payload, ["summary"]) ||
      typeof proposal.payload.summary !== "string" ||
      proposal.payload.summary.length < 1 || proposal.payload.summary.length > 10_000 ||
      sensitive(proposal.payload) ||
      typeof proposal.payload_hash !== "string" || !HASH.test(proposal.payload_hash) ||
      !Array.isArray(proposal.source_spans) || proposal.source_spans.length < 1 ||
      proposal.source_spans.length > 20_000 || !proposal.source_spans.every(span)) return false;
  const spanIds = new Set(proposal.source_spans.map((item) => String(item.source_span_id)));
  return Array.isArray(proposal.claims) && proposal.claims.length <= 20_000 &&
    proposal.claims.every((item) => claim(item, spanIds)) &&
    Array.isArray(proposal.diff) && proposal.diff.length <= 20_000 &&
    proposal.diff.every(diff) &&
    Array.isArray(proposal.dependencies) && proposal.dependencies.length <= 10_000 &&
    proposal.dependencies.every(dependency) &&
    Array.isArray(proposal.impacts) && proposal.impacts.length <= 10_000 &&
    proposal.impacts.every(impact) && unknownCost(proposal.cost) &&
    integer(proposal.confidence_basis_points, 0, 10_000) &&
    Array.isArray(proposal.capability_losses) &&
    proposal.capability_losses.length <= 100 &&
    proposal.capability_losses.every(capabilityLoss) &&
    Array.isArray(proposal.qc) && proposal.qc.length >= 1 && proposal.qc.length <= 100 &&
    proposal.qc.every(qc) &&
    typeof proposal.producer_agent_run_id === "string" &&
    AGENT_RUN.test(proposal.producer_agent_run_id) &&
    typeof proposal.producer_skill_run_id === "string" &&
    SKILL_RUN.test(proposal.producer_skill_run_id);
}

export function classifyVersionedSourceExtractionProposal(
  value: unknown, projectId: string, proposalId: string, requestId: string | null,
): Extract<VersionedSourceExtractionProposalReadResult, { kind: "FOUND_V1" | "FOUND_V2" }> | null {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.proposal)) return null;
  if (value.data.proposal.schema_version === "1.0.0" &&
      isArtifactProposalResponse(value, projectId, proposalId) &&
      value.request_id === requestId &&
      value.data.proposal.target_artifact_type === "SourceExtraction") {
    return { kind: "FOUND_V1", receipt: value };
  }
  if (value.data.proposal.schema_version === "2.0.0" &&
      isSourceExtractionProposalV2Response(value, projectId, proposalId, requestId)) {
    return { kind: "FOUND_V2", receipt: value };
  }
  return null;
}

export function isVersionedProposalNotFound(value: unknown, requestId: string | null):
  value is { error: { code: "ARTIFACT_PROPOSAL_NOT_FOUND" }; request_id: string } {
  return isRecord(value) && exact(value, ["error", "request_id"]) &&
    hasRequestId(value) && value.request_id === requestId && isRecord(value.error) &&
    exact(value.error, ["code", "message", "details", "retryable"]) &&
    value.error.code === "ARTIFACT_PROPOSAL_NOT_FOUND" &&
    typeof value.error.message === "string" && value.error.retryable === false &&
    isRecord(value.error.details) && Object.keys(value.error.details).length === 0;
}

function envelope(value: unknown, requestId: string | null):
  value is { data: Record<string, unknown>; request_id: string } {
  return isRecord(value) && exact(value, ["data", "request_id"]) &&
    hasRequestId(value) && value.request_id === requestId && isRecord(value.data) &&
    !sensitive(value);
}

function sameScope(value: unknown, projectId: string, command: Sub2APIQueueCommand):
  value is Sub2APIScope {
  if (!isRecord(value) || !exact(value, [
    "project_id", "task_id", "attempt_id", "selection", "source", "origin_hash",
    "input_hash", "context_manifest_hash", "attempt_fingerprint",
  ]) || value.project_id !== projectId ||
      typeof value.task_id !== "string" || !TASK.test(value.task_id) ||
      typeof value.attempt_id !== "string" || !ATTEMPT.test(value.attempt_id) ||
      !isRecord(value.selection) || !isRecord(value.source)) return false;
  if (canonicalJson(value.selection) !== canonicalJson(command.input.selection) ||
      canonicalJson(value.source) !== canonicalJson(command.input.source)) return false;
  if (!["origin_hash", "input_hash", "context_manifest_hash", "attempt_fingerprint"]
    .every((key) => typeof value[key] === "string" && HASH.test(value[key] as string))) return false;
  const expectedInputHash = hash({
    project_id: projectId,
    ...command.input.source,
    selection: command.input.selection,
    origin_hash: value.origin_hash,
    context_manifest_hash: value.context_manifest_hash,
  });
  return value.input_hash === expectedInputHash &&
    value.attempt_fingerprint === expectedAttemptFingerprint(
      projectId, command, expectedInputHash,
    );
}

export function isSub2APIQueueReceipt(
  value: unknown, projectId: string, command: Sub2APIQueueCommand,
  requestId: string | null,
): value is Sub2APIQueueReceipt {
  if (!isSub2APIQueueCommand(command) || !envelope(value, requestId) ||
      !exact(value.data, [
        "project_id", "run_id", "agent_run", "skill_run", "context_manifest",
        "agent_revision", "skill_revision", "created_at", "updated_at", "task", "attempt",
      ])) return false;
  const data = value.data;
  const runId = sub2APIRunId(projectId, command);
  if (data.project_id !== projectId || data.run_id !== runId ||
      !integer(data.agent_revision, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(data.skill_revision, 1, Number.MAX_SAFE_INTEGER) ||
      typeof data.created_at !== "string" || Number.isNaN(Date.parse(data.created_at)) ||
      typeof data.updated_at !== "string" || Number.isNaN(Date.parse(data.updated_at)) ||
      !isRecord(data.agent_run) || !isRecord(data.skill_run) ||
      !isRecord(data.context_manifest) || !isRecord(data.task) || !isRecord(data.attempt)) {
    return false;
  }
  const agent = data.agent_run;
  const skill = data.skill_run;
  const task = data.task;
  const attempt = data.attempt;
  const source = command.input.source;
  if (agent.schema_version !== "1.0.0" || agent.agent_run_id !== runId ||
      agent.project_id !== projectId || !isRecord(agent.agent_definition) ||
      canonicalJson(agent.agent_definition) !== canonicalJson(source.agent_definition) ||
      !Array.isArray(agent.delegated_skill_run_ids) ||
      agent.delegated_skill_run_ids.length !== 1 ||
      typeof agent.delegated_skill_run_ids[0] !== "string" ||
      !SKILL_RUN.test(agent.delegated_skill_run_ids[0]) ||
      skill.schema_version !== "1.0.0" ||
      skill.skill_run_id !== sub2APISkillRunId(projectId, command) ||
      skill.skill_run_id !== agent.delegated_skill_run_ids[0] ||
      skill.agent_run_id !== runId || skill.project_id !== projectId ||
      !isRecord(skill.skill_definition) ||
      canonicalJson(skill.skill_definition) !== canonicalJson(source.skill_definition) ||
      typeof data.context_manifest.manifest_hash !== "string" ||
      !HASH.test(data.context_manifest.manifest_hash) ||
      !exact(task, ["workflow_run_id", "node_run_id", "attempt_id", "task_id"]) ||
      typeof task.workflow_run_id !== "string" ||
      !/^wfr_[0-9a-f]{32}$/.test(task.workflow_run_id) ||
      typeof task.node_run_id !== "string" ||
      !/^node_[0-9a-f]{32}$/.test(task.node_run_id) ||
      typeof task.attempt_id !== "string" || !ATTEMPT.test(task.attempt_id) ||
      typeof task.task_id !== "string" || !TASK.test(task.task_id)) return false;
  const fingerprintKeys = [
    "project_id", "agent_run_id", "skill_run_id", "output_artifact_type",
    "agent_definition_id", "agent_version", "skill_definition_id", "skill_version",
    "prompt_version", "policy_version", "provider_connection_id", "model_id",
    "capability_snapshot_hash", "input_hash", "output_schema_version", "idempotency_key",
  ];
  if (!exact(attempt, ["schema_version", "attempt_id", ...fingerprintKeys,
    "attempt_fingerprint"]) || attempt.schema_version !== "1.0.0" ||
    attempt.attempt_id !== task.attempt_id || attempt.project_id !== projectId ||
    attempt.agent_run_id !== runId || attempt.skill_run_id !== skill.skill_run_id ||
    attempt.output_artifact_type !== "SourceExtraction" ||
    attempt.agent_definition_id !== source.agent_definition.definition_id ||
    attempt.agent_version !== source.agent_definition.version ||
    attempt.skill_definition_id !== source.skill_definition.definition_id ||
    attempt.skill_version !== source.skill_definition.version ||
    attempt.provider_connection_id !== command.input.selection.connection_id ||
    attempt.model_id !== command.input.selection.model_id ||
    attempt.prompt_version !== "prompt.source-extract-sub2api@1.0.0" ||
    attempt.policy_version !== "policy.sub2api-one-call-unknown-cost@1.0.0" ||
    attempt.idempotency_key !== sub2APIExecutionKey(projectId, command) ||
    attempt.capability_snapshot_hash !== sub2APICapabilityHash(command.input.selection) ||
    typeof attempt.input_hash !== "string" || !HASH.test(attempt.input_hash) ||
    attempt.output_schema_version !== "1.0.0" ||
    typeof attempt.attempt_fingerprint !== "string" ||
    !HASH.test(attempt.attempt_fingerprint)) return false;
  const fingerprint = Object.fromEntries(fingerprintKeys.map((key) => [key, attempt[key]]));
  return attempt.attempt_fingerprint === hash(fingerprint) &&
    attempt.attempt_fingerprint === expectedAttemptFingerprint(
      projectId, command, attempt.input_hash,
    );
}

export function isSub2APIOperationResponse(
  value: unknown, projectId: string, command: Sub2APIQueueCommand,
  requestId: string | null,
): value is Sub2APIOperationResponse {
  if (!isSub2APIQueueCommand(command) || !envelope(value, requestId) ||
      !exact(value.data, [
        "scope", "attempt_status", "approval_id", "proposal_id", "content_status",
        "cost", "automatic_retry_allowed",
      ]) || !sameScope(value.data.scope, projectId, command)) return false;
  const data = value.data;
  return typeof data.attempt_status === "string" && data.attempt_status.length > 0 &&
    (data.approval_id === null ||
      (typeof data.approval_id === "string" && APPROVAL.test(data.approval_id))) &&
    (data.proposal_id === null ||
      (typeof data.proposal_id === "string" && PROPOSAL.test(data.proposal_id))) &&
    (data.content_status === "PENDING" || data.content_status === "PROPOSAL_READY" ||
      data.content_status === "FAILED" || data.content_status === "REMOTE_UNKNOWN") &&
    ((data.content_status === "PROPOSAL_READY") === (data.proposal_id !== null)) &&
    (data.content_status !== "PROPOSAL_READY" || data.approval_id !== null) &&
    unknownCost(data.cost) && data.automatic_retry_allowed === false;
}

export function isSub2APIApprovalResponse(
  value: unknown, projectId: string, command: Sub2APIQueueCommand,
  requestId: string | null, approval?: Sub2APIApprovalCommand,
): value is Sub2APIApprovalResponse {
  if (!isSub2APIQueueCommand(command) || !envelope(value, requestId) ||
      !exact(value.data, [
        "approval_id", "scope", "status", "approved_at", "expires_at",
        "allowed_calls", "cost_decision", "cost",
      ]) || !sameScope(value.data.scope, projectId, command)) return false;
  const data = value.data;
  const scope = data.scope as Sub2APIScope;
  if (approval && (!isSub2APIApprovalCommand(approval) ||
      scope.task_id !== approval.input.task_id ||
      scope.attempt_id !== approval.input.attempt_id ||
      scope.attempt_fingerprint !== approval.input.expected_attempt_fingerprint)) return false;
  if (typeof data.approval_id !== "string" || !APPROVAL.test(data.approval_id) ||
      (data.status !== "APPROVED_ONE_CALL" && data.status !== "CONSUMED" &&
        data.status !== "EXPIRED" && data.status !== "REVOKED") ||
      typeof data.approved_at !== "string" ||
      typeof data.expires_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(data.approved_at) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(data.expires_at) ||
      Number.isNaN(Date.parse(data.approved_at)) ||
      Number.isNaN(Date.parse(data.expires_at)) ||
      data.allowed_calls !== 1 || data.cost_decision !== "UNKNOWN_COST_ACCEPTED" ||
      !unknownCost(data.cost)) return false;
  const interval = Date.parse(data.expires_at) - Date.parse(data.approved_at);
  return interval > 0 && interval <= 30 * 60_000;
}

const ERROR_CODES = new Map<number, ReadonlySet<string>>([
  [401, new Set(["SIDECAR_AUTH_REQUIRED"])],
  [403, new Set(["SIDECAR_REQUEST_REJECTED"])],
  [404, new Set(["PROJECT_NOT_FOUND", "SUB2API_RUN_NOT_FOUND",
    "SUB2API_APPROVAL_NOT_FOUND"])],
  [409, new Set(["SUB2API_QUEUE_CONFLICT", "SUB2API_SCOPE_CONFLICT",
    "SUB2API_APPROVAL_CONFLICT", "SUB2API_OPERATION_INCONSISTENT"])],
  [422, new Set(["VALIDATION_ERROR", "SUB2API_INPUT_REJECTED"])],
  [428, new Set(["IDEMPOTENCY_KEY_REQUIRED"])],
  [503, new Set(["SUB2API_EXECUTION_UNAVAILABLE"])],
]);

export function sub2APIDefiniteError(
  status: number, value: unknown, requestId: string | null,
): Sub2APIDefiniteError | null {
  if (!isRecord(value) || !exact(value, ["error", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.error) || !exact(value.error, [
        "code", "message", "details", "retryable",
      ]) || typeof value.error.code !== "string" ||
      !ERROR_CODES.get(status)?.has(value.error.code) ||
      typeof value.error.message !== "string" ||
      value.error.retryable !== false || !isRecord(value.error.details) ||
      Object.keys(value.error.details).length !== 0) return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status: status as Sub2APIDefiniteError["status"],
    code: value.error.code,
    request_id: value.request_id as string,
  };
}
