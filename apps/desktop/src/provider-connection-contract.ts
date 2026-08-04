import type { components } from "@aijian/contracts";

import { hasOnlyKeys, hasRequestId, isRecord } from "./api-contract-guards";

export type CreateProviderConnectionInput =
  components["schemas"]["CreateProviderConnectionRequest"];
export type ProviderConnectionListResponse =
  components["schemas"]["ProviderConnectionListResponse"];
export type ProviderConnectionResponse = components["schemas"]["ProviderConnectionResponse"];

const PROVIDER_CONNECTION_ID_PATTERN = /^pcn_[0-9a-f]{32}$/;
const PROVIDER_KINDS = ["OPENAI", "XAI", "OPENAI_COMPATIBLE", "OLLAMA"] as const;
const PROVIDER_CAPABILITIES = ["TEXT", "IMAGE", "VIDEO", "SPEECH"] as const;

function isNonPublicLiteralHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::" || host === "::1") return true;
  if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^ff/.test(host)) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [first = -1, second = -1] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isProviderModel(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["model_id", "capabilities"]) &&
    typeof value.model_id === "string" &&
    value.model_id.length > 0 &&
    value.model_id.length <= 200 &&
    Array.isArray(value.capabilities) &&
    value.capabilities.length >= 1 &&
    value.capabilities.length <= 4 &&
    new Set(value.capabilities).size === value.capabilities.length &&
    value.capabilities.every((item) => PROVIDER_CAPABILITIES.includes(item))
  );
}

function isProviderConnection(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "provider_kind",
      "display_name",
      "base_url",
      "enabled",
      "models",
      "credential_status",
      "revision",
      "created_at",
      "updated_at",
    ]) &&
    isProviderConnectionId(value.id) &&
    PROVIDER_KINDS.some((kind) => kind === value.provider_kind) &&
    typeof value.display_name === "string" &&
    typeof value.base_url === "string" &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.models) &&
    value.models.every(isProviderModel) &&
    ["CONFIGURED", "MISSING", "UNAVAILABLE"].includes(String(value.credential_status)) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

export function isProviderConnectionListResponse(
  value: unknown,
): value is ProviderConnectionListResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    Array.isArray(value.data) &&
    value.data.every(isProviderConnection)
  );
}

export function isProviderConnectionResponse(value: unknown): value is ProviderConnectionResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    isProviderConnection(value.data)
  );
}

export function isCreateProviderConnectionInput(
  value: unknown,
): value is CreateProviderConnectionInput {
  if (!isRecord(value)) return false;
  const allowedKeys = ["provider_kind", "display_name", "base_url", "enabled", "models", "api_key"];
  if (!hasOnlyKeys(value, allowedKeys)) return false;
  if (
    !PROVIDER_KINDS.some((kind) => kind === value.provider_kind) ||
    typeof value.display_name !== "string" ||
    value.display_name.trim().length === 0 ||
    value.display_name.length > 80 ||
    typeof value.base_url !== "string" ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.models) ||
    value.models.length < 1 ||
    value.models.length > 100 ||
    !value.models.every(isProviderModel) ||
    (value.api_key !== undefined &&
      (typeof value.api_key !== "string" ||
        value.api_key.length < 8 ||
        value.api_key.length > 8192)) ||
    (value.provider_kind !== "OLLAMA" && typeof value.api_key !== "string")
  ) {
    return false;
  }
  try {
    const url = new URL(value.base_url);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const safeUrl =
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      !value.base_url.includes("@") &&
      !value.base_url.includes("?") &&
      !value.base_url.includes("#") &&
      !/\s/.test(value.base_url) &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback));
    if (!safeUrl) return false;
    const normalized = value.base_url.replace(/\/+$/, "");
    if (value.provider_kind === "OPENAI") {
      return normalized === "https://api.openai.com/v1";
    }
    if (value.provider_kind === "XAI") {
      return normalized === "https://api.x.ai/v1";
    }
    if (value.provider_kind === "OLLAMA") return loopback;
    return url.protocol === "https:" && !isNonPublicLiteralHost(url.hostname);
  } catch {
    return false;
  }
}

export function isProviderConnectionId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_CONNECTION_ID_PATTERN.test(value);
}
