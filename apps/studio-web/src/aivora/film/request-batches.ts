import { agentRequest } from "./project";
import { parseLooseJson, type AgentId } from "./phase2";

/** Includes the system instructions, context, and per-batch instructions. */
export const TEXT_REQUEST_LIMIT = 8_000;
export type BatchReply = { text: string | null; detail: string; code?: string };
export type RequestBatch = { text: string; source: string; index: number; total: number };

/** Split at paragraph/sentence boundaries where possible, never trim or drop a character. */
export function splitSourceText(source: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error("Invalid text batch limit");
  const chunks: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    let end = Math.min(offset + limit, source.length);
    if (end < source.length) {
      const window = source.slice(offset, end);
      const paragraph = window.lastIndexOf("\n");
      const sentence = Math.max(
        ...["。", "！", "？", "；"].map((mark) => window.lastIndexOf(mark)),
      );
      const boundary = paragraph >= limit / 2 ? paragraph : sentence;
      if (boundary >= limit / 2) end = offset + boundary + 1;
      // Do not split a UTF-16 surrogate pair (e.g. an emoji).
      const previous = source.charCodeAt(end - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) end -= 1;
    }
    chunks.push(source.slice(offset, end));
    offset = end;
  }
  return chunks;
}

const BATCH_RULE =
  "本次只处理本批原文，保留原段号和场次 id，逐句按顺序保留台词和结尾，不重复其他批次。返回与单次请求相同的完整 JSON 结构。";

export function agentRequestBatches(
  agent: AgentId,
  context: string,
  instruction: string,
): RequestBatch[] {
  const original = agentRequest(agent, context, instruction);
  if (original.length <= TEXT_REQUEST_LIMIT)
    return [{ text: original, source: context, index: 0, total: 1 }];

  // Repeat the small identity/style header, but keep the novel only in the source slice.
  const marker = /(?:原文段落|剧本|正文)：\n/u.exec(context);
  let header = marker ? context.slice(0, marker.index + marker[0].length) : "";
  let source = marker ? context.slice(marker.index + marker[0].length) : context;
  let user = instruction;
  const envelope = () => agentRequest(agent, header, `${user}\n${BATCH_RULE}`).length + 100;
  if (envelope() > TEXT_REQUEST_LIMIT / 2) {
    // Large cast/style/user context is content too: include it once instead of rejecting it.
    source = `${context}\n\n用户要求：\n${instruction}`;
    header = "";
    user = "按你的职责处理本批内容。";
  }
  const chunks = splitSourceText(source, TEXT_REQUEST_LIMIT - envelope());
  let offset = 0;
  return chunks.map((part, index) => {
    const preceding = source.slice(0, offset);
    const paragraph = [...preceding.matchAll(/\[(P\d+)\]/g)].at(-1)?.[1];
    const continuing =
      paragraph && !/^\s*\[P\d+\]/u.test(part)
        ? `本批开头继续原段 [${paragraph}]，不要重新编号。\n`
        : "";
    offset += part.length;
    return {
      text: agentRequest(
        agent,
        `${header}${continuing}${part}`,
        `${user}\n${BATCH_RULE}\n批次 ${index + 1}/${chunks.length}。`,
      ),
      source: part,
      index,
      total: chunks.length,
    };
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Keep every batch in source order. Never concatenate JSON documents or retain only the first. */
export function combineAgentBatchReplies(
  agent: AgentId,
  replies: string[],
  sceneId = "",
): string | null {
  if (replies.length === 1) return replies[0] ?? null;
  const values = replies.map(parseLooseJson);
  if (
    agent === "writer" &&
    !values.some((value) => record(value) && ("characters" in value || "locations" in value))
  ) {
    const scenes: unknown[] = [];
    for (const value of values) {
      const rows = Array.isArray(value) ? value : record(value) ? value.scenes : null;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      scenes.push(...rows);
    }
    return JSON.stringify({ scenes });
  }
  if (agent === "director") {
    const scenes: unknown[] = [];
    const shots: unknown[] = [];
    let hasScenes = false;
    for (const value of values) {
      if (record(value) && Array.isArray(value.scenes) && value.scenes.length) {
        hasScenes = true;
        scenes.push(...value.scenes);
      } else if (record(value) && Array.isArray(value.shots) && value.shots.length) {
        if (typeof value.scene_id === "string" && value.scene_id) hasScenes = true;
        shots.push(...value.shots);
        scenes.push({ ...value, scene_id: value.scene_id ?? sceneId });
      } else if (Array.isArray(value) && value.length) {
        shots.push(...value);
        scenes.push({ scene_id: sceneId, shots: value });
      } else return null;
    }
    return JSON.stringify(hasScenes ? { scenes } : { shots });
  }
  // Preserve all array records for action/performance/cast schemas. Named cast entries
  // are merged only when their fields agree; conflicting traits require a new reply.
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (!record(value)) return null;
    for (const [key, item] of Object.entries(value)) {
      const previous = merged[key];
      if (previous === undefined) merged[key] = item;
      else if (Array.isArray(previous) && Array.isArray(item)) merged[key] = [...previous, ...item];
      else if (JSON.stringify(previous) !== JSON.stringify(item)) return null;
    }
  }
  if (!Object.values(merged).some(Array.isArray)) return null;
  for (const key of ["characters", "locations"]) {
    const rows = merged[key];
    if (!Array.isArray(rows)) continue;
    const unique = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      if (!record(row) || typeof row.name !== "string") return null;
      const old = unique.get(row.name);
      if (!old) {
        unique.set(row.name, { ...row });
        continue;
      }
      for (const [field, value] of Object.entries(row)) {
        if (!old[field]) old[field] = value;
        else if (value && old[field] !== value) {
          if (field === "identity" || field === "prompt")
            old[field] = `${String(old[field])}\n${String(value)}`;
          else return null;
        }
      }
    }
    merged[key] = [...unique.values()];
  }
  return JSON.stringify(merged);
}

export async function completeAgentBatched(
  agent: AgentId,
  context: string,
  instruction: string,
  execute: (text: string) => Promise<BatchReply>,
): Promise<BatchReply> {
  const batches = agentRequestBatches(agent, context, instruction);
  const replies: string[] = [];
  for (const batch of batches) {
    const reply = await execute(batch.text);
    if (reply.text === null) return reply;
    replies.push(reply.text);
  }
  const sceneId = /场次 id：([^\n]+)/u.exec(context)?.[1]?.trim() ?? "";
  const combined = combineAgentBatchReplies(agent, replies, sceneId);
  return combined === null
    ? { text: null, code: "BATCH_RESPONSE_INVALID", detail: "分批结果格式不完整。" }
    : { text: combined, detail: "" };
}
