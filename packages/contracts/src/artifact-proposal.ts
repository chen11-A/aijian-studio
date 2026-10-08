import type { components } from "./generated.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasRequestId(value: Record<string, unknown>): boolean {
  return typeof value.request_id === "string" && UUID_PATTERN.test(value.request_id);
}

export type ArtifactProposalResponse = components["schemas"]["ArtifactProposalResponse"];

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const PROPOSAL_ID = /^prp_[0-9a-f]{32}$/;
const ATTEMPT_ID = /^att_[0-9a-f]{32}$/;
const AGENT_RUN_ID = /^agr_[0-9a-f]{32}$/;
const SKILL_RUN_ID = /^skr_[0-9a-f]{32}$/;
const SOURCE_SPAN_ID = /^spn_[0-9a-f]{32}$/;
const SOURCE_ID = /^src_[0-9a-f]{32}$/;
const SOURCE_BLOCK_ID = /^srcb_[0-9a-f]{32}$/;
const CLAIM_ID = /^clm_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const ARTIFACT_ID = /^art_[0-9a-f]{32}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const DEFINITION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const ARTIFACT_TYPE = /^[A-Z][A-Za-z0-9]{1,79}$/;
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

function isDateTime(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isSourceSpan(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "source_span_id",
      "source_document_id",
      "source_block_id",
      "start_byte",
      "end_byte",
      "claim",
      "quote_hash",
    ]) &&
    typeof value.source_span_id === "string" &&
    SOURCE_SPAN_ID.test(value.source_span_id) &&
    typeof value.source_document_id === "string" &&
    SOURCE_ID.test(value.source_document_id) &&
    typeof value.source_block_id === "string" &&
    SOURCE_BLOCK_ID.test(value.source_block_id) &&
    isIntegerBetween(value.start_byte, 0, Number.MAX_SAFE_INTEGER) &&
    isIntegerBetween(value.end_byte, 1, Number.MAX_SAFE_INTEGER) &&
    Number(value.end_byte) > Number(value.start_byte) &&
    typeof value.claim === "string" &&
    value.claim.length > 0 &&
    value.claim.length <= 1000 &&
    typeof value.quote_hash === "string" &&
    CONTENT_HASH.test(value.quote_hash)
  );
}

function isClaim(value: unknown, spanIds: ReadonlySet<string>): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["claim_id", "text", "invented", "source_span_ids"]) ||
    typeof value.claim_id !== "string" ||
    !CLAIM_ID.test(value.claim_id) ||
    typeof value.text !== "string" ||
    value.text.length < 1 ||
    value.text.length > 2000 ||
    typeof value.invented !== "boolean" ||
    !Array.isArray(value.source_span_ids) ||
    value.source_span_ids.length > 100 ||
    !value.source_span_ids.every((id) => typeof id === "string" && spanIds.has(id))
  ) {
    return false;
  }
  return value.invented || value.source_span_ids.length > 0;
}

function isDiff(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["op", "path", "value"])) return false;
  return (
    ["add", "remove", "replace"].includes(String(value.op)) &&
    typeof value.path === "string" &&
    value.path.startsWith("/")
  );
}

function isDependency(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["artifact_type", "version_id", "approval_required"]) &&
    typeof value.artifact_type === "string" &&
    ARTIFACT_TYPE.test(value.artifact_type) &&
    typeof value.version_id === "string" &&
    VERSION_ID.test(value.version_id) &&
    value.approval_required === true
  );
}

function isImpact(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["artifact_type", "artifact_id", "impact"]) &&
    typeof value.artifact_type === "string" &&
    ARTIFACT_TYPE.test(value.artifact_type) &&
    (value.artifact_id === null ||
      (typeof value.artifact_id === "string" && ARTIFACT_ID.test(value.artifact_id))) &&
    ["CREATE", "STALE", "INVALIDATE"].includes(String(value.impact))
  );
}

function isCost(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["currency", "estimated_micros", "actual_micros"]) &&
    value.currency === "USD" &&
    isIntegerBetween(value.estimated_micros, 0, Number.MAX_SAFE_INTEGER) &&
    isIntegerBetween(value.actual_micros, 0, Number.MAX_SAFE_INTEGER)
  );
}

