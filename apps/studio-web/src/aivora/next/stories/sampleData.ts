/**
 * Made-up data for the story pages only, around the test novel 《雨夜旧书店》. None of it is a
 * real project or task.
 */
import type { QcReport } from "../qcReport";
import type { ShotSpan } from "../ExportCheck";
import type { TaskItem } from "../TaskCenter";

/**
 * Shot lengths in seconds, one list per scene: 19, 26 and 20 shots lasting 83, 96 and 92
 * seconds. With the title card the export is 274 seconds.
 */
export const SCENE_SHOT_SECONDS: readonly (readonly number[])[] = [
  [4, 4, 2, 5, 3, 5, 3, 3, 5, 4, 3, 14, 4, 4, 3, 6, 4, 3, 4],
  [3, 3, 10, 4, 5, 3, 3, 3, 5, 3, 3, 5, 4, 5, 4, 4, 3, 3, 3, 2, 2, 3, 3, 4, 3, 3],
  [4, 5, 4, 3, 5, 11, 5, 5, 5, 3, 4, 3, 4, 5, 5, 4, 5, 4, 4, 4],
];

/** Seconds of title card before the first shot. */
export const TITLE_SECONDS = 3;

export function sampleShotSpans(): ShotSpan[] {
  const spans: ShotSpan[] = [];
  let at = TITLE_SECONDS;
  SCENE_SHOT_SECONDS.forEach((shots, sceneIndex) => {
    shots.forEach((seconds, shotIndex) => {
      spans.push({
        id: `scene-${sceneIndex + 1}-shot-${shotIndex + 1}`,
        start: at,
        end: at + seconds,
      });
      at += seconds;
    });
  });
  return spans;
}

const ASSET_IMAGES = [
  "林晚 · 脸部定妆照",
  "林晚 · 正面定妆照",
  "林晚 · 侧面定妆照",
  "林晚 · 背面定妆照",
  "林晚披着风衣 · 正面定妆照",
  "林晚披着风衣 · 侧面定妆照",
  "林晚披着风衣 · 背面定妆照",
  "沈砚 · 脸部定妆照",
  "沈砚黑风衣 · 正面定妆照",
  "沈砚黑风衣 · 侧面定妆照",
  "沈砚黑风衣 · 背面定妆照",
  "沈砚卷袖衬衫 · 正面定妆照",
  "沈砚卷袖衬衫 · 侧面定妆照",
  "沈砚卷袖衬衫 · 背面定妆照",
  "周烈 · 脸部定妆照",
  "周烈 · 正面定妆照",
  "周烈 · 侧面定妆照",
  "周烈 · 背面定妆照",
  "打手甲 · 正面定妆照",
  "打手乙 · 正面定妆照",
  "阿婆 · 正面定妆照",
  "晚照书店 · 空镜",
  "青石巷 · 空镜",
  "码头仓库 · 空镜",
  "医院走廊 · 空镜",
  "油纸信封 · 道具图",
  "泛黄的合影 · 道具图",
  "铁棍 · 道具图",
  "折叠刀 · 道具图",
  "诗集 · 道具图",
];

/** Where the 33 lines are spoken: [scene, shot]. */
const LINE_SHOTS: readonly (readonly [number, number])[] = [
  [1, 5],
  [1, 6],
  [1, 7],
  [1, 8],
  [1, 10],
  [1, 11],
  [1, 12],
  [1, 13],
  [1, 14],
  [1, 15],
  [1, 16],
  [2, 2],
  [2, 3],
  [2, 4],
  [2, 5],
  [2, 6],
  [2, 9],
  [2, 10],
  [2, 11],
  [2, 15],
  [2, 16],
  [2, 21],
  [2, 25],
  [3, 3],
  [3, 4],
  [3, 5],
  [3, 6],
  [3, 10],
  [3, 11],
  [3, 12],
  [3, 14],
  [3, 15],
  [3, 20],
];

function videoStatus(scene: number, shot: number, take: number): Partial<TaskItem> {
  if (scene === 1 || (scene === 2 && shot <= 20)) return { status: "done" };
  if (scene === 2 && shot === 21) {
    return take === 1
      ? { status: "failed", attempt: 2, reason: "等了 10 分钟没有结果，已经停下" }
      : { status: "done" };
  }
  if (scene === 2 && shot === 22) {
    return take === 1
      ? {
          status: "failed",
          reason: "Grok 没有接受这段描述，可能是「刀锋划过小臂」「渗出一道血」被当成了血腥内容",
          suggestion: "刀从袖子上擦过，袖口出现一道深色痕迹，不拍伤口。",
        }
      : { status: "done" };
  }
  if (scene === 2 && shot === 23) return { status: "uncertain" };
  return { status: "queued" };
}

