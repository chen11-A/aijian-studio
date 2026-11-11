import type {
  FilmDeliveryEvidenceResult,
  FilmDeliveryFile,
  FilmDeliveryTechnical,
} from "@aijian/contracts/film-delivery-evidence";
export type DeliveryFileView = {
  name: string;
  role: string;
  aspect: string;
  sha?: string;
  bytes?: number;
  facts: { label: string; value: string }[];
};
export type DeliveryEvidenceView =
  | { kind: "not-provided" }
  | { kind: "invalid" }
  | {
      kind: "failed";
      reason: "unavailable" | "write-failed";
      cleanupUnconfirmed: boolean;
      files: DeliveryFileView[];
    }
  | {
      kind: "written";
      partial: boolean;
      filesPartial: boolean;
      cleanupUnconfirmed: boolean;
      name: string;
      sha: string;
      createdAt: string;
      files: DeliveryFileView[];
      selection: string[];
      settings: string[];
      unverified: string[];
      /** Null when an older record has no field. Never inferred from an AAC track. */
      audioDecision: "SILENT_BY_USER" | "WITH_AUDIO" | null;
    };
const roles = { video: "视频", subtitles: "字幕文件", cover: "封面" } as const;
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function hasControls(value: string, allowWhitespace = false): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 127 || (code < 32 && !(allowWhitespace && [9, 10, 13].includes(code))))
      return true;
  }
  return false;
}
function fileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    !/[\\/]/.test(value) &&
    !hasControls(value) &&
    !/^[A-Za-z]:/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !hasControls(value, true) &&
    !/[{}]|[A-Za-z]:[\\/]|\/[A-Za-z._]|(?:https?|file|aivora-media):|(?:api[_ -]?key|token|authorization|bearer|secret|password)\s*[:=]|sk-[A-Za-z0-9]|AKIA[A-Z0-9]|(?:Error|Exception|Traceback):/i.test(
      value,
    )
  );
}
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown) => value === null || (number(value) && value > 0);
const nonnegative = (value: unknown) => value === null || (number(value) && value >= 0);
const measurement = (value: unknown) => value === null || number(value);
const token = (value: unknown) =>
  value === null ||
  (typeof value === "string" && text(value) && /^[A-Za-z0-9_.:+ (),-]{1,80}$/.test(value));
const format = (value: number | null, unit = "") =>
  value === null ? "未核验" : `${Number(value.toFixed(3))}${unit}`;
