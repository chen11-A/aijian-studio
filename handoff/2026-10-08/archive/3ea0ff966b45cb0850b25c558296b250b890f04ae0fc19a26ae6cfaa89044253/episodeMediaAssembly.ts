/** Episode edit decisions over immutable project media versions. */

export type AssemblyMediaRef = {
  asset_id: string;
  asset_version_id: string;
  sha256: string;
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

export type AssemblyContent = {
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
  audio_segments: unknown[];
  subtitle_segments: unknown[];
};

export type AssemblyVersion = {
  artifact_id: string;
  version_id: string;
  content_hash: string;
  head_revision: number;
  parent_version_id: string | null;
  content: AssemblyContent;
  media_checks: Array<{
    media: AssemblyMediaRef;
    kind: "image" | "video" | "audio";
    availability: "VERIFIED" | "MISSING" | "CORRUPT" | "UNVERIFIED_SIZE_LIMIT" | "UNKNOWN_UNSAFE_PATH";
    technical_status: "STILL_HEADER_ONLY" | "PENDING_MEDIA_PROBE" | "PROBED_CFR_VIDEO" | "INVALID_MEDIA_PROBE";
    rights_status: "PENDING_REVIEW" | "CLEARED" | "RESTRICTED";
  }>;
  playback_status: "DRAFT_STATIC_ANIMATIC" | "DRAFT_VIDEO_PREVIEW" |
    "BLOCKED_MEDIA_PROBE" | "BLOCKED_MEDIA_BYTES" | "BLOCKED_RIGHTS";
  export_status: "NO_EXPORT_CLAIM";
};

export type AssemblyReceipt = { data: AssemblyVersion; request_id: string };
export type AssemblyGatewayResult =
  | { kind: "FOUND" | "CREATED"; receipt: AssemblyReceipt }
  | { kind: "NOT_FOUND"; request_id: string }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

export type CreateAssemblyCommand = {
  content: AssemblyContent;
  parent_version_id: string | null;
  expected_revision: number | null;
  change_summary: string;
};

export interface EpisodeMediaAssemblyGateway {
  readLatest(projectId: string, episodeId: string): Promise<AssemblyGatewayResult>;
  createVersion(projectId: string, episodeId: string,
    command: CreateAssemblyCommand): Promise<AssemblyGatewayResult>;
}

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_[a-z0-9._-]{1,80}$/;
const ASSET = /^asset_[0-9a-f]{32}$/;
const VERSION = /^asv_[0-9a-f]{32}$/;
const ARTIFACT_VERSION = /^ver_[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
const SEGMENT = /^seg_[a-z0-9._-]{1,80}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaRef(value: unknown): value is AssemblyMediaRef {
  return record(value) && typeof value.asset_id === "string" && ASSET.test(value.asset_id) &&
    typeof value.asset_version_id === "string" && VERSION.test(value.asset_version_id) &&
    typeof value.sha256 === "string" && HASH.test(value.sha256);
}

function frame(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

/** Identity and track geometry are checked before a server receipt can drive playback. */
export function parseAssemblyReceipt(
  value: unknown, projectId: string, episodeId: string,
): AssemblyVersion | null {
  if (!PROJECT.test(projectId) || !EPISODE.test(episodeId) || !record(value) ||
      typeof value.request_id !== "string" || !record(value.data)) return null;
  const data = value.data;
  if (typeof data.artifact_id !== "string" || !/^art_[0-9a-f]{32}$/.test(data.artifact_id) ||
      typeof data.version_id !== "string" || !ARTIFACT_VERSION.test(data.version_id) ||
      typeof data.content_hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(data.content_hash) ||
      !frame(data.head_revision, 1) ||
      !(data.parent_version_id === null ||
        (typeof data.parent_version_id === "string" && ARTIFACT_VERSION.test(data.parent_version_id))) ||
      !record(data.content) || !Array.isArray(data.media_checks) ||
      !["DRAFT_STATIC_ANIMATIC", "DRAFT_VIDEO_PREVIEW", "BLOCKED_MEDIA_PROBE",
        "BLOCKED_MEDIA_BYTES", "BLOCKED_RIGHTS"].includes(String(data.playback_status)) ||
      data.export_status !== "NO_EXPORT_CLAIM") return null;
  const content = data.content;
  const timebase = content.sequence_timebase;
  if (content.schema_version !== "1.0.0" || content.project_id !== projectId ||
      content.episode_id !== episodeId || !record(timebase) ||
      !record(timebase.frame_rate) || !frame(timebase.frame_rate.num, 1) ||
      !frame(timebase.frame_rate.den, 1) ||
      !["NON_DROP_FRAME", "DROP_FRAME"].includes(String(timebase.timecode_mode)) ||
      !frame(content.canvas_width, 1) || !frame(content.canvas_height, 1) ||
      !frame(content.total_frames, 1) || !Array.isArray(content.visual_segments) ||
      !Array.isArray(content.audio_segments) || !Array.isArray(content.subtitle_segments) ||
      content.visual_segments.length === 0) return null;
  let cursor = 0;
  const ids = new Set<string>();
  for (const item of content.visual_segments) {
    if (!record(item) || typeof item.segment_id !== "string" || !SEGMENT.test(item.segment_id) ||
        ids.has(item.segment_id) || !["image", "video"].includes(String(item.media_kind)) ||
        !mediaRef(item.media) || item.start_frame !== cursor || !frame(item.end_frame, 1) ||
        Number(item.end_frame) <= cursor || !frame(item.source_in_frame) ||
        !["MUTE", "PLAY"].includes(String(item.embedded_audio)) ||
        (item.media_kind === "image" &&
          (item.source_in_frame !== 0 || item.embedded_audio !== "MUTE"))) return null;
    cursor = Number(item.end_frame);
    ids.add(item.segment_id);
  }
  if (cursor !== content.total_frames) return null;
  for (const item of [...content.audio_segments, ...content.subtitle_segments]) {
    if (!record(item) || typeof item.segment_id !== "string" || !SEGMENT.test(item.segment_id) ||
        ids.has(item.segment_id) || !frame(item.start_frame) || !frame(item.end_frame, 1) ||
        Number(item.end_frame) <= Number(item.start_frame) ||
        Number(item.end_frame) > cursor) return null;
    ids.add(item.segment_id);
  }
  for (const check of data.media_checks) {
    if (!record(check) || !mediaRef(check.media) ||
        !["image", "video", "audio"].includes(String(check.kind)) ||
        !["VERIFIED", "MISSING", "CORRUPT", "UNVERIFIED_SIZE_LIMIT",
          "UNKNOWN_UNSAFE_PATH"].includes(String(check.availability)) ||
        !["STILL_HEADER_ONLY", "PENDING_MEDIA_PROBE", "PROBED_CFR_VIDEO",
          "INVALID_MEDIA_PROBE"].includes(String(check.technical_status)) ||
        !["PENDING_REVIEW", "CLEARED", "RESTRICTED"].includes(String(check.rights_status)))
      return null;
  }
  if (content.visual_segments.some((segment) =>
    !data.media_checks.some((check) => check.kind === segment.media_kind &&
      check.media.asset_id === segment.media.asset_id &&
      check.media.asset_version_id === segment.media.asset_version_id &&
      check.media.sha256 === segment.media.sha256))) return null;
  if (data.playback_status === "DRAFT_STATIC_ANIMATIC" &&
      (content.visual_segments.some((segment) => segment.media_kind !== "image") ||
        content.audio_segments.length > 0 ||
        data.media_checks.some((check) => check.availability !== "VERIFIED" ||
          check.rights_status === "RESTRICTED"))) return null;
  return data as unknown as AssemblyVersion;
}

export function staticAnimaticContent(
  projectId: string, episodeId: string,
  shots: Array<{ media: AssemblyMediaRef; frames: number }>,
): AssemblyContent {
  let cursor = 0;
  const visual_segments = shots.map((shot, index) => {
    const start_frame = cursor;
    cursor += shot.frames;
    return {
      segment_id: `seg_still_${String(index + 1).padStart(3, "0")}`,
      media_kind: "image" as const,
      media: shot.media, start_frame, end_frame: cursor,
      source_in_frame: 0, embedded_audio: "MUTE" as const,
    };
  });
  return {
    schema_version: "1.0.0", project_id: projectId, episode_id: episodeId,
    sequence_timebase: { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    canvas_width: 1920, canvas_height: 1080, total_frames: cursor,
    visual_segments, audio_segments: [], subtitle_segments: [],
  };
}
