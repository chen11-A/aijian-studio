import { validProbeScope, probeScopeKey, type MediaProbeScope } from "./selectedMediaProbeScope";
export { validProbeScope, probeScopeKey, type MediaProbeScope } from "./selectedMediaProbeScope";
import { createSelectedProbeStore, type SelectedProbeSnapshot } from "./selectedMediaProbe";
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
  | {
      kind: "DEFINITE_SERVER_ERROR";
      status: 401 | 403 | 404 | 409 | 422 | 503;
      code: string;
      request_id: string;
    }
  | { kind: "PROBE_UNKNOWN" };
export type MediaAssetProbeWriteResult =
  | { kind: "PROBED"; receipt: MediaAssetProbeEvidenceResponse }
  | Extract<MediaAssetProbeReadResult, { kind: "DEFINITE_SERVER_ERROR" }>
  | { kind: "PROBE_UNKNOWN" };

export interface MediaAssetProbeGateway {
  getMediaAssetProbeEvidence(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetProbeReadResult>;
  probeSelectedMediaAssetVersion(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetProbeWriteResult>;
}
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
function rational(value: unknown): value is Rational {
  return (
    record(value) &&
    exact(value, ["num", "den"]) &&
    integer(value.num, 1) &&
    integer(value.den, 1) &&
    value.den <= 2147483647
  );
}
function timestamp(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ["ticks", "time_base"]) &&
    Number.isSafeInteger(value.ticks) &&
    rational(value.time_base)
  );
}
/** Evidence must bind to the exact selected immutable version and its original bytes. */
export function parseMediaProbeReceipt(
  value: unknown,
  scope: MediaProbeScope,
): MediaAssetProbeEvidence | null {
  if (
    !validProbeScope(scope) ||
    !record(value) ||
    !exact(value, ["data", "request_id"]) ||
    !text(value.request_id) ||
    !record(value.data)
  )
    return null;
  const data = value.data;
  if (
    !exact(data, [
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
    ]) ||
    typeof data.id !== "string" ||
    !/^mpe_[0-9a-f]{32}$/.test(data.id) ||
    data.project_id !== scope.projectId ||
    data.asset_id !== scope.assetId ||
    data.version_id !== scope.versionId ||
    data.asset_sha256 !== scope.sha256 ||
    data.byte_size !== scope.byteSize ||
    !hash(data.probe_sha256) ||
    !hash(data.ffmpeg_sha256) ||
    !hash(data.ffprobe_sha256) ||
    !text(data.toolchain_profile_id) ||
    !text(data.toolchain_version) ||
    !text(data.created_at) ||
    !Number.isFinite(Date.parse(data.created_at)) ||
    !record(data.probe)
  )
    return null;
  const probe = data.probe;
  if (
    !exact(probe, [
      "source_asset_sha256",
      "byte_size",
      "format_names",
      "container_duration",
      "video",
      "audio",
    ]) ||
    probe.source_asset_sha256 !== `sha256:${scope.sha256}` ||
    probe.byte_size !== scope.byteSize ||
    !Array.isArray(probe.format_names) ||
    !probe.format_names.length ||
    !probe.format_names.every(text) ||
    !rational(probe.container_duration) ||
    !record(probe.video)
  )
    return null;
  const video = probe.video;
  if (
    !exact(video, [
      "stream_index",
      "codec_name",
      "width",
      "height",
      "pixel_format",
      "average_frame_rate",
      "time_base",
      "frames",
      "is_variable_frame_rate",
    ]) ||
    !integer(video.stream_index, 0) ||
    !text(video.codec_name) ||
    !text(video.pixel_format) ||
    !integer(video.width, 1) ||
    !integer(video.height, 1) ||
    !rational(video.average_frame_rate) ||
    !rational(video.time_base) ||
    typeof video.is_variable_frame_rate !== "boolean" ||
    !Array.isArray(video.frames) ||
    !video.frames.length ||
    video.frames.length > 1000000 ||
    !video.frames.every((frame) => record(frame) && exact(frame, ["pts"]) && timestamp(frame.pts))
  )
    return null;
  if (probe.audio !== null) {
    const audio = probe.audio;
    if (
      !record(audio) ||
      !exact(audio, [
        "stream_index",
        "codec_name",
        "sample_rate_hz",
        "channels",
        "channel_layout",
        "time_base",
        "total_samples",
      ]) ||
      !integer(audio.stream_index, 0) ||
      !text(audio.codec_name) ||
      !integer(audio.sample_rate_hz, 1) ||
      !integer(audio.channels, 1) ||
      (audio.channel_layout !== null && !text(audio.channel_layout)) ||
      !rational(audio.time_base) ||
      !integer(audio.total_samples, 0)
    )
      return null;
  }
  return data as MediaAssetProbeEvidence;
}
const gateways = new WeakMap<object, MediaAssetProbeGateway>();
export function desktopMediaAssetProbe(
  bridge: Partial<MediaAssetProbeGateway>,
): MediaAssetProbeGateway | undefined {
  if (
    typeof bridge.getMediaAssetProbeEvidence !== "function" ||
    typeof bridge.probeSelectedMediaAssetVersion !== "function"
  )
    return undefined;
  let gateway = gateways.get(bridge);
  if (!gateway) {
    gateway = {
      getMediaAssetProbeEvidence: (p, a, v) => bridge.getMediaAssetProbeEvidence!(p, a, v),
      probeSelectedMediaAssetVersion: (p, a, v) => bridge.probeSelectedMediaAssetVersion!(p, a, v),
    };
    gateways.set(bridge, gateway);
  }
  return gateway;
}
export type MediaProbeSnapshot = SelectedProbeSnapshot<MediaAssetProbeEvidence>;
/** Retains existing video gateway, journal namespace and recovery behavior. */
export function createMediaProbeStore(
  scope: MediaProbeScope,
  gateway?: MediaAssetProbeGateway,
  storage?: Storage,
) {
  return createSelectedProbeStore(
    scope,
    gateway
      ? {
          read: (p, a, v) => gateway.getMediaAssetProbeEvidence(p, a, v),
          write: (p, a, v) => gateway.probeSelectedMediaAssetVersion(p, a, v),
        }
      : undefined,
    storage,
    parseMediaProbeReceipt,
    "media-probe",
    "视频",
  );
}

const stores = new WeakMap<
  MediaAssetProbeGateway,
  Map<string, ReturnType<typeof createMediaProbeStore>>
>();
export function sharedMediaProbeStore(scope: MediaProbeScope, gateway: MediaAssetProbeGateway) {
  let scopes = stores.get(gateway);
  if (!scopes) {
    scopes = new Map();
    stores.set(gateway, scopes);
  }
  const key = probeScopeKey(scope);
  let store = scopes.get(key);
  if (!store) {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* fail closed */
    }
    store = createMediaProbeStore(scope, gateway, storage);
    scopes.set(key, store);
  }
  return store;
}
