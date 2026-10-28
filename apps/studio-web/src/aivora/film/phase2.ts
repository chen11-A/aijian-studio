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

export function lineInScript(sceneText: string, proposed: string): string {
  const line = proposed.replace(/\s+/g, " ").trim();
  if (!line || !sceneText.includes(line)) return "";
  return line;
}

/** Spoken lines already written in the scene. The shot copies the same characters. */
export function scriptDialogue(sceneText: string): { speaker: string; line: string }[] {
  const found: { speaker: string; line: string }[] = [];
  const seen = new Set<string>();
  const add = (speaker: string, raw: string) => {
    const line = raw
      .replace(/\s+/g, "")
      .replace(/^[「“"']+/, "")
      .replace(/[」”"'。！？…]+$/, "");
    if (line.length < 2 || line.length > 40 || seen.has(line) || !sceneText.includes(line)) return;
    seen.add(line);
    found.push({ speaker: speaker.trim(), line });
  };
  for (const match of sceneText.matchAll(
    /([\u4e00-\u9fffA-Za-z]{1,12})(?:说|道|问|喊|叫)?[：:]\s*[「“"']?([^「」“”"'\n。！？]{1,40})/g,
  )) {
    const speaker = (match[1] ?? "").replace(/(?:说|道|问|喊|叫)$/, "");
    add(speaker, match[2] ?? "");
  }
  for (const match of sceneText.matchAll(/[「“"]([^「」“”"]{1,40})[」”"]/g))
    add("", match[1] ?? "");
  return found;
}

export function attachScriptLines<
  T extends { line: string; characters: string[]; picture: string },
>(shots: T[], sceneText: string): T[] {
  const next = shots.map((shot) => ({ ...shot, characters: [...shot.characters] }));
  for (const spoken of scriptDialogue(sceneText)) {
    if (next.some((shot) => shot.line.includes(spoken.line))) continue;
    const host =
      next.find(
        (shot) =>
          !shot.line.trim() &&
          (!spoken.speaker ||
            shot.characters.includes(spoken.speaker) ||
            shot.picture.includes(spoken.speaker)),
      ) ?? next.find((shot) => !shot.line.trim());
    if (!host) continue;
    host.line = spoken.line;
    if (spoken.speaker && !host.characters.includes(spoken.speaker))
      host.characters.push(spoken.speaker);
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
    if (!Array.isArray(beats) || beats.length === 0) return ["动作结果里没有拍"];
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
};

export function actionFromModel(value: unknown): ActionRow[] | null {
  if (agentIssues("action", value).length > 0 || !value || typeof value !== "object") return null;
  const beats = (value as { beats?: unknown }).beats;
  if (!Array.isArray(beats)) return null;
  const rows: ActionRow[] = [];
  for (const item of beats) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    const feasibility =
      row.feasibility === "难" || row.feasibility === "看运气" ? row.feasibility : "稳";
    rows.push({
      text,
      feasibility,
      workaround: typeof row.workaround === "string" ? row.workaround.trim() : "",
      at: typeof row.at_seconds === "number" ? row.at_seconds : rows.length,
    });
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
    const bit = [emotion, face, eyes].filter(Boolean).join("，");
    if (bit) parts.push(bit);
  }
  if (parts.length === 0) return null;
  const gaze = gazeHandoff(names);
  const text = parts.join("。");
  return gaze && !text.includes("视线") ? `${text}。${gaze}` : text;
}

export function artFromModel(value: unknown): {
  styleZh: string;
  identities: { name: string; identity: string }[];
  places: { name: string; prompt: string; ambience: string }[];
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
        return name && identity ? [{ name, identity }] : [];
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
