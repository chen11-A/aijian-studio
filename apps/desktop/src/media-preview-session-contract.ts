import { isRecord } from "./api-contract-guards";

// Preview pins immutable assembly and execution-plan bytes. It does not carry paths.
export type MediaPreviewIdentity = {
  project_id: string;
  episode_id: string;
  assembly_artifact_id: string;
  assembly_version_id: string;
  assembly_content_hash: string;
  assembly_head_revision: number;
  plan_hash: string;
};
// The host must bind this request id to the identity before native launch;
// status can reconcile an ambiguous open without resending it.
export type OpenMediaPreviewCommand = { open_request_id: string; identity: MediaPreviewIdentity };
export type MediaPreviewSessionRef = { session_id: string; generation: number };
export type MediaPreviewStatusQuery = MediaPreviewSessionRef | { open_request_id: string };
export type MediaPreviewMutation = MediaPreviewSessionRef & { command_id: string };
export type SeekMediaPreviewCommand = MediaPreviewMutation & { frame_index: number };

export type MediaPreviewClock = {
  // MLT's consumer position reports the last shown frame, not audio hardware time.
  shown_frame_index: number | null;
  audio_output_sample_index: number | null;
  audio_sample_rate_hz: number | null;
  authority: "UNVERIFIED" | "SHOWN_FRAME" | "NATIVE_AUDIO_OUTPUT";
};
export type MediaPreviewStatus = MediaPreviewSessionRef & {
  open_request_id: string;
  identity: MediaPreviewIdentity;
  state: "STARTING" | "READY_PAUSED" | "PLAYING" | "PAUSED" | "SEEKING" |
    "FAILED" | "EXPIRED" | "CLOSED";
  transport: { kind: "NATIVE_SDL2_WINDOW"; embedded: false };
  clock: MediaPreviewClock;
  expires_at: string;
  failure: null | "NATIVE_EXIT" | "PLAN_MISMATCH" | "SOURCE_UNAVAILABLE" |
    "HOST_PROTOCOL" | "HOST_UNKNOWN";
};
export type MediaPreviewResult =
  | { kind: "STATUS"; status: MediaPreviewStatus }
  | { kind: "UNAVAILABLE"; reason: "NATIVE_HOST_NOT_INSTALLED" | "PLAN_NOT_READY" |
      "TRANSPORT_NOT_READY" }
  | { kind: "STALE_SESSION" }
  | { kind: "UNKNOWN" };

