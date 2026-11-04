/**
 * Volumes are 0–100 on screen and gains in dB for the mixer. A volume is the level as a
 * percentage of the recorded clip, so gain = 20 × log10(volume / 100): 100, 70, 50 and 20 are
 * 0, −3.1, −6.0 and −14.0 dB.
 */
export const SOUND_LANES = ["dialogue", "ambience", "sfx", "score"] as const;

export type SoundLane = (typeof SOUND_LANES)[number];

export type LaneVolumes = Record<SoundLane, number>;

export const LANE_LABEL: Record<SoundLane, string> = {
  dialogue: "台词",
  ambience: "环境声",
  sfx: "音效",
  score: "配乐",
};

/** Volumes whose gains round to AUDIO_LANE_GAIN_DB in film/audio.ts: 0, −6, −3 and −14 dB. */
export const DEFAULT_LANE_VOLUMES: LaneVolumes = {
  dialogue: 100,
  ambience: 50,
  sfx: 70,
  score: 20,
};

/** Rounds a volume to a whole number within 0–100. NaN gives 0. */
export function clampVolume(volume: number): number {
  if (Number.isNaN(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume)));
}

/**
 * Gain in dB for a volume, after clampVolume: 20 × log10(volume / 100). 0 gives -Infinity,
 * which is silence.
 */
export function volumeToDb(volume: number): number {
  const value = clampVolume(volume);
  return value === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(value / 100);
}

/** The volume for a gain in dB, after clampVolume. NaN and -Infinity give 0, above 0 dB 100. */
export function dbToVolume(db: number): number {
  return clampVolume(100 * 10 ** (db / 20));
}
