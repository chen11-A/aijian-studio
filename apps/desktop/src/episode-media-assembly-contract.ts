import { hasRequestId, isRecord } from "./api-contract-guards";

export type AssemblyMediaRef = {
  asset_id: string; asset_version_id: string; sha256: string;
};
export type AssemblyVisualSegment = {
  segment_id: string;
  media_kind: "image" | "video";
  media: AssemblyMediaRef;
  start_frame: number;
  end_frame: number;
  source_in_frame: number;
  embedded_audio: "MUTE" | "PLAY";
};
export type AssemblyAudioSegment = {
  segment_id: string;
  track_kind: "DIALOGUE" | "BGM" | "SFX";
  media: AssemblyMediaRef;
  start_frame: number;
  end_frame: number;
  source_in_sample: number;
  script_version_id: string | null;
  script_block_id: string | null;
  speaker_id: string | null;
  delivery: "ON_SCREEN" | "OFF_SCREEN" | null;
};
export type AssemblySubtitleSegment = {
  segment_id: string;
  script_version_id: string;
  script_block_id: string;
  start_frame: number;
  end_frame: number;
};
export type EpisodeMediaAssemblyContent = {
  schema_version: "1.0.0";
  project_id: string;
  episode_id: string;
  sequence_timebase: {
    frame_rate: { num: number; den: number };
    timecode_mode: "NON_DROP_FRAME" | "DROP_FRAME";
  };
  canvas_width: number;
  canvas_height: number;
  total_frames: number;
  visual_segments: AssemblyVisualSegment[];
  audio_segments: AssemblyAudioSegment[];
  subtitle_segments: AssemblySubtitleSegment[];
};
export type CreateEpisodeMediaAssemblyVersionRequest = {
  content: EpisodeMediaAssemblyContent;
  parent_version_id?: string | null;
  expected_revision?: number | null;
  change_summary: string;
};
export type AssemblyMediaCheck = {
  media: AssemblyMediaRef;
  kind: "image" | "video" | "audio";
  availability: "VERIFIED" | "MISSING" | "CORRUPT" | "UNVERIFIED_SIZE_LIMIT" |
    "UNKNOWN_UNSAFE_PATH" | "UNKNOWN_MEDIA_READ" | "UNKNOWN_MEDIA_CHANGED";
  technical_status: "STILL_HEADER_ONLY" | "PENDING_MEDIA_PROBE" |
    "PROBED_CFR_VIDEO" | "INVALID_MEDIA_PROBE";
  probe_evidence_id: string | null;
  probed_video_frames: number | null;
  probed_has_audio: boolean | null;
  rights_status: "PENDING_REVIEW" | "CLEARED" | "RESTRICTED";
  rights_decision_id: string | null;
};
export type EpisodeMediaAssemblyVersion = {
  artifact_id: string;
  version_id: string;
  content_hash: string;
  head_revision: number;
  parent_version_id: string | null;
  content: EpisodeMediaAssemblyContent;
  media_checks: AssemblyMediaCheck[];
  playback_status: "DRAFT_STATIC_ANIMATIC" | "DRAFT_VIDEO_PREVIEW" |
    "BLOCKED_MEDIA_PROBE" | "BLOCKED_MEDIA_BYTES" | "BLOCKED_RIGHTS";
  export_status: "NO_EXPORT_CLAIM";
};
export type EpisodeMediaAssemblyResponse = {
  data: EpisodeMediaAssemblyVersion;
  request_id: string;
};
export type EpisodeMediaAssemblyResult =
  | { kind: "FOUND"; receipt: EpisodeMediaAssemblyResponse }
  | { kind: "NOT_FOUND"; request_id: string }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 401 | 403 | 404 | 409 | 422;
      code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type EpisodeMediaAssemblyWriteResult =
  | { kind: "CREATED"; receipt: EpisodeMediaAssemblyResponse }
  | Extract<EpisodeMediaAssemblyResult, { kind: "DEFINITE_SERVER_ERROR" }>
  | { kind: "REMOTE_UNKNOWN" };

