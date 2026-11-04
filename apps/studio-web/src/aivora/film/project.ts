import type { TextReviewReport } from "./review-report";
import {
  directorPlanPrompt,
  parseDirectorPlan,
  type ShotDirectorPlan,
  type DirectorSourceRef,
} from "./director-plan";
import type { CostumeRule, CostumeRisk } from "./costume-rules";
import type { WriterElement } from "./writer-elements";
import type { ShotPerformancePlan, PerformanceState } from "./performance-plan";
import type { ShotActionPlan, SceneActionState } from "./action-plan";
import { parseAgentReplyText } from "./agent-reply-compat";
import type {
  SceneCoverage,
  LipSyncState,
  PipelineProgress,
  SceneSound,
  ContinuityNote,
} from "./contracts3j";
import { withStyleBible } from "./style-bible";
import type { ProductionPipeline } from "./production-pipeline";
import { normalizeAgeBand, normalizeGender } from "./cast-traits";
import {
  mergeAdjacentShots,
  sceneDisplayTitle,
  shotLines,
  suggestedShotCount,
} from "./director-continuity";
import action from "../../../../../services/api/src/aijian_api/agents/prompts/action.md?raw";
import art from "../../../../../services/api/src/aijian_api/agents/prompts/art.md?raw";
import director from "../../../../../services/api/src/aijian_api/agents/prompts/director.md?raw";
import performance from "../../../../../services/api/src/aijian_api/agents/prompts/performance.md?raw";
import prompter from "../../../../../services/api/src/aijian_api/agents/prompts/prompter.md?raw";
import qc from "../../../../../services/api/src/aijian_api/agents/prompts/qc.md?raw";
import writer from "../../../../../services/api/src/aijian_api/agents/prompts/writer.md?raw";
import { offlineRotation } from "../shot-plan";
import { IMAGE_MODEL, TEXT_MODEL, VIDEO_MODEL } from "../pro/capabilities";
import {
  attachScriptLines,
  classifyShotSize,
  gazeHandoff,
  identityLock,
  lineInScript,
  plainCue,
  soundFromDirector,
  type AgentId,
} from "./phase2";
import {
  emptySoundPlan,
  normalizeAudioClips,
  normalizeSoundPlan,
  storedShotSeconds,
  type AudioClip,
  type ShotSoundPlan,
} from "./audio";

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

const PROMPTS: Record<AgentId, string> = {
  director,
  writer,
  action,
  performance,
  art,
  prompter,
  qc,
};

export type FilmJob = {
  id: string;
  attempt?: number;
  takeId?: string;
  interruptedFrom?: "queued" | "running";
  shotId: string;
  kind: "video" | "keyframe" | "portrait";
  take: number;
  status: "queued" | "blocked" | "running" | "done" | "failed" | "cancelled";
  prompt: string;
  reason: string;
};

export type FilmLocation = {
  userFields?: string[];
  artFields?: { prompt?: string; ambience?: string; layout?: string };
  layout?: string;
  referenceLayout?: string;
  referenceImage?: string;
  referenceStyleRevision?: number;
  id: string;
  name: string;
  prompt: string;
  ambience: string;
};

export type FilmProp = {
  userFields?: string[];
  artFields?: { note?: string };
  id: string;
  name: string;
  note: string;
};

export type FilmPortrait = {
  view: string;
  prompt: string;
  url: string;
};

export type FilmStill = {
  id: string;
  prompt: string;
  url: string;
};

export type FilmTake = {
  interruptedFrom?: "queued" | "running";
  lipSync?: LipSyncState;
  lipSyncReason?: string;
  id: string;
  shotId: string;
  index: number;
  status: "queued" | "running" | "done" | "failed";
  stillUrl: string;
  videoPath: string;
  videoUrl: string;
  prompt: string;
  createdAt: string;
  reason: string;
};

export type FilmCharacter = {
  id: string;
  name: string;
  identity: string;
  gender?: "男" | "女" | "";
  ageBand?: "儿童" | "少年" | "青年" | "中年" | "老年" | "";
  voiceCode?: string;
  voiceId: string;
  source: string;
  userFields: string[];
  portraits: FilmPortrait[];
};

