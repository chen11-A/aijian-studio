import type { MediaAssetProbeReadResult } from "./mediaAssetProbe";
export type MediaProbeScope = {
  projectId: string;
  assetId: string;
  versionId: string;
  sha256: string;
  byteSize: number;
};
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const integer = (value: unknown, min: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
export function validProbeScope(scope: MediaProbeScope): boolean {
  return (
    /^prj_[0-9a-f]{32}$/.test(scope.projectId) &&
    /^asset_[0-9a-f]{32}$/.test(scope.assetId) &&
    /^asv_[0-9a-f]{32}$/.test(scope.versionId) &&
    hash(scope.sha256) &&
    integer(scope.byteSize, 1)
  );
}
export function probeScopeKey(scope: MediaProbeScope): string {
  return [scope.projectId, scope.assetId, scope.versionId, scope.sha256, scope.byteSize].join(":");
}
export function definite(
  value: unknown,
): value is Extract<MediaAssetProbeReadResult, { kind: "DEFINITE_SERVER_ERROR" }> {
  return (
    record(value) &&
    exact(value, ["kind", "status", "code", "request_id"]) &&
    value.kind === "DEFINITE_SERVER_ERROR" &&
    typeof value.status === "number" &&
    ([401, 403, 404, 409, 422].includes(value.status) ||
      (value.status === 503 && value.code === "TOOLCHAIN_UNAVAILABLE")) &&
    text(value.code) &&
    /^[A-Z][A-Z0-9_]{2,79}$/.test(value.code) &&
    text(value.request_id)
  );
}
