import { createHash } from "node:crypto";
import type { components } from "@aijian/contracts";

import { hasOnlyKeys, hasRequestId, isRecord } from "./api-contract-guards";

export type ProductionBriefCreateCommand = {
  operation_id: string;
  input: {
    content: unknown;
    parent_version_id?: string | null;
    expected_revision?: number | null;
    change_summary: string;
  };
};

export type NormalizedProductionBriefCreateCommand = {
  operation_id: string;
  input: {
    content: components["schemas"]["ProductionBriefContentV1"];
    parent_version_id: string | null;
    expected_revision: number | null;
    change_summary: string;
  };
};

export type ProductionBriefCreateResult =
  | { kind: "SUCCEEDED"; receipt: components["schemas"]["ProductionBriefResponse"] }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 409 | 422 | 428; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export const PRODUCTION_BRIEF_CHANNELS = Object.freeze({
  get: "production-brief:get",
  getVersion: "production-brief:get-version",
  create: "production-brief:create",
} as const);

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JSON_SAFE_INTEGER_MAX = 9_007_199_254_740_991;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasOnlyKeys(value, keys) && keys.every((key) => Object.hasOwn(value, key));
}

/** Validates the public envelope before privileged HTTP results cross IPC. */
export function isProductionBriefResponse(
  value: unknown,
  projectId: string,
  expectedVersionId?: string,
): value is components["schemas"]["ProductionBriefResponse"] {
  if (
    !PROJECT_ID.test(projectId) ||
    !isRecord(value) ||
    !hasExactKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data)
  )
    return false;
  const data = value.data;
  if (
    !hasExactKeys(data, ["project_id", "head", "version"]) ||
    data.project_id !== projectId ||
    !isRecord(data.head) ||
    !isRecord(data.version)
  )
    return false;
  const head = data.head;
  if (
    !hasExactKeys(head, [
      "accepted_version_id",
      "artifact_id",
      "latest_version_id",
      "review_evidence_revision",
      "review_submission_id",
      "review_version_id",
      "revision",
      "updated_at",
    ]) ||
    typeof head.artifact_id !== "string" ||
    !/^art_[0-9a-f]{32}$/.test(head.artifact_id) ||
    typeof head.latest_version_id !== "string" ||
    !VERSION_ID.test(head.latest_version_id) ||
    !Number.isSafeInteger(head.revision) ||
    Number(head.revision) < 1 ||
    !Number.isSafeInteger(head.review_evidence_revision) ||
    Number(head.review_evidence_revision) < 0 ||
    ![head.accepted_version_id, head.review_version_id].every(
      (x) => x === null || (typeof x === "string" && VERSION_ID.test(x)),
    ) ||
    !(head.review_submission_id === null || typeof head.review_submission_id === "string") ||
    typeof head.updated_at !== "string" ||
    Number.isNaN(Date.parse(head.updated_at))
  )
    return false;
  const version = data.version;
  if (
    !hasExactKeys(version, [
      "artifact_id",
      "change_summary",
      "content",
      "content_hash",
      "created_at",
      "id",
      "parent_version_id",
      "schema_version",
      "version_number",
    ]) ||
    typeof version.id !== "string" ||
    !VERSION_ID.test(version.id) ||
    (expectedVersionId !== undefined && version.id !== expectedVersionId)
  )
    return false;
  return (
    typeof version.artifact_id === "string" &&
    version.artifact_id === head.artifact_id &&
    /^art_[0-9a-f]{32}$/.test(version.artifact_id) &&
    typeof version.change_summary === "string" &&
    typeof version.content_hash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(version.content_hash) &&
    typeof version.created_at === "string" &&
    !Number.isNaN(Date.parse(version.created_at)) &&
    Number.isSafeInteger(version.version_number) &&
    Number(version.version_number) >= 1 &&
    (version.parent_version_id === null ||
      (typeof version.parent_version_id === "string" &&
        VERSION_ID.test(version.parent_version_id))) &&
    version.schema_version === "1.0.0" &&
    isWireContent(version.content)
  );
}

export function isProductionBriefLatestResponse(
  value: unknown,
  projectId: string,
): value is components["schemas"]["ProductionBriefResponse"] {
  if (
    !isProductionBriefResponse(value, projectId) ||
    !isRecord(value.data) ||
    !isRecord(value.data.head) ||
    !isRecord(value.data.version)
  )
    return false;
  return value.data.version.id === value.data.head.latest_version_id;
}

function isText(value: unknown, limit = 4000): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= limit;
}