export type FilmScene = {
  elements?: WriterElement[];
  /** Only uniquely attributable source paragraphs, in original order. */
  sourceParagraphIds?: string[];
  /** Snapshot invalidates writer annotations after a scene edit. */
  writerSourceText?: string;
  /** Original paragraph order in the rebuilt text; ownership may still need review. */
  writerParagraphIds?: string[];
  performanceState?: PerformanceState;
  actionState?: SceneActionState;
  sound?: SceneSound;
  coverage?: SceneCoverage;
  id: string;
  no: number;
  title: string;
  where: string;
  text: string;
  /** Phase 2. Empty until a scene writes 环境音. */
  ambience: string;
  source: string;
  userFields: string[];
  /** Writer tags such as 打斗 or 哭戏. Empty when the scene was typed in by hand. */
  tags?: string[];
  paragraphCoverage?: {
    ok: boolean;
    missingParagraphs: string[];
    duplicateParagraphs: string[];
    invalidParagraphs: string[];
    crossSceneRisk: boolean;
  };
};

export type FilmShot = {
  directorPlan?: ShotDirectorPlan;
  performancePlan?: ShotPerformancePlan;
  actionPlan?: ShotActionPlan;
  continuityFromShotId?: string;
  continuityFrame?: {
    sourceShotId: string;
    sourceTakeId: string;
    sourceVideoPath: string;
    path: string;
  };
  continuity?: ContinuityNote[];
  id: string;
  sceneId: string;
  no: number;
  size: string;
  angle: string;
  move: string;
  seconds: number;
  picture: string;
  action: string;
  performance: string;
  performanceSource?: string;
  /** Optional per-shot style. Empty means the project style bible. */
  styleNote?: string;
  characters: string[];
  line: string;
  /** Ordered dialogue; line remains a newline-joined compatibility view. */
  lines?: { speaker: string; text: string }[];
  /** Who says the line. Empty means the line names them, or the narrator. */
  speaker?: string;
  /** How this line should be spoken: tone, pace, pauses, emotion. */
  delivery?: string;
  /** Phase 2 sound block. Generation ignores it in Phase 1. */
  sound: ShotSoundPlan;
  /** Insert and other non-size labels. Empty when the size already says it. */
  tag?: string;
  blocking?: string;
  facing?: string;
  /** Director generation plans, separate from visible picture and later keyframe polishing. */
  directorFramePrompt?: string;
  directorVideoPrompt?: string;
  promptZh?: string;
  promptEn?: string;
  source: string;
  userFields: string[];
  poster: string;
  posterPosition: string;
  regenerationRequired?: { code: "STYLE_CHANGED"; styleRevision: number };
  takes: FilmTake[];
  stills: FilmStill[];
  selectedTakeId: string;
};

export type FilmProject = {
  reviewReports?: TextReviewReport[];
  costumes?: CostumeRule[];
  costumeRisks?: CostumeRisk[];
  pipeline?: PipelineProgress;
  productionPipeline?: ProductionPipeline;
  productionInputFingerprint?: string;
  unassignedBeats?: { sceneId: string; text: string }[];
  schemaVersion: number;
  id: string;
  seriesId: string;
  seriesTitle: string;
  episodeNo: number;
  episodeTitle: string;
  title: string;
  stylePreset: string;
  styleZh: string;
  styleRevision?: number;
  characters: FilmCharacter[];
  scenes: FilmScene[];
  shots: FilmShot[];
  takesPerShot: number;
  parallelism: number;
  maxRetryRounds: number;
  draft: boolean;
  jobs: FilmJob[];
  locations: FilmLocation[];
  props: FilmProp[];
  /** Imported novel text. Empty until the user imports a file. */
  sourceText: string;
  savedAt: string;
  directory: string;
  assemblyPath: string;
  assemblyUrl: string;
  exportPath: string;
  /** Phase 2. Empty until a series picks a narration voice. */
  narrationVoiceId: string;
  /** Phase 3 timeline audio. Empty until 剪辑 writes clips. */
  audioClips: AudioClip[];
  /** Backend ledger id. Empty until the desktop creates a project for this film. */
  backendProjectId: string;
  /** Frame shape for stills and video. Chosen when the film is created. */
  aspectRatio: "9:16" | "16:9";
};

export function newFilmId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `film_${hex}`;
}

