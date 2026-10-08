import { hasRequestId, isRecord } from "./api-contract-guards";

export type AppPreferencesData = {
  saved: boolean;
  revision: number;
  user_name: string;
  display_bio: string;
  ui_language: "zh-CN";
  ui_theme: "dark-cinematic";
  created_at: string | null;
  updated_at: string | null;
};

export type AppPreferencesResponse = {
  data: AppPreferencesData;
  request_id: string;
};

export type SaveAppPreferencesCommand = {
  expected_revision: number;
  user_name: string;
  display_bio: string;
  ui_language: "zh-CN";
  ui_theme: "dark-cinematic";
};

export type AppPreferencesDefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: 401 | 403 | 409 | 422;
  code: string;
  request_id: string;
};

export type AppPreferencesReadResult =
  | { kind: "FOUND"; receipt: AppPreferencesResponse }
  | AppPreferencesDefiniteError
  | { kind: "REMOTE_UNKNOWN" };

export type AppPreferencesSaveResult =
  | { kind: "SAVED"; receipt: AppPreferencesResponse }
  | AppPreferencesDefiniteError
  | { kind: "REMOTE_UNKNOWN" };

export const APP_PREFERENCES_CHANNELS = Object.freeze({
  get: "app-preferences:get",
  save: "app-preferences:save",
} as const);

const DATA_KEYS = [
  "saved", "revision", "user_name", "display_bio", "ui_language", "ui_theme",
  "created_at", "updated_at",
];
const REQUEST_KEYS = [
  "expected_revision", "user_name", "display_bio", "ui_language", "ui_theme",
];
const ERROR_CODES = new Map<number, readonly string[]>([
  [401, ["SIDECAR_AUTH_REQUIRED"]],
  [403, ["SIDECAR_REQUEST_REJECTED"]],
  [409, ["APP_PREFERENCES_REVISION_CONFLICT", "APP_PREFERENCES_INCONSISTENT"]],
  [422, ["VALIDATION_ERROR"]],
]);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validUserName(value: unknown, allowEmpty: boolean): value is string {
  if (typeof value !== "string" || value !== value.trim() || [...value].length > 80 ||
      (!allowEmpty && value.length === 0)) return false;
  return ![...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function validBio(value: unknown): value is string {
  if (typeof value !== "string" || [...value].length > 1000) return false;
  return ![...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 32 && char !== "\n") || code === 127;
  });
}

function isAwareTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function isSaveAppPreferencesCommand(value: unknown): value is SaveAppPreferencesCommand {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) return false;
  return typeof value.expected_revision === "number" &&
    Number.isSafeInteger(value.expected_revision) && value.expected_revision >= 0 &&
    value.expected_revision < Number.MAX_SAFE_INTEGER &&
    validUserName(value.user_name, false) && validBio(value.display_bio) &&
    value.ui_language === "zh-CN" && value.ui_theme === "dark-cinematic";
}

export function isAppPreferencesResponse(
  value: unknown,
  requestId: string | null,
  etag: string | null,
): value is AppPreferencesResponse {
  if (!isRecord(value) || !hasExactKeys(value, ["data", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId || !isRecord(value.data)) return false;
  const data = value.data;
  if (!hasExactKeys(data, DATA_KEYS) || typeof data.saved !== "boolean" ||
      typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) ||
      !validUserName(data.user_name, !data.saved) || !validBio(data.display_bio) ||
      data.ui_language !== "zh-CN" || data.ui_theme !== "dark-cinematic" ||
      etag !== `"revision-${data.revision}"`) return false;
  return data.saved
    ? data.revision >= 1 && isAwareTimestamp(data.created_at) &&
        isAwareTimestamp(data.updated_at)
    : data.revision === 0 && data.user_name === "" && data.display_bio === "" &&
        data.created_at === null && data.updated_at === null;
}

export function appPreferencesDefiniteError(
  status: number,
  value: unknown,
  requestId: string | null,
): AppPreferencesDefiniteError | null {
  if (!isRecord(value) || !hasExactKeys(value, ["error", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId || !isRecord(value.error) ||
      !hasExactKeys(value.error, ["code", "message", "retryable", "details"])) return null;
  const error = value.error;
  if (typeof error.code !== "string" || !ERROR_CODES.get(status)?.includes(error.code) ||
      typeof error.message !== "string" || error.retryable !== false ||
      !isRecord(error.details)) return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status: status as AppPreferencesDefiniteError["status"],
    code: error.code,
    request_id: value.request_id as string,
  };
}
