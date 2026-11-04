import { hasRequestId, isRecord } from "./api-contract-guards";

export type Rational = { num: number; den: number };
export type LocalAudioProbe = {
  source_asset_sha256: string;
  byte_size: number;
  format_names: string[];
  container_duration: Rational;
  video: null;
  audio: {
    stream_index: number;
    codec_name: string;
    sample_rate_hz: number;
    channels: number;
    channel_layout: string | null;
    time_base: Rational;
    total_samples: number;
  };
};
export type AudioAssetProbeEvidence = {
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
  probe: LocalAudioProbe;
};
export type AudioAssetProbeEvidenceResponse = {
  data: AudioAssetProbeEvidence;
  request_id: string;
};
export type AudioAssetProbeReadResult =
  | { kind: "FOUND"; receipt: AudioAssetProbeEvidenceResponse }
  | {
      kind: "DEFINITE_SERVER_ERROR";
      status: 401 | 403 | 404 | 409 | 422 | 503;
      code: string;
      request_id: string;
    }
  | { kind: "PROBE_UNKNOWN" };
export type AudioAssetProbeWriteResult =
  | { kind: "PROBED"; receipt: AudioAssetProbeEvidenceResponse }
  | Extract<AudioAssetProbeReadResult, { kind: "DEFINITE_SERVER_ERROR" }>
  | { kind: "PROBE_UNKNOWN" };

export const AUDIO_ASSET_PROBE_CHANNELS = Object.freeze({
  get: "audio-asset-probe:get",
  probe: "audio-asset-probe:probe-selected",
} as const);

const PROJECT = /^prj_[0-9a-f]{32}$/;
const ASSET = /^asset_[0-9a-f]{32}$/;
const VERSION = /^asv_[0-9a-f]{32}$/;
const EVIDENCE = /^mpe_[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function id(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function integer(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
function isRational(value: unknown): value is Rational {
  return (
    isRecord(value) &&
    exact(value, ["num", "den"]) &&
    integer(value.num, 1) &&
    integer(value.den, 1) &&
    value.den <= 2_147_483_647
  );
}
export function isProbeProjectId(value: unknown): value is string {
  return id(value, PROJECT);
}
export function isProbeAssetId(value: unknown): value is string {
  return id(value, ASSET);
}
export function isProbeVersionId(value: unknown): value is string {
  return id(value, VERSION);
}

function isProbe(
  value: unknown,
  expectedSha: string,
  expectedBytes: number,
): value is LocalAudioProbe {
  if (
    !isRecord(value) ||
    !exact(value, [
      "source_asset_sha256",
      "byte_size",
      "format_names",
      "container_duration",
      "video",
      "audio",
    ]) ||
    value.source_asset_sha256 !== `sha256:${expectedSha}` ||
    value.byte_size !== expectedBytes ||
    !Array.isArray(value.format_names) ||
    value.format_names.length < 1 ||
    value.format_names.some((item) => typeof item !== "string" || item.length < 1) ||
    !isRational(value.container_duration) ||
    value.format_names.length > 64 ||
    value.format_names.some((item) => typeof item !== "string" || item.length > 128) ||
    value.video !== null ||
    !isRecord(value.audio) ||
    !exact(value.audio, [
      "stream_index",
      "codec_name",
      "sample_rate_hz",
      "channels",
      "channel_layout",
      "time_base",
      "total_samples",
    ])
  )
    return false;
  const audio = value.audio;
  return (
    integer(audio.stream_index, 0) &&
    typeof audio.codec_name === "string" &&
    audio.codec_name.length > 0 &&
    audio.codec_name.length <= 256 &&
    integer(audio.sample_rate_hz, 1) &&
    audio.sample_rate_hz <= 384000 &&
    integer(audio.channels, 1) &&
    audio.channels <= 64 &&
    (audio.channel_layout === null ||
      (typeof audio.channel_layout === "string" &&
        audio.channel_layout.length > 0 &&
        audio.channel_layout.length <= 256)) &&
    isRational(audio.time_base) &&
    integer(audio.total_samples, 1)
  );
}
export function isAudioAssetProbeEvidenceResponse(
  value: unknown,
  projectId: string,
  assetId: string,
  versionId: string,
  requestId: string | null,
): value is AudioAssetProbeEvidenceResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.data) ||
    !exact(value.data, [
      "id",
      "project_id",
      "asset_id",
      "version_id",
      "asset_sha256",
      "byte_size",
      "probe_sha256",
      "toolchain_profile_id",
      "toolchain_version",
      "ffmpeg_sha256",
      "ffprobe_sha256",
      "created_at",
      "probe",
    ])
  )
    return false;
  const data = value.data;
  return (
    id(data.id, EVIDENCE) &&
    data.project_id === projectId &&
    data.asset_id === assetId &&
    data.version_id === versionId &&
    id(data.asset_sha256, HASH) &&
    integer(data.byte_size, 1) &&
    id(data.probe_sha256, HASH) &&
    typeof data.toolchain_profile_id === "string" &&
    data.toolchain_profile_id.length > 0 &&
    typeof data.toolchain_version === "string" &&
    data.toolchain_version.length > 0 &&
    id(data.ffmpeg_sha256, HASH) &&
    id(data.ffprobe_sha256, HASH) &&
    typeof data.created_at === "string" &&
    Number.isFinite(Date.parse(data.created_at)) &&
    isProbe(data.probe, data.asset_sha256, data.byte_size)
  );
}
export function audioAssetProbeDefiniteError(
  status: number,
  value: unknown,
  requestId: string | null,
): Extract<AudioAssetProbeReadResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (
    status !== 401 &&
    status !== 403 &&
    status !== 404 &&
    status !== 409 &&
    status !== 422 &&
    status !== 503
  )
    return null;
  if (
    !isRecord(value) ||
    !exact(value, ["error", "request_id"]) ||
    typeof value.request_id !== "string" ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.error) ||
    !exact(value.error, ["code", "message", "details", "retryable"]) ||
    typeof value.error.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
    typeof value.error.message !== "string" ||
    !isRecord(value.error.details) ||
    value.error.retryable !== false
  )
    return null;
  // This exact 503 is emitted before probing/persistence begins. Other 503s may
  // be lost write receipts and must remain unknown, with read-only reconciliation.
  if (status === 503 && value.error.code !== "TOOLCHAIN_UNAVAILABLE") return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status,
    code: value.error.code,
    request_id: value.request_id,
  };
}