export function blankFilm(): FilmProject {
  const seriesId = newFilmId();
  return {
    schemaVersion: 1,
    id: newFilmId(),
    seriesId,
    seriesTitle: "未命名作品",
    episodeNo: 1,
    episodeTitle: "第 1 集",
    title: "未命名作品",
    stylePreset: "写实电影感",
    styleZh: DEFAULT_STYLE_ZH,
    characters: [],
    scenes: [
      {
        id: "scene-1",
        no: 1,
        title: "地点待定 · 时间待定",
        where: "",
        text: "",
        ambience: "",
        source: "user",
        userFields: [],
      },
    ],
    shots: [],
    takesPerShot: 1,
    parallelism: 2,
    maxRetryRounds: 2,
    draft: false,
    jobs: [],
    locations: [],
    props: [],
    sourceText: "",
    savedAt: "",
    directory: "",
    assemblyPath: "",
    assemblyUrl: "",
    exportPath: "",
    narrationVoiceId: "",
    audioClips: [],
    backendProjectId: "",
    aspectRatio: "16:9",
  };
}

export function newEpisode(current: FilmProject): FilmProject {
  const next = blankFilm();
  next.seriesId = current.seriesId;
  next.seriesTitle = current.seriesTitle || current.title;
  next.episodeNo = current.episodeNo + 1;
  next.episodeTitle = `第 ${next.episodeNo} 集`;
  next.title = next.seriesTitle;
  next.stylePreset = current.stylePreset;
  next.styleZh = current.styleZh;
  next.styleRevision = current.styleRevision;
  next.narrationVoiceId = current.narrationVoiceId;
  next.backendProjectId = current.backendProjectId;
  next.aspectRatio = current.aspectRatio === "16:9" ? "16:9" : "9:16";
  next.characters = current.characters.map((item) => ({
    ...item,
    portraits: item.portraits.map((portrait) => ({ ...portrait })),
  }));
  next.locations = (current.locations ?? []).map((item) => ({
    ...item,
    ambience: item.ambience ?? "",
  }));
  next.props = (current.props ?? []).map((item) => ({ ...item }));
  return next;
}

export function sampleFilm(): FilmProject {
  const film = blankFilm();
  film.id = "film_sample000000000001";
  film.seriesId = "film_sampleseries00001";
  film.seriesTitle = "雨夜巷战";
  film.episodeNo = 1;
  film.episodeTitle = "第 1 集";
  film.title = "雨夜巷战";
  film.characters = [
    {
      id: "lin",
      name: "林骁",
      identity: "林骁，约二十八岁，短发被雨打湿，左眉有一道细疤，黑高领外套",
      voiceId: "leo",
      source: "sample",
      userFields: [],
      portraits: [],
    },
    {
      id: "dao",
      name: "刀疤",
      identity: "刀疤，约四十岁，光头，右颊一道长疤，深色外套",
      voiceId: "rex",
      source: "sample",
      userFields: [],
      portraits: [],
    },
  ];
  film.scenes = [
    {
      id: "01",
      no: 1,
      title: "雨夜·巷口",
      where: "外景 · 夜",
      text: "雨夜巷口。",
      ambience: "",
      source: "sample",
      userFields: [],
    },
    {
      id: "02",
      no: 2,
      title: "巷战·初交手",
      where: "外景 · 夜",
      text: "积水映着霓虹。林骁背靠砖墙。刀疤挥手。林骁侧身让过铁棍。",
      ambience: "",
      source: "sample",
      userFields: [],
    },
    {
      id: "03",
      no: 3,
      title: "巷战·被围",
      where: "外景 · 夜",
      text: "",
      ambience: "",
      source: "sample",
      userFields: [],
    },
    {
      id: "04",
      no: 4,
      title: "转折·断刀",
      where: "外景 · 夜",
      text: "",
      ambience: "",
      source: "sample",
      userFields: [],
    },
    {
      id: "05",
      no: 5,
      title: "反击",
      where: "外景 · 夜",
      text: "",
      ambience: "",
      source: "sample",
      userFields: [],
    },
    {
      id: "06",
      no: 6,
      title: "余韵·雨停",
      where: "外景 · 黎明",
      text: "",
      ambience: "",
      source: "sample",
      userFields: [],
    },
  ];
  const rows: [string, string, string, number][] = [
    ["远景", "俯拍窄巷，霓虹倒映在积水里，三道黑影从巷口走来。", "俯拍", 2],
    ["特写", "刀背上的雨水一滴滴落下，林骁平稳呼吸。", "平视", 1.5],
    ["中景", "刀疤叼着烟开口威胁，身后两个打手。", "平视", 2],
    ["近景", "林骁抬眼，眼神平静，雨水顺着眉骨流下。", "平视", 1.5],
    ["中景", "侧身让过铁棍，反手用刀柄砸中对方手腕。", "平视", 3],
    ["全景", "铁棍落进积水，水花在霓虹里四溅。", "俯拍", 4],
  ];
  film.shots = rows.map((row, index) => ({
    id: `02-shot-${index + 1}`,
    sceneId: "02",
    no: index + 1,
    size: row[0],
    angle: row[2],
    move: index === 4 ? "跟拍" : index === 5 ? "慢镜" : "固定",
    seconds: row[3],
    picture: row[1],
    action: index === 4 ? "侧身让过铁棍，反手砸中手腕。" : row[1],
    performance: index === 3 ? "冷静，眼神盯着刀疤。" : "",
    characters: row[1].includes("刀疤") ? ["刀疤"] : ["林骁"],
    line: ["", "", "东西交出来，留你一条腿。", "雨太大，我听不清。", "", "一起上！"][index] ?? "",
    sound: emptySoundPlan(),
    source: "sample",
    userFields: [],
    poster: "",
    posterPosition: "",
    takes: [],
    stills: [],
    selectedTakeId: "",
  }));
  return film;
}

