import { hasRequestId, isRecord } from "./api-contract-guards";

export type Rational = { num: number; den: number };
export type MediaTimestamp = { ticks: number; time_base: Rational };
export type LocalMediaProbe = {
  source_asset_sha256: string;
  byte_size: number;
  format_names: string[];
  container_duration: Rational;
  video: {
    stream_index: number;
    codec_name: string;
    width: number;
    height: number;
    pixel_format: string;
    average_frame_rate: Rational;
    time_base: Rational;
    frames: { pts: MediaTimestamp }[];
    is_variable_frame_rate: boolean;
  };
  audio: {
    stream_index: number;
    codec_name: string;
    sample_rate_hz: number;
    channels: number;
    channel_layout: string | null;
    time_base: Rational;
    total_samples: number;
  } | null;
};
export type MediaAssetProbeEvidence = {
  id: string;
  project_id: string;
  asset_id: string;
  version_id: string;
  asset_sha256: string;
  byte_size: number;
  probe_sha256: string;
  toolchain_profile_id: string;
  toolchain_version: string;
  ffmpeg_sha256: string;
  ffprobe_sha256: string;
  created_at: string;
  probe: LocalMediaProbe;
};
export type MediaAssetProbeEvidenceResponse = {
  data: MediaAssetProbeEvidence;
  request_id: string;
};
export type MediaAssetProbeReadResult =
  | { kind: "FOUND"; receipt: MediaAssetProbeEvidenceResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 401 | 403 | 404 | 409 | 422;
      code: string; request_id: string }
  | { kind: "PROBE_UNKNOWN" };
export type MediaAssetProbeWriteResult =
  | { kind: "PROBED"; receipt: MediaAssetProbeEvidenceResponse }
  | Extract<MediaAssetProbeReadResult, { kind: "DEFINITE_SERVER_ERROR" }>
  | { kind: "PROBE_UNKNOWN" };

export const MEDIA_ASSET_PROBE_CHANNELS = Object.freeze({
  get: "media-asset-probe:get",
  probe: "media-asset-probe:probe-selected",
} as const);

const PROJECT = /^prj_[0-9a-f]{32}$/;
const ASSET = /^asset_[0-9a-f]{32}$/;
const VERSION = /^asv_[0-9a-f]{32}$/;
const EVIDENCE = /^mpe_[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function id(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function integer(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
function isRational(value: unknown): value is Rational {
  return isRecord(value) && exact(value, ["num", "den"]) &&
    integer(value.num, 1) && integer(value.den, 1) && value.den <= 2_147_483_647;
}
function isTimestamp(value: unknown): value is MediaTimestamp {
  return isRecord(value) && exact(value, ["ticks", "time_base"]) &&
    typeof value.ticks === "number" && Number.isSafeInteger(value.ticks) &&
    isRational(value.time_base);
}
export function isProbeProjectId(value: unknown): value is string { return id(value, PROJECT); }
export function isProbeAssetId(value: unknown): value is string { return id(value, ASSET); }
export function isProbeVersionId(value: unknown): value is string { return id(value, VERSION); }

function isProbe(value: unknown, expectedSha: string, expectedBytes: number): value is LocalMediaProbe {
  if (!isRecord(value) || !exact(value, [
    "source_asset_sha256", "byte_size", "format_names", "container_duration", "video", "audio",
  ]) || value.source_asset_sha256 !== expectedSha || value.byte_size !== expectedBytes ||
      !Array.isArray(value.format_names) || value.format_names.length < 1 ||
      value.format_names.some((item) => typeof item !== "string" || item.length < 1) ||
      !isRational(value.container_duration) || !isRecord(value.video) ||
      !exact(value.video, [
        "stream_index", "codec_name", "width", "height", "pixel_format",
        "average_frame_rate", "time_base", "frames", "is_variable_frame_rate",
      ])) return false;
  const video = value.video;
  if (!integer(video.stream_index, 0) || typeof video.codec_name !== "string" ||
      !integer(video.width, 1) || !integer(video.height, 1) ||
      typeof video.pixel_format !== "string" || !isRational(video.average_frame_rate) ||
      !isRational(video.time_base) || !Array.isArray(video.frames) ||
      video.frames.length < 1 || video.frames.length > 1_000_000 ||
      !video.frames.every((frame) => isRecord(frame) && exact(frame, ["pts"]) &&
        isTimestamp(frame.pts)) || typeof video.is_variable_frame_rate !== "boolean") return false;
  if (value.audio === null) return true;
  if (!isRecord(value.audio) || !exact(value.audio, [
    "stream_index", "codec_name", "sample_rate_hz", "channels", "channel_layout",
    "time_base", "total_samples",
  ])) return false;
  const audio = value.audio;
  return integer(audio.stream_index, 0) && typeof audio.codec_name === "string" &&
    integer(audio.sample_rate_hz, 1) && integer(audio.channels, 1) &&
    (audio.channel_layout === null || typeof audio.channel_layout === "string") &&
    isRational(audio.time_base) && integer(audio.total_samples, 0);
}
export function isMediaAssetProbeEvidenceResponse(
  value: unknown, projectId: string, assetId: string, versionId: string,
  requestId: string | null,
): value is MediaAssetProbeEvidenceResponse {
  if (!isRecord(value) || !exact(value, ["data", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId || !isRecord(value.data) ||
      !exact(value.data, [
        "id", "project_id", "asset_id", "version_id", "asset_sha256", "byte_size",
        "probe_sha256", "toolchain_profile_id", "toolchain_version", "ffmpeg_sha256",
        "ffprobe_sha256", "created_at", "probe",
      ])) return false;
  const data = value.data;
  return id(data.id, EVIDENCE) && data.project_id === projectId &&
    data.asset_id === assetId && data.version_id === versionId &&
    id(data.asset_sha256, HASH) && integer(data.byte_size, 1) &&
    id(data.probe_sha256, HASH) && typeof data.toolchain_profile_id === "string" &&
    data.toolchain_profile_id.length > 0 && typeof data.toolchain_version === "string" &&
    data.toolchain_version.length > 0 && id(data.ffmpeg_sha256, HASH) &&
    id(data.ffprobe_sha256, HASH) && typeof data.created_at === "string" &&
    Number.isFinite(Date.parse(data.created_at)) &&
    isProbe(data.probe, data.asset_sha256, data.byte_size);
}
export function mediaAssetProbeDefiniteError(
  status: number, value: unknown, requestId: string | null,
): Extract<MediaAssetProbeReadResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (status !== 401 && status !== 403 && status !== 404 && status !== 409 &&
      status !== 422) return null;
  if (!isRecord(value) || !exact(value, ["error", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId ||
      !isRecord(value.error) || !exact(value.error, [
        "code", "message", "details", "retryable",
      ]) || typeof value.error.code !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
      typeof value.error.message !== "string" || !isRecord(value.error.details) ||
      value.error.retryable !== false) return null;
  return { kind: "DEFINITE_SERVER_ERROR", status, code: value.error.code,
    request_id: value.request_id };
}
