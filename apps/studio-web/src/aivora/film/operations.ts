import { VIDEO_DRAFT_MODEL, VIDEO_MODEL } from "../pro/capabilities";
import { emptySoundPlan } from "./audio";
import {
  keyframePrompt,
  shotIdentity,
  type FilmCharacter,
  type FilmJob,
  type FilmLocation,
  type FilmProject,
  type FilmScene,
  type FilmShot,
} from "./project";

export const QC_REASON = "审片还不能看图打分。版本由你来选，不会自动重做。";
export const PORTRAIT_REASON = "请打开安装好的 AIVORA 再出图。";
export const CONTINUITY_REASON =
  "这一镜会接着上一镜的结尾来写。生成时不会把上一镜的最后一帧传过去。";
export const PREVIEW_REASON =
  "单独试听还没接到语音接口。选定的声音会用在成片配音里，这一页不播放。";
export const LOUDNESS_NOTE = "整片音量会调到手机和电脑上听着一样大。视频自己的声音关掉。";
export const DESKTOP_REASON = "请打开安装好的 AIVORA，并打开一部作品，再生成。网页里不能直接出片。";

export const VOICES: { id: string; name: string; description: string; recommended?: boolean }[] = [
  { id: "eve", name: "女声·清亮", description: "女声，语速轻快", recommended: true },
  { id: "ara", name: "女声·温和", description: "女声，语气友好" },
  { id: "leo", name: "男声·沉稳", description: "男声，语速平稳" },
  { id: "rex", name: "男声·自信", description: "男声，吐字清楚" },
  { id: "sal", name: "男声·平稳", description: "男声，语气放平" },
];

export type ActionBeat = {
  text: string;
  seconds: number;
  feasibility: "稳" | "看运气" | "难";
  workaround: string;
};

export type StoryFilmBody = {
  scene_label: string;
  narration: string;
  subtitle: string;
  provider: "grok_subscription";
  confirmed: boolean;
  voice_id: string;
  style_block?: string;
  shots: {
    narration: string;
    prompt: string;
    subtitle: string;
    duration_seconds: number;
    size?: string;
    angle?: string;
    move?: string;
    action?: string;
    performance?: string;
    identity?: string;
  }[];
  video_model?: string;
};

const CHAPTER = /^第[0-9０-９一二三四五六七八九十百千零两]+[章回集幕]/;

function scene(no: number, title: string, text: string, where = ""): FilmScene {
  return {
    id: `scene-${no}`,
    no,
    title: title.slice(0, 40) || `第 ${no} 场`,
    where,
    text,
    ambience: "",
    source: "import",
    userFields: [],
  };
}

export function splitNovel(text: string): { title: string; scenes: FilmScene[]; note: string } {
  const clean = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 200_000);
  const note = text.trim().length > 200_000 ? "正文只读了前 20 万字。" : "";
  if (!clean) return { title: "未命名作品", scenes: [], note: note || "文件里没有正文。" };
  const lines = clean.split("\n");
  const head = lines[0]?.trim() ?? "";
  const title = head && !CHAPTER.test(head) && head.length <= 40 ? head : "未命名作品";
  const chapters: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;
  let sawChapter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (CHAPTER.test(trimmed)) {
      sawChapter = true;
      if (current) chapters.push(current);
      current = { title: trimmed.slice(0, 40), body: [] };
      continue;
    }
    if (!current) current = { title: "第 1 场", body: [] };
    if (trimmed && trimmed !== title) current.body.push(trimmed);
  }
  if (current) chapters.push(current);
  const blocks = sawChapter
    ? chapters.filter((item) => item.body.length > 0)
    : groupParagraphs(clean, title);
  const scenes = (blocks.length > 0 ? blocks : [{ title: "第 1 场", body: [clean] }])
    .slice(0, 40)
    .map((item, index) => scene(index + 1, item.title, item.body.join("\n").trim()))
    .filter((item) => item.text);
  const capped = blocks.length > 40 ? `${note} 只收了前 40 场。`.trim() : note;
  return { title, scenes, note: capped };
}

function groupParagraphs(text: string, title: string): { title: string; body: string[] }[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter((item) => item && item !== title);
  const groups: { title: string; body: string[] }[] = [];
  let bucket: string[] = [];
  let size = 0;
  for (const part of parts.length > 0 ? parts : [text]) {
    bucket.push(part);
    size += part.length;
    if (size >= 480) {
      groups.push({ title: `第 ${groups.length + 1} 场`, body: bucket });
      bucket = [];
      size = 0;
    }
  }
  if (bucket.length) groups.push({ title: `第 ${groups.length + 1} 场`, body: bucket });
  return groups;
}