export function shotIdentity(shot: FilmShot, film: FilmProject): string {
  const names = new Set(shot.characters);
  return film.characters
    .filter((item) => item.identity && (names.size === 0 || names.has(item.name)))
    .map((item) => item.identity.replace(/。$/, ""))
    .join("。");
}

export function keyframePrompt(shot: FilmShot, film: FilmProject): string {
  const edited = shot.userFields.includes("picture") || shot.userFields.includes("action");
  const frame = edited ? "" : shot.promptZh?.trim() || shot.directorFramePrompt?.trim() || "";
  const picture = frame || (shot.picture || shot.action).trim();
  const base = picture.startsWith("这一镜的起始画面")
    ? picture.endsWith("。")
      ? picture
      : `${picture}。`
    : framedKeyframe(shot, film, picture);
  const notes = directorPlanPrompt(shot, "frame");
  return withStyleBible(
    lockKeyframe([base, notes].filter(Boolean).join("\n"), shot, film),
    film.styleZh,
  );
}

function framedKeyframe(shot: FilmShot, film: FilmProject, picture: string): string {
  const bits = ["这一镜的起始画面，不是角色定妆照"];
  if (picture) bits.push(picture.replace(/。$/, ""));
  if (shot.size) bits.push(`景别${shot.size}`);
  if (shot.tag) bits.push(shot.tag);
  if (shot.angle) bits.push(`角度${shot.angle}`);
  if (shot.move) bits.push(`运镜${shot.move}`);
  const action = shot.action.trim().replace(/。$/, "");
  if (action && action !== picture.replace(/。$/, "")) bits.push(`动作要点${action}`);
  if (shot.performance.trim()) bits.push(`表演${shot.performance.trim().replace(/。$/, "")}`);
  if (shot.styleNote?.trim() && !film.styleZh.includes(shot.styleNote.trim()))
    bits.push(shot.styleNote.trim());
  return `${bits.filter(Boolean).join("。")}。`;
}

function lockKeyframe(body: string, shot: FilmShot, film: FilmProject): string {
  const names = new Set(shot.characters);
  let next = body;
  for (const person of film.characters) {
    if (!person.identity.trim()) continue;
    if (names.size > 0 && !names.has(person.name)) continue;
    const lock = identityLock(person.identity);
    if (lock && !next.includes(lock)) next += lock;
  }
  const gaze = gazeHandoff(shot.characters);
  if (gaze && !next.includes("视线")) next += gaze;
  return next;
}

export function videoPrompt(shot: FilmShot): string {
  const edited = shot.userFields.includes("picture") || shot.userFields.includes("action");
  const explicit = shot.userFields.includes("promptZh") ? shot.promptZh?.trim() : "";
  const motion = (
    edited
      ? shot.picture || shot.action
      : explicit || shot.directorVideoPrompt || shot.picture || shot.action
  ).replace(/。$/, "");
  const spoken = shot.line.trim() ? `台词原句：「${shot.line.trim()}」。不要背景音乐。` : "";
  return `从这张起始画面开始。${motion}。只做这一个动作，运镜用${shot.move || "固定"}。背景保持稳定。视频不要自己出声。${spoken}${directorPlanPrompt(shot, "video") ? `\n${directorPlanPrompt(shot, "video")}` : ""}`;
}

