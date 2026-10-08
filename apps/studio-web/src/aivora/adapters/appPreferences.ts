import { hasAsciiControlCharacter } from "../textValidation";

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

export type AppPreferencesSaveResult =
  | { kind: "SAVED"; receipt: AppPreferencesResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export type AppPreferencesGatewayReadResult =
  | { kind: "FOUND"; receipt: AppPreferencesResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export type AppPreferencesGateway = {
  getAppPreferences(): Promise<AppPreferencesGatewayReadResult>;
  saveAppPreferences(command: SaveAppPreferencesCommand): Promise<AppPreferencesSaveResult>;
};

export type AppPreferencesReadOutcome =
  | { kind: "READY"; response: AppPreferencesResponse }
  | { kind: "ERROR" };

export type AppPreferencesSaveOutcome =
  | { kind: "SAVED"; response: AppPreferencesResponse }
  | { kind: "INVALID_INPUT"; message: string }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" };

function validData(value: unknown): value is AppPreferencesData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Partial<AppPreferencesData>;
  if (typeof data.saved !== "boolean" || !Number.isSafeInteger(data.revision) ||
      (data.revision ?? -1) < 0 || typeof data.user_name !== "string" ||
      typeof data.display_bio !== "string" || data.ui_language !== "zh-CN" ||
      data.ui_theme !== "dark-cinematic" || [...data.user_name].length > 80 ||
      [...data.display_bio].length > 1000) return false;
  const dated = (value: string) =>
    Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (data.saved) return (data.revision ?? 0) > 0 &&
    data.user_name.length > 0 &&
    typeof data.created_at === "string" && dated(data.created_at) &&
    typeof data.updated_at === "string" && dated(data.updated_at);
  return data.revision === 0 && data.user_name === "" && data.display_bio === "" &&
    data.created_at === null && data.updated_at === null;
}

function validResponse(value: unknown): value is AppPreferencesResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Partial<AppPreferencesResponse>;
  return typeof response.request_id === "string" && validData(response.data);
}

export async function readAppPreferences(
  gateway: AppPreferencesGateway | null,
): Promise<AppPreferencesReadOutcome> {
  if (!gateway) return { kind: "ERROR" };
  try {
    const result = await gateway.getAppPreferences();
    return result.kind === "FOUND" && validResponse(result.receipt)
      ? { kind: "READY", response: result.receipt } : { kind: "ERROR" };
  } catch {
    return { kind: "ERROR" };
  }
}

export function prepareAppPreferencesSave(
  current: AppPreferencesResponse,
  userName: string,
  displayBio: string,
): SaveAppPreferencesCommand | { kind: "INVALID_INPUT"; message: string } {
  const name = userName.trim();
  const bio = displayBio.replace(/\r\n/g, "\n");
  if (!validResponse(current))
    return { kind: "INVALID_INPUT", message: "当前设置状态无效，请重新读取后再保存。" };
  if ([...name].length < 1 || [...name].length > 80 ||
      hasAsciiControlCharacter(name))
    return { kind: "INVALID_INPUT", message: "昵称需为 1 至 80 个字符，且不能包含控制字符。" };
  if ([...bio].length > 1000 || hasAsciiControlCharacter(bio, true))
    return { kind: "INVALID_INPUT", message: "创作签名不能超过 1000 字，且只能使用普通文字与换行。" };
  return {
    expected_revision: current.data.revision,
    user_name: name,
    display_bio: bio,
    ui_language: "zh-CN",
    ui_theme: "dark-cinematic",
  };
}

export async function saveAppPreferences(
  gateway: AppPreferencesGateway | null,
  current: AppPreferencesResponse,
  userName: string,
  displayBio: string,
): Promise<AppPreferencesSaveOutcome> {
  const command = prepareAppPreferencesSave(current, userName, displayBio);
  if ("kind" in command) return command;
  if (!gateway) return { kind: "UNKNOWN" };
  let result: AppPreferencesSaveResult;
  try {
    result = await gateway.saveAppPreferences(command);
  } catch {
    return { kind: "UNKNOWN" };
  }
  if (result.kind === "DEFINITE_SERVER_ERROR")
    return { kind: "REJECTED", status: result.status, code: result.code };
  if (result.kind !== "SAVED" || !validResponse(result.receipt) ||
      !result.receipt.data.saved ||
      result.receipt.data.revision !== current.data.revision + 1 ||
      result.receipt.data.user_name !== command.user_name ||
      result.receipt.data.display_bio !== command.display_bio)
    return { kind: "UNKNOWN" };
  const read = await readAppPreferences(gateway);
  return read.kind === "READY" &&
    read.response.data.revision === result.receipt.data.revision &&
    read.response.data.user_name === command.user_name &&
    read.response.data.display_bio === command.display_bio &&
    read.response.data.saved
      ? { kind: "SAVED", response: read.response }
      : { kind: "UNKNOWN" };
}