export function offlineScreenplay(idea: string, targetSeconds = 60): FilmScene[] {
  const sentences = idea
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const hook = sentences[0] ?? "开场还没写";
  const last = sentences.length > 1 ? sentences[sentences.length - 1]! : hook;
  const middle = sentences.slice(1, -1).join("。") || hook;
  const each = Math.max(3, Math.round(targetSeconds / 3));
  return [
    scene(1, "开场", `${hook}。`),
    scene(2, "发展", `${middle}。`),
    scene(3, "悬念", `${last}。还没完。`),
  ].map((item) => ({ ...item, source: "offline:writer", text: item.text, where: `约 ${each} 秒` }));
}

export function adaptToShortDrama(text: string, targetSeconds = 60): FilmScene[] {
  const split = splitNovel(text);
  if (split.scenes.length >= 2) {
    const each = Math.max(3, Math.round(targetSeconds / split.scenes.length));
    return split.scenes.map((item) => ({
      ...item,
      where: item.where || `约 ${each} 秒`,
      source: "offline:writer",
    }));
  }
  return offlineScreenplay(text, targetSeconds);
}

export function parseWriterScenes(text: string): FilmScene[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !("scenes" in value)) return null;
  const rows = (value as { scenes?: unknown }).scenes;
  if (!Array.isArray(rows)) return null;
  const scenes: FilmScene[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const record = row as Record<string, unknown>;
    const body = [record.key_event, record.text, record.beats]
      .map((item) => (Array.isArray(item) ? item.join("。") : item))
      .find((item) => typeof item === "string" && item.trim());
    if (typeof body !== "string") return;
    const title = typeof record.title === "string" ? record.title : `第 ${index + 1} 场`;
    const where = [record.place, record.time]
      .filter((item) => typeof item === "string")
      .join(" · ");
    scenes.push({
      ...scene(index + 1, title, body.trim(), where),
      source: "agent:writer",
    });
  });
  return scenes.length > 0 ? scenes : null;
}

export function applyScenes(film: FilmProject, incoming: FilmScene[]): FilmProject {
  const kept = film.scenes.filter((item) => item.text.trim() && item.userFields.includes("text"));
  const locked = new Set(kept.map((item) => item.id));
  const fresh = incoming.map((item, index) =>
    locked.has(item.id) ? { ...item, id: `incoming-${index + 1}` } : item,
  );
  const scenes = [...kept, ...fresh].map((item, index) => ({ ...item, no: index + 1 }));
  return scenes.length > 0 ? { ...film, scenes } : film;
}

export function portraitPrompts(
  name: string,
  identity: string,
  styleZh: string,
): { view: string; prompt: string }[] {
  const who = identity.trim() || name.trim() || "人物";
  const style = styleZh.replace(/。$/, "");
  const views = [
    ["正面", "正面半身，看向镜头，作为定妆锚定"],
    ["侧面", "正侧面半身，同一张脸，同一套衣服"],
    ["背面", "背面全身，能看见衣服和发型"],
    ["脸部", "脸部特写，眼睛清楚，不要文字"],
  ];
  return views.map(([view, pose]) => ({
    view: view!,
    prompt: `角色定妆照，不要画成某一场的动作。${who}。${pose}。${style}。`,
  }));
}

export function locationPlate(where: string, styleZh: string, variant: string): string {
  return `空镜，没有人物。${where || "地点"}。${variant}。${styleZh}`;
}

export type ExtractedCast = {
  characters: { name: string; identity: string }[];
  locations: { name: string; prompt: string }[];
};

const NAME_BEFORE =
  /(?<![\u4e00-\u9fff])([\u4e00-\u9fff]{2,3})(?=站|跑|笑|说|看|走|撑|等|问|答|抬|停|推|拉|坐|躺|哭|喊)/g;
const PLACE_AT = /(?:在|到)([\u4e00-\u9fff]{2,8})/g;
const NOT_A_NAME = new Set(["两人", "他们", "她们", "我们", "夜里", "雨夜", "一个人"]);

export function extractCastOffline(text: string): ExtractedCast {
  const names = new Set<string>();
  for (const match of text.matchAll(NAME_BEFORE)) {
    const name = match[1] ?? "";
    if (name && !NOT_A_NAME.has(name)) names.add(name);
  }
  const rainy = /雨夜|夜里下雨|下雨/.test(text);
  const places = new Set<string>();
  for (const match of text.matchAll(PLACE_AT)) {
    const place = (match[1] ?? "").replace(/(等人|等他|等她|里面|里|上|下|中)$/u, "");
    if (place.length >= 2) places.add(place);
  }
  return {
    characters: [...names].map((name) => ({ name, identity: "" })),
    locations: [...places].map((name) => {
      const label = rainy && name.includes("巷") && !name.startsWith("雨") ? `雨夜${name}` : name;
      return { name: label, prompt: label };
    }),
  };
}

