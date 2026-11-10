import { VOLUME_STOPS, type AudioClip } from "../film/audio";

export type SoundExportDecision = "SILENT_BY_USER" | "WITH_AUDIO";

/** Lowest panel stop. A diagnostic only; it does not decide whether export is allowed. */
export const LOWEST_GAIN_DB = VOLUME_STOPS[VOLUME_STOPS.length - 1]!.db;

export function gainAtLowestStop(gainDb: number): boolean {
  return gainDb <= LOWEST_GAIN_DB;
}

export function soundChoicePending(film: { audioDecision?: SoundExportDecision }): boolean {
  return film.audioDecision !== "SILENT_BY_USER" && film.audioDecision !== "WITH_AUDIO";
}

/** Ungenerated suggestions stay in this label. They are not finished. */
export const UNGENERATED_SOUND_LABEL = "建议 · 未生成";

export const LOWEST_GAIN_NOTE = `增益在最低档（${LOWEST_GAIN_DB} dB）。这是音量档位，不是实测电平。`;

export function soundRowLabel(
  clip: Pick<AudioClip, "path" | "gainDb" | "suggestionGroup">,
): string {
  if (clip.suggestionGroup && !clip.path) return UNGENERATED_SOUND_LABEL;
  if (typeof clip.gainDb === "number" && gainAtLowestStop(clip.gainDb)) return LOWEST_GAIN_NOTE;
  return "";
}
