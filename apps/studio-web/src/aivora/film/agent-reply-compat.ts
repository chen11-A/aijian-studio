export type ReplyRole = "writer" | "director" | "action" | "performance";

/** Normalize envelopes only: retain all fields and never invent identity or positional matches. */
export function normalizeAgentReply(
  role: ReplyRole,
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value)) return value as Record<string, unknown>;
  if (role === "writer") return { scenes: value };
  if (role === "director") {
    return value.some((row) => row && typeof row === "object" && Array.isArray(row.shots))
      ? { scenes: value }
      : { shots: value };
  }
  if (role === "performance") return { shots: value };
  const shots: unknown[] = [];
  const beats: unknown[] = [];
  for (const row of value) {
    if (row && typeof row === "object" && Array.isArray(row.nodes)) shots.push(row);
    else beats.push(row);
  }
  return { shots, beats };
}

/** Accept an object or array inside optional prose/fences, without stripping nested envelopes. */
export function parseAgentReplyText(role: ReplyRole, text: string): Record<string, unknown> | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const end = text.lastIndexOf(text[start] === "[" ? "]" : "}");
  if (end <= start) return null;
  try {
    return normalizeAgentReply(role, JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}