export function offlineShots(story: string, sceneId: string): FilmShot[] {
  const rows = offlineRotation(story).map((item) => ({
    id: `${sceneId}-shot-${item.index}`,
    sceneId,
    no: item.index,
    size: item.shotSize,
    move: "固定",
    seconds: storedShotSeconds(item.durationSeconds),
    picture: item.narration,
    action: item.action,
    performance: item.performance,
    characters: [],
    line: "",
    sound: emptySoundPlan(),
    source: "offline:director",
    userFields: [],
    poster: "",
    posterPosition: "",
    angle: "平视",
    takes: [],
    stills: [],
    selectedTakeId: "",
  }));
  return attachScriptLines(rows, story);
}

export function applyShots(film: FilmProject, incoming: FilmShot[], sceneId: string): FilmProject {
  const groups = new Map<string, FilmShot[]>();
  for (const shot of incoming) {
    const id = shot.sceneId || sceneId;
    const list = groups.get(id) ?? [];
    list.push({ ...shot, sceneId: id });
    groups.set(id, list);
  }
  if (groups.size === 0) return film;
  let shots = film.shots;
  const sceneOrder = new Map(film.scenes.map((item, index) => [item.id, index]));
  for (const [id, fresh] of groups) {
    const kept = shots.filter(
      (shot) => shot.sceneId !== id || shot.userFields.length > 0 || shot.source === "user",
    );
    const locked = new Set(kept.filter((shot) => shot.sceneId === id).map((shot) => shot.id));
    shots = [...kept, ...fresh.filter((shot) => !locked.has(shot.id))];
  }
  shots = shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const sceneDelta =
        (sceneOrder.get(a.shot.sceneId) ?? 99) - (sceneOrder.get(b.shot.sceneId) ?? 99);
      return sceneDelta || a.shot.no - b.shot.no || a.index - b.index;
    })
    .map((item) => item.shot);
  return { ...film, shots };
}

export function agentRequest(agentId: AgentId, context: string, user: string): string {
  const system = (PROMPTS[agentId] ?? "").trim();
  const coverage =
    agentId === "director"
      ? "\n本次镜头数上限是合并节拍的建议预算，不是截断原文的许可。每句台词和每场末段必须完整覆盖；无法合并时保留全部镜头并说明超额，不得省略剧情。"
      : "";
  const body = `${system}${coverage}\n\n上下文：\n${context.trim()}\n\n用户：\n${user.trim()}`;
  return body;
}

export type DirectorSceneRef = { id: string; title: string; where: string } & DirectorSourceRef;

function placeName(value: string): string {
  return value.split(/[·_]/)[0]?.trim() ?? "";
}

function matchDirectorScene(
  block: Record<string, unknown>,
  scenes: DirectorSceneRef[],
  requestedId: string,
  index: number,
): DirectorSceneRef | undefined {
  const id = typeof block.scene_id === "string" ? block.scene_id.trim() : "";
  const exact = scenes.find((item) => id && item.id === id);
  if (exact) return exact;
  const hint = [block.place, block.title, id]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ");
  const byPlace = scenes.filter((item) => {
    const title = item.title.trim();
    const where = placeName(item.where);
    return (title && hint.includes(title)) || (where.length >= 2 && hint.includes(where));
  });
  if (byPlace.length === 1) return byPlace[0];
  if (scenes.length === 1) return scenes[0];
  const requested = scenes.find((item) => item.id === requestedId);
  return scenes[index] ?? requested;
}

/** Suggested pacing only. Never discard source material to meet this budget. */
export function shotBudget(sceneText: string): number | null {
  const length = sceneText.trim().length;
  if (!length) return null;
  return Math.min(16, Math.max(1, Math.round(length / 50)));
}

// Ephemeral parser metadata survives merge spreads, but is removed before persistence.
const directorConnection = Symbol("directorConnection");
type DirectorConnection = { previous: boolean; explicit: string; rawId: string };
type ParsedDirectorShot = FilmShot & { [directorConnection]?: DirectorConnection };

