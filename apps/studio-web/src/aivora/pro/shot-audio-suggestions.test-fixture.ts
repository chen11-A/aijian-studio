import type {
  SuggestBundledFilmShotAudioInput,
  SuggestBundledFilmShotAudioResult,
} from "@aijian/contracts/film-audio-library";
import { sampleFilm, upgradeFilm } from "../film/project";
import type { ShotAudioPlan } from "./actions/shot-audio-suggestions";
export function soundFilm() {
  const film = sampleFilm();
  film.directory = "/trusted/project";
  film.shots = film.shots.map((shot, index) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    selectedTakeId: `take-${index}-1`,
    takes: [1, 2].map((n) => ({
      id: `take-${index}-${n}`,
      shotId: shot.id,
      index: n,
      status: "done" as const,
      videoPath: `/trusted/video-${index}-${n}.mp4`,
      videoUrl: "",
      stillUrl: "",
      createdAt: "",
      prompt: "保留原稿",
      reason: "",
    })),
  }));
  film.audioClips = [
    {
      id: "old-clip",
      lane: "sfx",
      shotId: film.shots[0]!.id,
      takeId: film.shots[0]!.selectedTakeId!,
      path: "/trusted/old.wav",
      label: "原片段",
      startSeconds: 0,
      durationSeconds: 1,
      offsetSeconds: 0,
      gainDb: -3,
    },
  ];
  return upgradeFilm(film)!;
}
export function soundPlan(input: SuggestBundledFilmShotAudioInput): ShotAudioPlan {
  return {
    kind: "SUGGESTED",
    projectId: input.projectId,
    projectHash: input.expectedProjectHash,
    shotId: input.shotId,
    takeId: input.takeId,
    catalogSha256: "a".repeat(64),
    pickerSha256: "b".repeat(64),
    planFingerprint: "c".repeat(64),
    durationSeconds: 8,
    clips: ["ambience", "sfx", "sfx", "score"].map((lane, i) => ({
      key: `segment-${i}`,
      lane: lane as "ambience" | "sfx" | "score",
      asset: {
        id: `asset-${i}`,
        name: `声音素材${i + 1}`,
        type: lane === "score" ? "music" : "sfx",
        category: "自然",
        tags: ["雨"],
        scene: "室外",
        durationSeconds: 12,
        loopable: true,
        loudness: -18,
        source: "https://example.org/source",
        author: "素材作者",
        license: "CC0",
        sha256: "d".repeat(64),
      },
      placement: {
        startSeconds: i + 0.123456789,
        durationSeconds: 1.25,
        offsetSeconds: 0.125,
        gainDb: -30,
        loop: false,
      },
      envelope: {
        schemaVersion: 1,
        baseGainDb: -25,
        fades: [
          { direction: "in", startSeconds: -0.5, durationSeconds: 1.5 },
          { direction: "out", startSeconds: 1, durationSeconds: 0.25 },
        ],
        gainAutomation: [
          { startSeconds: 0, endSeconds: 0.25, gainDb: -32 },
          { startSeconds: 0.25, endSeconds: 1, gainDb: -28 },
        ],
      },
      reason: "按明确文字时间安排",
    })),
    warnings: [
      { code: "MATCH_MISSING", message: "某个已标注动作没有匹配素材", index: 4, seconds: 2.75 },
    ],
    limitations: [
      { code: "PLANNED_TIMES_ONLY", message: "时间仅按文字计划，尚未核对实际动作" },
      { code: "DEVICE_TIME_UNCONFIRMED", message: "设备声音的时间仍待决定" },
    ],
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export type SoundReply = SuggestBundledFilmShotAudioResult;
