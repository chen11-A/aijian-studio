import type { components } from "@aijian/contracts";
import type { ArtifactProposalResponse } from "@aijian/contracts/artifact-proposal";

import type { LocalApiClient } from "./api-client";
import { hasControlCharacter, hasOnlyKeys, hasRequestId, isRecord } from "./api-contract-guards";

export {
  isArtifactProposalResponse,
  type ArtifactProposalResponse,
} from "@aijian/contracts/artifact-proposal";

export type ArtifactProposalDraftAcceptanceInput =
  components["schemas"]["CreateArtifactProposalDraftAcceptanceRequest"];
export type ArtifactProposalDraftAcceptanceResponse =
  components["schemas"]["ArtifactProposalDraftAcceptanceResponse"];
export type ArtifactProposalRejectionInput =
  components["schemas"]["CreateArtifactProposalRejectionRequest"];
export type ArtifactProposalRejectionResponse =
  components["schemas"]["ArtifactProposalRejectionResponse"];
export type ArtifactProposalDecisionResult<TReceipt> =
  | { kind: "SUCCEEDED"; receipt: TReceipt }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export const ARTIFACT_PROPOSAL_CHANNELS = Object.freeze({
  get: "proposals:get",
  acceptAsDraft: "proposals:accept-as-draft",
  reject: "proposals:reject",
} as const);

type ProposalClient = Pick<
  LocalApiClient,
  "getArtifactProposal" | "acceptArtifactProposalAsDraft" | "rejectArtifactProposal"
>;
type ProposalInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const PROPOSAL_ID_PATTERN = /^prp_[0-9a-f]{32}$/;
const ACCEPTANCE_ID_PATTERN = /^pda_[0-9a-f]{32}$/;
const REJECTION_ID_PATTERN = /^pdr_[0-9a-f]{32}$/;
const VERSION_ID_PATTERN = /^ver_[0-9a-f]{32}$/;
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REJECTION_REASONS = new Set([
  "SOURCE_EVIDENCE",
  "CREATIVE_DIRECTION",
  "CONTINUITY",
  "TECHNICAL_QUALITY",
  "RIGHTS_OR_SAFETY",
  "BUDGET_OR_COST",
  "OTHER",
]);

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isActorId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 200 &&
    !hasControlCharacter(value)
  );
}

export function isArtifactProposalDecisionKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,240}$/.test(value);
}

export function isArtifactProposalDraftAcceptanceInput(
  value: unknown,
): value is ArtifactProposalDraftAcceptanceInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["parent_version_id", "expected_head_revision"])) {
    return false;
  }
  const parent = value.parent_version_id;
  const revision = value.expected_head_revision;
  const parentAbsent = parent === undefined || parent === null;
  const revisionAbsent = revision === undefined || revision === null;
  return (
    parentAbsent === revisionAbsent &&
    (parentAbsent ||
      (typeof parent === "string" &&
        VERSION_ID_PATTERN.test(parent) &&
        Number.isInteger(revision) &&
        typeof revision === "number" &&
        revision >= 1))
  );
}

export function isArtifactProposalRejectionInput(
  value: unknown,
): value is ArtifactProposalRejectionInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["reason_code", "comment"])) return false;
  const comment = typeof value.comment === "string" ? value.comment : "";
  return (
    typeof value.reason_code === "string" &&
    REJECTION_REASONS.has(value.reason_code) &&
    comment.length > 0 &&
    comment === comment.normalize("NFC").replace(/\r\n?/g, "\n").trim() &&
    [...comment].length <= 4000 &&
    new TextEncoder().encode(comment).byteLength <= 16 * 1024 &&
    ![...comment].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
        codePoint === 127
      );
    })
  );
}

export function isArtifactProposalDraftAcceptanceResponse(
  value: unknown,
  projectId: string,
  proposalId: string,
): value is ArtifactProposalDraftAcceptanceResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["data", "request_id"]) || !hasRequestId(value)) {
    return false;
  }
  const data = value.data;
  return (
    isRecord(data) &&
    hasOnlyKeys(data, [
      "acceptance_id",
      "project_id",
      "proposal_id",
      "draft_version_id",
      "actor_id",
      "accepted_as_draft_at",
      "replayed",
    ]) &&
    typeof data.acceptance_id === "string" &&
    ACCEPTANCE_ID_PATTERN.test(data.acceptance_id) &&
    data.project_id === projectId &&
    PROJECT_ID_PATTERN.test(projectId) &&
    data.proposal_id === proposalId &&
    PROPOSAL_ID_PATTERN.test(proposalId) &&
    typeof data.draft_version_id === "string" &&
    VERSION_ID_PATTERN.test(data.draft_version_id) &&
    isActorId(data.actor_id) &&
    isDateTime(data.accepted_as_draft_at) &&
    typeof data.replayed === "boolean"
  );
}

