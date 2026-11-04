/**
 * The JSON report that packages/aivora-qc writes, schemaVersion 1. The types are kept here so
 * these components can read a report without importing that package.
 */
export const QC_ACTIONS = [
  "trim",
  "regenerate_shot",
  "add_audio",
  "adjust_volume",
  "edit_subtitle",
  "none",
] as const;

export type QcAction = (typeof QC_ACTIONS)[number];

export type QcSeverity = "warn" | "block";

export type QcIssue = {
  id: string;
  severity: QcSeverity;
  /** Seconds from the start of the export. 0 for whole-program issues. */
  time: number;
  /** Plain label written by the checker, for example 「第 2.0 秒」. */
  timeLabel: string;
  end: number;
  type: string;
  message: string;
  suggestion: string;
  action: QcAction;
  /** Measurements for professionals: thresholds, LUFS, dBTP, subtitle widths. */
  detail: Record<string, unknown>;
  /** "program" for loudness, true peak and missing audio: the whole export, not second 0. */
  scope?: "program";
  cue?: number;
  nextCue?: number;
  estimated?: boolean;
};

export type QcReport = {
  schemaVersion: 1;
  media: { duration: number; width: number; height: number };
  audio: { present: boolean; integratedLufs: number | null; truePeakDbtp: number | null };
  assumptions: Record<string, unknown>;
  issues: QcIssue[];
};

export type QcReadResult = { ok: true; report: QcReport } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || isNumber(value);

function readIssue(value: unknown, index: number): QcIssue | string {
  const where = `第 ${index + 1} 条问题`;
  if (!isRecord(value)) return `${where}不是对象`;
  const { id, severity, time, timeLabel, end, type, message, suggestion, action, detail } = value;
  if (!isText(id)) return `${where}缺少 id`;
  if (severity !== "warn" && severity !== "block")
    return `${where}的 severity 只能是 warn 或 block`;
  if (!isNumber(time)) return `${where}缺少 time`;
  if (!isText(timeLabel)) return `${where}缺少 timeLabel`;
  if (!isNumber(end)) return `${where}缺少 end`;
  if (!isText(type)) return `${where}缺少 type`;
  if (!isText(message)) return `${where}缺少 message`;
  if (typeof suggestion !== "string") return `${where}缺少 suggestion`;
  if (!QC_ACTIONS.includes(action as QcAction))
    return `${where}的 action 不认识：${String(action)}`;
  if (!isRecord(detail)) return `${where}的 detail 不是对象`;
  const issue: QcIssue = {
    id,
    severity,
    time,
    timeLabel,
    end,
    type,
    message,
    suggestion,
    action: action as QcAction,
    detail,
  };
  if (value.scope === "program") issue.scope = "program";
  if (isNumber(value.cue)) issue.cue = value.cue;
  if (isNumber(value.nextCue)) issue.nextCue = value.nextCue;
  if (value.estimated === true) issue.estimated = true;
  return issue;
}

/**
 * Checks a parsed report and copies the version 1 fields. It is refused, with the reason in
 * Chinese, when it is not schemaVersion 1, lacks the media or audio measurements or the
 * assumptions, or has an issue without id, severity, time, timeLabel, end, type, message,
 * suggestion, a known action or a detail object. A type it has no label for is kept.
 */
export function readQcReport(value: unknown): QcReadResult {
  if (!isRecord(value)) return { ok: false, reason: "检查结果不是对象" };
  if (value.schemaVersion !== 1) return { ok: false, reason: "检查结果的版本不是 1" };
  const { media, audio, issues } = value;
  if (
    !isRecord(media) ||
    !isNumber(media.duration) ||
    !isNumber(media.width) ||
    !isNumber(media.height)
  ) {
    return { ok: false, reason: "检查结果缺少成片的时长或尺寸" };
  }
  if (
    !isRecord(audio) ||
    typeof audio.present !== "boolean" ||
    !isNumberOrNull(audio.integratedLufs) ||
    !isNumberOrNull(audio.truePeakDbtp)
  ) {
    return { ok: false, reason: "检查结果缺少声音的测量" };
  }
  if (!isRecord(value.assumptions)) return { ok: false, reason: "检查结果缺少 assumptions" };
  if (!Array.isArray(issues)) return { ok: false, reason: "检查结果缺少 issues 列表" };
  const read: QcIssue[] = [];
  for (const [index, item] of issues.entries()) {
    const issue = readIssue(item, index);
    if (typeof issue === "string") return { ok: false, reason: issue };
    read.push(issue);
  }
  return {
    ok: true,
    report: {
      schemaVersion: 1,
      media: { duration: media.duration, width: media.width, height: media.height },
      audio: {
        present: audio.present,
        integratedLufs: audio.integratedLufs,
        truePeakDbtp: audio.truePeakDbtp,
      },
      assumptions: value.assumptions,
      issues: read,
    },
  };
}

/** Short tag for each issue type the checker reports. */
export const QC_TYPE_LABEL: Record<string, string> = {
  black: "黑屏",
  freeze: "画面停住",
  silence: "没有声音",
  no_audio: "没有声音",
  loudness: "整片音量",
  true_peak: "声音太冲",
  subtitle_safe_area: "字幕靠边",
  subtitle_line_length: "字幕太长",
  subtitle_overlap: "字幕重叠",
};

const DETAIL_LABEL: Record<string, string> = {
  durationSeconds: "持续（秒）",
  thresholdSeconds: "提示门槛（秒）",
  pixelThreshold: "黑像素门槛",
  blackPixelRatio: "黑像素占比",
  noiseDb: "噪声门槛 dB",
  integratedLufs: "整片响度 LUFS",
  targetLufs: "目标响度 LUFS",
  toleranceLu: "允许偏差 LU",
  truePeakDbtp: "真峰值 dBTP",
  maxTruePeakDbtp: "峰值上限 dBTP",
  audioStreamPresent: "有音轨",
  lineUnits: "每行字数",
  maxLineUnits: "每行上限",
  estimated: "估算",
  widthsPx: "每行宽度（像素）",
  topPx: "顶边（像素）",
  bottomPx: "底边（像素）",
  width: "画面宽",
  height: "画面高",
  overlapSeconds: "重叠（秒）",
  layout: "字幕布局",
};

function detailValue(value: unknown): string {
  if (value === null) return "无法测量";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(detailValue).join("、");
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${key}=${detailValue(item)}`)
      .join("，");
  }
  return String(value);
}

/** The detail measurements as label/value rows, for the 「高级」 section. */
export function detailRows(detail: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(detail).map(([key, value]) => ({
    label: DETAIL_LABEL[key] ?? key,
    value: detailValue(value),
  }));
}
