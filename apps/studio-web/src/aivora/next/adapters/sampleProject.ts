import { emptySoundPlan } from "../../film/audio";
import {
  DEFAULT_STYLE_ZH,
  type FilmProject,
  type FilmShot,
  type FilmTake,
} from "../../film/project";
import type { QcReport } from "../qcReport";

/**
 * Example data for the adapter tests and story pages: one episode of 《雨夜旧书店》 as the
 * desktop would save it, typed as FilmProject so it keeps the real shape. Nothing in it is a
 * real project, file or task. It holds one of each case the adapters handle: two finished
 * versions, a version the export does not use, a take marked 已中断, one still generating, a
 * job that was never sent, a paused take and a cancelled one.
 */
const FOLDER = "/home/demo/.config/AIVORA/films/film_sample3jseries000001";

const MADE_AT = "2026-11-04T08:00:00.000Z";

function take(
  over: Partial<FilmTake> & Pick<FilmTake, "id" | "shotId" | "index" | "status">,
): FilmTake {
  const done = over.status === "done";
  return {
    stillUrl: done ? `${FOLDER}/stills/${over.id}.png` : "",
    videoPath: done ? `${FOLDER}/takes/${over.id}.mp4` : "",
    videoUrl: "",
    prompt: "",
    createdAt: MADE_AT,
    reason: "",
    ...over,
  };
}

function shot(over: Partial<FilmShot> & Pick<FilmShot, "id" | "sceneId" | "no">): FilmShot {
  return {
    size: "中景",
    angle: "平视",
    move: "固定",
    seconds: 4,
    picture: "",
    action: "",
    performance: "",
    characters: [],
    line: "",
    sound: emptySoundPlan(),
    source: "agent:director",
    userFields: [],
    poster: "",
    posterPosition: "",
    takes: [],
    stills: [],
    selectedTakeId: "",
    ...over,
  };
}

const mood = (musicMood: string) => ({ ...emptySoundPlan(), musicMood });