/** 130 video, 95 picture and 33 voice jobs, as left behind when the app closed by accident. */
export function sampleTasks(): TaskItem[] {
  const tasks: TaskItem[] = [];
  SCENE_SHOT_SECONDS.forEach((shots, sceneIndex) => {
    shots.forEach((_seconds, shotIndex) => {
      const shotId = `scene-${sceneIndex + 1}-shot-${shotIndex + 1}`;
      for (const take of [1, 2]) {
        tasks.push({
          id: `${shotId}-take-${take}`,
          shotId,
          version: take === 1 ? "A 版" : "B 版",
          kind: "video",
          status: "done",
          attempt: 1,
          ...videoStatus(sceneIndex + 1, shotIndex + 1, take),
        });
      }
    });
  });
  ASSET_IMAGES.forEach((title, index) => {
    tasks.push({
      id: `image-asset-${index + 1}`,
      title,
      kind: "image",
      status: "done",
      attempt: 1,
    });
  });
  SCENE_SHOT_SECONDS.forEach((shots, sceneIndex) => {
    shots.forEach((_seconds, shotIndex) => {
      const shotId = `scene-${sceneIndex + 1}-shot-${shotIndex + 1}`;
      tasks.push({
        id: `${shotId}-frame`,
        shotId,
        version: "起始画面",
        kind: "image",
        status: "done",
        attempt: 1,
      });
    });
  });
  LINE_SHOTS.forEach(([scene, shot], index) => {
    const shotId = `scene-${scene}-shot-${shot}`;
    tasks.push({
      id: `${shotId}-voice-${index + 1}`,
      shotId,
      version: "配音",
      kind: "voice",
      status: "done",
      attempt: 1,
    });
  });
  return tasks;
}

/** A report in the packages/aivora-qc format: one issue that should be fixed, five to look at. */
export const SAMPLE_QC_REPORT: QcReport = {
  schemaVersion: 1,
  media: { duration: 274, width: 1080, height: 1920 },
  audio: { present: true, integratedLufs: -18.2, truePeakDbtp: -0.3 },
  assumptions: {
    black: "blackdetect: pix_th=0.10, pic_th=0.98；片头/片尾≤0.5秒黑区间作为短淡入淡出代理豁免。",
    freeze: "freezedetect: noise=-60dB；整个静止区间被台词时间段覆盖才放宽至2秒。",
    loudness: "loudnorm 输入测量；全片问题time=0；无法测量/负无穷用null表示。",
  },
  issues: [
    {
      id: "loudness-0.00-274.00",
      severity: "warn",
      time: 0,
      timeLabel: "第 0.0 秒",
      end: 274,
      type: "loudness",
      message: "整片声音偏小，听起来会比别的视频轻。",
      suggestion: "先预览确认有声音，再在导出时打开‘自动调整音量’。",
      action: "adjust_volume",
      scope: "program",
      detail: { integratedLufs: -18.2, targetLufs: -16, toleranceLu: 1 },
    },
    {
      id: "true_peak-0.00-274.00",
      severity: "block",
      time: 0,
      timeLabel: "第 0.0 秒",
      end: 274,
      type: "true_peak",
      message: "有几处声音太响，可能破音。",
      suggestion: "在声音设置里调低音量，导出后再听一遍最响的地方。",
      action: "adjust_volume",
      scope: "program",
      detail: { truePeakDbtp: -0.3, maxTruePeakDbtp: -1 },
    },
    {
      id: "black-13.00-13.60",
      severity: "warn",
      time: 13,
      timeLabel: "第 13.0 秒",
      end: 13.6,
      type: "black",
      message: "这里黑了一会儿，画面看不到内容。",
      suggestion: "在时间轴上剪掉这段黑画面，或补上缺少的视频。",
      action: "trim",
      detail: {
        durationSeconds: 0.6,
        thresholdSeconds: 0.5,
        pixelThreshold: 0.1,
        blackPixelRatio: 0.98,
      },
    },
    {
      id: "silence-82.30-84.60",
      severity: "warn",
      time: 82.3,
      timeLabel: "第 82.3 秒",
      end: 84.6,
      type: "silence",
      message: "这里有至少两秒听不到声音。",
      suggestion: "在时间轴上检查这段声音，补上对白或背景音乐。",
      action: "add_audio",
      detail: { durationSeconds: 2.3, thresholdSeconds: 2, noiseDb: -50 },
    },
    {
      id: "freeze-157.90-159.00",
      severity: "warn",
      time: 157.9,
      timeLabel: "第 157.9 秒",
      end: 159,
      type: "freeze",
      message: "这里的画面停住不动了。",
      suggestion: "在时间轴上缩短这段停顿，或重新生成这个镜头。",
      action: "regenerate_shot",
      detail: { durationSeconds: 1.1, thresholdSeconds: 1, noiseDb: -60 },
    },
    {
      id: "subtitle_line_length-203.60-209.10-cue27",
      severity: "warn",
      time: 203.6,
      timeLabel: "第 203.6 秒",
      end: 209.1,
      type: "subtitle_line_length",
      message: "第 27 条字幕一行字太多，不容易读完。",
      suggestion: "在字幕编辑里删短文字、换行，或拆成两条字幕。",
      action: "edit_subtitle",
      cue: 27,
      detail: { lineUnits: [22], maxLineUnits: 20 },
    },
  ],
};
