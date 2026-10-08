import { hasRequestId, isRecord } from "./api-contract-guards";
import {
  isEpisodeScriptEpisodeId,
  isEpisodeScriptProjectId,
  isEpisodeScriptVersionId,
} from "./episode-script-contract";

export type CreateEpisodeScriptConfirmationRequest = {
  version_id: string;
  expected_content_hash: string;
  expected_head_revision: number;
  confirm: true;
};
export type EpisodeScriptConfirmation = {
  confirmation_id: string;
  project_id: string;
  episode_id: string;
  artifact_id: string;
  version_id: string;
  content_hash: string;
  head_revision: number;
  actor_id: string;
  confirmed_at: string;
};
export type EpisodeScriptConfirmationStatus = {
  project_id: string;
  episode_id: string;
  latest_version_id: string;
  latest_head_revision: number;
  confirmation: EpisodeScriptConfirmation | null;
  current: boolean;
};
export type EpisodeScriptConfirmationStatusResponse = {
  data: EpisodeScriptConfirmationStatus;
  request_id: string;
};
export type EpisodeScriptConfirmationCreatedResponse = {
  data: { status: EpisodeScriptConfirmationStatus; replayed: boolean };
  request_id: string;
};
export type EpisodeScriptConfirmationDefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: 401 | 403 | 404 | 409 | 422 | 428;
  code: string;
  request_id: string;
};
export type EpisodeScriptConfirmationReadResult =
  | { kind: "FOUND"; receipt: EpisodeScriptConfirmationStatusResponse }
  | EpisodeScriptConfirmationDefiniteError | { kind: "REMOTE_UNKNOWN" };
export type EpisodeScriptConfirmationCreateResult =
  | { kind: "CREATED"; receipt: EpisodeScriptConfirmationCreatedResponse }
  | EpisodeScriptConfirmationDefiniteError | { kind: "REMOTE_UNKNOWN" };

export const EPISODE_SCRIPT_CONFIRMATION_CHANNELS = Object.freeze({
  current: "episode-script-confirmation:current",
  create: "episode-script-confirmation:create",
  receipt: "episode-script-confirmation:receipt",
} as const);

const CONFIRMATION = /^esc_[0-9a-f]{32}$/;
const ARTIFACT = /^art_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
export function isEpisodeScriptConfirmationId(value: unknown): value is string {
  return typeof value === "string" && CONFIRMATION.test(value);
}
export function isCreateEpisodeScriptConfirmationRequest(
  value: unknown,
): value is CreateEpisodeScriptConfirmationRequest {
  return isRecord(value) && exact(value, [
    "version_id", "expected_content_hash", "expected_head_revision", "confirm",
  ]) && isEpisodeScriptVersionId(value.version_id) &&
    typeof value.expected_content_hash === "string" &&
    HASH.test(value.expected_content_hash) && positive(value.expected_head_revision) &&
    value.confirm === true;
}
function isConfirmation(
  value: unknown, projectId: string, episodeId: string,
): value is EpisodeScriptConfirmation {
  return isRecord(value) && exact(value, [
    "confirmation_id", "project_id", "episode_id", "artifact_id", "version_id",
    "content_hash", "head_revision", "actor_id", "confirmed_at",
  ]) && isEpisodeScriptConfirmationId(value.confirmation_id) &&
    value.project_id === projectId && value.episode_id === episodeId &&
    typeof value.artifact_id === "string" && ARTIFACT.test(value.artifact_id) &&
    isEpisodeScriptVersionId(value.version_id) &&
    typeof value.content_hash === "string" && HASH.test(value.content_hash) &&
    positive(value.head_revision) && typeof value.actor_id === "string" &&
    value.actor_id.trim().length >= 1 && [...value.actor_id].length <= 240 &&
    typeof value.confirmed_at === "string" && Number.isFinite(Date.parse(value.confirmed_at));
}
function isStatus(
  value: unknown, projectId: string, episodeId: string,
  confirmationId?: string,
): value is EpisodeScriptConfirmationStatus {
  if (!isRecord(value) || !exact(value, [
    "project_id", "episode_id", "latest_version_id", "latest_head_revision",
    "confirmation", "current",
  ]) || value.project_id !== projectId || value.episode_id !== episodeId ||
      !isEpisodeScriptVersionId(value.latest_version_id) ||
      !positive(value.latest_head_revision) || typeof value.current !== "boolean" ||
      !(value.confirmation === null || isConfirmation(value.confirmation, projectId, episodeId))) {
    return false;
  }
  if (confirmationId !== undefined && value.confirmation?.confirmation_id !== confirmationId) {
    return false;
  }
  return !value.current || (value.confirmation !== null &&
    value.confirmation.version_id === value.latest_version_id &&
    value.confirmation.head_revision === value.latest_head_revision);
}
export function isEpisodeScriptConfirmationStatusResponse(
  value: unknown, projectId: string, episodeId: string,
  requestId: string | null, confirmationId?: string,
): value is EpisodeScriptConfirmationStatusResponse {
  return isRecord(value) && exact(value, ["data", "request_id"]) &&
    hasRequestId(value) && value.request_id === requestId &&
    isStatus(value.data, projectId, episodeId, confirmationId);
}
export function isEpisodeScriptConfirmationCreatedResponse(
  value: unknown, projectId: string, episodeId: string,
  requestId: string | null, payload: CreateEpisodeScriptConfirmationRequest,
): value is EpisodeScriptConfirmationCreatedResponse {
  if (!isRecord(value) || !exact(value, ["data", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.data) || !exact(value.data, ["status", "replayed"]) ||
      typeof value.data.replayed !== "boolean" ||
      !isStatus(value.data.status, projectId, episodeId)) return false;
  const confirmation = value.data.status.confirmation;
  return confirmation !== null && confirmation.version_id === payload.version_id &&
    confirmation.content_hash === payload.expected_content_hash &&
    confirmation.head_revision === payload.expected_head_revision;
}
export function episodeScriptConfirmationDefiniteError(
  status: number, value: unknown, requestId: string | null,
): EpisodeScriptConfirmationDefiniteError | null {
  if (status !== 401 && status !== 403 && status !== 404 && status !== 409 &&
      status !== 422 && status !== 428) return null;
  if (!isRecord(value) || !exact(value, ["error", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.error) || !exact(value.error, [
        "code", "message", "details", "retryable",
      ]) || typeof value.error.code !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
      typeof value.error.message !== "string" || !isRecord(value.error.details) ||
      value.error.retryable !== false) return null;
  return { kind: "DEFINITE_SERVER_ERROR", status, code: value.error.code,
    request_id: value.request_id };
}