export const SAMPLE_PROJECT: FilmProject = {
  schemaVersion: 1,
  id: "film_sample3jepisode000001",
  seriesId: "film_sample3jseries000001",
  seriesTitle: "雨夜旧书店",
  episodeNo: 1,
  episodeTitle: "第 1 集",
  title: "雨夜旧书店",
  stylePreset: "写实电影感",
  styleZh: DEFAULT_STYLE_ZH,
  characters: [
    {
      id: "cast-1",
      name: "林晚",
      identity: "女，二十六岁，扎着低马尾，袖口卷到手肘",
      gender: "女",
      ageBand: "青年",
      voiceId: "ara",
      source: "script",
      userFields: [],
      portraits: [],
    },
    {
      id: "cast-2",
      name: "沈砚",
      identity: "男，三十岁上下，眉骨很高，左手虎口有一道旧疤，黑色风衣",
      gender: "男",
      ageBand: "青年",
      voiceId: "leo",
      source: "script",
      userFields: [],
      portraits: [],
    },
  ],
  scenes: [
    {
      id: "scene-1",
      no: 1,
      title: "雨夜旧书店",
      where: "内景 · 夜",
      text: "入秋后的第一场大雨来得又急又猛。巷子尽头那家“晚照书店”还亮着灯。",
      ambience: "",
      source: "agent:writer",
      userFields: [],
    },
    {
      id: "scene-2",
      no: 2,
      title: "码头仓库",
      where: "内景 · 夜",
      text: "城东废弃的码头仓库。铁皮屋顶被雨点砸得轰轰作响。",
      ambience: "",
      source: "agent:writer",
      userFields: [],
    },
    {
      id: "scene-3",
      no: 3,
      title: "医院走廊",
      where: "内景 · 凌晨",
      text: "凌晨两点，市医院急诊室的走廊空荡荡的。",
      ambience: "",
      source: "agent:writer",
      userFields: [],
    },
  ],
  shots: [
    shot({
      id: "scene-1-shot-1",
      sceneId: "scene-1",
      no: 1,
      size: "远景",
      picture: "雨夜的青石巷，晚照书店的灯亮着，玻璃门上贴着停业的纸条。",
      sound: mood("不安"),
      takes: [
        take({ id: "s1-1-t1", shotId: "scene-1-shot-1", index: 1, status: "done" }),
        take({ id: "s1-1-t2", shotId: "scene-1-shot-1", index: 2, status: "done" }),
      ],
      selectedTakeId: "s1-1-t2",
    }),
    shot({
      id: "scene-1-shot-2",
      sceneId: "scene-1",
      no: 2,
      seconds: 3,
      picture: "林晚蹲在书架前，把旧书一本本装进纸箱，头也没抬。",
      line: "打烊了。要买书的话，明天来吧，全场五折。",
      speaker: "林晚",
      sound: mood("不安"),
      takes: [take({ id: "s1-2-t1", shotId: "scene-1-shot-2", index: 1, status: "done" })],
    }),
    shot({
      id: "scene-1-shot-3",
      sceneId: "scene-1",
      no: 3,
      size: "近景",
      seconds: 3,
      picture: "沈砚站在门口，雨水顺着风衣往下滴。",
      line: "我不买书。我找林国栋。",
      speaker: "沈砚",
      takes: [
        take({
          id: "s1-3-t1",
          shotId: "scene-1-shot-3",
          index: 1,
          status: "failed",
          reason: "已中断，可以重试。",
        }),
      ],
      selectedTakeId: "s1-3-t1",
    }),
    shot({
      id: "scene-2-shot-1",
      sceneId: "scene-2",
      no: 1,
      seconds: 5,
      picture: "周烈挥棍砸向沈砚，沈砚侧身一让，铁棍砸在木箱上，木屑四溅。",
      sound: mood("激烈"),
      takes: [
        take({ id: "s2-1-t1", shotId: "scene-2-shot-1", index: 1, status: "done" }),
        take({ id: "s2-1-t2", shotId: "scene-2-shot-1", index: 2, status: "done" }),
        take({
          id: "s2-1-t3",
          shotId: "scene-2-shot-1",
          index: 3,
          status: "failed",
          reason: "Grok 没有接受这段描述，可能是「铁棍砸在木箱上」被当成了暴力内容。",
        }),
      ],
      selectedTakeId: "s2-1-t1",
    }),
    shot({
      id: "scene-2-shot-2",
      sceneId: "scene-2",
      no: 2,
      size: "近景",
      seconds: 3,
      picture: "沈砚顺势扣住周烈的手腕一拧，铁棍落地。",
      sound: mood("激烈"),
      takes: [take({ id: "s2-2-t1", shotId: "scene-2-shot-2", index: 1, status: "running" })],
      selectedTakeId: "s2-2-t1",
    }),
    shot({
      id: "scene-2-shot-3",
      sceneId: "scene-2",
      no: 3,
      picture: "第三个人掏出折叠刀，刀锋划过沈砚的小臂。",
      sound: mood("激烈"),
    }),
    shot({
      id: "scene-3-shot-1",
      sceneId: "scene-3",
      no: 1,
      seconds: 5,
      picture: "走廊长椅上，沈砚的小臂缠着纱布，林晚站在他面前。",
      line: "你本来可以不管的。这是我家的事。",
      speaker: "林晚",
      sound: mood("温暖"),
      takes: [
        take({
          id: "s3-1-t1",
          shotId: "scene-3-shot-1",
          index: 1,
          status: "queued",
          reason: "已暂停。点继续再生成剩下的。",
        }),
      ],
      selectedTakeId: "s3-1-t1",
    }),
    shot({
      id: "scene-3-shot-2",
      sceneId: "scene-3",
      no: 2,
      size: "特写",
      picture: "林晚攥紧风衣的领口，轻轻点了点头。",
      sound: mood("释然，慢钢琴"),
      takes: [
        take({
          id: "s3-2-t1",
          shotId: "scene-3-shot-2",
          index: 1,
          status: "failed",
          reason: "已取消",
        }),
      ],
    }),
  ],
  takesPerShot: 1,
  parallelism: 2,
  maxRetryRounds: 2,
  draft: false,
  jobs: [
    {
      id: "scene-2-shot-2-video-1",
      shotId: "scene-2-shot-2",
      kind: "video",
      take: 1,
      status: "running",
      prompt: "沈砚顺势扣住周烈的手腕一拧，铁棍落地。",
      reason: "每个版本各算一次。视频自己的声音关掉。",
    },
    {
      id: "scene-2-shot-3-video-1",
      shotId: "scene-2-shot-3",
      kind: "video",
      take: 1,
      status: "blocked",
      prompt: "第三个人掏出折叠刀，刀锋划过沈砚的小臂。",
      reason: "请打开安装好的 AIVORA，并打开一部作品，再生成。网页里不能直接出片。",
    },
  ],
  locations: [],
  props: [],
  sourceText: "",
  savedAt: "2026-11-04T08:01:00.000Z",
  directory: FOLDER,
  assemblyPath: "",
  assemblyUrl: "",
  exportPath: "",
  narrationVoiceId: "",
  audioClips: [
    {
      id: "voice-scene-1-shot-2",
      lane: "dialogue",
      shotId: "scene-1-shot-2",
      takeId: "s1-2-t1",
      label: "配音",
      startSeconds: 0,
      durationSeconds: 3,
      offsetSeconds: 0,
      gainDb: 0,
      path: `${FOLDER}/voice/scene-1-shot-2.mp3`,
    },
    {
      id: "music-1",
      lane: "score",
      shotId: "",
      takeId: "",
      label: "",
      startSeconds: 0,
      durationSeconds: 0,
      offsetSeconds: 0,
      gainDb: -22,
      path: `${FOLDER}/music/bed.mp3`,
    },
  ],
  backendProjectId: "",
  aspectRatio: "9:16",
};

/** project.json as the desktop writes it to disk: plain JSON. */
export function sampleProjectJson(): unknown {
  return JSON.parse(JSON.stringify(SAMPLE_PROJECT)) as unknown;
}

/**
 * An example aivora-qc report for the export of SAMPLE_PROJECT: 第 1 场第 1、2 个镜头 and
 * 第 2 场第 1 个镜头, 4 + 3 + 5 = 12 seconds.
 */
export const SAMPLE_PROJECT_QC_REPORT: QcReport = {
  schemaVersion: 1,
  media: { duration: 12, width: 1080, height: 1920 },
  audio: { present: true, integratedLufs: -19.1, truePeakDbtp: -1.8 },
  assumptions: { black: "blackdetect: pix_th=0.10, pic_th=0.98。" },
  issues: [
    {
      id: "black-0.00-0.40",
      severity: "warn",
      time: 0,
      timeLabel: "第 0.0 秒",
      end: 0.4,
      type: "black",
      message: "这里黑了一会儿，画面看不到内容。",
      suggestion: "在时间轴上剪掉这段黑画面，或补上缺少的视频。",
      action: "trim",
      detail: { durationSeconds: 0.4, thresholdSeconds: 0.3 },
    },
    {
      id: "silence-8.00-10.20",
      severity: "warn",
      time: 8,
      timeLabel: "第 8.0 秒",
      end: 10.2,
      type: "silence",
      message: "这里有至少两秒听不到声音。",
      suggestion: "在时间轴上检查这段声音，补上对白或背景音乐。",
      action: "add_audio",
      detail: { durationSeconds: 2.2, thresholdSeconds: 2 },
    },
  ],
};
