import { hasControlCharacter, hasOnlyKeys, isRecord } from "./api-contract-guards";

export const MEDIA_TOOLCHAIN_CHANNELS = {
  status: "media-toolchain:status",
  select: "media-toolchain:select",
  clear: "media-toolchain:clear",
  cancelSelection: "media-toolchain:cancel-selection",
} as const;

export type MediaToolchainStatus = {
  schema_version: 1;
  state: "AVAILABLE" | "NOT_CONFIGURED" | "INVALID" | "UNSUPPORTED";
  source: "EXTERNAL" | "BUNDLED" | "DEVELOPMENT_OVERRIDE" | "DEVELOPMENT_LOCAL" | "NONE";
  profile_id: string | null;
  version: string | null;
  directory: string | null;
  diagnostic: string;
  can_probe: boolean;
  can_preview: boolean;
  can_draft_export: boolean;
  formal_release_approved: false;
};
export type MediaToolchainResult =
  { kind: "STATUS"; status: MediaToolchainStatus } | { kind: "REMOTE_UNKNOWN" };
export type MediaToolchainSelectionResult =
  MediaToolchainResult | { kind: "PICKER_CANCELLED" } | { kind: "PICKER_BUSY" };
export type MediaToolchainCancelResult = {
  kind: "CANCELLED" | "NO_PENDING_SELECTION" | "ALREADY_SUBMITTED";
};
export type MediaToolchainBridge = {
  getMediaToolchainStatus(): Promise<MediaToolchainResult>;
  selectMediaToolchain(): Promise<MediaToolchainSelectionResult>;
  clearMediaToolchain(): Promise<MediaToolchainResult>;
  cancelMediaToolchainSelection(): Promise<MediaToolchainCancelResult>;
};

const STATUS_KEYS = [
  "schema_version",
  "state",
  "source",
  "profile_id",
  "version",
  "directory",
  "diagnostic",
  "can_probe",
  "can_preview",
  "can_draft_export",
  "formal_release_approved",
] as const;
function boundedText(value: unknown, limit: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= limit &&
    !hasControlCharacter(value)
  );
}

/** A plain status, never a request-shaped wrapper or a formal release approval. */
export function isMediaToolchainStatus(value: unknown): value is MediaToolchainStatus {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, STATUS_KEYS) ||
    !STATUS_KEYS.every((key) => Object.hasOwn(value, key)) ||
    value.schema_version !== 1 ||
    typeof value.state !== "string" ||
    !["AVAILABLE", "NOT_CONFIGURED", "INVALID", "UNSUPPORTED"].includes(value.state) ||
    typeof value.source !== "string" ||
    !["EXTERNAL", "BUNDLED", "DEVELOPMENT_OVERRIDE", "DEVELOPMENT_LOCAL", "NONE"].includes(
      value.source,
    ) ||
    (value.profile_id !== null && !boundedText(value.profile_id, 128)) ||
    (value.version !== null && !boundedText(value.version, 128)) ||
    (value.directory !== null && !boundedText(value.directory, 32_768)) ||
    !boundedText(value.diagnostic, 2_048, true) ||
    value.formal_release_approved !== false
  )
    return false;
  if (
    value.source === "NONE" &&
    (value.profile_id !== null || value.version !== null || value.directory !== null)
  )
    return false;
  const available = value.state === "AVAILABLE";
  if (
    value.can_probe !== available ||
    value.can_preview !== available ||
    value.can_draft_export !== available
  )
    return false;
  if (
    available &&
    value.source === "EXTERNAL" &&
    (value.profile_id !== "windows-x86_64-gyan-full-8.1.2-dev" || value.version !== "8.1.2")
  )
    return false;
  if (available)
    return (
      value.source !== "NONE" &&
      value.profile_id !== null &&
      value.version !== null &&
      value.directory !== null
    );
  return value.state !== "NOT_CONFIGURED" || value.source === "NONE";
}
