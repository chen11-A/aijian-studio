import { VIDEO_DRAFT_MODEL, VIDEO_MODEL } from "../pro/capabilities";
import { emptySoundPlan } from "./audio";
import { durationFromSpeech, speechSeconds } from "./phase2";
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
export const LOUDNESS_NOTE =
  "导入的配乐会在对白出现时让路，对白本身不降低。这一版不会把整片音量调成统一大小。";
export const DESKTOP_REASON = "请打开安装好的 AIVORA，并打开一部作品，再生成。网页里不能直接出片。";

/** Chinese labels for preset voices. The live list still comes from the account. */
export const VOICE_LABELS: Record<string, string> = {
  carina: "柔和体贴",
  zagan: "有力有戏",
  helix: "大胆有冲劲",
  orion: "浑厚电影感",
  luna: "温和耐心",
  iris: "亲切活泼",
  altair: "优雅高级",
  zenith: "干脆利落",
  perseus: "坚定可靠",
  helios: "明快有劲",
  lux: "沉稳睿智",
  kepler: "有感染力",
  rigel: "专业冷静",
  cosmo: "明亮好奇",
  celeste: "温暖安心",
  ursa: "亲切踏实",
  sirius: "机灵俏皮",
  lumen: "温暖清楚",
  castor: "随和接地气",
  naksh: "温暖深思",
  atlas: "自信有威严",
  aurora: "宁静明亮",
  liora: "平静透亮",
  ara: "温暖友好",
  eve: "有活力",
  leo: "威严有力",
  rex: "自信清楚",
  sal: "平稳均衡",
};

export const VOICES: { id: string; name: string; description: string; recommended?: boolean }[] =
  Object.entries(VOICE_LABELS).map(([id, name]) => ({
    id,
    name,
    description: name,
    ...(id === "orion" ? { recommended: true } : {}),
  }));

export function voiceLabel(id: string, apiName = ""): string {
  if (VOICE_LABELS[id]) return VOICE_LABELS[id];
  const name = apiName.trim();
  return name || id;
}

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
  aspect_ratio?: "9:16" | "16:9";
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
    voice_id?: string;
    still?: string;
    reference?: string;
    references?: string[];
    delivery?: string;
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

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      return [row.text, row.line, row.action, row.dialogue]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join("，");
    })
    .filter(Boolean)
    .join("\n");
}

const NOVEL_HEADING = /^第[0-9０-９一二三四五六七八九十百千零两]+场[ \t\u3000]*([^\n]*)/gm;

/** The novel's own 第X场 headings, each a contiguous non-overlapping slice. */
export function novelHeadingSlices(source: string): { title: string; text: string }[] {
  const text = source.replace(/\r\n/g, "\n").trim();
  const found = [...text.matchAll(NOVEL_HEADING)];
  if (found.length < 2) return [];
  return found.map((match, index) => {
    const start = index === 0 ? 0 : (match.index ?? 0);
    const end = index + 1 < found.length ? (found[index + 1]?.index ?? text.length) : text.length;
    return { title: (match[1] ?? "").trim(), text: text.slice(start, end).trim() };
  });
}

function quoteAt(chunk: string, probes: string[], after: number): number {
  let best = -1;
  for (const probe of probes) {
    const needle = probe.trim().slice(0, 14);
    if (needle.length < 6) continue;
    const at = chunk.indexOf(needle, Math.max(0, after));
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

function rowProbes(record: Record<string, unknown>): string[] {
  return [asText(record.text), asText(record.beats), asText(record.key_event)]
    .join("\n")
    .split(/[\n。！？]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6);
}

/** Cut the novel at each scene's place so the dialogue stays with that scene. */
export function sliceNovel(source: string, markers: string[]): string[] {
  const text = source.trim();
  const slices = markers.map(() => "");
  if (!text) return slices;
  const found = markers
    .map((marker, index) => ({ index, at: marker.trim() ? text.indexOf(marker.trim()) : -1 }))
    .filter((item) => item.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (found.length < markers.filter((item) => item.trim()).length) return slices;
  for (let cursor = 0; cursor < found.length; cursor += 1) {
    const start = found[cursor]!.at;
    const end = cursor + 1 < found.length ? found[cursor + 1]!.at : text.length;
    slices[found[cursor]!.index] = text.slice(start, end).trim();
  }
  return slices;
}

function subsplit(chunk: string, group: Record<string, unknown>[]): string[] {
  const ordered = group
    .map((record) => ({ record, at: quoteAt(chunk, rowProbes(record), 0) }))
    .sort((a, b) => (a.at < 0 ? 1 : b.at < 0 ? -1 : a.at - b.at));
  const points = ordered.map((item, index) => (index === 0 ? 0 : item.at));
  return ordered.map((item, index) => {
    const start = points[index] ?? -1;
    if (start < 0) return "";
    const next = points.slice(index + 1).find((point) => point > start);
    return chunk.slice(start, next ?? chunk.length).trim();
  });
}

export type SourceParagraph = { id: string; text: string };

/** Number the novel's paragraphs [P01]… so each one can belong to exactly one scene. */
export function numberParagraphs(source: string): SourceParagraph[] {
  return source
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `P${String(index + 1).padStart(2, "0")}`,
      text: text.replace(/^\[P\d{2}\]\s*/, ""),
    }));
}

