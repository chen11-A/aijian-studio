/** A preview session is scoped to one frozen assembly and one derived plan. */

export type MediaPreviewIdentity = {
  project_id: string;
  episode_id: string;
  assembly_artifact_id: string;
  assembly_version_id: string;
  assembly_content_hash: string;
  assembly_head_revision: number;
  plan_hash: string;
};

export type MediaPreviewSessionRef = { session_id: string; generation: number };
export type MediaPreviewStatusQuery = MediaPreviewSessionRef | { open_request_id: string };
export type MediaPreviewMutation = MediaPreviewSessionRef & { command_id: string };
export type SeekMediaPreviewCommand = MediaPreviewMutation & { frame_index: number };
export type MediaPreviewStatus = MediaPreviewSessionRef & {
  open_request_id: string;
  identity: MediaPreviewIdentity;
  state:
    | "STARTING"
    | "READY_PAUSED"
    | "PLAYING"
    | "PAUSED"
    | "SEEKING"
    | "FAILED"
    | "EXPIRED"
    | "CLOSED";
  transport: { kind: "NATIVE_SDL2_WINDOW"; embedded: false };
  clock: {
    shown_frame_index: number | null;
    audio_output_sample_index: number | null;
    audio_sample_rate_hz: number | null;
    authority: "UNVERIFIED" | "SHOWN_FRAME" | "NATIVE_AUDIO_OUTPUT";
  };
  expires_at: string;
  failure:
    | null
    | "NATIVE_EXIT"
    | "PLAN_MISMATCH"
    | "SOURCE_UNAVAILABLE"
    | "HOST_PROTOCOL"
    | "HOST_UNKNOWN";
};

export type MediaPreviewResult =
  | { kind: "STATUS"; status: MediaPreviewStatus }
  | {
      kind: "UNAVAILABLE";
      reason: "NATIVE_HOST_NOT_INSTALLED" | "PLAN_NOT_READY" | "TRANSPORT_NOT_READY";
    }
  | { kind: "STALE_SESSION" }
  | { kind: "UNKNOWN" };

export interface MediaPreviewSessionGateway {
  openMediaPreviewSession(command: {
    open_request_id: string;
    identity: MediaPreviewIdentity;
  }): Promise<MediaPreviewResult>;
  playMediaPreviewSession(command: MediaPreviewMutation): Promise<MediaPreviewResult>;
  pauseMediaPreviewSession(command: MediaPreviewMutation): Promise<MediaPreviewResult>;
  seekMediaPreviewSession(command: SeekMediaPreviewCommand): Promise<MediaPreviewResult>;
  readMediaPreviewSessionStatus(query: MediaPreviewStatusQuery): Promise<MediaPreviewResult>;
  closeMediaPreviewSession(command: MediaPreviewMutation): Promise<MediaPreviewResult>;
}

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const ARTIFACT = /^art_[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SESSION = /^pvs_[0-9a-f]{32}$/;
const OPEN_REQUEST = /^pvo_[0-9a-f]{32}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

export function validPreviewIdentity(value: unknown): value is MediaPreviewIdentity {
  return (
    record(value) &&
    typeof value.project_id === "string" &&
    PROJECT.test(value.project_id) &&
    typeof value.episode_id === "string" &&
    EPISODE.test(value.episode_id) &&
    typeof value.assembly_artifact_id === "string" &&
    ARTIFACT.test(value.assembly_artifact_id) &&
    typeof value.assembly_version_id === "string" &&
    VERSION.test(value.assembly_version_id) &&
    typeof value.assembly_content_hash === "string" &&
    HASH.test(value.assembly_content_hash) &&
    integer(value.assembly_head_revision, 1) &&
    typeof value.plan_hash === "string" &&
    HASH.test(value.plan_hash)
  );
}

export function samePreviewIdentity(a: MediaPreviewIdentity, b: MediaPreviewIdentity): boolean {
  return (
    a.project_id === b.project_id &&
    a.episode_id === b.episode_id &&
    a.assembly_artifact_id === b.assembly_artifact_id &&
    a.assembly_version_id === b.assembly_version_id &&
    a.assembly_content_hash === b.assembly_content_hash &&
    a.assembly_head_revision === b.assembly_head_revision &&
    a.plan_hash === b.plan_hash
  );
}

/** Reject stale, foreign, or malformed host status before the UI advances controls. */
export function parsePreviewStatus(
  value: unknown,
  identity: MediaPreviewIdentity,
  openRequestId: string,
  prior?: MediaPreviewSessionRef,
): MediaPreviewStatus | null {
  if (
    !record(value) ||
    !validPreviewIdentity(value.identity) ||
    !samePreviewIdentity(value.identity, identity) ||
    value.open_request_id !== openRequestId ||
    !OPEN_REQUEST.test(openRequestId) ||
    typeof value.session_id !== "string" ||
    !SESSION.test(value.session_id) ||
    !integer(value.generation, 1) ||
    (prior && (value.session_id !== prior.session_id || value.generation < prior.generation)) ||
    ![
      "STARTING",
      "READY_PAUSED",
      "PLAYING",
      "PAUSED",
      "SEEKING",
      "FAILED",
      "EXPIRED",
      "CLOSED",
    ].includes(String(value.state)) ||
    !record(value.transport) ||
    value.transport.kind !== "NATIVE_SDL2_WINDOW" ||
    value.transport.embedded !== false ||
    !record(value.clock) ||
    !(value.clock.shown_frame_index === null || integer(value.clock.shown_frame_index)) ||
    !(
      value.clock.audio_output_sample_index === null ||
      integer(value.clock.audio_output_sample_index)
    ) ||
    !(value.clock.audio_sample_rate_hz === null || integer(value.clock.audio_sample_rate_hz, 1)) ||
    !["UNVERIFIED", "SHOWN_FRAME", "NATIVE_AUDIO_OUTPUT"].includes(String(value.clock.authority)) ||
    (value.clock.authority === "SHOWN_FRAME" &&
      (value.clock.shown_frame_index === null ||
        value.clock.audio_output_sample_index !== null ||
        value.clock.audio_sample_rate_hz !== null)) ||
    (value.clock.authority === "NATIVE_AUDIO_OUTPUT" &&
      (value.clock.audio_output_sample_index === null ||
        value.clock.audio_sample_rate_hz === null)) ||
    (value.clock.authority === "UNVERIFIED" &&
      (value.clock.audio_output_sample_index !== null ||
        value.clock.audio_sample_rate_hz !== null)) ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at)) ||
    !(
      value.failure === null ||
      [
        "NATIVE_EXIT",
        "PLAN_MISMATCH",
        "SOURCE_UNAVAILABLE",
        "HOST_PROTOCOL",
        "HOST_UNKNOWN",
      ].includes(String(value.failure))
    )
  )
    return null;
  return value as unknown as MediaPreviewStatus;
}

export function previewCommand(ref: MediaPreviewSessionRef): MediaPreviewMutation | null {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") return null;
  return { ...ref, command_id: `pvc_${crypto.randomUUID().replace(/-/g, "")}` };
}

export function previewOpenRequestId(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") return null;
  return `pvo_${crypto.randomUUID().replace(/-/g, "")}`;
}