function isCapabilityLoss(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["code", "description"]) &&
    typeof value.code === "string" &&
    DEFINITION_ID.test(value.code) &&
    typeof value.description === "string" &&
    value.description.length >= 1 &&
    value.description.length <= 1000
  );
}

function isQc(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["check_id", "status", "details"]) &&
    typeof value.check_id === "string" &&
    DEFINITION_ID.test(value.check_id) &&
    ["PASS", "FAIL", "NOT_RUN"].includes(String(value.status)) &&
    typeof value.details === "string" &&
    value.details.length >= 1 &&
    value.details.length <= 1000
  );
}

function isProposal(value: unknown, projectId: string, proposalId: string): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schema_version",
      "proposal_id",
      "project_id",
      "target_artifact_type",
      "payload",
      "payload_hash",
      "source_spans",
      "claims",
      "diff",
      "dependencies",
      "impacts",
      "cost",
      "confidence_basis_points",
      "capability_losses",
      "qc",
      "producer_agent_run_id",
      "producer_skill_run_id",
    ]) ||
    value.schema_version !== "1.0.0" ||
    value.project_id !== projectId ||
    value.proposal_id !== proposalId ||
    typeof value.target_artifact_type !== "string" ||
    !ARTIFACT_TYPE.test(value.target_artifact_type) ||
    !isRecord(value.payload) ||
    hasSensitiveKey(value.payload) ||
    typeof value.payload_hash !== "string" ||
    !CONTENT_HASH.test(value.payload_hash) ||
    !Array.isArray(value.source_spans) ||
    value.source_spans.length < 1 ||
    value.source_spans.length > 20_000 ||
    !value.source_spans.every(isSourceSpan)
  ) {
    return false;
  }
  const spanIds = new Set(value.source_spans.map((span) => String(span.source_span_id)));
  return (
    Array.isArray(value.claims) &&
    value.claims.length <= 20_000 &&
    value.claims.every((claim) => isClaim(claim, spanIds)) &&
    Array.isArray(value.diff) &&
    value.diff.length <= 20_000 &&
    value.diff.every(isDiff) &&
    Array.isArray(value.dependencies) &&
    value.dependencies.length <= 10_000 &&
    value.dependencies.every(isDependency) &&
    Array.isArray(value.impacts) &&
    value.impacts.length <= 10_000 &&
    value.impacts.every(isImpact) &&
    isCost(value.cost) &&
    isIntegerBetween(value.confidence_basis_points, 0, 10_000) &&
    Array.isArray(value.capability_losses) &&
    value.capability_losses.length <= 100 &&
    value.capability_losses.every(isCapabilityLoss) &&
    Array.isArray(value.qc) &&
    value.qc.length >= 1 &&
    value.qc.length <= 100 &&
    value.qc.every(isQc) &&
    typeof value.producer_agent_run_id === "string" &&
    AGENT_RUN_ID.test(value.producer_agent_run_id) &&
    typeof value.producer_skill_run_id === "string" &&
    SKILL_RUN_ID.test(value.producer_skill_run_id)
  );
}

export function isArtifactProposalResponse(
  value: unknown,
  expectedProjectId: string,
  expectedProposalId: string,
): value is ArtifactProposalResponse {
  // The Sidecar/store is the canonical hash authority and revalidates both hashes
  // against immutable JSON before this read boundary. Browser/Electron guards enforce
  // the published shape, ownership, IDs and sensitive-key policy without duplicating crypto.
  if (
    !PROJECT_ID.test(expectedProjectId) ||
    !PROPOSAL_ID.test(expectedProposalId) ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "project_id",
      "proposal_id",
      "proposal",
      "producer_attempt_id",
      "proposal_hash",
      "created_at",
    ])
  ) {
    return false;
  }
  const data = value.data;
  return (
    data.project_id === expectedProjectId &&
    data.proposal_id === expectedProposalId &&
    typeof data.producer_attempt_id === "string" &&
    ATTEMPT_ID.test(data.producer_attempt_id) &&
    typeof data.proposal_hash === "string" &&
    CONTENT_HASH.test(data.proposal_hash) &&
    isDateTime(data.created_at) &&
    isProposal(data.proposal, expectedProjectId, expectedProposalId)
  );
}