export function numberedScript(source: string): string {
  return numberParagraphs(source)
    .map((item) => `[${item.id}] ${item.text}`)
    .join("\n");
}

/** Lines inside quotes. The writer must keep each one word for word. */
export function quotedLines(text: string): string[] {
  const lines: string[] = [];
  for (const pattern of [/“([^”]+)”/g, /「([^」]+)」/g, /"([^"\n]{1,80})"/g]) {
    for (const match of text.matchAll(pattern)) {
      const line = (match[1] ?? "").trim();
      if (line) lines.push(line);
    }
  }
  return lines;
}

function headingWhere(record: Record<string, unknown>): string {
  const heading = record.heading;
  if (heading && typeof heading === "object" && !Array.isArray(heading)) {
    const row = heading as Record<string, unknown>;
    return [row.place, row.location, row.time, row.weather]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join(" · ");
  }
  return [record.place, record.time]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" · ");
}

function listedParagraphs(record: Record<string, unknown>): string[] {
  const raw = record.source_paragraphs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && /^P\d{2}$/.test(item));
}

function elementLines(record: Record<string, unknown>): string[] {
  if (!Array.isArray(record.elements)) return [];
  return record.elements.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const line = (item as { line?: unknown }).line;
    return typeof line === "string" && line.trim() ? [line.trim()] : [];
  });
}

/** Rebuild each scene from its own paragraphs and put back any dialogue the reply dropped. */
export function rebuildFromParagraphs(
  scenes: FilmScene[],
  records: Record<string, unknown>[],
  source: string,
): FilmScene[] {
  const paragraphs = numberParagraphs(source);
  if (paragraphs.length === 0 || scenes.length === 0) return scenes;
  const groups = scenes.map(() => [] as string[]);
  const explicit = records.map(listedParagraphs);
  const owner = new Map<string, number>();
  explicit.forEach((ids, index) => {
    for (const id of ids) if (!owner.has(id)) owner.set(id, index);
  });
  let cursor = 0;
  for (const paragraph of paragraphs) {
    const listed = owner.get(paragraph.id);
    if (listed !== undefined) {
      cursor = listed;
    } else if (!explicit.some((ids) => ids.length > 0)) {
      const needle = paragraph.text.slice(0, Math.min(18, paragraph.text.length));
      const hits = scenes
        .map((scene, index) => ({
          index,
          length: scene.text.length,
          lines: elementLines(records[index] ?? {}).some((line) => paragraph.text.includes(line)),
          hit: scene.text.includes(needle) && scene.text.length < source.length * 0.75,
        }))
        .filter((item) => item.lines || item.hit);
      hits.sort((a, b) => Number(b.lines) - Number(a.lines) || a.length - b.length);
      if (hits[0]) cursor = hits[0].index;
    }
    groups[cursor]?.push(paragraph.id);
  }
  const byId = new Map(paragraphs.map((item) => [item.id, item.text]));
  return scenes.map((scene, index) => {
    const owned = (groups[index] ?? []).map((id) => byId.get(id) ?? "").filter(Boolean);
    const text = owned.join("\n");
    if (!text) return scene;
    const missing = quotedLines(text).filter((line) => !text.includes(line));
    return { ...scene, text: missing.length > 0 ? `${text}\n${missing.join("\n")}` : text };
  });
}

