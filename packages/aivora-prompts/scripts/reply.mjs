import { validate } from "./json-schema.mjs";

/**
 * Parses a model reply the way the app should: one JSON.parse on the whole text.
 * Code fences, leading or trailing prose, and anything that is not a single JSON value of the
 * schema's top-level type (an object, or an array for the performance role) are rejected instead
 * of being repaired, so a failed reply can be retried or replaced.
 * Returns { ok: true, value } or { ok: false, reason, errors }.
 */
export function parseReply(text, schema) {
  if (typeof text !== "string") return { ok: false, reason: "回复不是文字", errors: [] };
  const body = text.trim();
  const [open, close, kind] = schema.type === "array" ? ["[", "]", "数组"] : ["{", "}", "对象"];
  if (!body.startsWith(open) || !body.endsWith(close)) {
    return {
      ok: false,
      reason: `回复不是以 ${open} 开头、以 ${close} 结尾的单个 JSON ${kind}`,
      errors: [],
    };
  }
  let value;
  try {
    value = JSON.parse(body);
  } catch (error) {
    return { ok: false, reason: `JSON 解析失败：${error.message}`, errors: [] };
  }
  const errors = validate(schema, value);
  if (errors.length > 0) return { ok: false, reason: "JSON 不符合输出结构", errors };
  return { ok: true, value };
}
