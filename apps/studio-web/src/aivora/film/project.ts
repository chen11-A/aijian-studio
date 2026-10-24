import director from "../../../../../services/api/src/aijian_api/agents/prompts/director.md?raw";
import writer from "../../../../../services/api/src/aijian_api/agents/prompts/writer.md?raw";
import { offlineRotation } from "../shot-plan";
import { IMAGE_MODEL, TEXT_MODEL, VIDEO_MODEL } from "../pro/capabilities";

export const FILM_KEY = "aivora.film.active";
export const DEFAULT_STYLE_ZH =
  "写实电影感：自然光、真实镜头、人物有重量，动作遵守重力，不要卡通，不要血腥。";

export const STYLE_PRESETS: { name: string; zh: string }[] = [
  { name: "写实电影感", zh: DEFAULT_STYLE_ZH },
  { name: "都市写实", zh: "都市写实：干净的现场光，肤色自然，背景稍虚，不要夸张色彩。" },
  { name: "古风武侠", zh: "古风武侠：薄雾，衣料和木头的质感，颜色偏淡，不要现代物品。" },
  { name: "民国年代", zh: "民国年代：钨丝灯，暖褐色，颗粒稍重，室内有装饰线条。" },
  { name: "赛博夜景", zh: "赛博夜景：雨、品红和青色的灯光、地面反光，脸要看得清。" },
  { name: "日系动漫", zh: "日系动漫：干净线稿，平涂上色，背景是绘景，不要写成实拍。" },
  { name: "国风动画", zh: "国风动画：立体动画电影画面，肤色柔和，颜色饱满。" },
  { name: "黑白悬疑", zh: "黑白悬疑：硬光，影子深，颗粒明显，不要彩色。" },
];

const PROMPTS: Record<string, string> = { director, writer };

export type FilmCharacter = {
  id: string;
  name: string;
  identity: string;
  voiceId: string;
  source: string;
  userFields: string[];
};

export type FilmScene = {
  id: string;
  no: number;
  title: string;
  where: string;
  text: string;
  source: string;
  userFields: string[];
};

export type FilmShot = {
  id: string;
  sceneId: string;
  no: number;
  size: string;
  move: string;
  seconds: number;
  picture: string;
  action: string;
  performance: string;
  characters: string[];
  source: string;
  userFields: string[];
  poster: string;
  posterPosition: string;
};

export type FilmProject = {
  schemaVersion: number;
  id: string;
  title: string;
  stylePreset: string;
  styleZh: string;
  characters: FilmCharacter[];
  scenes: FilmScene[];
  shots: FilmShot[];
  takesPerShot: number;
  parallelism: number;
  maxRetryRounds: number;
  draft: boolean;
};

export function blankFilm(): FilmProject {
  return {
    schemaVersion: 1,
    id: "film-local",
    title: "未命名作品",
    stylePreset: "写实电影感",
    styleZh: DEFAULT_STYLE_ZH,
    characters: [],
    scenes: [{ id: "scene-1", no: 1, title: "第 1 场", where: "", text: "", source: "user", userFields: [] }],
    shots: [],
    takesPerShot: 2,
    parallelism: 2,
    maxRetryRounds: 2,
    draft: false,
  };
}