export function parseCastReply(text: string): ExtractedCast | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as {
      characters?: { name?: unknown; identity?: unknown }[];
      locations?: { name?: unknown; prompt?: unknown }[];
    };
    const characters = (value.characters ?? [])
      .map((item) => ({
        name: typeof item.name === "string" ? item.name.trim() : "",
        identity: typeof item.identity === "string" ? item.identity.trim() : "",
      }))
      .filter((item) => item.name);
    const locations = (value.locations ?? [])
      .map((item) => ({
        name: typeof item.name === "string" ? item.name.trim() : "",
        prompt: typeof item.prompt === "string" ? item.prompt.trim() : "",
      }))
      .filter((item) => item.name);
    if (characters.length === 0 && locations.length === 0) return null;
    return { characters, locations };
  } catch {
    return null;
  }
}

export function mergeCast(film: FilmProject, extracted: ExtractedCast): FilmProject {
  const known = new Set(film.characters.map((item) => item.name));
  const characters: FilmCharacter[] = [...film.characters];
  for (const item of extracted.characters) {
    if (!item.name || known.has(item.name)) continue;
    known.add(item.name);
    characters.push({
      id: `cast-${characters.length + 1}`,
      name: item.name,
      identity: item.identity,
      voiceId: "",
      source: "script",
      userFields: [],
      portraits: [],
    });
  }
  const knownPlaces = new Set(film.locations.map((item) => item.name));
  const locations: FilmLocation[] = [...film.locations];
  for (const item of extracted.locations) {
    if (!item.name || knownPlaces.has(item.name)) continue;
    knownPlaces.add(item.name);
    locations.push({
      id: `loc-${locations.length + 1}`,
      name: item.name,
      prompt: item.prompt || item.name,
    });
  }
  let scenes = film.scenes;
  const place = locations[0]?.name ?? "";
  if (place && scenes[0] && !scenes[0].where.trim()) {
    scenes = scenes.map((scene, index) => (index === 0 ? { ...scene, where: place } : scene));
  }
  if (
    characters.length === film.characters.length &&
    locations.length === film.locations.length &&
    scenes === film.scenes
  ) {
    return film;
  }
  return { ...film, characters, locations, scenes };
}

export function ensureLocations(film: FilmProject): FilmProject {
  if (film.locations.length > 0) return film;
  const names = [...new Set(film.scenes.map((item) => item.where || item.title).filter(Boolean))];
  return {
    ...film,
    locations: names.map((name, index) => ({
      id: `loc-${index + 1}`,
      name,
      prompt: locationPlate(name, film.styleZh, "夜"),
    })),
  };
}

const HARD_ACTION = /抱|摔|翻滚|缠|多人同时/;

