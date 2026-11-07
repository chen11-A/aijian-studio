import type { SuggestionFieldRow } from "../../next/SuggestionFieldDiff";
import type { EditorSelection } from "./editor-context";
import type { ShotDirectionTransaction } from "./shot-direction-transaction";
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function reject(): never {
  throw Error("UNSUPPORTED_PERFORMANCE_DISPLAY");
}
function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = object(value);
  if (!row || Object.keys(row).some((key) => !keys.includes(key))) reject();
  return row;
}
function safeText(value: unknown, scope: EditorSelection): string {
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    [...value].some((c) => {
      const n = c.codePointAt(0)!;
      return (n < 32 && ![9, 10, 13].includes(n)) || n === 127;
    }) ||
    /^\s*[{[]/u.test(value) ||
    /(?:https?:|file:|aivora-media:|aijian-media:|data:|blob:)/iu.test(value) ||
    /\b[A-Za-z]:[\\/]|\\\\[^\s\\]+\\|(?:^|[\s'"(=:：])\/[^\s，。；]+/u.test(value) ||
    /\bBearer\s+\S+|\bsk[-_][A-Za-z0-9_-]{8,}|(?:authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu.test(
      value,
    ) ||
    /\b(?:film|prj|shot|take|scene|asset|char|character|location|prop|voice|clip|audio)_[A-Za-z0-9_-]{6,}|\b(?:shotId|takeId|projectId|selectedTakeId|videoPath|poster|source)\s*[:=]/u.test(
      value,
    ) ||
    [scope.projectId, scope.sceneId, scope.shotId].some(
      (id) => id && (id.length >= 4 ? value.includes(id) : value.trim() === id),
    )
  )
    reject();
  return value;
}
function list(value: unknown, max = 64): unknown[] {
  if (!Array.isArray(value) || value.length > max) reject();
  return value;
}
function seconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 36000) reject();
  return `${value} 秒（建议时间）`;
}
function nullable(value: unknown, format: (v: unknown) => string): string {
  return value === undefined ? "未设置" : value === null ? "明确留空" : format(value);
}
const sources: Record<string, string> = {
  user: "用户",
  "agent:director": "导演建议",
  "agent:action": "动作指导",
  "agent:performance": "表演指导",
  "agent:prompter": "画面说明建议",
  "agent:art": "美术建议",
};
function source(value: unknown) {
  if (typeof value !== "string" || !Object.hasOwn(sources, value)) reject();
  return sources[value]!;
}
function voice(value: unknown, scope: EditorSelection, declaration = false): string {
  const row = shape(
    value,
    declaration
      ? ["tone", "pace", "pauses", "emotion", "pause"]
      : ["tone", "pace", "pauses", "emotion"],
  );
  const labels: Record<string, string> = {
    tone: "音色语气",
    pace: "语速",
    pauses: "停顿",
    emotion: "情绪",
    pause: "停顿声明",
  };
  if (!declaration && ["tone", "pace", "pauses", "emotion"].some((key) => !Object.hasOwn(row, key)))
    reject();
  return (
    Object.keys(labels)
      .filter((key) => Object.hasOwn(row, key))
      .map((key) => `${labels[key]}：${nullable(row[key], (v) => safeText(v, scope))}`)
      .join("；") || "无声音声明"
  );
}
function person(value: unknown, scope: EditorSelection): string {
  const row = shape(value, [
    "declarations",
    "name",
    "emotion",
    "intensity",
    "face",
    "faceAt",
    "eyes",
    "gaze",
    "holdSeconds",
    "hands",
    "breath",
    "voice",
    "voiceAlternatives",
  ]);
  if (
    ["name", "emotion", "face", "faceAt", "eyes", "gaze", "hands", "breath", "voice"].some(
      (key) => !Object.hasOwn(row, key),
    )
  )
    reject();
  const lines = [`人物：${safeText(row.name, scope)}`, `情绪：${safeText(row.emotion, scope)}`];
  if (Object.hasOwn(row, "intensity")) {
    const n = row.intensity;
    if (n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10))
      reject();
    lines.push(`表演强度：${n === undefined ? "未设置" : n}`);
  }
  const faces = list(row.face).map((v) => safeText(v, scope)),
    at = list(row.faceAt).map((v) => (v === null ? "未指定" : seconds(v)));
  if (faces.length !== at.length) reject();
  lines.push(`表情：${faces.map((text, index) => `${text}（${at[index]}）`).join("；") || "无"}`);
  for (const [key, label] of [
    ["eyes", "眼神"],
    ["gaze", "视线"],
    ["hands", "手部"],
    ["breath", "呼吸"],
  ])
    lines.push(`${label}：${safeText(row[key!], scope)}`);
  if (Object.hasOwn(row, "holdSeconds")) lines.push(`停留：${nullable(row.holdSeconds, seconds)}`);
  lines.push(`声音：${voice(row.voice, scope)}`);
  if (Object.hasOwn(row, "voiceAlternatives"))
    lines.push(
      `备选声音：${nullable(
        row.voiceAlternatives,
        (v) =>
          list(v, 16)
            .map((item) => voice(item, scope))
            .join(" / ") || "无",
      )}`,
    );
  if (Object.hasOwn(row, "declarations"))
    lines.push(
      `来源声明：${nullable(row.declarations, (value) => {
        const declaration = shape(value, ["role", "holdS", "voice"]);
        if (!["primary", "other"].includes(String(declaration.role))) reject();
        return [
          declaration.role === "primary" ? "主要人物" : "其他人物",
          ...(Object.hasOwn(declaration, "holdS")
            ? [`时长：${nullable(declaration.holdS, seconds)}`]
            : []),
          ...(Object.hasOwn(declaration, "voice")
            ? [
                `声音：${nullable(declaration.voice, (v) => (Array.isArray(v) ? list(v, 16) : [v]).map((item) => voice(item, scope, true)).join(" / "))}`,
              ]
            : []),
        ].join("；");
      })}`,
    );
  return lines.join("\n");
}
function plan(value: unknown, scope: EditorSelection): string {
  const row = shape(value, [
    "binding",
    "sourceId",
    "unverifiedPeople",
    "timingWarnings",
    "people",
    "scopeCues",
    "promptAddon",
  ]);
  if (!Object.hasOwn(row, "people") || !Object.hasOwn(row, "promptAddon")) reject();
  const lines: string[] = [];
  if (Object.hasOwn(row, "binding")) {
    if (row.binding !== undefined && !["explicit", "scope-order"].includes(String(row.binding)))
      reject();
    lines.push(
      `对应方式：${row.binding === undefined ? "未设置" : row.binding === "explicit" ? "明确对应当前镜头" : "按请求中的人物范围对应"}`,
    );
  }
  if (Object.hasOwn(row, "sourceId")) {
    if (row.sourceId !== undefined && row.sourceId !== scope.shotId) reject();
    lines.push(`镜头来源对应：${row.sourceId === undefined ? "未设置" : "当前镜头"}`);
  }
  const people = list(row.people, 32).map((v) => person(v, scope));
  lines.push(`人物表演：${people.length ? "\n" + people.join("\n\n") : "无"}`);
  if (Object.hasOwn(row, "scopeCues"))
    lines.push(
      `范围表演提示：${nullable(
        row.scopeCues,
        (v) =>
          list(v, 32)
            .map((item) => person(item, scope))
            .join("\n\n") || "无",
      )}`,
    );
  lines.push(`表演补充：${safeText(row.promptAddon, scope)}`);
  if (Object.hasOwn(row, "unverifiedPeople"))
    lines.push(
      `待核对人物：${nullable(
        row.unverifiedPeople,
        (v) =>
          list(v, 32)
            .map((item) => safeText(item, scope))
            .join("、") || "无",
      )}`,
    );
  if (Object.hasOwn(row, "timingWarnings"))
    lines.push(
      `待核对时间：${nullable(
        row.timingWarnings,
        (v) =>
          list(v, 64)
            .map((item) => {
              const warning = shape(item, ["name", "field", "value"]);
              if (!["faceAt", "holdSeconds"].includes(String(warning.field))) reject();
              return `${safeText(warning.name, scope)}·${warning.field === "faceAt" ? "表情" : "停留"}：${seconds(warning.value)}`;
            })
            .join("；") || "无",
      )}`,
    );
  const text = lines.join("\n");
  if (text.length > 32768) reject();
  return text;
}
function state(value: unknown, scope: EditorSelection): string {
  const row = shape(value, ["voiceReviews", "unassigned"]);
  if (!Array.isArray(row.unassigned) || row.unassigned.length) reject();
  const reasons: Record<string, string> = {
    SPEAKER_UNSPECIFIED: "说话人待确认",
    MULTIPLE_SPEAKERS: "多人语气待核对",
    VOICE_NOT_UNIQUE: "声音对应待确认",
  };
  const reviews = Object.hasOwn(row, "voiceReviews")
    ? nullable(
        row.voiceReviews,
        (v) =>
          list(v, 32)
            .map((item) => {
              const review = shape(item, ["shotId", "reason"]);
              if (
                review.shotId !== scope.shotId ||
                typeof review.reason !== "string" ||
                !Object.hasOwn(reasons, review.reason)
              )
                reject();
              return `当前镜头：${reasons[review.reason]}`;
            })
            .join("；") || "无待核项",
      )
    : "未设置声音核对项";
  return `未分配表演：无\n声音核对：${reviews}`;
}
/** Full supported transaction or no field mode. Never pretty-print raw objects or recompute a live baseline. */
export function projectPerformanceFields(
  tx: ShotDirectionTransaction | undefined,
  origin: EditorSelection,
): SuggestionFieldRow[] | null {
  if (
    !tx ||
    tx.role !== "performance" ||
    tx.stateField !== "performanceState" ||
    !object(tx.input) ||
    !Array.isArray(tx.unsupported) ||
    tx.unsupported.length ||
    !Array.isArray(tx.changes) ||
    !Array.isArray(tx.beatsBefore) ||
    !Array.isArray(tx.beatsAfter) ||
    !object(tx.selection) ||
    !object(tx.stateBefore) ||
    !object(tx.stateAfter) ||
    !origin.projectId ||
    !origin.sceneId ||
    !origin.shotId ||
    !["board", "edit"].includes(origin.page) ||
    tx.selection.projectId !== origin.projectId ||
    tx.selection.page !== origin.page ||
    tx.selection.sceneId !== origin.sceneId ||
    tx.selection.shotId !== origin.shotId ||
    !equal(tx.beatsBefore, tx.beatsAfter)
  )
    return null;
  const labels: Record<string, string> = {
    performance: "表演说明",
    performancePlan: "表演计划",
    performanceSource: "表演来源",
    delivery: "配音语气",
    source: "镜头建议来源",
  };
  const rows = new Map<string, SuggestionFieldRow>();
  try {
    const cell = (
      raw: { present: boolean; value: unknown },
      format: (v: unknown) => string,
    ): string | null => {
      if (!raw || typeof raw.present !== "boolean") reject();
      if (!raw.present) {
        if (raw.value !== undefined) reject();
        return null;
      }
      return nullable(raw.value, format);
    };
    for (const change of tx.changes) {
      if (
        change.target.collection !== "shots" ||
        change.target.id !== origin.shotId ||
        !Object.hasOwn(labels, change.field) ||
        rows.has(change.field)
      )
        reject();
      const format = (v: unknown) =>
        change.field === "performancePlan"
          ? plan(v, origin)
          : ["source", "performanceSource"].includes(change.field)
            ? source(v)
            : safeText(v, origin);
      rows.set(change.field, {
        key: `performance-${change.field}`,
        label: labels[change.field]!,
        kind: !change.before.present ? "added" : !change.after.present ? "removed" : "changed",
        before: cell(change.before, format),
        after: cell(change.after, format),
      });
    }
    if (!equal(tx.stateBefore, tx.stateAfter))
      rows.set("performanceState", {
        key: "performance-state",
        label: "表演待核项",
        kind: !tx.stateBefore.present ? "added" : !tx.stateAfter.present ? "removed" : "changed",
        before: cell(tx.stateBefore, (v) => state(v, origin)),
        after: cell(tx.stateAfter, (v) => state(v, origin)),
      });
    return [...Object.keys(labels), "performanceState"].flatMap((key) =>
      rows.has(key) ? [rows.get(key)!] : [],
    );
  } catch {
    return null;
  }
}