export function parseDirectorShots(
  text: string,
  sceneId: string,
  sceneText = "",
  scenes: DirectorSceneRef[] = [],
  preserveSource = true,
): FilmShot[] | null {
  const value = parseAgentReplyText("director", text);
  if (!value || typeof value !== "object") return null;
  const wrapped = (value as { scenes?: unknown; shots?: unknown }).scenes;
  if (Array.isArray(wrapped) && !Array.isArray((value as { shots?: unknown }).shots)) {
    const all: FilmShot[] = [];
    wrapped.forEach((block, index) => {
      if (!block || typeof block !== "object") return;
      const record = block as Record<string, unknown>;
      const target =
        scenes.length > 0 ? matchDirectorScene(record, scenes, sceneId, index) : undefined;
      const nested = parseDirectorShots(
        JSON.stringify({ shots: record.shots ?? [] }),
        target?.id ?? sceneId,
        target?.text ?? sceneText,
        target ? [target] : [],
        false,
      );
      if (nested) all.push(...nested);
    });
    if (!all.length) return null;
    return [...new Set(all.map((shot) => shot.sceneId))].flatMap((id) =>
      completeDirectorCoverage(
        all.filter((shot) => shot.sceneId === id),
        id,
        scenes.find((scene) => scene.id === id)?.text ?? sceneText,
      ),
    );
  }
  if (!("shots" in value)) return null;
  const rows = (value as { shots?: unknown }).shots;
  if (!Array.isArray(rows)) return null;
  const shots: ParsedDirectorShot[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const record = row as Record<string, unknown>;
    const rawLines = Array.isArray(record.lines)
      ? record.lines
      : Array.isArray(record.dialogue)
        ? record.dialogue
        : [];
    const parsedLines = rawLines.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const text =
        typeof value.text === "string"
          ? value.text
          : typeof value.line === "string"
            ? value.line
            : "";
      const valid = lineInScript(sceneText, text);
      return valid
        ? [{ speaker: typeof value.speaker === "string" ? value.speaker.trim() : "", text: valid }]
        : [];
    });
    const picture = [
      record.picture,
      record.video_prompt,
      record.narration,
      record.start_frame_prompt,
      record.action,
    ].find((item) => typeof item === "string" && item.trim());
    if (typeof picture !== "string") return;
    const told = plainCue(picture.trim());
    const action = typeof record.action === "string" ? plainCue(record.action.trim()) : "";
    const seconds = typeof record.seconds === "number" ? record.seconds : 3;
    const sized = classifyShotSize(typeof record.size === "string" ? record.size : "中景");
    const tag = typeof record.tag === "string" && record.tag.trim() ? record.tag.trim() : sized.tag;
    const proposed = typeof record.line === "string" && record.line.trim() ? record.line : "";
    const performance = typeof record.performance === "string" ? record.performance.trim() : "";
    const size = sized.size;
    const characters = Array.isArray(record.characters)
      ? record.characters.filter((item): item is string => typeof item === "string")
      : [];
    const line = parsedLines.length
      ? parsedLines.map((item) => item.text).join("\n")
      : lineInScript(sceneText, proposed);
    const named =
      typeof record.speaker === "string" && record.speaker.trim()
        ? record.speaker.trim()
        : parsedLines.length && new Set(parsedLines.map((item) => item.speaker)).size === 1
          ? (parsedLines[0]?.speaker ?? "")
          : "";
    const speaker = named || (line && characters.length === 1 ? characters[0]!.trim() : "");
    const parsed: ParsedDirectorShot = {
      [directorConnection]: {
        previous: record.connect_previous === true || record.continuity_from_prev === true,
        explicit:
          typeof record.continuity_from_shot_id === "string"
            ? record.continuity_from_shot_id.trim()
            : "",
        rawId: typeof record.id === "string" ? record.id.trim() : "",
      },
      id:
        typeof record.id === "string" && /^scene-\d+-shot-\d+$/.test(record.id.trim())
          ? record.id.trim()
          : `${sceneId}-shot-${index + 1}`,
      sceneId,
      no: index + 1,
      size,
      tag,
      move: typeof record.move === "string" ? record.move : "固定",
      seconds: storedShotSeconds(seconds),
      picture: told,
      ...(typeof record.start_frame_prompt === "string" && record.start_frame_prompt.trim()
        ? { directorFramePrompt: plainCue(record.start_frame_prompt.trim()) }
        : {}),
      ...(typeof record.video_prompt === "string" && record.video_prompt.trim()
        ? { directorVideoPrompt: plainCue(record.video_prompt.trim()) }
        : {}),
      action: action && action !== told ? action : "",
      performance: plainCue(performance),
      characters,
      line,
      lines: parsedLines.length ? parsedLines : line ? [{ speaker, text: line }] : [],
      speaker,
      delivery: typeof record.delivery === "string" ? record.delivery.trim() : "",
      blocking: Array.isArray(record.blocking)
        ? record.blocking
            .map((item) =>
              typeof item === "string"
                ? item
                : item && typeof item === "object"
                  ? ["who", "where", "note", "position"]
                      .map((key) => (item as Record<string, unknown>)[key])
                      .filter(
                        (part): part is string =>
                          typeof part === "string" && part.trim().length > 0,
                      )
                      .join("")
                  : "",
            )
            .filter(Boolean)
            .join("；")
        : typeof record.blocking === "string"
          ? record.blocking
          : "",
      facing: typeof record.facing === "string" ? record.facing : "",
      sound: soundFromDirector(record, ""),
      source: "agent:director",
      userFields: [],
      poster: "",
      posterPosition: "",
      angle: typeof record.angle === "string" ? record.angle : "平视",
      takes: [],
      stills: [],
      selectedTakeId: "",
    };
    const plan = parseDirectorPlan(
      record,
      parsed,
      scenes.find((scene) => scene.id === sceneId && scene.text === sceneText),
    );
    if (plan) parsed.directorPlan = plan;
    shots.push(parsed);
  });
  const varied =
    shots.length > 0 && shots.every((shot) => shot.seconds === 8)
      ? shots.map((shot, index) => ({
          ...shot,
          seconds: [3, 4, 5, 2, 4, 6, 3, 5][index % 8] ?? 4,
          ...(shot.directorPlan
            ? { directorPlan: { ...shot.directorPlan, timingStatus: "needs_review" as const } }
            : {}),
        }))
      : shots;
  if (!varied.length) return null;
  return preserveSource ? completeDirectorCoverage(varied, sceneId, sceneText) : varied;
}

