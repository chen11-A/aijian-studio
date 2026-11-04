import {
  normalizeGender,
  normalizeAgeBand,
  type CharacterGender,
  type CharacterAgeBand,
} from "./cast-traits";
import { normalizeAgentReply } from "./agent-reply-compat";
import { emptySoundPlan, shotSecondsForLine, type ShotSoundPlan } from "./audio";

/** Seven standard shot sizes. An insert is a tag, never a size. */
export const SHOT_SIZES = ["大远景", "远景", "全景", "中景", "近景", "特写", "大特写"] as const;

export const AGENTS = [
  "writer",
  "director",
  "action",
  "performance",
  "art",
  "prompter",
  "qc",
] as const;

export type AgentId = (typeof AGENTS)[number];

export const FILM_TEMPLATES: { id: string; name: string; text: string }[] = [
  {
    id: "rain-fight",
    name: "雨夜巷战打斗",
    text: "雨夜巷口。林骁拦住刀疤。刀疤说：东西交出来。林骁侧身让过铁棍，刀柄砸中对方手腕。铁棍落进积水。",
  },
  {
    id: "city-rise",
    name: "都市逆袭",
    text: "写字楼夜里只剩一层灯。周宁把辞职信放在桌上。老板说：你走不出这扇门。周宁拿走备份，电梯门开在一楼，雨停了。",
  },
  {
    id: "mystery-turn",
    name: "悬疑反转",
    text: "旧钟停在十一点。客人说自己看见了凶手。店主把灯关掉。镜子里的人不是客人，是店主自己。",
  },
];

export function classifyShotSize(raw: string): { size: string; tag: string } {
  const text = raw.trim();
  if ((SHOT_SIZES as readonly string[]).includes(text)) return { size: text, tag: "" };
  if (text.includes("插入")) return { size: text.includes("近") ? "近景" : "特写", tag: "插入" };
  for (const size of SHOT_SIZES) {
    if (text.includes(size)) return { size, tag: "" };
  }
  return { size: "中景", tag: text };
}

/** One fixed appearance sentence. Callers paste this string unchanged. */
export function identityLock(identity: string): string {
  const line = identity.replace(/\s+/g, " ").trim();
  if (!line) return "";
  return line.endsWith("。") ? line : `${line}。`;
}

export function gazeHandoff(names: string[]): string {
  const people = names.map((name) => name.trim()).filter(Boolean);
  if (people.length < 2) return "";
  const [left, right] = people;
  const rest = people.slice(2);
  const others = rest.length > 0 ? `${rest.join("、")}不抢视线。` : "";
  return `${left}在画左看向画右的${right}，${right}在画右看向画左的${left}。视线从${left}交到${right}。${others}`;
}

export function missingIdentityLocks(
  shots: { id: string; prompt: string; names: string[] }[],
  people: { name: string; identity: string }[],
): { shotId: string; name: string }[] {
  const misses: { shotId: string; name: string }[] = [];
  for (const shot of shots) {
    for (const person of people) {
      if (shot.names.length > 0 && !shot.names.includes(person.name)) continue;
      const lock = identityLock(person.identity);
      if (!lock) continue;
      if (!shot.prompt.includes(lock)) misses.push({ shotId: shot.id, name: person.name });
    }
  }
  return misses;
}

export function withIdentityLocks(
  prompt: string,
  people: { name: string; identity: string }[],
  names: string[],
): { prompt: string; missing: string[] } {
  let next = prompt.trim();
  if (next && !next.endsWith("。")) next += "。";
  const missing: string[] = [];
  for (const person of people) {
    if (names.length > 0 && !names.includes(person.name)) continue;
    const lock = identityLock(person.identity);
    if (!lock) continue;
    if (!next.includes(lock)) {
      missing.push(person.name);
      next += lock;
    }
  }
  const gaze = gazeHandoff(names);
  if (gaze && !next.includes("视线")) next += gaze;
  return { prompt: next, missing };
}

export type ScriptLine = { speaker: string; text: string };

