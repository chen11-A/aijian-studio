import { hasRequestId, isRecord } from "./api-contract-guards";

export type SourceProposalAcceptanceData = {
  acceptance_id: string;
  project_id: string;
  source_extraction_version_id: string;
  source_extraction_content_hash: string;
  proposal_id: string;
  accepted_as_draft_at: string;
  latest_version_id: string;
  latest_head_revision: number;
  current: boolean;
};
export type SourceProposalAcceptanceResponse = {
  data: SourceProposalAcceptanceData;
  request_id: string;
};
export type SourceProposalAcceptanceResult =
  | { kind: "FOUND"; receipt: SourceProposalAcceptanceResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 401 | 403 | 404 | 409 | 422;
      code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export const SOURCE_PROPOSAL_ACCEPTANCE_CHANNEL = "source-extraction:proposal-acceptance";
const PROJECT = /^prj_[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const ACCEPTANCE = /^pda_[0-9a-f]{32}$/;
const PROPOSAL = /^prp_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
export function isSourceProposalAcceptanceProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT.test(value);
}
export function isSourceProposalAcceptanceVersionId(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}
export function isSourceProposalAcceptanceResponse(
  value: unknown, projectId: string, versionId: string,
  requestId: string | null, etag: string | null,
): value is SourceProposalAcceptanceResponse {
  if (!isRecord(value) || !exact(value, ["data", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.data) || !exact(value.data, [
        "acceptance_id", "project_id", "source_extraction_version_id",
        "source_extraction_content_hash", "proposal_id", "accepted_as_draft_at",
        "latest_version_id", "latest_head_revision", "current",
      ])) return false;
  const data = value.data;
  return typeof data.acceptance_id === "string" && ACCEPTANCE.test(data.acceptance_id) &&
    data.project_id === projectId && data.source_extraction_version_id === versionId &&
    typeof data.source_extraction_content_hash === "string" &&
    HASH.test(data.source_extraction_content_hash) &&
    etag === `"${data.source_extraction_content_hash}"` &&
    typeof data.proposal_id === "string" && PROPOSAL.test(data.proposal_id) &&
    typeof data.accepted_as_draft_at === "string" &&
    Number.isFinite(Date.parse(data.accepted_as_draft_at)) &&
    typeof data.latest_version_id === "string" && VERSION.test(data.latest_version_id) &&
    typeof data.latest_head_revision === "number" &&
    Number.isSafeInteger(data.latest_head_revision) && data.latest_head_revision >= 1 &&
    typeof data.current === "boolean" &&
    data.current === (data.latest_version_id === versionId);
}
export function sourceProposalAcceptanceDefiniteError(
  status: number, value: unknown, requestId: string | null,
): Extract<SourceProposalAcceptanceResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (status !== 401 && status !== 403 && status !== 404 && status !== 409 &&
      status !== 422) return null;
  if (!isRecord(value) || !exact(value, ["error", "request_id"]) ||
      typeof value.request_id !== "string" || !hasRequestId(value) ||
      value.request_id !== requestId ||
      !isRecord(value.error) || !exact(value.error, [
        "code", "message", "details", "retryable",
      ]) || typeof value.error.code !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
      typeof value.error.message !== "string" || !isRecord(value.error.details) ||
      value.error.retryable !== false ||
      (status === 404 && value.error.code !== "SOURCE_PROPOSAL_ACCEPTANCE_NOT_FOUND") ||
      (status === 409 && value.error.code !== "SOURCE_PROPOSAL_ACCEPTANCE_INCONSISTENT")) {
    return null;
  }
  return { kind: "DEFINITE_SERVER_ERROR", status, code: value.error.code,
    request_id: value.request_id };
}