function completeDirectorCoverage(
  shots: FilmShot[],
  sceneId: string,
  sceneText: string,
): FilmShot[] {
  const originals = shots as ParsedDirectorShot[];
  const merged = mergeAdjacentShots(
    shots.map((shot) => ({ ...shot, sceneId })),
    sceneText.trim() ? suggestedShotCount(sceneText) : 16,
  ) as ParsedDirectorShot[];
  const starts = merged.map((shot) =>
    originals.findIndex((original) => original[directorConnection] === shot[directorConnection]),
  );
  const groups = starts.map((start, index) =>
    originals.slice(start, starts[index + 1] ?? originals.length),
  );
  return merged.map((shot, index) => {
    const clean = { ...shot };
    delete clean[directorConnection];
    const group = groups[index] ?? [];
    const requested = group.some((item) => {
      const meta = item[directorConnection];
      return meta?.previous || meta?.explicit;
    });
    if (!requested) return clean;
    const previous = merged[index - 1];
    const meta = shot[directorConnection];
    const previousGroup = groups[index - 1] ?? [];
    const explicitMatches =
      !meta?.explicit ||
      (previousGroup.length === 1 &&
        originals.filter(
          (item) => item.id === meta.explicit || item[directorConnection]?.rawId === meta.explicit,
        ).length === 1 &&
        previousGroup.some(
          (item) => item.id === meta.explicit || item[directorConnection]?.rawId === meta.explicit,
        ));
    if (group.length === 1 && previous && previous.sceneId === shot.sceneId && explicitMatches) {
      clean.continuityFromShotId = previous.id;
    } else {
      clean.continuity = [
        {
          kind: "cut",
          text: "未自动衔接：首镜、合镜或前镜标识不明确，请确认紧邻前镜后重试。",
        },
      ];
    }
    return clean;
  });
}

export function assistantPrompt(userText: string, film: FilmProject | null): string {
  const head = film
    ? `你是这部短剧的助手。作品《${film.title}》。画风：${film.styleZh}。人物：${
        film.characters.map((item) => item.name).join("、") || "还没有"
      }。当前场：${film.scenes[0]?.title ?? "未定"}。用户确认之前，不要改作品。`
    : "你是短剧助手。用户确认之前，不要改作品。";
  const body = `${head}\n\n用户：${userText.trim()}`;
  return body;
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
  const text = modelIds.filter(
    (id) => id.startsWith("grok-") && !id.includes("imagine") && !id.includes("tts"),
  );
  return (
    text.find((id) => id === TEXT_MODEL) ||
    text.find((id) => id.startsWith("grok-4")) ||
    text[0] ||
    ""
  );
}