export function parseWriterScenes(text: string, source = ""): FilmScene[] | null {
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
  const records = rows.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
  );
  const headings = novelHeadingSlices(source);
  const slices = records.map(() => "");
  if (headings.length >= 2) {
    const groups = headings.map(() => [] as Record<string, unknown>[]);
    const loose: Record<string, unknown>[] = [];
    for (const record of records) {
      const title = typeof record.title === "string" ? record.title : "";
      const place = typeof record.place === "string" ? record.place : "";
      const hit = headings.findIndex(
        (heading) =>
          heading.title &&
          (title.includes(heading.title) ||
            heading.title.includes(title) ||
            place.includes(heading.title)),
      );
      if (hit >= 0) groups[hit]!.push(record);
      else loose.push(record);
    }
    for (const record of loose) {
      let best = -1;
      let at = Number.POSITIVE_INFINITY;
      headings.forEach((heading, index) => {
        const found = quoteAt(heading.text, rowProbes(record), 0);
        if (found >= 0 && found < at) {
          at = found;
          best = index;
        }
      });
      (best >= 0 ? groups[best] : groups[groups.length - 1])!.push(record);
    }
    groups.forEach((group, index) => {
      if (group.length === 0) return;
      const parts = subsplit(headings[index]!.text, group);
      const ordered = group
        .map((record) => ({ record, at: quoteAt(headings[index]!.text, rowProbes(record), 0) }))
        .sort((a, b) => (a.at < 0 ? 1 : b.at < 0 ? -1 : a.at - b.at));
      ordered.forEach((item, part) => {
        const rowIndex = records.indexOf(item.record);
        if (rowIndex >= 0) slices[rowIndex] = parts[part] ?? "";
      });
    });
  } else {
    const markers = records.map((record) => {
      const place = typeof record.place === "string" ? record.place.trim() : "";
      const title = typeof record.title === "string" ? record.title.trim() : "";
      return place || title;
    });
    sliceNovel(source, markers).forEach((item, index) => {
      slices[index] = item;
    });
  }
  const scenes: FilmScene[] = [];
  const kept: Record<string, unknown>[] = [];
  records.forEach((record, index) => {
    const beats = asText(record.beats);
    const written = [asText(record.text), asText(record.dialogue), asText(record.lines)]
      .filter(Boolean)
      .join("\n");
    let slice = slices[index] ?? "";
    const extraHeading = [...slice.matchAll(NOVEL_HEADING)];
    if (extraHeading.length >= 2)
      slice = slice.slice(0, extraHeading[1]?.index ?? slice.length).trim();
    if (slice.length > 0 && source && slice.length > source.length * 0.75 && records.length > 1) {
      slice = "";
    }
    const key = asText(record.key_event);
    const story = slice || written;
    const outline = [beats, story ? "" : key].filter(Boolean).join("\n");
    const body = [story, outline && !story.includes(outline) ? outline : ""]
      .filter(Boolean)
      .join("\n");
    if (!body.trim()) return;
    const title = typeof record.title === "string" ? record.title : `第 ${index + 1} 场`;
    const where = headingWhere(record);
    const dialogue = elementLines(record).filter((line) => !body.includes(line));
    const withLines = [body.trim(), ...dialogue].filter(Boolean).join("\n");
    if (!withLines) return;
    scenes.push({
      ...scene(index + 1, title, withLines, where),
      source: "agent:writer",
    });
    kept.push(record);
  });
  const ready = source ? rebuildFromParagraphs(scenes, kept, source) : scenes;
  return ready.some((item) => item.text.trim()) ? ready.filter((item) => item.text.trim()) : null;
}