function isRational(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["num", "den"]) &&
    Number.isSafeInteger(value.num) &&
    Number(value.num) > 0 &&
    Number(value.num) <= JSON_SAFE_INTEGER_MAX &&
    Number.isSafeInteger(value.den) &&
    Number(value.den) > 0 &&
    Number(value.den) <= 2147483647 &&
    gcd(Number(value.num), Number(value.den)) === 1
  );
}
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function isCreativeEntry(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "original_idea") {
    if (
      !hasOnlyKeys(value, ["kind", "origin_statement", "references"]) ||
      !isText(value.origin_statement) ||
      !(value.references === undefined || Array.isArray(value.references)) ||
      (Array.isArray(value.references) && value.references.length > 32)
    )
      return false;
    const pairs = new Set<string>();
    return (value.references ?? []).every(
      (reference) =>
        isRecord(reference) &&
        hasOnlyKeys(reference, ["reference_kind", "description"]) &&
        typeof reference.reference_kind === "string" &&
        ["inspiration", "research", "other"].includes(reference.reference_kind) &&
        isText(reference.description) &&
        !pairs.has(`${reference.reference_kind}\0${reference.description}`) &&
        (pairs.add(`${reference.reference_kind}\0${reference.description}`), true),
    );
  }
  return (
    value.kind === "source_adaptation" &&
    hasOnlyKeys(value, [
      "kind",
      "adaptation_statement",
      "source_document_id",
      "source_manifest_version_id",
      "source_block_ids",
    ]) &&
    isText(value.adaptation_statement) &&
    typeof value.source_document_id === "string" &&
    /^src_[0-9a-f]{32}$/.test(value.source_document_id) &&
    typeof value.source_manifest_version_id === "string" &&
    VERSION_ID.test(value.source_manifest_version_id) &&
    Array.isArray(value.source_block_ids) &&
    value.source_block_ids.length > 0 &&
    value.source_block_ids.length <= 100 &&
    value.source_block_ids.every(
      (block) => typeof block === "string" && /^srcb_[0-9a-f]{32}$/.test(block),
    ) &&
    new Set(value.source_block_ids).size === value.source_block_ids.length
  );
}

function isRawContent(value: unknown): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schema_version",
      "creative_entry",
      "creative",
      "delivery",
      "duration_intent",
      "budget_intent",
      "rights_declaration",
    ]) ||
    !(value.schema_version === undefined || value.schema_version === "1.0.0") ||
    !isCreativeEntry(value.creative_entry) ||
    !isRecord(value.creative) ||
    !isText(value.creative.premise) ||
    !isText(value.creative.intent) ||
    !isRecord(value.delivery) ||
    !isText(value.delivery.language) ||
    !isRational(value.delivery.display_aspect_ratio) ||
    !isRational(value.delivery.frame_rate) ||
    !Number.isSafeInteger(value.delivery.width_px) ||
    !Number.isSafeInteger(value.delivery.height_px) ||
    Number(value.delivery.width_px) <= 0 ||
    Number(value.delivery.width_px) > JSON_SAFE_INTEGER_MAX ||
    Number(value.delivery.height_px) <= 0 ||
    Number(value.delivery.height_px) > JSON_SAFE_INTEGER_MAX
  )
    return false;
  const c = value.creative,
    d = value.delivery,
    du = value.duration_intent,
    b = value.budget_intent,
    r = value.rights_declaration;
  const aspect = isRecord(d.display_aspect_ratio) ? d.display_aspect_ratio : null;
  if (
    !hasOnlyKeys(c, ["premise", "intent", "audience", "genre", "style", "constraints"]) ||
    ![c.audience, c.genre, c.style].every((x) => x === null || x === undefined || isText(x, 240)) ||
    !(c.constraints === undefined || Array.isArray(c.constraints)) ||
    (Array.isArray(c.constraints) && c.constraints.length > 32) ||
    !(c.constraints ?? []).every((x) => isText(x, 240)) ||
    new Set(c.constraints ?? []).size !== (c.constraints ?? []).length ||
    !hasOnlyKeys(d, ["language", "display_aspect_ratio", "width_px", "height_px", "frame_rate"]) ||
    !isRational(d.frame_rate) ||
    aspect === null ||
    BigInt(Number(d.width_px)) * BigInt(Number(aspect.den)) !==
      BigInt(Number(d.height_px)) * BigInt(Number(aspect.num))
  )
    return false;
  if (
    !isRecord(du) ||
    !hasOnlyKeys(du, ["work_seconds", "episode_mode", "episode_seconds"]) ||
    (du.episode_mode !== "unspecified" && du.episode_mode !== "per_episode") ||
    ![du.work_seconds, du.episode_seconds].every(
      (x) =>
        x === null ||
        (Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) <= JSON_SAFE_INTEGER_MAX),
    ) ||
    du.work_seconds === 0 ||
    (du.episode_mode === "unspecified" && du.episode_seconds !== null) ||
    (du.episode_mode === "per_episode" && !du.episode_seconds)
  )
    return false;
  if (
    !isRecord(b) ||
    !hasOnlyKeys(b, ["state", "currency", "amount_micros"]) ||
    (b.state !== "unknown" && b.state !== "declared") ||
    !(b.currency === null || (typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency))) ||
    !(
      b.amount_micros === null ||
      (Number.isSafeInteger(b.amount_micros) &&
        Number(b.amount_micros) >= 0 &&
        Number(b.amount_micros) <= JSON_SAFE_INTEGER_MAX)
    )
  )
    return false;
  if (b.state === "unknown" && !(b.currency === null && b.amount_micros === null)) return false;
  if (b.state === "declared" && !(b.currency !== null && b.amount_micros !== null)) return false;
  return (
    isRecord(r) &&
    hasOnlyKeys(r, ["state", "statement"]) &&
    (r.state === "unknown" || r.state === "user_declared") &&
    (r.statement === null || isText(r.statement)) &&
    (r.state === "user_declared") === (r.statement !== null)
  );
}