/** A previous session cannot still be queued after the app opens the film again. */
export function interruptStaleWork(film: FilmProject): { film: FilmProject; interrupted: boolean } {
  const pending = (status: string) => status === "queued" || status === "running";
  const interrupted =
    film.jobs.some((job) => pending(job.status)) ||
    film.shots.some((shot) => shot.takes.some((take) => pending(take.status)));
  if (!interrupted) return { film, interrupted: false };
  return {
    interrupted: true,
    film: {
      ...film,
      jobs: film.jobs.map((job) =>
        pending(job.status)
          ? {
              ...job,
              interruptedFrom: job.status as "queued" | "running",
              status: "failed",
              reason: "已中断",
            }
          : job,
      ),
      shots: film.shots.map((shot) => ({
        ...shot,
        takes: shot.takes.map((take) =>
          pending(take.status)
            ? {
                ...take,
                interruptedFrom: take.status as "queued" | "running",
                status: "failed",
                reason: "已中断，可以重试。",
              }
            : take,
        ),
      })),
    },
  };
}

/** Read pre-C13 single reminders as arrays without losing existing director cut notes. */
function upgradeContinuity(value: unknown): ContinuityNote[] | undefined {
  if (value === undefined || value === null) return undefined;
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item): item is ContinuityNote => {
      if (!item || typeof item !== "object") return false;
      const note = item as Record<string, unknown>;
      return (
        typeof note.kind === "string" &&
        ["missing_look", "prop", "gaze", "axis", "cut"].includes(note.kind) &&
        typeof note.text === "string" &&
        Boolean(note.text.trim())
      );
    })
    .map(({ kind, text }) => ({ kind, text }));
}

export function upgradeFilm(value: Partial<FilmProject> | null | undefined): FilmProject | null {
  if (!value || typeof value !== "object" || !value.title) return null;
  try {
    const base = blankFilm();
    return {
      ...base,
      ...value,
      id: value.id || base.id,
      seriesId: value.seriesId || value.id || base.seriesId,
      seriesTitle: value.seriesTitle || value.title || base.seriesTitle,
      episodeNo: value.episodeNo || 1,
      episodeTitle: value.episodeTitle || "第 1 集",
      characters: (value.characters ?? []).map((item) => ({
        ...item,
        gender: normalizeGender(item.gender),
        ageBand: normalizeAgeBand(item.ageBand),
        portraits: item.portraits ?? [],
      })),
      scenes: (value.scenes?.length ? value.scenes : base.scenes).map((item) => ({
        ...item,
        ambience: item.ambience ?? "",
        title: sceneDisplayTitle(item.title, item.where, item.text),
      })),
      shots: (value.shots ?? []).map((shot) => ({
        ...shot,
        continuity: upgradeContinuity(shot.continuity),
        lines: shotLines({
          ...shot,
          line: shot.line ?? (shot.lines ?? []).map((line) => line.text).join("\n"),
        }),
        line: shot.line ?? (shot.lines ?? []).map((line) => line.text).join("\n"),
        angle: shot.angle ?? "平视",
        sound: normalizeSoundPlan(shot.sound),
        size: classifyShotSize(shot.size || "中景").size,
        tag: shot.tag || classifyShotSize(shot.size || "中景").tag,
        seconds: storedShotSeconds(shot.seconds),
        takes: shot.takes ?? [],
        stills: shot.stills ?? [],
        selectedTakeId: shot.selectedTakeId ?? "",
        poster: shot.poster?.startsWith("/pro/") ? "" : (shot.poster ?? ""),
      })),
      jobs: value.jobs ?? [],
      locations: (value.locations ?? []).map((item) => ({
        ...item,
        ambience: item.ambience ?? "",
      })),
      props: value.props ?? [],
      sourceText: value.sourceText ?? "",
      styleZh: value.styleZh || base.styleZh,
      savedAt: value.savedAt ?? "",
      directory: value.directory ?? "",
      assemblyPath: value.assemblyPath ?? "",
      assemblyUrl: "",
      exportPath: value.exportPath ?? "",
      narrationVoiceId: value.narrationVoiceId ?? "",
      audioClips: normalizeAudioClips(value.audioClips),
      backendProjectId: typeof value.backendProjectId === "string" ? value.backendProjectId : "",
      aspectRatio: value.aspectRatio === "16:9" ? "16:9" : "9:16",
    };
  } catch {
    return null;
  }
}

export function readFilm(storage: Storage): FilmProject | null {
  const raw = storage.getItem(FILM_KEY);
  if (!raw) return null;
  try {
    return upgradeFilm(JSON.parse(raw) as Partial<FilmProject>);
  } catch {
    return null;
  }
}

export function writeFilm(storage: Storage, film: FilmProject): void {
  storage.setItem(FILM_KEY, JSON.stringify(film));
}