/** A one-line summary is not enough for the director to shoot. */
export function sceneNeedsSource(text: string): boolean {
  const body = text.trim();
  if (!body) return true;
  const line = /[「“"'][^」”"']{1,80}[」”"']/.test(body) || /(说|问|喊|哭着)[:：「"']/.test(body);
  const action = /(挥|砍|打|哭|跑|推|划|刀|钢|拳|踢|抱|坐|站|走|看向|走进)/.test(body);
  return !(line || action) && body.length < 80;
}

export function isFightScene(text: string): boolean {
  return /打斗|打架|挥棍|铁棍|钢条|钢管|折叠刀|刀|拳|砍|踢|肘击|小臂/.test(text);
}

const FIGHT_WORDS = [
  "铁棍",
  "钢条",
  "钢管",
  "钢棒",
  "折叠刀",
  "刀",
  "小臂",
  "前臂",
  "肘击",
  "划开",
];

/** Keep weapons and injuries from the novel when the action pass softens them. */
export function keepFightDetails(source: string, beats: string): string {
  const words = FIGHT_WORDS.filter((word) => source.includes(word));
  const missing = words.filter((word) => !beats.includes(word));
  const kept = missing.length > 0 ? `保留原文：${missing.join("、")}` : "";
  return [beats.trim(), kept].filter(Boolean).join("。");
}

/** One shot gets the beats that name it, never the whole fight list. */
export function beatsForShot(
  beats: { text: string; shotId?: string }[],
  shotNo: number,
  shotId = "",
): string {
  if (shotId) {
    const ownId = beats.filter((item) => item.shotId === shotId);
    if (ownId.length > 0) return ownId.map((item) => item.text).join("。");
  }
  const own = beats.filter((item) => new RegExp(`镜头\\s*${shotNo}(?!\\d)`).test(item.text));
  if (own.length > 0) return own.map((item) => item.text).join("。");
  const numbered = beats.some((item) => /镜头\s*\d+/.test(item.text));
  if (numbered) return "";
  return beats[shotNo - 1]?.text ?? "";
}

export function applyScenes(film: FilmProject, incoming: FilmScene[]): FilmProject {
  const distinctive = incoming
    .map((item) => item.text.trim().slice(0, 24))
    .filter((item) => item.length >= 6);
  const kept = film.scenes.filter((item) => {
    if (!item.text.trim() || !item.userFields.includes("text")) return false;
    const hits = distinctive.filter((bit) => item.text.includes(bit)).length;
    return hits < 2;
  });
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
    prompt: `角色定妆照，不要画成某一场的动作。${who}。按这句话里的性别和年龄来画，不要改成另一种性别。${pose}。${style}。`,
  }));
}

export function filmFileName(series: string, episode: string): string {
  const base = `${series.trim() || "未命名"}-${episode.trim() || "第1集"}`.replace(/\s+/g, "");
  return base.toLowerCase().endsWith(".mp4") ? base : `${base}.mp4`;
}

export function shotProgress(shot: FilmShot): "视频已出" | "画面已出" | "未生成" {
  if (shot.takes.some((take) => take.status === "done")) return "视频已出";
  if (shot.poster || shot.takes.some((take) => Boolean(take.stillUrl))) return "画面已出";
  return "未生成";
}

export function locationPlate(where: string, styleZh: string, variant: string): string {
  return `空镜，没有人物。${where || "地点"}。${variant}。${styleZh}`;
}

