import { dbToVolumePercent, volumePercentToDb } from "../film/audio";

/**
 * Volumes are 0–100 on screen and gains in dB for the mixer. The conversion is the one in
 * film/audio.ts that the music volume on the timeline uses: straight lines between 100 → 0 dB,
 * 70 → −3 dB, 50 → −6 dB, 20 → −14 dB and 0 → −40 dB. The app treats −40 dB and below as muted.
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

/** Volumes whose gains are AUDIO_LANE_GAIN_DB in film/audio.ts: 0, −6, −3 and −14 dB. */
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

/** Gain in dB for a volume, after clampVolume, rounded to 0.1 dB. 0 gives −40 dB. */
export function volumeToDb(volume: number): number {
  return volumePercentToDb(clampVolume(volume));
}

/** The volume for a gain in dB. Below −40 dB, and NaN, give 0; above 0 dB gives 100. */
export function dbToVolume(db: number): number {
  return clampVolume(dbToVolumePercent(db));
}
