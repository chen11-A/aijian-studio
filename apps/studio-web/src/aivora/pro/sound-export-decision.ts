import type { AudioClip } from "../film/audio";

type SoundClip = Pick<AudioClip, "path" | "gainDb" | "suggestionGroup">;

/** A file path or an AAC container is not audible sound. */
export function clipAudible(clip: Pick<AudioClip, "path" | "gainDb">): boolean {
  return Boolean(clip.path) && clip.gainDb > -40;
}

export function hasAudibleSound(film: {
  audioClips: readonly Pick<AudioClip, "path" | "gainDb">[];
}): boolean {
  return film.audioClips.some(clipAudible);
}

export function needsSoundChoice(film: {
  audioClips: readonly Pick<AudioClip, "path" | "gainDb" | "suggestionGroup">[];
  audioDecision?: "SILENT_BY_USER";
}): boolean {
  if (hasAudibleSound(film) || film.audioDecision === "SILENT_BY_USER") return false;
  return film.audioClips.some((clip) => Boolean(clip.path) || Boolean(clip.suggestionGroup));
}

export function exportSoundReady(film: {
  audioClips: readonly Pick<AudioClip, "path" | "gainDb" | "suggestionGroup">[];
  audioDecision?: "SILENT_BY_USER";
}): boolean {
  return !needsSoundChoice(film);
}

/** Ungenerated suggestions stay in this label. They are not finished. */
export const UNGENERATED_SOUND_LABEL = "建议 · 未生成";

export function soundRowLabel(
  clip: Pick<AudioClip, "path" | "gainDb" | "suggestionGroup">,
): string {
  if (clip.suggestionGroup && !clip.path) return UNGENERATED_SOUND_LABEL;
  if (clip.path && !clipAudible(clip)) return "有音轨，还没有可听声音";
  if (clipAudible(clip)) return "已有可听声音";
  return UNGENERATED_SOUND_LABEL;
}