export function isArtifactProposalRejectionResponse(
  value: unknown,
  projectId: string,
  proposalId: string,
): value is ArtifactProposalRejectionResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["data", "request_id"]) || !hasRequestId(value)) {
    return false;
  }
  const data = value.data;
  return (
    isRecord(data) &&
    hasOnlyKeys(data, [
      "rejection_id",
      "project_id",
      "proposal_id",
      "proposal_hash",
      "reason_code",
      "comment",
      "actor_id",
      "rejected_at",
      "replayed",
    ]) &&
    typeof data.rejection_id === "string" &&
    REJECTION_ID_PATTERN.test(data.rejection_id) &&
    data.project_id === projectId &&
    PROJECT_ID_PATTERN.test(projectId) &&
    data.proposal_id === proposalId &&
    PROPOSAL_ID_PATTERN.test(proposalId) &&
    typeof data.proposal_hash === "string" &&
    CONTENT_HASH_PATTERN.test(data.proposal_hash) &&
    typeof data.reason_code === "string" &&
    REJECTION_REASONS.has(data.reason_code) &&
    isArtifactProposalRejectionInput({
      reason_code: data.reason_code,
      comment: data.comment,
    }) &&
    isActorId(data.actor_id) &&
    isDateTime(data.rejected_at) &&
    typeof data.replayed === "boolean"
  );
}

export function createArtifactProposalPreload(invoke: ProposalInvoke): {
  getArtifactProposal(projectId: string, proposalId: string): Promise<ArtifactProposalResponse>;
  acceptArtifactProposalAsDraft(
    projectId: string,
    proposalId: string,
    input: ArtifactProposalDraftAcceptanceInput,
  ): Promise<ArtifactProposalDecisionResult<ArtifactProposalDraftAcceptanceResponse>>;
  rejectArtifactProposal(
    projectId: string,
    proposalId: string,
    input: ArtifactProposalRejectionInput,
  ): Promise<ArtifactProposalDecisionResult<ArtifactProposalRejectionResponse>>;
} {
  return {
    getArtifactProposal: (projectId, proposalId) =>
      invoke(
        ARTIFACT_PROPOSAL_CHANNELS.get,
        projectId,
        proposalId,
      ) as Promise<ArtifactProposalResponse>,
    acceptArtifactProposalAsDraft: (projectId, proposalId, input) =>
      invoke(ARTIFACT_PROPOSAL_CHANNELS.acceptAsDraft, projectId, proposalId, input) as Promise<
        ArtifactProposalDecisionResult<ArtifactProposalDraftAcceptanceResponse>
      >,
    rejectArtifactProposal: (projectId, proposalId, input) =>
      invoke(ARTIFACT_PROPOSAL_CHANNELS.reject, projectId, proposalId, input) as Promise<
        ArtifactProposalDecisionResult<ArtifactProposalRejectionResponse>
      >,
  };
}

export function registerArtifactProposalHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => ProposalClient,
): void {
  handle(ARTIFACT_PROPOSAL_CHANNELS.get, (event, projectId, proposalId) => {
    if (typeof projectId !== "string" || typeof proposalId !== "string") {
      throw new Error("Artifact proposal read IPC requires exact string arguments");
    }
    return clientFor(event).getArtifactProposal(projectId, proposalId);
  });
  handle(ARTIFACT_PROPOSAL_CHANNELS.acceptAsDraft, (event, projectId, proposalId, input) =>
    typeof projectId === "string" && typeof proposalId === "string"
      ? clientFor(event).acceptArtifactProposalAsDraft(
          projectId,
          proposalId,
          input as ArtifactProposalDraftAcceptanceInput,
        )
      : Promise.reject(new Error("Artifact proposal acceptance IPC requires exact arguments")),
  );
  handle(ARTIFACT_PROPOSAL_CHANNELS.reject, (event, projectId, proposalId, input) =>
    typeof projectId === "string" && typeof proposalId === "string"
      ? clientFor(event).rejectArtifactProposal(
          projectId,
          proposalId,
          input as ArtifactProposalRejectionInput,
        )
      : Promise.reject(new Error("Artifact proposal rejection IPC requires exact arguments")),
  );
}