export const MEDIA_PREVIEW_CHANNELS = Object.freeze({
  open: "media-preview:open",
  play: "media-preview:play",
  pause: "media-preview:pause",
  seek: "media-preview:seek",
  status: "media-preview:status",
  close: "media-preview:close",
} as const);

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const ARTIFACT = /^art_[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SESSION = /^pvs_[0-9a-f]{32}$/;
const OPEN_REQUEST = /^pvo_[0-9a-f]{32}$/;
const COMMAND = /^pvc_[0-9a-f]{32}$/;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function safeInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
export function isMediaPreviewIdentity(value: unknown): value is MediaPreviewIdentity {
  return isRecord(value) && exact(value, [
    "project_id", "episode_id", "assembly_artifact_id", "assembly_version_id",
    "assembly_content_hash", "assembly_head_revision", "plan_hash",
  ]) && matches(value.project_id, PROJECT) && matches(value.episode_id, EPISODE) &&
    matches(value.assembly_artifact_id, ARTIFACT) &&
    matches(value.assembly_version_id, VERSION) &&
    matches(value.assembly_content_hash, HASH) &&
    safeInteger(value.assembly_head_revision, 1) && matches(value.plan_hash, HASH);
}
export function isOpenMediaPreviewCommand(value: unknown): value is OpenMediaPreviewCommand {
  return isRecord(value) && exact(value, ["open_request_id", "identity"]) &&
    matches(value.open_request_id, OPEN_REQUEST) &&
    isMediaPreviewIdentity(value.identity);
}
export function isMediaPreviewSessionRef(value: unknown): value is MediaPreviewSessionRef {
  return isRecord(value) && exact(value, ["session_id", "generation"]) &&
    matches(value.session_id, SESSION) && safeInteger(value.generation, 1);
}
export function isMediaPreviewStatusQuery(value: unknown): value is MediaPreviewStatusQuery {
  return isMediaPreviewSessionRef(value) ||
    (isRecord(value) && exact(value, ["open_request_id"]) &&
      matches(value.open_request_id, OPEN_REQUEST));
}
export function isMediaPreviewMutation(value: unknown): value is MediaPreviewMutation {
  return isRecord(value) && exact(value, ["session_id", "generation", "command_id"]) &&
    matches(value.session_id, SESSION) && safeInteger(value.generation, 1) &&
    matches(value.command_id, COMMAND);
}
export function isSeekMediaPreviewCommand(value: unknown): value is SeekMediaPreviewCommand {
  return isRecord(value) && exact(value, [
    "session_id", "generation", "command_id", "frame_index",
  ]) && matches(value.session_id, SESSION) && safeInteger(value.generation, 1) &&
    matches(value.command_id, COMMAND) && safeInteger(value.frame_index, 0);
}

function isPreviewClock(value: unknown): value is MediaPreviewClock {
  if (!isRecord(value) || !exact(value, [
    "shown_frame_index", "audio_output_sample_index", "audio_sample_rate_hz", "authority",
  ])) return false;
  const frame = value.shown_frame_index;
  const sample = value.audio_output_sample_index;
  const rate = value.audio_sample_rate_hz;
  if (!(frame === null || safeInteger(frame, 0)) ||
      !(sample === null || safeInteger(sample, 0)) ||
      !(rate === null || safeInteger(rate, 1))) return false;
  if (value.authority === "NATIVE_AUDIO_OUTPUT") return sample !== null && rate !== null;
  if (value.authority === "SHOWN_FRAME") return frame !== null && sample === null && rate === null;
  return value.authority === "UNVERIFIED" && sample === null && rate === null;
}
function isPreviewStatus(value: unknown): value is MediaPreviewStatus {
  if (!isRecord(value) || !exact(value, [
    "session_id", "generation", "open_request_id", "identity", "state", "transport", "clock",
    "expires_at", "failure",
  ])) return false;
  return matches(value.session_id, SESSION) && safeInteger(value.generation, 1) &&
    matches(value.open_request_id, OPEN_REQUEST) &&
    isMediaPreviewIdentity(value.identity) &&
    typeof value.state === "string" &&
    ["STARTING", "READY_PAUSED", "PLAYING", "PAUSED", "SEEKING", "FAILED",
      "EXPIRED", "CLOSED"].includes(value.state) &&
    isRecord(value.transport) && exact(value.transport, ["kind", "embedded"]) &&
    value.transport.kind === "NATIVE_SDL2_WINDOW" && value.transport.embedded === false &&
    isPreviewClock(value.clock) && typeof value.expires_at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.expires_at) &&
    (value.failure === null || (typeof value.failure === "string" &&
      ["NATIVE_EXIT", "PLAN_MISMATCH", "SOURCE_UNAVAILABLE",
        "HOST_PROTOCOL", "HOST_UNKNOWN"].includes(value.failure)));
}
export function isMediaPreviewResult(value: unknown): value is MediaPreviewResult {
  if (!isRecord(value)) return false;
  if (value.kind === "STATUS") return exact(value, ["kind", "status"]) &&
    isPreviewStatus(value.status);
  if (value.kind === "UNAVAILABLE") return exact(value, ["kind", "reason"]) &&
    typeof value.reason === "string" &&
    ["NATIVE_HOST_NOT_INSTALLED", "PLAN_NOT_READY", "TRANSPORT_NOT_READY"]
      .includes(value.reason);
  return (value.kind === "STALE_SESSION" || value.kind === "UNKNOWN") &&
    exact(value, ["kind"]);
}