function technical(value: FilmDeliveryTechnical): boolean {
  if (
    !value ||
    !nonnegative(value.durationSeconds) ||
    !["video-stream", "container", "unknown"].includes(value.durationBasis)
  )
    return false;
  const video = value.video;
  if (
    video !== null &&
    (!video ||
      ![
        video.width,
        video.height,
        video.displayWidth,
        video.displayHeight,
        video.averageFrameRate,
      ].every(positive) ||
      ![
        video.codec,
        video.pixelFormat,
        video.colorSpace,
        video.colorPrimaries,
        video.colorTransfer,
        video.colorRange,
      ].every(token))
  )
    return false;
  return (
    value.audioTracks === null ||
    (Array.isArray(value.audioTracks) &&
      value.audioTracks.every(
        (track) =>
          track &&
          Number.isSafeInteger(track.index) &&
          track.index >= 0 &&
          token(track.codec) &&
          positive(track.sampleRate) &&
          positive(track.channels) &&
          token(track.channelLayout),
      ))
  );
}
function reference(value: {
  role: string;
  aspectRatio: string;
  fileName: string;
}): DeliveryFileView | null {
  if (
    !value ||
    !Object.hasOwn(roles, value.role) ||
    !["16:9", "9:16"].includes(value.aspectRatio) ||
    !fileName(value.fileName)
  )
    return null;
  return {
    name: value.fileName,
    role: roles[value.role as keyof typeof roles],
    aspect: value.aspectRatio,
    facts: [],
  };
}
function file(value: FilmDeliveryFile): DeliveryFileView | null {
  const result = reference(value);
  if (
    !result ||
    !sha(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    (value.technical !== null && !technical(value.technical))
  )
    return null;
  result.sha = value.sha256;
  result.bytes = value.bytes;
  if (value.role === "video") {
    const source = value.technical;
    result.facts.push(
      { label: "文件时长", value: format(source?.durationSeconds ?? null, " 秒") },
      {
        label: "时长来源",
        value:
          source?.durationBasis === "video-stream"
            ? "视频流"
            : source?.durationBasis === "container"
              ? "容器"
              : "未核验",
      },
    );
    const video = source?.video;
    result.facts.push(
      { label: "视频编码", value: video?.codec ?? "未核验" },
      {
        label: "存储尺寸",
        value: video?.width && video.height ? `${video.width} × ${video.height}` : "未核验",
      },
      {
        label: "显示尺寸",
        value:
          video?.displayWidth && video.displayHeight
            ? `${video.displayWidth} × ${video.displayHeight}`
            : "未核验",
      },
      { label: "平均帧率（不代表恒定帧率）", value: format(video?.averageFrameRate ?? null) },
      { label: "像素格式", value: video?.pixelFormat ?? "未核验" },
      {
        label: "色彩记录",
        value: video
          ? [video.colorSpace, video.colorPrimaries, video.colorTransfer, video.colorRange]
              .map((v) => v ?? "未核验")
              .join(" / ")
          : "未核验",
      },
    );
    if (source?.audioTracks === null || !source)
      result.facts.push({ label: "音轨", value: "未核验" });
    else if (!source.audioTracks.length)
      result.facts.push({ label: "音轨", value: "检测未发现音轨" });
    else
      for (const [i, track] of source.audioTracks.entries())
        result.facts.push({
          label: `第 ${i + 1} 条音轨`,
          value: `${track.codec ?? "编码未核验"}；${format(track.sampleRate, " Hz")}；${format(track.channels, " 声道")}；${track.channelLayout ?? "布局未核验"}`,
        });
  }
  const qc = value.qc;
  if (qc !== null) {
    if (
      !qc ||
      qc.schemaVersion !== 1 ||
      !["clear", "warnings", "blocked", "unknown"].includes(qc.status) ||
      ![qc.integratedLufs, qc.truePeakDbtp].every(measurement) ||
      (qc.counts !== null &&
        (!qc.counts ||
          ![qc.counts.block, qc.counts.warn, qc.counts.info].every(
            (v) => Number.isSafeInteger(v) && v >= 0,
          )))
    )
      return null;
    const labels = {
      clear: "未发现技术阻断项",
      warnings: "存在技术提示",
      blocked: "存在技术阻断项",
      unknown: "技术检查未核验",
    };
    result.facts.push({ label: "技术检查记录", value: labels[qc.status] });
    if (qc.counts)
      result.facts.push({
        label: "检查项数",
        value: `阻断 ${qc.counts.block} · 提示 ${qc.counts.warn} · 信息 ${qc.counts.info}`,
      });
    result.facts.push(
      { label: "首条受检音轨综合响度", value: format(qc.integratedLufs, " LUFS") },
      { label: "首条受检音轨真峰值", value: format(qc.truePeakDbtp, " dBTP") },
    );
  } else result.facts.push({ label: "技术检查记录", value: "未核验" });
  return result;
}
export function deliveryEvidenceView(
  value: FilmDeliveryEvidenceResult | undefined,
  resultKind: "PUBLISHED" | "PARTIAL",
): DeliveryEvidenceView {
  if (value === undefined) return { kind: "not-provided" };
  try {
    if (value?.cleanupUnconfirmed !== undefined && value.cleanupUnconfirmed !== true)
      return { kind: "invalid" };
    const cleanupUnconfirmed = value?.cleanupUnconfirmed === true;
    if (value?.kind === "FAILED") {
      if (
        !["EVIDENCE_WRITE_FAILED", "EVIDENCE_UNAVAILABLE"].includes(value.code) ||
        !Array.isArray(value.files)
      )
        return { kind: "invalid" };
      const files = value.files.map(reference);
      return files.every(Boolean)
        ? {
            kind: "failed",
            reason: value.code === "EVIDENCE_UNAVAILABLE" ? "unavailable" : "write-failed",
            cleanupUnconfirmed,
            files: files as DeliveryFileView[],
          }
        : { kind: "invalid" };
    }
    if (value?.kind !== "WRITTEN" || !fileName(value.fileName) || !sha(value.manifestSha256))
      return { kind: "invalid" };
    const manifest = value.manifest;
    if (
      !manifest ||
      manifest.schemaVersion !== 1 ||
      (manifest.status !== (resultKind === "PARTIAL" ? "partial" : "complete") &&
        !(resultKind === "PARTIAL" && cleanupUnconfirmed && manifest.status === "complete")) ||
      typeof manifest.createdAt !== "string" ||
      !Number.isFinite(Date.parse(manifest.createdAt)) ||
      !Array.isArray(manifest.files) ||
      !manifest.files.length ||
      !Array.isArray(manifest.selection) ||
      !Array.isArray(manifest.unverified) ||
      !manifest.unverified.every(text)
    )
      return { kind: "invalid" };
    const files = manifest.files.map(file);
    if (
      !files.every(Boolean) ||
      new Set(manifest.files.map((f) => f.fileName)).size !== files.length
    )
      return { kind: "invalid" };
    if (
      !manifest.selection.every(
        (s) =>
          s &&
          text(s.label) &&
          (s.versionLabel === null || text(s.versionLabel)) &&
          nonnegative(s.startSeconds) &&
          nonnegative(s.endSeconds) &&
          (s.startSeconds === null || s.endSeconds === null || s.endSeconds >= s.startSeconds),
      )
    )
      return { kind: "invalid" };
    const audioDecision = Object.hasOwn(manifest, "audioDecision") ? manifest.audioDecision : null;
    if (
      audioDecision !== null &&
      audioDecision !== "SILENT_BY_USER" &&
      audioDecision !== "WITH_AUDIO"
    )
      return { kind: "invalid" };
    const settings = manifest.settings;
    if (
      !settings ||
      !Array.isArray(settings.aspects) ||
      !settings.aspects.length ||
      settings.aspects.length > 2 ||
      new Set(settings.aspects).size !== settings.aspects.length ||
      !settings.aspects.every((a) => ["16:9", "9:16"].includes(a)) ||
      !["720p", "1080p"].includes(settings.quality) ||
      !["burn", "srt", "none"].includes(settings.subtitles) ||
      !["white", "bar", "yellow", "film"].includes(settings.style) ||
      typeof settings.aiMark !== "boolean" ||
      (settings.autoAdjustVolume !== undefined && typeof settings.autoAdjustVolume !== "boolean")
    )
      return { kind: "invalid" };
    return {
      kind: "written",
      partial: resultKind === "PARTIAL",
      filesPartial: manifest.status === "partial",
      cleanupUnconfirmed,
      name: value.fileName,
      sha: value.manifestSha256,
      createdAt: manifest.createdAt,
      files: files as DeliveryFileView[],
      selection: manifest.selection.map(
        (s) =>
          `${s.label}${s.versionLabel ? ` · ${s.versionLabel}` : " · 版本说明未提供"}；${format(s.startSeconds, " 秒")}–${format(s.endSeconds, " 秒")}`,
      ),
      audioDecision,
      settings: [
        `画幅：${settings.aspects.join("、")}`,
        `导出设置：${settings.quality}`,
        `字幕：${{ burn: "烧入画面", srt: "单独字幕文件", none: "不含字幕" }[settings.subtitles]}`,
        `字幕样式设置：${{ white: "白字", bar: "黑底", yellow: "黄字", film: "电影字幕" }[settings.style]}`,
        `AI 标识：${settings.aiMark ? "开启" : "关闭"}`,
        `统一响度设置：${settings.autoAdjustVolume === true ? "开启" : "关闭"}`,
      ],
      unverified: [...manifest.unverified],
    };
  } catch {
    return { kind: "invalid" };
  }
}