export const EPISODE_MEDIA_ASSEMBLY_CHANNELS = Object.freeze({
  latest: "episode-media-assembly:latest",
  version: "episode-media-assembly:version",
  create: "episode-media-assembly:create-version",
} as const);

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const BLOCK = /^sblk_[0-9a-f]{32}$/;
const SPEAKER = /^spk_[0-9a-f]{32}$/;
const ASSET = /^asset_[0-9a-f]{32}$/;
const ASSET_VERSION = /^asv_[0-9a-f]{32}$/;
const SEGMENT = /^seg_[a-z0-9._-]{1,80}$/;
const PROBE = /^mpe_[0-9a-f]{32}$/;
const ARTIFACT = /^art_[0-9a-f]{32}$/;
const HEX_HASH = /^[0-9a-f]{64}$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const AVAILABILITY = new Set([
  "VERIFIED", "MISSING", "CORRUPT", "UNVERIFIED_SIZE_LIMIT", "UNKNOWN_UNSAFE_PATH",
  "UNKNOWN_MEDIA_READ", "UNKNOWN_MEDIA_CHANGED",
]);
const TECHNICAL = new Set([
  "STILL_HEADER_ONLY", "PENDING_MEDIA_PROBE", "PROBED_CFR_VIDEO", "INVALID_MEDIA_PROBE",
]);
const PLAYBACK = new Set([
  "DRAFT_STATIC_ANIMATIC", "DRAFT_VIDEO_PREVIEW", "BLOCKED_MEDIA_PROBE",
  "BLOCKED_MEDIA_BYTES", "BLOCKED_RIGHTS",
]);
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function id(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= min && value <= max;
}
function nullableId(value: unknown, pattern: RegExp): value is string | null {
  return value === null || id(value, pattern);
}
function interval(value: Record<string, unknown>, totalFrames: number): boolean {
  return integer(value.start_frame, 0) && integer(value.end_frame, 1, totalFrames) &&
    value.end_frame > value.start_frame;
}
export function isAssemblyProjectId(value: unknown): value is string { return id(value, PROJECT); }
export function isAssemblyEpisodeId(value: unknown): value is string { return id(value, EPISODE); }
export function isAssemblyVersionId(value: unknown): value is string { return id(value, VERSION); }