export function sampleFilm(): FilmProject {
  const film = blankFilm();
  film.title = "雨夜巷战";
  film.characters = [
    {
      id: "lin",
      name: "林骁",
      identity: "林骁，约二十八岁，短发被雨打湿，左眉有一道细疤，黑高领外套",
      voiceId: "leo",
      source: "sample",
      userFields: [],
    },
    {
      id: "dao",
      name: "刀疤",
      identity: "刀疤，约四十岁，光头，右颊一道长疤，深色外套",
      voiceId: "leo",
      source: "sample",
      userFields: [],
    },
  ];
  film.scenes = [
    { id: "01", no: 1, title: "雨夜·巷口", where: "外景 · 夜", text: "雨夜巷口。", source: "sample", userFields: [] },
    {
      id: "02",
      no: 2,
      title: "巷战·初交手",
      where: "外景 · 夜",
      text: "积水映着霓虹。林骁背靠砖墙。刀疤挥手。林骁侧身让过铁棍。",
      source: "sample",
      userFields: [],
    },
    { id: "03", no: 3, title: "巷战·被围", where: "外景 · 夜", text: "", source: "sample", userFields: [] },
    { id: "04", no: 4, title: "转折·断刀", where: "外景 · 夜", text: "", source: "sample", userFields: [] },
    { id: "05", no: 5, title: "反击", where: "外景 · 夜", text: "", source: "sample", userFields: [] },
    { id: "06", no: 6, title: "余韵·雨停", where: "外景 · 黎明", text: "", source: "sample", userFields: [] },
  ];
  const rows: [string, string, string, string, string, number][] = [
    ["远景", "俯拍窄巷，霓虹倒映在积水里，三道黑影从巷口走来。", "/pro/key.jpg", "50% 18%", "2.0", 2],
    ["特写", "刀背上的雨水一滴滴落下，林骁平稳呼吸。", "/pro/f1.0.jpg", "50% 70%", "1.5", 1.5],
    ["中景", "刀疤叼着烟开口威胁，身后两个打手。", "/pro/f0.2.jpg", "50% 30%", "2.0", 2],
    ["近景", "林骁抬眼，眼神平静，雨水顺着眉骨流下。", "/pro/key.jpg", "20% 52%", "1.5", 1.5],
    ["跟拍", "侧身让过铁棍，反手用刀柄砸中对方手腕。", "/pro/f1.4.jpg", "50% 55%", "3.0", 3],
    ["慢镜", "铁棍落进积水，水花在霓虹里四溅。", "", "", "4.0", 4],
  ];
  film.shots = rows.map((row, index) => ({
    id: `02-shot-${index + 1}`,
    sceneId: "02",
    no: index + 1,
    size: row[0],
    move: index === 4 ? "跟拍" : "固定",
    seconds: row[5],
    picture: row[1],
    action: row[1],
    performance: index === 3 ? "冷静，眼神盯着刀疤。" : "",
    characters: row[1].includes("刀疤") ? ["刀疤"] : ["林骁"],
    source: "sample",
    userFields: [],
    poster: row[2],
    posterPosition: row[3],
  }));
  return film;
}

export function keyframePrompt(shot: FilmShot, film: FilmProject): string {
  const names = new Set(shot.characters);
  const identity = film.characters
    .filter((item) => item.identity && (names.size === 0 || names.has(item.name)))
    .map((item) => item.identity.replace(/。$/, ""))
    .join("。");
  const bits = ["这一镜的起始画面，不是角色定妆照"];
  if (identity) bits.push(identity);
  bits.push((shot.picture || shot.action).replace(/。$/, ""));
  bits.push(film.styleZh.replace(/。$/, ""));
  return `${bits.join("。")}。`;
}

export function videoPrompt(shot: FilmShot): string {
  const motion = (shot.picture || shot.action).replace(/。$/, "");
  return `从这张起始画面开始。${motion}。只做这一个动作，运镜用${shot.move || "固定"}。背景保持稳定。视频不要自己出声。`;
}

export function offlineShots(story: string, sceneId: string): FilmShot[] {
  return offlineRotation(story).map((item) => ({
    id: `${sceneId}-shot-${item.index}`,
    sceneId,
    no: item.index,
    size: item.shotSize,
    move: "固定",
    seconds: Math.min(item.durationSeconds, 5),
    picture: item.narration,
    action: item.action,
    performance: item.performance,
    characters: [],
    source: "offline:director",
    userFields: [],
    poster: "",
    posterPosition: "",
  }));
}