export type ExtractedCast = {
  characters: { name: string; identity: string; gender?: string; ageBand?: string }[];
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
      characters?: {
        name?: unknown;
        identity?: unknown;
        identity_lock?: unknown;
        gender?: unknown;
        age_band?: unknown;
      }[];
      locations?: { name?: unknown; prompt?: unknown }[];
    };
    const characters = (value.characters ?? [])
      .map((item) => ({
        name: typeof item.name === "string" ? item.name.trim() : "",
        identity:
          (typeof item.identity === "string" && item.identity.trim()) ||
          (typeof item.identity_lock === "string" && item.identity_lock.trim()) ||
          "",
        ...(typeof item.gender === "string" && item.gender.trim()
          ? { gender: item.gender.trim() }
          : {}),
        ...(typeof item.age_band === "string" && item.age_band.trim()
          ? { ageBand: item.age_band.trim() }
          : {}),
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

const WOMAN = ["ara", "eve", "luna", "carina", "celeste"];
const MAN = ["leo", "rex", "atlas", "perseus", "zagan", "sal", "lux"];
const YOUNG_WOMAN = ["iris", "sirius", "cosmo", "helix"];
const YOUNG_MAN = ["helios", "castor", "kepler", "zenith"];
const GIRL = ["iris", "sirius", "cosmo", "lumen"];
const BOY = ["helios", "castor", "lumen", "zenith"];
const ELDER_WOMAN = ["naksh", "ursa"];
const ELDER_MAN = ["orion", "lux"];

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function ageYears(text: string): number | null {
  const digits = text.match(/(\d{1,2})\s*岁/);
  if (digits) return Number(digits[1]);
  const tens = text.match(/([一二三四五六七八九])十([一二三四五六七八九])?\s*岁/);
  if (tens) return (CN_DIGIT[tens[1]!] ?? 0) * 10 + (tens[2] ? (CN_DIGIT[tens[2]] ?? 0) : 0);
  const ten = text.match(/(?<![一二三四五六七八九])十([一二三四五六七八九])?\s*岁/);
  if (ten) return 10 + (ten[1] ? (CN_DIGIT[ten[1]] ?? 0) : 0);
  const one = text.match(/([一二三四五六七八九])\s*岁/);
  return one ? (CN_DIGIT[one[1]!] ?? null) : null;
}

function voicePool(text: string, index: number): string[] {
  const female = /女|她|小姐|姑娘|妈妈|母亲|姐姐|妹妹|少女|妻子|婆|奶/.test(text);
  const male =
    /男|先生|爸爸|父亲|之父|哥哥|弟弟|少年|小伙|丈夫|爷爷|老爷|寸头|打手|领头|金链/.test(text) ||
    (/他/.test(text) && !/她/.test(text));
  const years = ageYears(text);
  const child =
    (years !== null && years < 13) ||
    (years === null && /小孩|孩子|儿童|幼年|幼童|孩童|宝宝/.test(text));
  const elder = years !== null ? years >= 60 : /老人|长者|老年|爷爷|奶奶|婆婆|阿婆|老爷/.test(text);
  const adult = /成年|成人/.test(text);
  const young = !adult && (years !== null ? years < 18 : /少年|少女|年轻|青年/.test(text));
  if (child && female) return GIRL;
  if (child && male) return BOY;
  if (child) return index % 2 === 0 ? GIRL : BOY;
  if (elder && female) return ELDER_WOMAN;
  if (elder && male) return ELDER_MAN;
  if (elder) return index % 2 === 0 ? ELDER_WOMAN : ELDER_MAN;
  if (young && female && years === null) return YOUNG_WOMAN;
  if (young && male && years === null) return YOUNG_MAN;
  if (female) return WOMAN;
  if (male) return MAN;
  return MAN;
}

/** A free preset voice. The user can change it afterwards. */
export function assignVoice(identity: string, name: string, used: ReadonlySet<string>): string {
  const pool = voicePool(`${name} ${identity}`, used.size);
  const all = [...WOMAN, ...MAN, ...YOUNG_WOMAN, ...YOUNG_MAN, ...GIRL, ...BOY];
  return pool.find((id) => !used.has(id)) ?? all.find((id) => !used.has(id)) ?? pool[0] ?? "eve";
}

export function mergeCast(film: FilmProject, extracted: ExtractedCast): FilmProject {
  const known = new Set(film.characters.map((item) => item.name));
  const used = new Set(film.characters.map((item) => item.voiceId).filter(Boolean));
  const characters: FilmCharacter[] = film.characters.map((item) => {
    if (item.voiceId) return item;
    const voiceId = assignVoice(item.identity, item.name, used);
    used.add(voiceId);
    return { ...item, voiceId };
  });
  for (const item of extracted.characters) {
    if (!item.name || known.has(item.name)) continue;
    known.add(item.name);
    const voiceId = assignVoice(
      `${item.gender ?? ""} ${item.ageBand ?? ""} ${item.identity}`,
      item.name,
      used,
    );
    used.add(voiceId);
    characters.push({
      id: `cast-${characters.length + 1}`,
      name: item.name,
      identity: item.identity,
      ...(item.gender ? { gender: item.gender } : {}),
      ...(item.ageBand ? { ageBand: item.ageBand } : {}),
      voiceId,
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
      ambience: "",
    });
  }
  let scenes = film.scenes;
  const place = locations[0]?.name ?? "";
  if (place && scenes[0] && !scenes[0].where.trim()) {
    scenes = scenes.map((scene, index) => (index === 0 ? { ...scene, where: place } : scene));
  }
  const voicesChanged = characters.some(
    (item, index) => item.voiceId !== film.characters[index]?.voiceId,
  );
  if (
    !voicesChanged &&
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
      ambience: "",
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

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** The line is spoken. The picture is never used as narration. */
export function spokenLine(shot: FilmShot): string {
  return shot.line.replace(/\s+/g, " ").trim();
}

export function isBeatList(text: string): boolean {
  return text.includes("时长") && text.includes("镜头");
}

/** The picture the user can see. A prompt is used only until the picture is edited. Beat lists stay out. */
export function motionPrompt(shot: FilmShot): string {
  const picture = shot.picture.trim();
  const edited = shot.userFields.includes("picture") || shot.userFields.includes("action");
  const prompted = edited ? "" : shot.promptZh?.trim() || "";
  let visual = prompted || picture;
  const acted = shot.performance.trim();
  if (acted && visual && !visual.includes(acted) && !isBeatList(acted)) {
    visual = `${visual}。表演：${acted}`;
  }
  if (visual && !isBeatList(visual)) return visual;
  return picture && !isBeatList(picture) ? picture : "起始画面";
}

export function shotVoiceId(shot: FilmShot, film: FilmProject): string {
  const named = shot.speaker?.trim() || "";
  const fromSpeaker = film.characters.find((item) => named && item.name === named && item.voiceId);
  if (fromSpeaker?.voiceId) return fromSpeaker.voiceId;
  const fromLine = film.characters.find(
    (item) => item.name && item.voiceId && shot.line.trim().startsWith(item.name),
  );
  if (fromLine?.voiceId) return fromLine.voiceId;
  const names = shot.characters.filter((name) => name && name !== "人物" && name !== "空镜");
  if (names.length === 1) {
    const only = film.characters.find((item) => item.name === names[0] && item.voiceId);
    if (only?.voiceId) return only.voiceId;
  }
  if (names.length > 1) {
    const speaking = film.characters.find((item) => names.includes(item.name) && item.voiceId);
    if (speaking?.voiceId) return speaking.voiceId;
  }
  if (names.length > 1) return "leo";
  if (film.narrationVoiceId) return film.narrationVoiceId;
  return "eve";
}

export function fitShotToLine(shot: FilmShot): { shot: FilmShot; warning: string } {
  const line = shot.line.trim();
  if (!line) return { shot, warning: "" };
  const plan = durationFromSpeech(speechSeconds(line, null), shot.seconds);
  const clipped = !plan.fits || plan.seconds > shot.seconds;
  if (shot.userFields.includes("seconds")) {
    return {
      shot,
      warning: clipped ? `镜头 ${shot.no} 的台词超过这一镜的时长，生成时声音会被截断。` : "",
    };
  }
  if (!plan.fits) {
    return { shot, warning: `镜头 ${shot.no} 的台词超过 15 秒，生成时声音会被截断。` };
  }
  if (plan.seconds !== shot.seconds)
    return { shot: { ...shot, seconds: plan.seconds }, warning: "" };
  return { shot, warning: "" };
}

function usableImage(url: string): boolean {
  return Boolean(url) && !url.startsWith("blob:") && !url.startsWith("data:");
}

function shotReference(
  shot: FilmShot,
  film: FilmProject,
): {
  still: string;
  references: { url: string; who: string }[];
} {
  const picked =
    [shot.poster, ...shot.stills.map((item) => item.url)].find((url) => usableImage(url)) ?? "";
  const people = film.characters.filter(
    (person) => shot.characters.includes(person.name) || person.name === shot.speaker,
  );
  const ranked = people.flatMap((person) =>
    person.portraits
      .filter((item) => usableImage(item.url))
      .map((item) => ({
        url: item.url,
        who: person.name || "角色",
        rank: (person.name === shot.speaker ? 4 : 0) + (item.view === "正面" ? 2 : 0),
      })),
  );
  ranked.sort((a, b) => b.rank - a.rank);
  const pinned = picked || ranked[0]?.url || "";
  const seen = new Set<string>(pinned ? [pinned] : []);
  const references: { url: string; who: string }[] = [];
  for (const item of ranked) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    references.push({ url: item.url.slice(0, 500), who: item.who });
    if (references.length === 13) break;
  }
  return { still: pinned.slice(0, 500), references };
}

function imageCue(references: { who: string }[], draft: boolean): string {
  const parts = ["<IMAGE_0> 是这一镜的起始画面。"];
  if (!draft) {
    references.forEach((item, index) => {
      parts.push(`<IMAGE_${index + 1}> 是${item.who}的定妆照。`);
    });
  }
  return parts.join("");
}

export function draftFaceWarning(draft: boolean): string {
  return draft ? "草稿用的是较快的模型，不能带定妆照，脸可能会变。" : "";
}

function isVoiceFile(path: string): boolean {
  return (
    path.startsWith("data:audio") ||
    /\.(mp3|wav|m4a|aac)(?:$|\?)/i.test(path.split(/[\\/]/).pop() ?? "")
  );
}

/** One entry per exported shot: a voice file, "mute", or empty to keep the take. */
export function dialogueTracks(film: FilmProject): string[] {
  const tracks: string[] = [];
  for (const shot of film.shots) {
    const chosen = shot.selectedTakeId
      ? shot.takes.find(
          (take) => take.id === shot.selectedTakeId && take.status === "done" && take.videoPath,
        )
      : shot.takes.find((take) => take.status === "done" && take.videoPath);
    if (!chosen?.videoPath) continue;
    const clip = film.audioClips.find(
      (item) => item.lane === "dialogue" && item.shotId === shot.id && isVoiceFile(item.path ?? ""),
    );
    if (!clip?.path) tracks.push("");
    else if ((clip.gainDb ?? 0) <= -40) tracks.push("mute");
    else tracks.push(clip.path);
  }
  return tracks;
}

export function previewMix(input: {
  joined: boolean;
  voice: string;
  music: string;
  dialogueMuted: boolean;
  solo: "" | "dialogue" | "score";
  musicHeard: boolean;
}): { voice: string; music: string; hearVideo: boolean } {
  if (input.joined) {
    if (input.solo === "score") return { voice: "", music: input.music, hearVideo: false };
    return { voice: "", music: "", hearVideo: true };
  }
  const voice = input.solo === "score" || input.dialogueMuted ? "" : input.voice;
  const music = !input.musicHeard || input.solo === "dialogue" ? "" : input.music;
  return {
    voice,
    music,
    hearVideo: !input.dialogueMuted && input.solo !== "score" && !voice,
  };
}

export function chosenExport(film: FilmProject): { paths: string[]; missing: string[] } {
  const paths: string[] = [];
  const missing: string[] = [];
  for (const shot of film.shots) {
    const chosen = shot.selectedTakeId
      ? shot.takes.find(
          (take) => take.id === shot.selectedTakeId && take.status === "done" && take.videoPath,
        )
      : shot.takes.find((take) => take.status === "done" && take.videoPath);
    if (chosen?.videoPath) paths.push(chosen.videoPath);
    else missing.push(`镜头 ${shot.no}`);
  }
  return { paths, missing };
}

export function confirmEstimate(shots: { seconds: number }[], versions: number): string {
  const copies = Math.max(1, versions);
  const count = shots.length * copies;
  const duration = Math.round(
    shots.reduce((sum, item) => sum + Math.max(0, item.seconds), 0) * copies,
  );
  return `将生成 ${count} 个视频 · 约 ${duration} 秒 · 记在 Grok 会员额度里`;
}

function oneShot(shot: FilmShot, film: FilmProject, draft: boolean) {
  const line = spokenLine(shot);
  const refs = shotReference(shot, film);
  return {
    narration: line || "。",
    prompt: clip(`${imageCue(refs.references, draft)}${motionPrompt(shot)}`, 2000),
    subtitle: line.slice(0, 500),
    duration_seconds: Math.max(1, Math.min(15, Math.round(shot.seconds) || 3)),
    size: shot.size.slice(0, 20),
    angle: (shot.angle || "平视").slice(0, 20),
    move: (shot.move || "固定").slice(0, 20),
    action: clip(shot.action, 1000),
    performance: clip(shot.performance, 1000),
    identity: shotIdentity(shot, film).slice(0, 200),
    voice_id: shotVoiceId(shot, film).slice(0, 64),
    ...(refs.still ? { still: refs.still } : {}),
    ...(!draft && refs.references.length > 0
      ? { references: refs.references.map((item) => item.url) }
      : {}),
    ...(shot.delivery?.trim() ? { delivery: shot.delivery.trim().slice(0, 400) } : {}),
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
      subtitle: "",
      provider: "grok_subscription",
      confirmed: true,
      voice_id: film.narrationVoiceId || film.characters[0]?.voiceId || "eve",
      style_block: (slice.length === 1 ? slice[0]?.styleNote?.trim() || film.styleZh : film.styleZh)
        .trim()
        .slice(0, 400),
      aspect_ratio: film.aspectRatio === "16:9" ? "16:9" : "9:16",
      shots: (slice.length > 0 ? slice : rows)
        .slice(0, 10)
        .map((shot) => oneShot(shot, film, draft)),
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