function isMediaRef(value: unknown): value is AssemblyMediaRef {
  return isRecord(value) && exact(value, ["asset_id", "asset_version_id", "sha256"]) &&
    id(value.asset_id, ASSET) && id(value.asset_version_id, ASSET_VERSION) &&
    id(value.sha256, HEX_HASH);
}
function isTimebase(value: unknown): value is EpisodeMediaAssemblyContent["sequence_timebase"] {
  if (!isRecord(value) || !exact(value, ["frame_rate", "timecode_mode"]) ||
      !isRecord(value.frame_rate) || !exact(value.frame_rate, ["num", "den"])) return false;
  const { num, den } = value.frame_rate;
  return ((num === 24000 && den === 1001) || (num === 24 && den === 1) ||
    (num === 25 && den === 1) || (num === 30000 && den === 1001)) &&
    (value.timecode_mode === "NON_DROP_FRAME" ||
      (value.timecode_mode === "DROP_FRAME" && num === 30000 && den === 1001));
}
function isVisual(value: unknown, totalFrames: number): value is AssemblyVisualSegment {
  return isRecord(value) && exact(value, [
    "segment_id", "media_kind", "media", "start_frame", "end_frame",
    "source_in_frame", "embedded_audio",
  ]) && id(value.segment_id, SEGMENT) &&
    (value.media_kind === "image" || value.media_kind === "video") &&
    isMediaRef(value.media) && interval(value, totalFrames) &&
    integer(value.source_in_frame, 0) &&
    (value.embedded_audio === "MUTE" || value.embedded_audio === "PLAY") &&
    (value.media_kind !== "image" ||
      (value.source_in_frame === 0 && value.embedded_audio === "MUTE"));
}
function isAudio(value: unknown, totalFrames: number): value is AssemblyAudioSegment {
  if (!isRecord(value) || !exact(value, [
    "segment_id", "track_kind", "media", "start_frame", "end_frame",
    "source_in_sample", "script_version_id", "script_block_id", "speaker_id", "delivery",
  ]) || !id(value.segment_id, SEGMENT) ||
      !["DIALOGUE", "BGM", "SFX"].includes(String(value.track_kind)) ||
      !isMediaRef(value.media) || !interval(value, totalFrames) ||
      !integer(value.source_in_sample, 0) ||
      !nullableId(value.script_version_id, VERSION) ||
      !nullableId(value.script_block_id, BLOCK) ||
      !nullableId(value.speaker_id, SPEAKER) ||
      !(value.delivery === null || value.delivery === "ON_SCREEN" ||
        value.delivery === "OFF_SCREEN")) return false;
  const binding = [value.script_version_id, value.script_block_id,
    value.speaker_id, value.delivery];
  return value.track_kind === "DIALOGUE"
    ? binding.every((item) => item !== null)
    : binding.every((item) => item === null);
}
function isSubtitle(value: unknown, totalFrames: number): value is AssemblySubtitleSegment {
  return isRecord(value) && exact(value, [
    "segment_id", "script_version_id", "script_block_id", "start_frame", "end_frame",
  ]) && id(value.segment_id, SEGMENT) && id(value.script_version_id, VERSION) &&
    id(value.script_block_id, BLOCK) && interval(value, totalFrames);
}
export function isEpisodeMediaAssemblyContent(
  value: unknown, projectId: string, episodeId: string,
): value is EpisodeMediaAssemblyContent {
  if (!isRecord(value) || !exact(value, [
    "schema_version", "project_id", "episode_id", "sequence_timebase",
    "canvas_width", "canvas_height", "total_frames", "visual_segments",
    "audio_segments", "subtitle_segments",
  ]) || value.schema_version !== "1.0.0" || value.project_id !== projectId ||
      value.episode_id !== episodeId || !isTimebase(value.sequence_timebase) ||
      !integer(value.canvas_width, 1, 8192) || !integer(value.canvas_height, 1, 8192) ||
      !integer(value.total_frames, 1, 1_000_000) ||
      !Array.isArray(value.visual_segments) || value.visual_segments.length < 1 ||
      value.visual_segments.length > 1000 || !Array.isArray(value.audio_segments) ||
      value.audio_segments.length > 1000 || !Array.isArray(value.subtitle_segments) ||
      value.subtitle_segments.length > 1000) return false;
  const totalFrames = value.total_frames;
  if (!value.visual_segments.every((item: unknown) => isVisual(item, totalFrames)) ||
      !value.audio_segments.every((item: unknown) => isAudio(item, totalFrames)) ||
      !value.subtitle_segments.every((item: unknown) => isSubtitle(item, totalFrames))) return false;
  let cursor = 0;
  const ids = new Set<string>();
  for (const segment of [
    ...value.visual_segments, ...value.audio_segments, ...value.subtitle_segments,
  ]) {
    if (ids.has(segment.segment_id)) return false;
    ids.add(segment.segment_id);
  }
  for (const segment of value.visual_segments) {
    if (segment.start_frame !== cursor) return false;
    cursor = segment.end_frame;
  }
  return cursor === totalFrames;
}
export function isCreateEpisodeMediaAssemblyVersionRequest(
  value: unknown, projectId: string, episodeId: string,
): value is CreateEpisodeMediaAssemblyVersionRequest {
  return isRecord(value) &&
    Object.keys(value).every((key) => [
      "content", "parent_version_id", "expected_revision", "change_summary",
    ].includes(key)) && Object.hasOwn(value, "content") &&
    Object.hasOwn(value, "change_summary") &&
    isEpisodeMediaAssemblyContent(value.content, projectId, episodeId) &&
    (value.parent_version_id === undefined || nullableId(value.parent_version_id, VERSION)) &&
    (value.expected_revision === undefined || value.expected_revision === null ||
      integer(value.expected_revision, 1)) &&
    typeof value.change_summary === "string" &&
    value.change_summary.length >= 1 && [...value.change_summary].length <= 500 &&
    ((value.parent_version_id ?? null) === null) ===
      ((value.expected_revision ?? null) === null);
}
function isMediaCheck(value: unknown): value is AssemblyMediaCheck {
  return isRecord(value) && exact(value, [
    "media", "kind", "availability", "technical_status", "probe_evidence_id",
    "probed_video_frames", "probed_has_audio", "rights_status", "rights_decision_id",
  ]) && isMediaRef(value.media) &&
    (value.kind === "image" || value.kind === "video" || value.kind === "audio") &&
    typeof value.availability === "string" && AVAILABILITY.has(value.availability) &&
    typeof value.technical_status === "string" && TECHNICAL.has(value.technical_status) &&
    nullableId(value.probe_evidence_id, PROBE) &&
    (value.probed_video_frames === null || integer(value.probed_video_frames, 1)) &&
    (value.probed_has_audio === null || typeof value.probed_has_audio === "boolean") &&
    ["PENDING_REVIEW", "CLEARED", "RESTRICTED"].includes(String(value.rights_status)) &&
    (value.rights_decision_id === null || typeof value.rights_decision_id === "string");
}
export function isEpisodeMediaAssemblyResponse(
  value: unknown, projectId: string, episodeId: string, requestId: string | null,
  versionId?: string,
): value is EpisodeMediaAssemblyResponse {
  if (!isRecord(value) || !exact(value, ["data", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.data) || !exact(value.data, [
        "artifact_id", "version_id", "content_hash", "head_revision", "parent_version_id",
        "content", "media_checks", "playback_status", "export_status",
      ])) return false;
  const data = value.data;
  return id(data.artifact_id, ARTIFACT) && id(data.version_id, VERSION) &&
    (versionId === undefined || data.version_id === versionId) &&
    id(data.content_hash, CONTENT_HASH) && integer(data.head_revision, 1) &&
    nullableId(data.parent_version_id, VERSION) &&
    isEpisodeMediaAssemblyContent(data.content, projectId, episodeId) &&
    Array.isArray(data.media_checks) && data.media_checks.length <= 2000 &&
    data.media_checks.every(isMediaCheck) &&
    typeof data.playback_status === "string" && PLAYBACK.has(data.playback_status) &&
    data.export_status === "NO_EXPORT_CLAIM";
}
export function episodeMediaAssemblyDefiniteError(
  status: number, value: unknown, requestId: string | null,
): Extract<EpisodeMediaAssemblyResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (status !== 401 && status !== 403 && status !== 404 && status !== 409 &&
      status !== 422) return null;
  if (!isRecord(value) || !exact(value, ["error", "request_id"]) ||
      typeof value.request_id !== "string" || !hasRequestId(value) ||
      value.request_id !== requestId ||
      !isRecord(value.error) || !exact(value.error, [
        "code", "message", "details", "retryable",
      ]) || typeof value.error.code !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
      typeof value.error.message !== "string" || !isRecord(value.error.details) ||
      value.error.retryable !== false) return null;
  return { kind: "DEFINITE_SERVER_ERROR", status, code: value.error.code,
    request_id: value.request_id };
}