export function actionBeats(text: string): ActionBeat[] {
  const parts = text
    .split(/[。；;！]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
  const rows = parts.length > 0 ? parts : ["这一下还没写"];
  return rows.map((part) => {
    const hard = HARD_ACTION.test(part);
    return {
      text: part,
      seconds: Math.min(3, Math.max(1, part.length > 18 ? 2 : 1)),
      feasibility: hard ? "难" : part.length > 24 ? "看运气" : "稳",
      workaround: hard ? "改成出手、冲击特写、受击反应，靠剪辑接上。" : "",
    };
  });
}

export function performanceLine(picture: string): string {
  const seen = picture.trim();
  if (!seen) return "眼神看向前方，停半拍，语气压低。";
  return `顺着这一镜，眼神不要飘。${seen.slice(0, 24)}`;
}

export function keyframeVariants(shot: FilmShot, film: FilmProject): string[] {
  const base = keyframePrompt(shot, film).replace(/。$/, "");
  return ["构图偏左", "构图偏右", "光线更暗，脸仍清楚", "再近一些"].map(
    (twist) => `${base}。${twist}。`,
  );
}

export function continuityPrompt(
  previous: FilmShot | undefined,
  shot: FilmShot,
  film: FilmProject,
): string {
  const base = keyframePrompt(shot, film);
  if (!previous?.picture.trim()) return base;
  return `接上一镜的结尾：${previous.picture.replace(/。$/, "")}。${base}`;
}

export function addShot(film: FilmProject, sceneId: string): FilmProject {
  const siblings = film.shots.filter((item) => item.sceneId === sceneId);
  const shot: FilmShot = {
    id: `${sceneId}-shot-${siblings.length + 1}`,
    sceneId,
    no: siblings.length + 1,
    size: "中景",
    angle: "平视",
    move: "固定",
    seconds: 3,
    picture: "新镜头。",
    action: "",
    performance: "",
    line: "",
    sound: emptySoundPlan(),
    characters: film.characters[0] ? [film.characters[0].name] : [],
    source: "user",
    userFields: ["picture"],
    poster: "",
    posterPosition: "",
    takes: [],
    stills: [],
    selectedTakeId: "",
  };
  return { ...film, shots: [...film.shots, shot] };
}

export function removeShot(film: FilmProject, shotId: string): FilmProject {
  return { ...film, shots: film.shots.filter((item) => item.id !== shotId) };
}

export function moveShot(film: FilmProject, shotId: string, direction: -1 | 1): FilmProject {
  const current = film.shots.find((item) => item.id === shotId);
  if (!current) return film;
  const sceneShots = film.shots.filter((item) => item.sceneId === current.sceneId);
  const local = sceneShots.findIndex((item) => item.id === shotId);
  const target = local + direction;
  if (target < 0 || target >= sceneShots.length) return film;
  const reordered = sceneShots.slice();
  const moved = reordered[local];
  if (!moved) return film;
  reordered.splice(local, 1);
  reordered.splice(target, 0, moved);
  const numbered = reordered.map((item, index) => ({ ...item, no: index + 1 }));
  return {
    ...film,
    shots: [...film.shots.filter((item) => item.sceneId !== current.sceneId), ...numbered],
  };
}

export function updateShot(
  film: FilmProject,
  shotId: string,
  patch: Partial<FilmShot>,
): FilmProject {
  return {
    ...film,
    shots: film.shots.map((item) => (item.id === shotId ? { ...item, ...patch } : item)),
  };
}

export function planVideoJobs(
  shot: FilmShot,
  takes: number,
  enabled: boolean,
  reason: string,
): FilmJob[] {
  const count = Math.max(1, Math.min(takes, 4));
  return Array.from({ length: count }, (_, index) => ({
    id: `${shot.id}-video-${index + 1}`,
    shotId: shot.id,
    kind: "video" as const,
    take: index + 1,
    status: enabled ? ("queued" as const) : ("blocked" as const),
    prompt: shot.picture,
    reason: enabled ? "每个版本各算一次。视频自己的声音关掉。" : reason,
  }));
}

export function subtitleCues(shots: FilmShot[]): { id: string; text: string; start: number }[] {
  let start = 0;
  const cues: { id: string; text: string; start: number }[] = [];
  for (const shot of shots) {
    const text = shot.line.trim();
    if (text) cues.push({ id: shot.id, text: text.slice(0, 20), start });
    start += shot.seconds;
  }
  return cues;
}

export function exportSummary(film: FilmProject): string {
  const seconds = film.shots.reduce((sum, item) => sum + item.seconds, 0);
  const done = new Set(
    film.jobs
      .filter((job) => job.kind === "video" && job.status === "done")
      .map((job) => job.shotId),
  );
  const missing = film.shots.filter((shot) => {
    const takeDone = shot.takes.some((take) => take.status === "done");
    return !takeDone && !done.has(shot.id);
  }).length;
  const gap = missing === 0 ? "镜头都已生成" : `还有 ${missing} 个镜头没生成`;
  return `共 ${film.scenes.length} 场 · ${film.shots.length} 个镜头 · 约 ${seconds} 秒 · ${gap}。${QC_REASON} ${LOUDNESS_NOTE}`;
}

export function clipLayout(
  shots: { id: string; seconds: number }[],
): { id: string; left: number; width: number }[] {
  let left = 1;
  return shots.map((shot) => {
    const width = Math.max(48, Math.round(shot.seconds * 52) - 2);
    const clip = { id: shot.id, left, width };
    left += width + 2;
    return clip;
  });
}

export function clock(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function oneShot(shot: FilmShot, film: FilmProject) {
  const narration = (shot.line || shot.picture || "这一镜")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const picture = (shot.picture || shot.action || "起始画面").replace(/\s+/g, " ").trim();
  return {
    narration: narration || "这一镜",
    prompt: picture.slice(0, 400),
    subtitle: shot.line.trim().slice(0, 28),
    duration_seconds: Math.max(1, Math.min(15, Math.round(shot.seconds) || 3)),
    size: shot.size.slice(0, 20),
    angle: (shot.angle || "平视").slice(0, 20),
    move: (shot.move || "固定").slice(0, 20),
    action: shot.action.replace(/\s+/g, " ").trim().slice(0, 80),
    performance: shot.performance.replace(/\s+/g, " ").trim().slice(0, 80),
    identity: shotIdentity(shot, film).slice(0, 200),
  };
}

export function generationEstimate(shots: number, versions: number, seconds: number): string {
  const count = Math.max(0, shots) * Math.max(1, versions);
  const duration = Math.round(count * Math.max(0, seconds));
  return `将生成 ${count} 个视频 · 约 ${duration} 秒 · 记在 Grok 会员额度里`;
}

export function storyFilmBatches(
  film: FilmProject,
  shots: FilmShot[],
  draft: boolean,
): StoryFilmBody[] {
  const rows = shots.length > 0 ? shots : film.shots;
  const batches: StoryFilmBody[] = [];
  for (let index = 0; index < Math.max(rows.length, 1); index += 10) {
    const slice = rows.slice(index, index + 10);
    const narration = (film.scenes.map((item) => item.text).join(" ") || film.title).slice(0, 200);
    batches.push({
      scene_label: (film.title || "未命名").slice(0, 80),
      narration: narration || "未命名",
      subtitle: film.title.slice(0, 28),
      provider: "grok_subscription",
      confirmed: true,
      voice_id: film.characters[0]?.voiceId || "eve",
      style_block: (slice.length === 1 ? slice[0]?.styleNote?.trim() || film.styleZh : film.styleZh)
        .trim()
        .slice(0, 400),
      shots: (slice.length > 0 ? slice : rows).slice(0, 10).map((shot) => oneShot(shot, film)),
      ...(draft ? { video_model: VIDEO_DRAFT_MODEL } : { video_model: VIDEO_MODEL }),
    });
    if (rows.length === 0) break;
  }
  return batches;
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

async function inflateRaw(payload: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "function") {
    try {
      const copy = Uint8Array.from(payload);
      const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // The desktop browser can inflate. The test page's blob stream sometimes cannot.
    }
  }
  const specifier = "node:zlib";
  const zlib = (await import(/* @vite-ignore */ specifier)) as {
    inflateRawSync: (value: Uint8Array) => Uint8Array;
  };
  return zlib.inflateRawSync(payload);
}

export async function zipTexts(bytes: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const decoder = new TextDecoder("utf-8");
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 65535); index -= 1) {
    if (u32(bytes, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) return out;
  let cursor = u32(bytes, eocd + 16);
  const total = u16(bytes, eocd + 10);
  for (let index = 0; index < total; index += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) break;
    const method = u16(bytes, cursor + 10);
    const size = u32(bytes, cursor + 20);
    const nameLen = u16(bytes, cursor + 28);
    const extraLen = u16(bytes, cursor + 30);
    const commentLen = u16(bytes, cursor + 32);
    const local = u32(bytes, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;
    const nameAt = u16(bytes, local + 26);
    const extraAt = u16(bytes, local + 28);
    const dataStart = local + 30 + nameAt + extraAt;
    const payload = bytes.subarray(dataStart, dataStart + size);
    if (!/\.(xml|xhtml|html|htm|txt)$/i.test(name)) continue;
    try {
      const raw = method === 0 ? payload : method === 8 ? await inflateRaw(payload) : null;
      if (raw) out.set(name, decoder.decode(raw));
    } catch {
      continue;
    }
  }
  return out;
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractBookText(
  name: string,
  bytes: Uint8Array,
): Promise<{ text: string; note: string }> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
    return { text, note: "已读取文本。" };
  }
  if (!lower.endsWith(".docx") && !lower.endsWith(".epub")) {
    return { text: "", note: "只读取 txt、docx 和 epub。请另存为其中一种再导入。" };
  }
  const files = await zipTexts(bytes);
  if (files.size === 0) {
    return { text: "", note: "这个文件读不出来。请另存为 txt 再导入。" };
  }
  if (lower.endsWith(".docx")) {
    const xml = files.get("word/document.xml") ?? "";
    const text = xmlToText(xml);
    return text
      ? { text, note: "已从文档里抽出正文。" }
      : { text: "", note: "文档里没有正文。请另存为 txt 再导入。" };
  }
  const pages = [...files.entries()]
    .filter(([file]) => /\.(xhtml|html|htm)$/i.test(file) && !/nav/i.test(file))
    .map(([, xml]) => xmlToText(xml))
    .filter(Boolean);
  return pages.length
    ? { text: pages.join("\n\n"), note: "已从电子书里抽出正文。" }
    : { text: "", note: "电子书里没有正文。请另存为 txt 再导入。" };
}
