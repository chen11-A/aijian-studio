import { createHash } from "node:crypto";

import { hasRequestId, isRecord } from "./api-contract-guards";

export type HumanRightsDecision = "CLEARED" | "RESTRICTED";
export type HumanRightsDecisionCommand = {
  operation_id: string;
  expected_revision: number;
  decision: HumanRightsDecision;
  basis_text: string;
  supporting_reference?: string | null;
};
export type RightsDecisionAudit = {
  schema_version: 1;
  decision_id: string;
  project_id: string;
  asset_id: string;
  version_id: string;
  asset_sha256: string;
  revision: number;
  previous_decision_id: string | null;
  operation_id: string;
  request_sha256: string;
  decision: HumanRightsDecision;
  actor_type: "human";
  actor_id: string;
  basis_text: string;
  supporting_reference: string | null;
  evidence_sha256: string;
  decision_content_hash: string;
  created_at: string;
};
export type RightsDecisionWriteReceipt = {
  decision: RightsDecisionAudit;
  replayed: boolean;
  is_latest: boolean;
  current_revision: number;
};
export type AuthoritativeRightsDecision = {
  project_id: string;
  asset_id: string;
  version_id: string;
  asset_sha256: string;
  decision_id: string;
  revision: number;
  decision: HumanRightsDecision;
  previous_decision_id: string | null;
  decision_content_hash: string;
  evidence_sha256: string;
  actor_id: string;
  chain_integrity: true;
};
export type RightsDecisionReadStatus =
  | "VERIFIED" | "NO_DECISION" | "CONFLICT" | "NOT_FOUND"
  | "UNKNOWN_DATABASE" | "UNKNOWN_DATABASE_BUSY" | "UNKNOWN_DATABASE_CHANGED"
  | "UNKNOWN_INVALID_RECORD" | "UNKNOWN_READ_BUDGET" | "UNKNOWN_UNSAFE_PATH"
  | "UNKNOWN_UNSUPPORTED_PLATFORM";
export type RightsDecisionRead = {
  status: RightsDecisionReadStatus;
  current_revision: number | null;
  decision: AuthoritativeRightsDecision | null;
};
export type RightsDecisionWriteResponse = { data: RightsDecisionWriteReceipt; request_id: string };
export type RightsDecisionReadResponse = { data: RightsDecisionRead; request_id: string };
export type RightsDecisionHistoryResponse = { data: RightsDecisionAudit[]; request_id: string };
export type RightsDecisionAuditResponse = { data: RightsDecisionAudit; request_id: string };
export type RightsDecisionLatestExpectation = {
  expected_revision?: number;
  expected_decision_id?: string;
  expected_content_hash?: string;
};

