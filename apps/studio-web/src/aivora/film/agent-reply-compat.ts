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

/** Performance compatibility only: exact identities first, then a provable one-to-one scope. */
export function bindPerformanceRows(
  sourceIds: string[],
  targetIds: string[],
): {
  sourceId: string;
  targetId?: string;
  binding?: "explicit" | "scope-order";
  reason?: "UNKNOWN_SHOT" | "DUPLICATE_SHOT";
}[] {
  const repeated = new Set(sourceIds.filter((id, index) => id && sourceIds.indexOf(id) !== index));
  const validScope = new Set(targetIds).size === targetIds.length;
  const used = new Set<string>();
  const bindings = sourceIds.map((sourceId) => {
    if (repeated.has(sourceId)) return { sourceId, reason: "DUPLICATE_SHOT" as const };
    if (validScope && sourceId && targetIds.includes(sourceId)) {
      used.add(sourceId);
      return { sourceId, targetId: sourceId, binding: "explicit" as const };
    }
    return { sourceId, reason: "UNKNOWN_SHOT" as const };
  });
  if (validScope && repeated.size === 0 && sourceIds.length === targetIds.length) {
    const remaining = targetIds.filter((id) => !used.has(id));
    let cursor = 0;
    return bindings.map((row) =>
      row.targetId
        ? row
        : {
            sourceId: row.sourceId,
            targetId: remaining[cursor++]!,
            binding: "scope-order" as const,
          },
    );
  }
  return bindings;
}
