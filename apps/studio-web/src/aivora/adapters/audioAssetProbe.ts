import { visualJson } from "@aijian/contracts/visual-bible";
import { validProbeScope, probeScopeKey, type MediaProbeScope } from "./selectedMediaProbeScope";
import { createSelectedProbeStore } from "./selectedMediaProbe";
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

export interface AudioAssetProbeGateway {
  getAudioAssetProbeEvidence(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeReadResult>;
  probeSelectedAudioAssetVersion(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeWriteResult>;
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
/** Evidence must bind to the exact selected immutable version and its original bytes. */
function audioReceiptStructure(
  value: unknown,
  scope: MediaProbeScope,
): AudioAssetProbeEvidence | null {
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
    probe.format_names.length > 64 ||
    probe.format_names.some((name) => typeof name !== "string" || name.length > 128) ||
    probe.video !== null
  )
    return null;
  {
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
      audio.sample_rate_hz > 384000 ||
      !integer(audio.channels, 1) ||
      audio.channels > 64 ||
      (audio.channel_layout !== null && !text(audio.channel_layout)) ||
      !rational(audio.time_base) ||
      !integer(audio.total_samples, 1)
    )
      return null;
  }
  return data as AudioAssetProbeEvidence;
}
export async function parseAudioProbeReceipt(
  value: unknown,
  scope: MediaProbeScope,
): Promise<AudioAssetProbeEvidence | null> {
  try {
    const snapshot = structuredClone(value);
    const data = audioReceiptStructure(snapshot, scope);
    if (
      !data ||
      !record(snapshot) ||
      typeof snapshot.request_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshot.request_id)
    )
      return null;
    const bytes = new TextEncoder().encode(visualJson(data.probe));
    if (bytes.length > 8 * 1024 * 1024) return null;
    const digest = await window.crypto.subtle.digest("SHA-256", bytes.buffer);
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return sha === data.probe_sha256 ? data : null;
  } catch {
    return null;
  }
}
const gateways = new WeakMap<object, AudioAssetProbeGateway>();
export function desktopAudioAssetProbe(
  bridge: Partial<AudioAssetProbeGateway>,
): AudioAssetProbeGateway | undefined {
  if (
    typeof bridge.getAudioAssetProbeEvidence !== "function" ||
    typeof bridge.probeSelectedAudioAssetVersion !== "function"
  )
    return undefined;
  let gateway = gateways.get(bridge);
  if (!gateway) {
    gateway = {
      getAudioAssetProbeEvidence: (p, a, v) => bridge.getAudioAssetProbeEvidence!(p, a, v),
      probeSelectedAudioAssetVersion: (p, a, v) => bridge.probeSelectedAudioAssetVersion!(p, a, v),
    };
    gateways.set(bridge, gateway);
  }
  return gateway;
}
export function createAudioProbeStore(
  scope: MediaProbeScope,
  gateway?: AudioAssetProbeGateway,
  storage?: Storage,
) {
  return createSelectedProbeStore(
    scope,
    gateway
      ? {
          read: (p, a, v) => gateway.getAudioAssetProbeEvidence(p, a, v),
          write: (p, a, v) => gateway.probeSelectedAudioAssetVersion(p, a, v),
        }
      : undefined,
    storage,
    parseAudioProbeReceipt,
    "audio-probe",
    "音频",
  );
}
const stores = new WeakMap<
  AudioAssetProbeGateway,
  Map<string, ReturnType<typeof createAudioProbeStore>>
>();
export function sharedAudioProbeStore(scope: MediaProbeScope, gateway: AudioAssetProbeGateway) {
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
    store = createAudioProbeStore(scope, gateway, storage);
    scopes.set(key, store);
  }
  return store;
}