export function applyShots(film: FilmProject, incoming: FilmShot[], sceneId: string): FilmProject {
  const kept = film.shots.filter(
    (shot) => shot.sceneId !== sceneId || shot.userFields.length > 0 || shot.source === "user",
  );
  const locked = new Set(kept.filter((shot) => shot.sceneId === sceneId).map((shot) => shot.id));
  const fresh = incoming.filter((shot) => shot.sceneId === sceneId && !locked.has(shot.id));
  return { ...film, shots: [...kept, ...fresh] };
}

export function agentRequest(agentId: "director" | "writer", context: string, user: string): string {
  const system = (PROMPTS[agentId] ?? "").trim();
  const body = `${system}\n\n上下文：\n${context.trim()}\n\n用户：\n${user.trim()}`;
  return body.length > 7500 ? body.slice(0, 7500) : body;
}

export function parseDirectorShots(text: string, sceneId: string): FilmShot[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !("shots" in value)) return null;
  const rows = (value as { shots?: unknown }).shots;
  if (!Array.isArray(rows)) return null;
  const shots: FilmShot[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const record = row as Record<string, unknown>;
    const picture = [record.action, record.picture, record.narration].find(
      (item) => typeof item === "string" && item.trim(),
    );
    if (typeof picture !== "string") return;
    const seconds = typeof record.seconds === "number" ? record.seconds : 3;
    shots.push({
      id: `${sceneId}-shot-${index + 1}`,
      sceneId,
      no: index + 1,
      size: typeof record.size === "string" ? record.size : "中景",
      move: typeof record.move === "string" ? record.move : "固定",
      seconds: Math.max(1, Math.min(seconds, 15)),
      picture: picture.trim(),
      action: picture.trim(),
      performance: "",
      characters: Array.isArray(record.characters)
        ? record.characters.filter((item): item is string => typeof item === "string")
        : [],
      source: "agent:director",
      userFields: [],
      poster: "",
      posterPosition: "",
    });
  });
  return shots.length > 0 ? shots : null;
}

export function assistantPrompt(userText: string, film: FilmProject | null): string {
  const head = film
    ? `你是这部短剧的助手。作品《${film.title}》。画风：${film.styleZh}。人物：${
        film.characters.map((item) => item.name).join("、") || "还没有"
      }。当前场：${film.scenes[0]?.title ?? "未定"}。用户确认之前，不要改作品。`
    : "你是短剧助手。用户确认之前，不要改作品。";
  const body = `${head}\n\n用户：${userText.trim()}`;
  return body.length > 7500 ? body.slice(0, 7500) : body;
}

export function generationNote(modelIds: readonly string[]): string {
  if (!modelIds.includes(IMAGE_MODEL)) {
    return `模型列表里没有 ${IMAGE_MODEL}，先不生成起始画面。`;
  }
  if (!modelIds.includes(VIDEO_MODEL)) {
    return `模型列表里没有 ${VIDEO_MODEL}，先不生成视频。`;
  }
  return "每个镜头先出自己的起始画面，再变成视频。定妆照没有网址时不附参考图。视频自带的声音关掉。审片还不能自动打分，由你选版本。";
}

export function textModel(modelIds: readonly string[]): string {
  const listed = modelIds.find((id) => id === TEXT_MODEL || id.startsWith("grok-4"));
  return listed || TEXT_MODEL;
}

export function readFilm(storage: Storage): FilmProject | null {
  const raw = storage.getItem(FILM_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<FilmProject>;
    if (!value || typeof value !== "object" || !value.title) return null;
    const base = blankFilm();
    return {
      ...base,
      ...value,
      characters: value.characters ?? [],
      scenes: value.scenes?.length ? value.scenes : base.scenes,
      shots: value.shots ?? [],
      styleZh: value.styleZh || base.styleZh,
    };
  } catch {
    return null;
  }
}

export function writeFilm(storage: Storage, film: FilmProject): void {
  storage.setItem(FILM_KEY, JSON.stringify(film));
}