function isWireContent(value: unknown): boolean {
  if (
    !isRawContent(value) ||
    value.schema_version !== "1.0.0" ||
    !hasExactKeys(value, [
      "schema_version",
      "creative_entry",
      "creative",
      "delivery",
      "duration_intent",
      "budget_intent",
      "rights_declaration",
    ])
  )
    return false;
  const entry = value.creative_entry;
  const creative = value.creative;
  if (!isRecord(entry) || !isRecord(creative)) return false;
  if (
    entry.kind === "original_idea" &&
    !hasExactKeys(entry, ["kind", "origin_statement", "references"])
  )
    return false;
  return hasExactKeys(creative, ["premise", "intent", "audience", "genre", "style", "constraints"]);
}

export function productionBriefSafeError(
  value: unknown,
  status: number,
): ProductionBriefCreateResult | null {
  if (
    ![409, 422, 428].includes(status) ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ["error", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.error) ||
    !hasOnlyKeys(value.error, ["code", "message", "retryable", "details"])
  )
    return null;
  const code = value.error.code;
  if (
    typeof value.error.message !== "string" ||
    typeof value.error.retryable !== "boolean" ||
    !isRecord(value.error.details) ||
    !Object.values(value.error.details).every((detail) => typeof detail === "string")
  )
    return null;
  const permitted: Record<number, string[]> = {
    409: ["ARTIFACT_DEPENDENCY_INVALID"],
    422: ["VALIDATION_ERROR"],
    428: ["PRECONDITION_REQUIRED"],
  };
  const allowed = permitted[status] ?? [];
  return typeof code === "string" && allowed.includes(code)
    ? {
        kind: "DEFINITE_SERVER_ERROR",
        status: status as 409 | 422 | 428,
        code,
        request_id: String(value.request_id),
      }
    : null;
}

export function isProductionBriefCreateCommand(
  value: unknown,
): value is ProductionBriefCreateCommand {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["operation_id", "input"]) &&
    typeof value.operation_id === "string" &&
    OPERATION_ID.test(value.operation_id) &&
    isRecord(value.input) &&
    hasOnlyKeys(value.input, [
      "content",
      "parent_version_id",
      "expected_revision",
      "change_summary",
    ]) &&
    isRawContent(value.input.content) &&
    (value.input.parent_version_id === undefined ||
      value.input.parent_version_id === null ||
      (typeof value.input.parent_version_id === "string" &&
        VERSION_ID.test(value.input.parent_version_id))) &&
    (value.input.expected_revision === undefined ||
      value.input.expected_revision === null ||
      (Number.isSafeInteger(value.input.expected_revision) &&
        Number(value.input.expected_revision) >= 1)) &&
    isText(value.input.change_summary, 1000)
  );
}

export function normalizeProductionBriefCreateCommand(
  value: unknown,
): NormalizedProductionBriefCreateCommand | null {
  if (!isProductionBriefCreateCommand(value) || !isRecord(value.input.content)) return null;
  const rawContent = value.input.content;
  const rawEntry = rawContent.creative_entry;
  const rawCreative = rawContent.creative;
  if (!isRecord(rawEntry) || !isRecord(rawCreative)) return null;
  const creativeEntry =
    rawEntry.kind === "original_idea"
      ? { ...rawEntry, references: rawEntry.references ?? [] }
      : rawEntry;
  const content = {
    ...rawContent,
    schema_version: "1.0.0" as const,
    creative_entry: creativeEntry,
    creative: {
      ...rawCreative,
      audience: rawCreative.audience ?? null,
      genre: rawCreative.genre ?? null,
      style: rawCreative.style ?? null,
      constraints: rawCreative.constraints ?? [],
    },
  } as components["schemas"]["ProductionBriefContentV1"];
  return {
    operation_id: value.operation_id,
    input: {
      content,
      parent_version_id: value.input.parent_version_id ?? null,
      expected_revision: value.input.expected_revision ?? null,
      change_summary: value.input.change_summary,
    },
  };
}

export function productionBriefIdempotencyKey(
  projectId: string,
  command: ProductionBriefCreateCommand,
): string {
  if (!PROJECT_ID.test(projectId) || !isProductionBriefCreateCommand(command)) {
    throw new Error("ProductionBrief idempotency requires an exact project and command");
  }
  return `production-brief:create:v1:${createHash("sha256")
    .update(`${projectId}\u0000${command.operation_id}`, "utf8")
    .digest("hex")}`;
}
