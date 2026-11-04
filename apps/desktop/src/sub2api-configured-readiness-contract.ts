import type { components } from "@aijian/contracts";
import { hasRequestId, isRecord } from "./api-contract-guards";
import { isSub2APIOriginMode } from "./provider-connection-contract";

export type Sub2APIReadinessReason = components["schemas"]["LocalReadinessReason"];
export type Sub2APIConfiguredReadinessData =
  components["schemas"]["Sub2APIConfiguredReadinessData"];
export type Sub2APIConfiguredReadinessResponse =
  components["schemas"]["Sub2APIConfiguredReadinessResponse"];
export type Sub2APIConfiguredReadinessResult =
  | { kind: "READ"; receipt: Sub2APIConfiguredReadinessResponse }
  | {
      kind: "DEFINITE_SERVER_ERROR";
      status: 401 | 403 | 404 | 422;
      code: string;
      request_id: string;
    }
  | { kind: "READINESS_UNKNOWN" };

export const SUB2API_CONFIGURED_READINESS_CHANNEL = "providers:sub2api-configured-readiness";

const CONNECTION_ID = /^pcn_[0-9a-f]{32}$/;
const REASONS = new Set<Sub2APIReadinessReason>([
  "NOT_SUB2API",
  "CONNECTION_DISABLED",
  "ORIGIN_INVALID",
  "TEXT_MODEL_NOT_CONFIGURED",
  "CREDENTIAL_MISSING",
  "CREDENTIAL_UNAVAILABLE",
  "RUNTIME_UNAVAILABLE",
]);
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
export function isSub2APIConnectionId(value: unknown): value is string {
  return typeof value === "string" && CONNECTION_ID.test(value);
}
export function isSub2APIModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    [...value].length >= 1 &&
    [...value].length <= 200 &&
    value === value.trim() &&
    ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  );
}
export function isSub2APIConfiguredReadinessResponse(
  value: unknown,
  connectionId: string,
  modelId: string,
  requestId: string | null,
): value is Sub2APIConfiguredReadinessResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.data) ||
    !exact(value.data, [
      "connection_id",
      "connection_revision",
      "origin_mode",
      "model_id",
      "credential_status",
      "runtime_status",
      "local_preconditions_met",
      "reasons",
      "provider_observation",
      "model_entitlement",
    ])
  )
    return false;
  const data = value.data;
  return (
    data.connection_id === connectionId &&
    data.model_id === modelId &&
    typeof data.connection_revision === "number" &&
    Number.isSafeInteger(data.connection_revision) &&
    data.connection_revision >= 1 &&
    (data.credential_status === "CONFIGURED" ||
      data.credential_status === "MISSING" ||
      data.credential_status === "UNAVAILABLE") &&
    typeof data.runtime_status === "string" &&
    data.runtime_status.length >= 1 &&
    typeof data.local_preconditions_met === "boolean" &&
    Array.isArray(data.reasons) &&
    data.reasons.length <= REASONS.size &&
    data.reasons.every(
      (item) => typeof item === "string" && REASONS.has(item as Sub2APIReadinessReason),
    ) &&
    new Set(data.reasons).size === data.reasons.length &&
    (data.reasons.includes("NOT_SUB2API")
      ? data.origin_mode === null
      : isSub2APIOriginMode(data.origin_mode)) &&
    data.local_preconditions_met === (data.reasons.length === 0) &&
    data.provider_observation === "NOT_CHECKED" &&
    data.model_entitlement === "UNKNOWN"
  );
}

export function sub2APIReadinessDefiniteError(
  status: number,
  value: unknown,
  requestId: string | null,
): Extract<Sub2APIConfiguredReadinessResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (status !== 401 && status !== 403 && status !== 404 && status !== 422) return null;
  if (
    !isRecord(value) ||
    !exact(value, ["error", "request_id"]) ||
    typeof value.request_id !== "string" ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.error) ||
    !exact(value.error, ["code", "message", "details", "retryable"]) ||
    typeof value.error.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
    typeof value.error.message !== "string" ||
    !isRecord(value.error.details) ||
    value.error.retryable !== false ||
    (status === 404 && value.error.code !== "PROVIDER_CONNECTION_NOT_FOUND")
  )
    return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status,
    code: value.error.code,
    request_id: value.request_id,
  };
}
