import type { components } from "@aijian/contracts";

import { hasOnlyKeys, hasRequestId, isRecord } from "./api-contract-guards";

export type HealthResponse = components["schemas"]["HealthResponse"];

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["data", "request_id"]) || !hasRequestId(value)) {
    return false;
  }
  if (!isRecord(value.data)) return false;
  return (
    hasOnlyKeys(value.data, ["status", "service", "version"]) &&
    value.data.status === "ok" &&
    value.data.service === "aijian-api" &&
    typeof value.data.version === "string"
  );
}