// Transport wrappers and HTTP status mappings are owned by the route contract.
// Until that contract is frozen, these types describe the immutable core payload only.
export type RightsDecisionWriteResult =
  | { kind: "RECORDED"; receipt: RightsDecisionWriteResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type RightsDecisionOperationResult =
  | { kind: "FOUND"; receipt: RightsDecisionWriteResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type RightsDecisionLatestResult =
  | { kind: "READ"; receipt: RightsDecisionReadResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type RightsDecisionHistoryResult =
  | { kind: "LISTED"; receipt: RightsDecisionHistoryResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type RightsDecisionAuditResult =
  | { kind: "FOUND"; receipt: RightsDecisionAuditResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export const MEDIA_RIGHTS_DECISION_CHANNELS = Object.freeze({
  record: "media-rights:record-decision",
  operation: "media-rights:get-operation",
  latest: "media-rights:read-latest",
  history: "media-rights:list-history",
  audit: "media-rights:get-audit",
} as const);

const PROJECT = /^prj_[0-9a-f]{32}$/;
const ASSET = /^asset_[0-9a-f]{32}$/;
const VERSION = /^asv_[0-9a-f]{32}$/;
const DECISION_ID = /^ard_[0-9a-f]{32}$/;
const OPERATION_ID = /^rdop_[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
const READ_STATUSES = new Set<RightsDecisionReadStatus>([
  "VERIFIED", "NO_DECISION", "CONFLICT", "NOT_FOUND", "UNKNOWN_DATABASE",
  "UNKNOWN_DATABASE_BUSY", "UNKNOWN_DATABASE_CHANGED", "UNKNOWN_INVALID_RECORD",
  "UNKNOWN_READ_BUDGET", "UNKNOWN_UNSAFE_PATH", "UNKNOWN_UNSUPPORTED_PLATFORM",
]);

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function id(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function revision(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
function readable(value: unknown, min: number, max: number, layout: boolean): value is string {
  if (typeof value !== "string" || value !== value.normalize("NFC") ||
      value !== value.trim()) return false;
  const chars = [...value];
  return chars.length >= min && chars.length <= max && chars.every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code !== 127 && !(code >= 0xd800 && code <= 0xdfff) &&
      (code >= 32 || (layout && (character === "\n" || character === "\t")));
  });
}
function decision(value: unknown): value is HumanRightsDecision {
  return value === "CLEARED" || value === "RESTRICTED";
}
function nullableId(value: unknown, pattern: RegExp): value is string | null {
  return value === null || id(value, pattern);
}
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
}
function sha256(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(sortedJson(value)), "utf8").digest("hex");
}

export function isRightsProjectId(value: unknown): value is string { return id(value, PROJECT); }
export function isRightsAssetId(value: unknown): value is string { return id(value, ASSET); }
export function isRightsVersionId(value: unknown): value is string { return id(value, VERSION); }
export function isRightsOperationId(value: unknown): value is string { return id(value, OPERATION_ID); }
export function isRightsDecisionId(value: unknown): value is string { return id(value, DECISION_ID); }

export function isRightsDecisionLatestExpectation(
  value: unknown,
): value is RightsDecisionLatestExpectation {
  return isRecord(value) && Object.keys(value).every((key) => [
    "expected_revision", "expected_decision_id", "expected_content_hash",
  ].includes(key)) &&
    (value.expected_revision === undefined || revision(value.expected_revision, 0)) &&
    (value.expected_decision_id === undefined || id(value.expected_decision_id, DECISION_ID)) &&
    (value.expected_content_hash === undefined || id(value.expected_content_hash, HASH));
}

export function isHumanRightsDecisionCommand(value: unknown): value is HumanRightsDecisionCommand {
  return isRecord(value) &&
    ["operation_id", "expected_revision", "decision", "basis_text"].every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => [
      "operation_id", "expected_revision", "decision", "basis_text", "supporting_reference",
    ].includes(key)) &&
    id(value.operation_id, OPERATION_ID) && revision(value.expected_revision, 0) &&
    decision(value.decision) && readable(value.basis_text, 20, 4000, true) &&
    (value.supporting_reference === undefined || value.supporting_reference === null ||
      readable(value.supporting_reference, 1, 512, false));
}

function isRightsDecisionAudit(value: unknown): value is RightsDecisionAudit {
  if (!isRecord(value) || !exact(value, [
    "schema_version", "decision_id", "project_id", "asset_id", "version_id",
    "asset_sha256", "revision", "previous_decision_id", "operation_id",
    "request_sha256", "decision", "actor_type", "actor_id", "basis_text",
    "supporting_reference", "evidence_sha256", "decision_content_hash", "created_at",
  ]) || value.schema_version !== 1 || !id(value.decision_id, DECISION_ID) ||
      !id(value.project_id, PROJECT) || !id(value.asset_id, ASSET) ||
      !id(value.version_id, VERSION) || !id(value.asset_sha256, HASH) ||
      !revision(value.revision, 1) || !nullableId(value.previous_decision_id, DECISION_ID) ||
      !id(value.operation_id, OPERATION_ID) || !id(value.request_sha256, HASH) ||
      !decision(value.decision) || value.actor_type !== "human" ||
      !readable(value.actor_id, 1, 128, false) ||
      !readable(value.basis_text, 20, 4000, true) ||
      !(value.supporting_reference === null || readable(value.supporting_reference, 1, 512, false)) ||
      !id(value.evidence_sha256, HASH) || !id(value.decision_content_hash, HASH) ||
      typeof value.created_at !== "string" || value.created_at.length < 1 ||
      (value.revision === 1) !== (value.previous_decision_id === null)) return false;
  const { decision_content_hash: contentHash, ...content } = value;
  return value.evidence_sha256 === sha256({
    schema_version: 1, basis_text: value.basis_text,
    supporting_reference: value.supporting_reference,
  }) && contentHash === sha256(content);
}

export function isRightsDecisionWriteReceipt(
  value: unknown, projectId: string, assetId: string, versionId: string,
  command?: HumanRightsDecisionCommand,
): value is RightsDecisionWriteReceipt {
  if (!isRecord(value) || !exact(value, ["decision", "replayed", "is_latest", "current_revision"]) ||
      !isRightsDecisionAudit(value.decision) || typeof value.replayed !== "boolean" ||
      typeof value.is_latest !== "boolean" || !revision(value.current_revision, 1) ||
      value.current_revision < value.decision.revision ||
      value.is_latest !== (value.current_revision === value.decision.revision) ||
      value.decision.project_id !== projectId || value.decision.asset_id !== assetId ||
      value.decision.version_id !== versionId) return false;
  if (!command) return true;
  const audit = value.decision;
  return audit.operation_id === command.operation_id &&
    audit.revision === command.expected_revision + 1 &&
    audit.decision === command.decision && audit.basis_text === command.basis_text &&
    audit.supporting_reference === (command.supporting_reference ?? null) &&
    audit.request_sha256 === sha256({
      schema_version: 1, project_id: projectId, asset_id: assetId,
      version_id: versionId, operation_id: command.operation_id,
      expected_revision: command.expected_revision, decision: command.decision,
      actor_type: "human", actor_id: audit.actor_id,
      basis_text: command.basis_text,
      supporting_reference: command.supporting_reference ?? null,
    });
}

function isAuthoritativeDecision(value: unknown): value is AuthoritativeRightsDecision {
  return isRecord(value) && exact(value, [
    "project_id", "asset_id", "version_id", "asset_sha256", "decision_id",
    "revision", "decision", "previous_decision_id", "decision_content_hash",
    "evidence_sha256", "actor_id", "chain_integrity",
  ]) && id(value.project_id, PROJECT) && id(value.asset_id, ASSET) &&
    id(value.version_id, VERSION) && id(value.asset_sha256, HASH) &&
    id(value.decision_id, DECISION_ID) && revision(value.revision, 1) &&
    decision(value.decision) && nullableId(value.previous_decision_id, DECISION_ID) &&
    id(value.decision_content_hash, HASH) && id(value.evidence_sha256, HASH) &&
    readable(value.actor_id, 1, 128, false) && value.chain_integrity === true &&
    (value.revision === 1) === (value.previous_decision_id === null);
}

export function isRightsDecisionRead(
  value: unknown, projectId: string, assetId: string, versionId: string,
): value is RightsDecisionRead {
  if (!isRecord(value) || !exact(value, ["status", "current_revision", "decision"]) ||
      typeof value.status !== "string" || !READ_STATUSES.has(value.status as RightsDecisionReadStatus) ||
      !(value.current_revision === null || revision(value.current_revision, 0))) return false;
  if (value.status === "VERIFIED") {
    return isAuthoritativeDecision(value.decision) &&
      value.current_revision === value.decision.revision &&
      value.decision.project_id === projectId && value.decision.asset_id === assetId &&
      value.decision.version_id === versionId;
  }
  return value.decision === null &&
    (value.status !== "NO_DECISION" || value.current_revision === 0);
}

function response(value: unknown, requestId: string | null): value is {
  data: unknown; request_id: string;
} {
  return isRecord(value) && exact(value, ["data", "request_id"]) &&
    hasRequestId(value) && value.request_id === requestId;
}

export function isRightsDecisionWriteResponse(
  value: unknown, requestId: string | null, projectId: string, assetId: string,
  versionId: string, command?: HumanRightsDecisionCommand,
): value is RightsDecisionWriteResponse {
  return response(value, requestId) &&
    isRightsDecisionWriteReceipt(value.data, projectId, assetId, versionId, command);
}

export function isRightsDecisionReadResponse(
  value: unknown, requestId: string | null, projectId: string, assetId: string,
  versionId: string, expectation?: RightsDecisionLatestExpectation,
): value is RightsDecisionReadResponse {
  if (!response(value, requestId) ||
      !isRightsDecisionRead(value.data, projectId, assetId, versionId)) return false;
  const read = value.data;
  return read.status !== "VERIFIED" || !expectation ||
    (expectation.expected_revision === undefined ||
      read.current_revision === expectation.expected_revision) &&
    (expectation.expected_decision_id === undefined ||
      read.decision?.decision_id === expectation.expected_decision_id) &&
    (expectation.expected_content_hash === undefined ||
      read.decision?.decision_content_hash === expectation.expected_content_hash);
}

export function isRightsDecisionHistoryResponse(
  value: unknown, requestId: string | null, projectId: string, assetId: string,
  versionId: string,
): value is RightsDecisionHistoryResponse {
  if (!response(value, requestId) || !Array.isArray(value.data) ||
      value.data.length > 1000) return false;
  return value.data.every((item: unknown, index: number) =>
    isRightsDecisionAudit(item) && item.project_id === projectId &&
    item.asset_id === assetId && item.version_id === versionId &&
    item.revision === index + 1 &&
    item.previous_decision_id === (index === 0 ? null : value.data[index - 1].decision_id));
}

export function isRightsDecisionAuditResponse(
  value: unknown, requestId: string | null, projectId: string, assetId: string,
  versionId: string, decisionId: string,
): value is RightsDecisionAuditResponse {
  return response(value, requestId) && isRightsDecisionAudit(value.data) &&
    value.data.project_id === projectId && value.data.asset_id === assetId &&
    value.data.version_id === versionId && value.data.decision_id === decisionId;
}

export function rightsDecisionDefiniteError(
  status: number, value: unknown, requestId: string | null,
): { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string } | null {
  if (![401, 403, 404, 409, 422].includes(status) ||
      !isRecord(value) || !exact(value, ["error", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.error) ||
      !exact(value.error, ["code", "message", "details", "retryable"]) ||
      typeof value.error.code !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
      typeof value.error.message !== "string" || !isRecord(value.error.details) ||
      value.error.retryable !== false) return null;
  return { kind: "DEFINITE_SERVER_ERROR", status, code: value.error.code,
    request_id: value.request_id };
}