/** Extract dialogue in source order. Quoted multi-sentence speech stays intact. */
export function extractScriptLines(source: string, known: readonly string[] = []): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const paragraph of source
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)) {
    const prefix = /^([\u4e00-\u9fff]{1,8}?)(?:说|道|问|喊|叫)?[：:]\s*/u.exec(paragraph);
    const label = prefix?.[1] ?? "";
    const isSpeaker = Boolean(
      prefix &&
      !/纸条|招牌|书名|标题|备注|旁注|说明|场景/u.test(label) &&
      (!known.length || known.includes(label) || /(?:说|道|问|喊|叫)[：:]/u.test(prefix[0])),
    );
    if (prefix && !isSpeaker) continue;
    const quoted = [...paragraph.matchAll(/[“「"]([^”」"\n]+)[”」"]/gu)];
    if (quoted.length) {
      for (const quote of quoted) {
        const text = quote[1] ?? "";
        const at = quote.index ?? 0;
        const before = paragraph.slice(0, at);
        const direct = isSpeaker || /(?:说|道|问|喊|叫|声音[^：:]{0,12})[：:]\s*$/u.test(before);
        if (!direct && !/[，。！？；：!?]/u.test(text) && at !== 0) continue;
        const speaker = isSpeaker
          ? label
          : (known.find(
              (name) =>
                paragraph.slice(at + quote[0].length).startsWith(name) ||
                before.endsWith(`${name}说：`),
            ) ?? "");
        lines.push({ speaker, text });
      }
      continue;
    }
    if (isSpeaker && prefix) {
      const raw = paragraph.slice(prefix[0].length);
      const text = raw.match(/^.*?[。！？!?]/u)?.[0] ?? raw;
      if (text.trim()) lines.push({ speaker: label, text: text.trim() });
    }
  }
  return lines;
}

export function lineInScript(sceneText: string, proposed: string): string {
  const line = proposed.replace(/\s+/g, " ").trim();
  if (!line || !sceneText.includes(line)) return "";
  return extractScriptLines(sceneText).some((spoken) => spoken.text.includes(line)) ? line : "";
}

function spokenLine(raw: string): string {
  return raw.trim().replace(/^[「“"']|[」”"']$/gu, "");
}

/** Lines from a scene's dialogue list: 已知人名：台词, or 人名说/道/问/喊/叫：台词.
 *  A quote or a caption such as 纸条： is not a line. */
export function scriptDialogue(
  sceneText: string,
  known: readonly string[] = [],
): { speaker: string; line: string }[] {
  const found: { speaker: string; line: string }[] = [];
  const seen = new Set<string>();
  const names = [...known.map((name) => name.trim()).filter((name) => name.length >= 2)].sort(
    (a, b) => b.length - a.length,
  );
  const push = (speaker: string, raw: string) => {
    const line = spokenLine(raw);
    if (!speaker || line.length < 2 || line.length > 80 || seen.has(`${speaker}\0${line}`)) return;
    if (!sceneText.includes(line)) return;
    if (names.length > 0 && !names.includes(speaker)) return;
    seen.add(`${speaker}\0${line}`);
    found.push({ speaker, line });
  };
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of sceneText.matchAll(new RegExp(`${escaped}[：:]\\s*([^\\n]{1,80})`, "g"))) {
      const raw = match[1] ?? "";
      const quoted = /^[「“"']([^」”"']+)[」”"']/u.exec(raw);
      push(name, quoted?.[1] ?? raw.match(/^.*?[。！？!?]/u)?.[0] ?? raw);
    }
  }
  for (const match of sceneText.matchAll(
    /([\u4e00-\u9fff]{2,4})(?:说|道|问|喊|叫)[：:]\s*[「“"']?([^「」“”"'\n]{1,80})/gu,
  )) {
    const raw = match[2] ?? "";
    push(
      (match[1] ?? "").trim(),
      /[「“"']/u.test(match[0]) ? raw : (raw.match(/^.*?[。！？!?]/u)?.[0] ?? raw),
    );
  }
  return found;
}

export function attachScriptLines<
  T extends { line: string; characters: string[]; picture: string; speaker?: string },
>(shots: T[], sceneText: string, known: readonly string[] = []): T[] {
  const names = new Set(
    [...known, ...shots.flatMap((shot) => shot.characters)]
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const next = shots.map((shot) => ({
    ...shot,
    line: lineInScript(sceneText, shot.line),
    characters: [...shot.characters],
  }));
  for (const spoken of scriptDialogue(sceneText, [...names])) {
    if (!names.has(spoken.speaker)) continue;
    if (next.some((shot) => shot.line.includes(spoken.line))) continue;
    const host = next.find((shot) => !shot.line.trim() && shot.characters.includes(spoken.speaker));
    if (!host) continue;
    host.line = spoken.line;
    host.speaker = spoken.speaker;
  }
  return next;
}

/** True when every scene is just a slice of the question, not a screenplay. */
export function scenesEchoRequest(scenes: { text: string }[], request: string): boolean {
  const asked = request.replace(/\s+/g, "");
  if (!asked || scenes.length === 0) return false;
  return scenes.every((scene) => {
    const body = scene.text.replace(/\s+/g, "").replace(/还没完。?$/, "");
    return body.length > 0 && (asked.includes(body) || body.includes(asked));
  });
}

export function difficultyLabel(raw: string): "稳" | "险" | "高危" {
  if (raw === "难" || raw === "高危") return "高危";
  if (raw === "看运气" || raw === "险") return "险";
  return "稳";
}

export const DIFFICULTY_LEGEND = "稳可以拍。险要碰运气。高危很难，得改拍法。";

/** A shot tag of 「人物」 is not a name. Use a real character, or 空镜. */
export function shotPerson(names: string[], picture: string, cast: string[]): string {
  const named = names.find((name) => name.trim() && name.trim() !== "人物");
  if (named) return named.trim();
  const found = cast.find((name) => name.trim() && picture.includes(name.trim()));
  return found?.trim() || "空镜";
}

export function appearanceMark(
  prompt: string,
  names: string[],
  people: { name: string; identity: string }[],
): "" | "外貌已锁" | "缺外貌" {
  const relevant = people.filter(
    (person) => person.identity.trim() && (names.length === 0 || names.includes(person.name)),
  );
  if (relevant.length === 0) return "";
  const missing = missingIdentityLocks([{ id: "shot", prompt, names }], relevant);
  return missing.length > 0 ? "缺外貌" : "外貌已锁";
}

export function parseLooseJson(text: string): unknown | null {
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = Math.min(
    ...["{", "["].map((mark) => {
      const at = raw.indexOf(mark);
      return at < 0 ? Number.POSITIVE_INFINITY : at;
    }),
  );
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (!Number.isFinite(start) || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export function agentIssues(agent: AgentId, value: unknown): string[] {
  if (agent === "director") {
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray((value as { shots?: unknown }).shots)
    ) {
      return ["导演结果里没有镜头"];
    }
    return [];
  }
  if (agent === "writer") {
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray((value as { scenes?: unknown }).scenes)
    ) {
      return ["编剧结果里没有场次"];
    }
    return [];
  }
  if (agent === "action") {
    const beats = value && typeof value === "object" ? (value as { beats?: unknown }).beats : null;
    const shots = value && typeof value === "object" ? (value as { shots?: unknown }).shots : null;
    const nodes =
      Array.isArray(shots) &&
      shots.some(
        (shot) =>
          Boolean(shot) &&
          typeof shot === "object" &&
          Array.isArray((shot as { nodes?: unknown }).nodes) &&
          ((shot as { nodes?: unknown[] }).nodes?.length ?? 0) > 0,
      );
    if ((!Array.isArray(beats) || beats.length === 0) && !nodes) return ["动作结果里没有拍"];
    return [];
  }
  if (agent === "performance") {
    const rows = Array.isArray(value)
      ? value
      : value && typeof value === "object" && Array.isArray((value as { shots?: unknown }).shots)
        ? (value as { shots: unknown[] }).shots
        : null;
    if (!rows || rows.length === 0) return ["表演结果里没有镜头"];
    return [];
  }
  if (agent === "art" || agent === "prompter" || agent === "qc") {
    if (!value || typeof value !== "object") return ["结果不是 JSON"];
    return [];
  }
  return ["没有这个智能体"];
}

type ActionRow = {
  text: string;
  feasibility: "稳" | "看运气" | "难";
  workaround: string;
  at: number;
  shotId?: string;
};

function actionText(row: Record<string, unknown>): string {
  // Normalize once before assignment and rejection filtering, so sound cues and card notes
  // cannot retain raw internal prefixes or bypass comparison with sanitized unassigned beats.
  if (typeof row.text === "string" && row.text.trim()) return plainCue(row.text);
  return plainCue(
    [row.actor, row.move, row.target, row.body_part, row.direction, row.reaction]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join("，"),
  );
}

export function actionFromModel(value: unknown): ActionRow[] | null {
  value = normalizeAgentReply("action", value);
  if (agentIssues("action", value).length > 0 || !value || typeof value !== "object") return null;
  const rows: ActionRow[] = [];
  const nodeRows = new Map<string, number>();
  const push = (row: Record<string, unknown>, shotId = "") => {
    const text = actionText(row);
    if (!text) return;
    const feasibility =
      row.feasibility === "难" || row.feasibility === "看运气" ? row.feasibility : "稳";
    if (typeof row.node_id === "string" && row.node_id && !nodeRows.has(row.node_id))
      nodeRows.set(row.node_id, rows.length);
    rows.push({
      text,
      feasibility,
      workaround: typeof row.workaround === "string" ? row.workaround.trim() : "",
      at: typeof row.at_seconds === "number" ? row.at_seconds : rows.length,
      ...(shotId ? { shotId } : {}),
    });
  };
  const shots = (value as { shots?: unknown }).shots;
  if (Array.isArray(shots)) {
    for (const shot of shots) {
      if (!shot || typeof shot !== "object") continue;
      const record = shot as Record<string, unknown>;
      const shotId =
        typeof record.shot_id === "string"
          ? record.shot_id
          : typeof record.id === "string"
            ? record.id
            : "";
      const nodes = Array.isArray(record.nodes) ? record.nodes : [];
      for (const node of nodes) {
        if (node && typeof node === "object") push(node as Record<string, unknown>, shotId);
      }
    }
  }
  const beats = (value as { beats?: unknown }).beats;
  if (Array.isArray(beats) && beats.length > 0) {
    for (const item of beats) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const text = actionText(row);
      if (!text) continue;
      const feasibility =
        row.feasibility === "难" || row.feasibility === "看运气" ? row.feasibility : "稳";
      const shotId =
        typeof row.shot_id === "string"
          ? row.shot_id.trim()
          : typeof row.id === "string"
            ? row.id.trim()
            : "";
      const existing = typeof row.node_id === "string" ? nodeRows.get(row.node_id) : undefined;
      if (existing !== undefined) {
        const node = rows[existing]!;
        node.text = node.text.includes(text)
          ? node.text
          : text.includes(node.text)
            ? text
            : `${text}，${node.text}`;
        node.feasibility = feasibility;
        node.workaround =
          typeof row.workaround === "string" ? row.workaround.trim() : node.workaround;
        continue;
      }
      rows.push({
        ...(shotId ? { shotId } : {}),
        text,
        feasibility,
        workaround: typeof row.workaround === "string" ? row.workaround.trim() : "",
        at: typeof row.at_seconds === "number" ? row.at_seconds : rows.length,
      });
    }
  }
  return rows.length > 0 ? rows : null;
}

export function actionSentence(rows: ActionRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.text}（${row.feasibility}${row.workaround ? `，${row.workaround}` : ""}，来自动作指导）`,
    )
    .join("");
}

export function performanceFromModel(value: unknown, names: string[]): string | null {
  if (agentIssues("performance", value).length > 0) return null;
  const rows = Array.isArray(value) ? value : ((value as { shots?: unknown[] }).shots ?? []);
  const parts: string[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const face = Array.isArray(row.face)
      ? row.face.filter((part) => typeof part === "string").join("、")
      : "";
    const eyes = typeof row.eyes === "string" ? row.eyes.trim() : "";
    const emotion = typeof row.emotion === "string" ? row.emotion.trim() : "";
    const hands = typeof row.hands === "string" ? row.hands.trim() : "";
    const breath =
      typeof row.breath === "string"
        ? row.breath.trim()
        : typeof row.pause === "string"
          ? row.pause.trim()
          : "";
    const bit = [emotion, face, eyes, hands, breath].filter(Boolean).join("，");
    if (bit) parts.push(bit);
  }
  if (parts.length === 0) return null;
  const gaze = gazeHandoff(names);
  const text = parts.join("。");
  return gaze && !text.includes("视线") ? `${text}。${gaze}` : text;
}

function performanceRows(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value) ? value : ((value as { shots?: unknown[] }).shots ?? []);
  return rows.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
  );
}

/** Turn model field names into words a person can read. */
export function plainCue(text: string): string {
  return text
    .replace(
      /\bhold_(?:seconds|s)\b[ \t]*[:=：]?[ \t]*([^\s,，;；。！？]*)/gi,
      (_field, raw: string) => {
        if (!raw || /^(?:null|undefined|none)$/i.test(raw)) return "";
        if (/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw) && Number.isFinite(Number(raw)))
          return `停 ${raw} 秒`;
        return "停顿时间未指定";
      },
    )
    .replace(/([，,；;])(?:\s*[，,；;])+/gu, "$1")
    .replace(/^[\s，,；;]+|[\s，,；;]+$/gu, "")
    .replace(/保留原文\s*[:：]\s*/gu, "")
    .replace(/。{2,}/gu, "。")
    .replace(
      /\b(shot_id|scene_id|at_seconds|feasibility|workaround|micro_expressions)\b\s*[:=：]?\s*/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function spokenBit(value: string): string {
  const text = plainCue(value);
  return /^(无|无台词|无配音|空|没有)$/.test(text) ? "" : text;
}

function notePieces(row: Record<string, unknown>): string[] {
  const people = Array.isArray(row.performances) ? row.performances : [row];
  const bits: string[] = [];
  for (const person of people) {
    if (!person || typeof person !== "object") continue;
    const item = person as Record<string, unknown>;
    const face = Array.isArray(item.micro_expressions)
      ? item.micro_expressions
          .map((part) =>
            typeof part === "string"
              ? part
              : part &&
                  typeof part === "object" &&
                  typeof (part as { text?: unknown }).text === "string"
                ? (part as { text: string }).text
                : "",
          )
          .filter(Boolean)
          .join("、")
      : Array.isArray(item.face)
        ? item.face.filter((part) => typeof part === "string").join("、")
        : "";
    const eyes =
      item.eyes && typeof item.eyes === "object"
        ? [
            typeof (item.eyes as { gaze?: unknown }).gaze === "string"
              ? (item.eyes as { gaze: string }).gaze
              : "",
            typeof (item.eyes as { hold_seconds?: unknown }).hold_seconds === "number"
              ? `停 ${(item.eyes as { hold_seconds: number }).hold_seconds} 秒`
              : "",
          ]
            .filter(Boolean)
            .join("，")
        : typeof item.eyes === "string"
          ? item.eyes
          : "";
    const emotion = typeof item.emotion === "string" ? item.emotion : "";
    const hands = typeof item.hands === "string" ? item.hands : "";
    const breath = typeof item.breath === "string" ? item.breath : "";
    bits.push([emotion, face, eyes, hands, breath].map(spokenBit).filter(Boolean).join("，"));
  }
  return bits.filter(Boolean);
}

function noteFromRow(
  row: Record<string, unknown>,
  names: string[],
): { performance: string; delivery: string } {
  const bit = notePieces(row).join("。");
  const emotion = typeof row.emotion === "string" ? row.emotion : "";
  const gaze = gazeHandoff(names);
  const performance = bit ? (gaze && !bit.includes("视线") ? `${bit}。${gaze}` : bit) : "";
  const nested = Array.isArray(row.performances) ? row.performances : [];
  const nestedVoice = nested
    .map((person) =>
      person && typeof person === "object" ? (person as { voice?: unknown }).voice : undefined,
    )
    .find((voice) => voice && typeof voice === "object");
  const voice = (Array.isArray(nestedVoice) ? nestedVoice[0] : nestedVoice) as
    Record<string, unknown> | undefined;
  const voiceRow =
    voice && typeof voice === "object"
      ? voice
      : row.voice && typeof row.voice === "object"
        ? (row.voice as Record<string, unknown>)
        : row;
  const tone = spokenBit(typeof voiceRow.tone === "string" ? voiceRow.tone : "");
  const pace = spokenBit(typeof voiceRow.pace === "string" ? voiceRow.pace : "");
  const pauses = spokenBit(
    typeof voiceRow.pauses === "string"
      ? voiceRow.pauses
      : typeof voiceRow.pause === "string"
        ? voiceRow.pause
        : "",
  );
  const voiceEmotion = spokenBit(typeof voiceRow.emotion === "string" ? voiceRow.emotion : "");
  const delivery = [
    tone ? `语气${tone}` : "",
    pace ? `语速${pace}` : "",
    pauses ? `停顿${pauses}` : "",
    voiceEmotion && voiceEmotion !== emotion ? `情绪${voiceEmotion}` : "",
  ]
    .filter(Boolean)
    .join("，");
  return { performance, delivery };
}

/** Map a performance reply onto our shot ids. Unknown ids fall back to order. */
export function assignPerformance(
  value: unknown,
  shots: { id: string }[],
  names: string[] = [],
): { id: string; performance: string; delivery: string }[] {
  const rows = performanceRows(value);
  const used = new Set<number>();
  return shots.map((shot, index) => {
    const found = rows.findIndex((row, rowIndex) => {
      if (used.has(rowIndex)) return false;
      const id =
        typeof row.shot_id === "string" ? row.shot_id : typeof row.id === "string" ? row.id : "";
      return id === shot.id;
    });
    const rowIndex = found >= 0 ? found : !used.has(index) && rows[index] ? index : -1;
    if (rowIndex >= 0) used.add(rowIndex);
    const row = rowIndex >= 0 ? rows[rowIndex] : undefined;
    const note = row ? noteFromRow(row, names) : { performance: "", delivery: "" };
    return { id: shot.id, ...note };
  });
}

/** Tone, pace, pauses and emotion for the line. Empty when the model did not write them. */
export function voiceDirectionFromModel(value: unknown): string {
  if (agentIssues("performance", value).length > 0) return "";
  const parts: string[] = [];
  for (const row of performanceRows(value)) {
    const voice =
      row.voice && typeof row.voice === "object" ? (row.voice as Record<string, unknown>) : row;
    const tone = typeof voice.tone === "string" ? voice.tone.trim() : "";
    const pace = typeof voice.pace === "string" ? voice.pace.trim() : "";
    const pauses =
      typeof voice.pauses === "string"
        ? voice.pauses.trim()
        : typeof voice.pause === "string"
          ? voice.pause.trim()
          : "";
    const emotion = typeof voice.emotion === "string" ? voice.emotion.trim() : "";
    const bit = [
      tone ? `语气${tone}` : "",
      pace ? `语速${pace}` : "",
      pauses ? `停顿${pauses}` : "",
      emotion ? `情绪${emotion}` : "",
    ]
      .filter(Boolean)
      .join("，");
    if (bit) parts.push(bit);
  }
  return parts.join("。");
}

/** Speech tags and speed the TTS API documents. Unsupported directions stay out of the request. */
export function directedSpeech(line: string, delivery: string): { text: string; speed: number } {
  const spoken = line.trim();
  const note = delivery.trim();
  if (!spoken) return { text: "", speed: 1 };
  let speed = 1;
  if (/语速慢|语速：慢/.test(note)) speed = 0.85;
  else if (/语速快|语速：快/.test(note)) speed = 1.2;
  let text = spoken;
  if (/停|顿/.test(note) && !text.includes("[pause]")) text = `[pause] ${text}`;
  if (/吸气|换气/.test(note) && !text.includes("[inhale]")) text = `[inhale] ${text}`;
  if (/耳语|轻声|低声/.test(note) && !text.includes("<whisper>")) {
    text = `<whisper>${text}</whisper>`;
  }
  return { text, speed };
}

export function artFromModel(value: unknown): {
  styleZh: string;
  identities: {
    name: string;
    identity: string;
    gender?: CharacterGender;
    ageBand?: CharacterAgeBand;
  }[];
  places: { name: string; prompt: string; ambience: string; layout?: string }[];
  props: { name: string; note: string }[];
  lines: string[];
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const styleZh = typeof row.prompt_block_zh === "string" ? row.prompt_block_zh.trim() : "";
  const identities = Array.isArray(row.identities)
    ? row.identities.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const person = item as Record<string, unknown>;
        const name = typeof person.name === "string" ? person.name.trim() : "";
        const identity =
          typeof person.identity === "string"
            ? person.identity.trim()
            : typeof person.identity_block_en === "string"
              ? person.identity_block_en.trim()
              : "";
        const gender = normalizeGender(person.gender);
        const ageBand = normalizeAgeBand(person.ageBand ?? person.age_band);
        return name && (identity || gender || ageBand)
          ? [{ name, identity, ...(gender ? { gender } : {}), ...(ageBand ? { ageBand } : {}) }]
          : [];
      })
    : [];
  const places = Array.isArray(row.locations)
    ? row.locations.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const place = item as Record<string, unknown>;
        const name = typeof place.name === "string" ? place.name.trim() : "";
        if (!name) return [];
        return [
          {
            name,
            prompt: typeof place.prompt === "string" ? place.prompt.trim() : "",
            ambience: typeof place.ambience === "string" ? place.ambience.trim() : "",
            ...(typeof place.layout === "string" ? { layout: place.layout.trim() } : {}),
          },
        ];
      })
    : [];
  const props = Array.isArray(row.props)
    ? row.props.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const prop = item as Record<string, unknown>;
        const name = typeof prop.name === "string" ? prop.name.trim() : "";
        if (!name) return [];
        return [{ name, note: typeof prop.note === "string" ? prop.note.trim() : "" }];
      })
    : [];
  const lines = [
    styleZh ? `画风：${styleZh}` : "",
    ...identities.map((item) => `${item.name}：${identityLock(item.identity)}`),
    ...places.map((item) => `场景 ${item.name}`),
    ...props.map((item) => `道具 ${item.name}`),
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return { styleZh, identities, places, props, lines };
}

export function prompterFromModel(value: unknown): { zh: string; en: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const keyframe = row.keyframe;
  const zh =
    keyframe &&
    typeof keyframe === "object" &&
    typeof (keyframe as { prompt_zh?: unknown }).prompt_zh === "string"
      ? (keyframe as { prompt_zh: string }).prompt_zh.trim()
      : typeof row.prompt_zh === "string"
        ? row.prompt_zh.trim()
        : "";
  const en =
    keyframe &&
    typeof keyframe === "object" &&
    typeof (keyframe as { prompt_en?: unknown }).prompt_en === "string"
      ? (keyframe as { prompt_en: string }).prompt_en.trim()
      : "";
  if (!zh && !en) return null;
  return { zh, en };
}

export function qcFromModel(value: unknown): { lines: string[]; verdict: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const verdict = typeof row.verdict === "string" ? row.verdict.trim() : "";
  const issues = Array.isArray(row.issues)
    ? row.issues.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  if (!verdict && issues.length === 0) return null;
  return {
    verdict,
    lines: [verdict ? `审片意见：${verdict}` : "", ...issues].filter(Boolean),
  };
}

export function soundFromDirector(
  record: Record<string, unknown>,
  ambience: string,
): ShotSoundPlan {
  const sound = record.sound;
  const row = sound && typeof sound === "object" ? (sound as Record<string, unknown>) : record;
  const sfxRaw = Array.isArray(row.sfx) ? row.sfx : [];
  const sfx = sfxRaw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const cue = item as Record<string, unknown>;
    const text = typeof cue.text === "string" ? cue.text.trim() : "";
    if (!text) return [];
    const at =
      typeof cue.at_seconds === "number"
        ? cue.at_seconds
        : typeof cue.atSeconds === "number"
          ? cue.atSeconds
          : 0;
    return [{ atSeconds: at, text }];
  });
  const music =
    typeof row.musicMood === "string"
      ? row.musicMood
      : typeof row.music === "string"
        ? row.music
        : typeof record.music === "string"
          ? record.music
          : "";
  const place =
    typeof row.ambience === "string" && row.ambience.trim() ? row.ambience.trim() : ambience;
  const source = row.source === "dub" || record.audio === "dub" ? "dub" : "native";
  return { ...emptySoundPlan(place), source, sfx, musicMood: music.trim() };
}

export function speechSeconds(line: string, measured: number | null): number {
  if (measured !== null && measured > 0) return measured;
  const chars = [...line.replace(/\s+/g, "")].length;
  return chars > 0 ? chars / 4 : 0;
}

export function splitSpokenLine(line: string): [string, string] | null {
  const text = line.trim();
  const matched = text.match(/^(.{2,}?[。！？；;])\s*(.+)$/);
  if (matched?.[1] && matched[2]) return [matched[1].trim(), matched[2].trim()];
  if ([...text].length < 8) return null;
  const mid = Math.ceil([...text].length / 2);
  const chars = [...text];
  return [chars.slice(0, mid).join(""), chars.slice(mid).join("")];
}

export function durationFromSpeech(
  lineSeconds: number,
  directorSeconds: number,
): { seconds: number; fits: boolean; note: string } {
  const plan = shotSecondsForLine(lineSeconds, directorSeconds);
  if (!(lineSeconds > 0))
    return { seconds: plan.seconds, fits: true, note: "这一镜没有台词，时长保持导演的选择。" };
  if (!plan.fits) {
    return { seconds: plan.seconds, fits: false, note: "这句话超过 15 秒，要拆成两镜。" };
  }
  return { seconds: plan.seconds, fits: true, note: `按配音长度，这一镜定为 ${plan.seconds} 秒。` };
}
