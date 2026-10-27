/** AUDIO-SPEC data reserved for Phase 2 and Phase 3.
 * Phase 1 stores these fields and does not generate, play, or mix them.
 */

export const SHOT_SECONDS_MAX = 15;
export const LINE_HEAD_SECONDS = 0.4;
export const LINE_TAIL_SECONDS = 0.6;

export const AUDIO_LANE_ORDER = ["dialogue", "ambience", "sfx", "score"] as const;

export type AudioLaneId = (typeof AUDIO_LANE_ORDER)[number];

export const AUDIO_LANE_LABEL: Record<AudioLaneId, string> = {
  dialogue: "对白",
  ambience: "环境音",
  sfx: "音效",
  score: "配乐",
};

export const AUDIO_LANE_GAIN_DB: Record<AudioLaneId, number> = {
  dialogue: 0,
  ambience: -6,
  sfx: -3,
  score: -14,
};

export type DialogueClipLabel = "原声" | "配音" | "旁白";

export type AudioClip = {
  id: string;
  lane: AudioLaneId;
  shotId: string;
  takeId: string;
  label: DialogueClipLabel | "";
  startSeconds: number;
  durationSeconds: number;
  offsetSeconds: number;
  gainDb: number;
};

export type ShotSoundSource = "native" | "dub";

export type ShotSfxCue = {
  atSeconds: number;
  text: string;
};

export type ShotSoundPlan = {
  source: ShotSoundSource;
  ambience: string;
  sfx: ShotSfxCue[];
  musicMood: string;
};

export function emptySoundPlan(ambience = ""): ShotSoundPlan {
  return { source: "native", ambience, sfx: [], musicMood: "" };
}

export function storedShotSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 3;
  return Math.max(1, Math.min(SHOT_SECONDS_MAX, seconds));
}

/** D-A4. Phase 1 does not call this before generation. */
export function shotSecondsForLine(
  lineSeconds: number,
  directorSeconds: number,
): { seconds: number; fits: boolean } {
  const director = storedShotSeconds(directorSeconds);
  if (!(lineSeconds > 0)) return { seconds: director, fits: true };
  const needed = lineSeconds + LINE_HEAD_SECONDS + LINE_TAIL_SECONDS;
  const rounded = Math.ceil(needed - 1e-9);
  if (rounded > SHOT_SECONDS_MAX) return { seconds: SHOT_SECONDS_MAX, fits: false };
  return { seconds: Math.max(rounded, director), fits: true };
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeSoundPlan(value: unknown, ambience = ""): ShotSoundPlan {
  if (!value || typeof value !== "object") return emptySoundPlan(ambience);
  const row = value as Partial<ShotSoundPlan>;
  const sfx = Array.isArray(row.sfx)
    ? row.sfx.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const cue = item as Partial<ShotSfxCue>;
        if (typeof cue.text !== "string" || !cue.text.trim()) return [];
        return [{ atSeconds: finiteNumber(cue.atSeconds), text: cue.text.trim() }];
      })
    : [];
  return {
    source: row.source === "dub" ? "dub" : "native",
    ambience: typeof row.ambience === "string" ? row.ambience : ambience,
    sfx,
    musicMood: typeof row.musicMood === "string" ? row.musicMood : "",
  };
}

const DIALOGUE_LABELS = new Set<DialogueClipLabel>(["原声", "配音", "旁白"]);

export function normalizeAudioClips(value: unknown): AudioClip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<AudioClip>;
    if (typeof row.id !== "string" || !row.id) return [];
    if (!AUDIO_LANE_ORDER.includes(row.lane as AudioLaneId)) return [];
    const lane = row.lane as AudioLaneId;
    const label = DIALOGUE_LABELS.has(row.label as DialogueClipLabel)
      ? (row.label as DialogueClipLabel)
      : "";
    return [
      {
        id: row.id,
        lane,
        shotId: typeof row.shotId === "string" ? row.shotId : "",
        takeId: typeof row.takeId === "string" ? row.takeId : "",
        label,
        startSeconds: finiteNumber(row.startSeconds),
        durationSeconds: finiteNumber(row.durationSeconds),
        offsetSeconds: finiteNumber(row.offsetSeconds),
        gainDb:
          typeof row.gainDb === "number" && Number.isFinite(row.gainDb)
            ? row.gainDb
            : AUDIO_LANE_GAIN_DB[lane],
      },
    ];
  });
}
