import type { EditorSelection } from "./editor-context";
export const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function reject(): never {
  throw Error("UNSUPPORTED_DIRECTION_DISPLAY");
}
export function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = object(value);
  if (!row || Object.keys(row).some((key) => !keys.includes(key))) reject();
  return row;
}
export function safeText(value: unknown, scope: EditorSelection): string {
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
export function list(value: unknown, max = 64): unknown[] {
  if (!Array.isArray(value) || value.length > max) reject();
  return value;
}
export function seconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 36000) reject();
  return `${value} 秒（建议时间）`;
}
export function nullable(value: unknown, format: (v: unknown) => string): string {
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
export function source(value: unknown) {
  if (typeof value !== "string" || !Object.hasOwn(sources, value)) reject();
  return sources[value]!;
}
