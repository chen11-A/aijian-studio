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
export type MediaProbeScope = {
  projectId: string;
  assetId: string;
  versionId: string;
  sha256: string;
  byteSize: number;
};
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
export function validProbeScope(scope: MediaProbeScope): boolean {
  return (
    /^prj_[0-9a-f]{32}$/.test(scope.projectId) &&
    /^asset_[0-9a-f]{32}$/.test(scope.assetId) &&
    /^asv_[0-9a-f]{32}$/.test(scope.versionId) &&
    hash(scope.sha256) &&
    integer(scope.byteSize, 1)
  );
}
export function probeScopeKey(scope: MediaProbeScope): string {
  return [scope.projectId, scope.assetId, scope.versionId, scope.sha256, scope.byteSize].join(":");
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
function definite(
  value: unknown,
): value is Extract<MediaAssetProbeReadResult, { kind: "DEFINITE_SERVER_ERROR" }> {
  return (
    record(value) &&
    exact(value, ["kind", "status", "code", "request_id"]) &&
    value.kind === "DEFINITE_SERVER_ERROR" &&
    typeof value.status === "number" &&
    ([401, 403, 404, 409, 422].includes(value.status) ||
      (value.status === 503 && value.code === "TOOLCHAIN_UNAVAILABLE")) &&
    text(value.code) &&
    /^[A-Z][A-Z0-9_]{2,79}$/.test(value.code) &&
    text(value.request_id)
  );
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
export type MediaProbeSnapshot = {
  phase: "LOADING" | "FOUND" | "NOT_FOUND" | "ERROR" | "UNKNOWN" | "UNAVAILABLE";
  evidence: MediaAssetProbeEvidence | null;
  busy: boolean;
  uncertain: boolean;
  notFound: boolean;
  notice: string;
};
/** One durable unknown-write lock per exact version; navigation cannot replay a probe. */
export function createMediaProbeStore(
  scope: MediaProbeScope,
  gateway?: MediaAssetProbeGateway,
  storage?: Storage,
) {
  const key = `aivora:media-probe:pending:${probeScopeKey(scope)}`;
  const usable = !!gateway && validProbeScope(scope);
  let uncertain = true;
  try {
    uncertain = !storage || storage.getItem(key) !== null;
  } catch {
    /* fail closed */
  }
  let snapshot: MediaProbeSnapshot = {
    phase: usable ? "LOADING" : "UNAVAILABLE",
    evidence: null,
    busy: false,
    uncertain,
    notFound: false,
    notice: "",
  };
  let operation: Promise<void> | undefined;
  let expected: MediaAssetProbeEvidence | null = null;
  const listeners = new Set<() => void>();
  function publish(next: MediaProbeSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  function markPending() {
    try {
      if (!storage || storage.getItem(key) !== null) return false;
      storage.setItem(key, "pending");
      return storage.getItem(key) === "pending";
    } catch {
      return false;
    }
  }
  function clearPending() {
    try {
      if (!storage) return false;
      storage.removeItem(key);
      return storage.getItem(key) === null;
    } catch {
      return false;
    }
  }
  async function readback() {
    const result = await Promise.resolve()
      .then(() =>
        gateway!.getMediaAssetProbeEvidence(scope.projectId, scope.assetId, scope.versionId),
      )
      .catch(() => null);
    const evidence =
      result?.kind === "FOUND" ? parseMediaProbeReceipt(result.receipt, scope) : null;
    if (
      evidence &&
      (!expected ||
        (evidence.id === expected.id && evidence.probe_sha256 === expected.probe_sha256))
    ) {
      uncertain = !clearPending();
      expected = null;
      publish({
        phase: "FOUND",
        evidence,
        uncertain,
        busy: false,
        notFound: false,
        notice: "已读回此视频版本的真实探测记录；不代表权利或正式发布审核通过。",
      });
      return;
    }
    const notFound = definite(result) && result.status === 404 && result.code === "PROBE_NOT_FOUND";
    publish({
      phase: uncertain ? "UNKNOWN" : notFound ? "NOT_FOUND" : "ERROR",
      evidence: null,
      busy: false,
      uncertain,
      notFound,
      notice: uncertain
        ? "上次探测结果仍待核对，暂不能重复开始。未查到记录不代表旧请求已结束。"
        : notFound
          ? "此视频版本尚无探测记录。"
          : result?.kind === "FOUND"
            ? "探测记录的版本、哈希或结构不匹配，未采纳。"
            : definite(result)
              ? `探测记录读取被拒绝：${result.status} / ${result.code}`
              : "探测记录尚未可靠读回，请重新读取。",
    });
  }
  function refresh() {
    if (!usable) return Promise.resolve();
    if (operation) return operation;
    publish({ ...snapshot, phase: "LOADING", busy: true, evidence: null });
    operation = readback().finally(() => {
      operation = undefined;
    });
    return operation;
  }
  function probe() {
    if (!usable || operation || uncertain || snapshot.phase !== "NOT_FOUND")
      return Promise.resolve();
    if (!markPending()) {
      uncertain = true;
      publish({
        ...snapshot,
        phase: "UNKNOWN",
        uncertain: true,
        notice: "无法保存探测恢复记录，未开始探测。",
      });
      return Promise.resolve();
    }
    uncertain = true;
    publish({
      ...snapshot,
      busy: true,
      uncertain: true,
      notFound: false,
      notice: "正在探测选中视频版本，请勿重复提交…",
    });
    operation = (async () => {
      const result = await Promise.resolve()
        .then(() =>
          gateway!.probeSelectedMediaAssetVersion(scope.projectId, scope.assetId, scope.versionId),
        )
        .catch(() => null);
      if (definite(result)) {
        uncertain = !clearPending();
        publish({
          phase: uncertain ? "UNKNOWN" : "ERROR",
          evidence: null,
          busy: false,
          uncertain,
          notFound: false,
          notice: `探测被拒绝：${result.status} / ${result.code}。请核对后重新读取记录。`,
        });
        return;
      }
      expected = result?.kind === "PROBED" ? parseMediaProbeReceipt(result.receipt, scope) : null;
      publish({
        ...snapshot,
        phase: "LOADING",
        busy: true,
        notice: expected
          ? "探测已返回，正在读取持久记录…"
          : "探测结果未知，正在只读核对同一版本；不会重复探测。",
      });
      await readback();
    })().finally(() => {
      operation = undefined;
    });
    return operation;
  }
  function acknowledgeFinished() {
    if (operation || !uncertain || !snapshot.notFound || !clearPending()) return;
    uncertain = false;
    expected = null;
    publish({
      ...snapshot,
      phase: "NOT_FOUND",
      uncertain: false,
      notice: "已按你的确认解除重试锁定；仍需再次明确点击开始探测。",
    });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    probe,
    acknowledgeFinished,
  };
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
