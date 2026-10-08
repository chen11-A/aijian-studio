import { hasRequestId, isRecord } from "./api-contract-guards";
import {
  isProviderConnectionResponse,
  type ProviderConnectionResponse,
} from "./provider-connection-contract";

export type EditSub2APIMetadataCommand = {
  expected_revision: number;
  display_name: string;
  base_url: string;
  enabled: boolean;
  models: { model_id: string; capabilities: ["TEXT"] }[];
};
export type RotateSub2APIKeyCommand = {
  expected_revision: number;
  operation_id: string;
  api_key: string;
};
export type Sub2APIRotationOperationResponse = {
  data: {
    operation_id: string;
    connection_id: string;
    expected_revision: number;
    status: "PREPARED" | "APPLIED" | "CONFLICT" | "UNKNOWN";
    applied_revision: number | null;
    created_at: string;
    updated_at: string;
  };
  request_id: string;
};
export type Sub2APIConnectionMutationResult =
  | { kind: "UPDATED"; receipt: ProviderConnectionResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 401 | 403 | 404 | 409 | 422;
      code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type Sub2APIRotationReadResult =
  | { kind: "READ"; receipt: Sub2APIRotationOperationResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 401 | 403 | 404 | 422;
      code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export const SUB2API_MUTATION_CHANNELS = Object.freeze({
  edit: "providers:edit-sub2api-metadata",
  rotate: "providers:rotate-sub2api-key",
  readRotation: "providers:read-sub2api-rotation",
} as const);

const CONNECTION = /^pcn_[0-9a-f]{32}$/;
const OPERATION = /^pcop_[0-9a-f]{32}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,79}$/;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
export function isSub2APIConnectionId(value: unknown): value is string {
  return typeof value === "string" && CONNECTION.test(value);
}
export function isSub2APIRotationOperationId(value: unknown): value is string {
  return typeof value === "string" && OPERATION.test(value);
}
function isOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 ||
      /[\s\\@%?#]/.test(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      /^https:\/\/[^/?#\\]+\/?$/i.test(value) && url.pathname === "/" &&
      url.username === "" && url.password === "" &&
      host !== "localhost" && !host.endsWith(".localhost") &&
      (host.includes(".") || host.includes(":"));
  } catch {
    return false;
  }
}
export function isEditSub2APIMetadataCommand(value: unknown): value is EditSub2APIMetadataCommand {
  if (!isRecord(value) || !exact(value, [
    "expected_revision", "display_name", "base_url", "enabled", "models",
  ]) || !revision(value.expected_revision) ||
      typeof value.display_name !== "string" ||
      value.display_name.length < 1 || value.display_name.length > 80 ||
      value.display_name !== value.display_name.trim() || !isOrigin(value.base_url) ||
      typeof value.enabled !== "boolean" || !Array.isArray(value.models) ||
      value.models.length < 1 || value.models.length > 100) return false;
  const modelIds = new Set<string>();
  for (const model of value.models) {
    if (!isRecord(model) || !exact(model, ["model_id", "capabilities"]) ||
        typeof model.model_id !== "string" || model.model_id.length < 1 ||
        model.model_id.length > 200 || model.model_id !== model.model_id.trim() ||
        !Array.isArray(model.capabilities) || model.capabilities.length !== 1 ||
        model.capabilities[0] !== "TEXT" || modelIds.has(model.model_id)) return false;
    modelIds.add(model.model_id);
  }
  return true;
}
export function isRotateSub2APIKeyCommand(value: unknown): value is RotateSub2APIKeyCommand {
  return isRecord(value) && exact(value, [
    "expected_revision", "operation_id", "api_key",
  ]) && revision(value.expected_revision) &&
    isSub2APIRotationOperationId(value.operation_id) &&
    typeof value.api_key === "string" && value.api_key.length >= 8 &&
    value.api_key.length <= 8192 && !/\s/.test(value.api_key);
}
export function isSub2APIMutationReceipt(
  value: unknown, connectionId: string, requestId: string | null,
): value is ProviderConnectionResponse {
  return isProviderConnectionResponse(value) && value.request_id === requestId &&
    value.data.id === connectionId && value.data.provider_kind === "SUB2API";
}
export function isSub2APIRotationOperationResponse(
  value: unknown, connectionId: string, operationId: string, requestId: string | null,
): value is Sub2APIRotationOperationResponse {
  if (!isRecord(value) || !exact(value, ["data", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.data) || !exact(value.data, [
        "operation_id", "connection_id", "expected_revision", "status",
        "applied_revision", "created_at", "updated_at",
      ])) return false;
  const data = value.data;
  return data.connection_id === connectionId && data.operation_id === operationId &&
    revision(data.expected_revision) &&
    (data.status === "PREPARED" || data.status === "APPLIED" ||
      data.status === "CONFLICT" || data.status === "UNKNOWN") &&
    (data.applied_revision === null ||
      (revision(data.applied_revision) && data.applied_revision > data.expected_revision)) &&
    (data.status !== "APPLIED" || data.applied_revision !== null) &&
    typeof data.created_at === "string" && typeof data.updated_at === "string";
}
export function sub2APIMutationDefiniteError(
  status: number, value: unknown, requestId: string | null,
): Extract<Sub2APIConnectionMutationResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (![401, 403, 404, 409, 422].includes(status) ||
      !isRecord(value) || !exact(value, ["error", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.error) || !exact(value.error, [
        "code", "message", "details", "retryable",
      ]) || typeof value.error.code !== "string" || !CODE.test(value.error.code) ||
      typeof value.error.message !== "string" || !isRecord(value.error.details) ||
      value.error.retryable !== false) return null;
  return { kind: "DEFINITE_SERVER_ERROR", status: status as 401 | 403 | 404 | 409 | 422,
    code: value.error.code, request_id: value.request_id };
}
export function sub2APIRotationReadDefiniteError(
  status: number, value: unknown, requestId: string | null,
): Extract<Sub2APIRotationReadResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (status === 409) return null;
  const error = sub2APIMutationDefiniteError(status, value, requestId);
  if (error === null || error.status === 409) return null;
  return error;
}
