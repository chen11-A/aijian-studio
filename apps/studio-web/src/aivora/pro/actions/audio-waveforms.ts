import {
  filmAudioSourceIdentity,
  validFilmAudioWaveform,
  audioWaveformToken,
} from "../../film/audio-waveform-data";
import type { FilmProject } from "../../film/project";
import type {
  FilmAudioWaveformInput,
  FilmAudioWaveformResult,
} from "@aijian/contracts/film-audio-waveform";
export async function audioSourceKey(film: FilmProject, clip: FilmProject["audioClips"][number]) {
  const bytes = new TextEncoder().encode(filmAudioSourceIdentity(film, clip));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** Only source metadata is merged; a late decode never replaces the surrounding project. */
export async function refreshAudioWaveforms(
  base: FilmProject,
  host: {
    current: () => FilmProject | null;
    read: (input: FilmAudioWaveformInput) => Promise<FilmAudioWaveformResult>;
    apply: (film: FilmProject) => void;
    verified: (id: string, key: string) => void;
    currentRun: () => boolean;
  },
) {
  for (const clip of base.audioClips) {
    if (!clip.path || clip.path.startsWith("data:")) continue;
    const identity = filmAudioSourceIdentity(base, clip),
      key = await audioSourceKey(base, clip);
    if (!host.currentRun()) return;
    let result: FilmAudioWaveformResult;
    try {
      result = await host.read({ projectId: base.id, clipId: clip.id, expectedSourceKey: key });
    } catch {
      continue;
    }
    const live = host.current(),
      current = live?.audioClips.find((c) => c.id === clip.id);
    if (
      !host.currentRun() ||
      !live ||
      live.id !== base.id ||
      !current ||
      filmAudioSourceIdentity(live, current) !== identity
    )
      continue;
    const waveform =
      result.kind === "READY" &&
      validFilmAudioWaveform(result.waveform) &&
      result.waveform.sourceKey === key &&
      result.waveform.offsetSeconds === current.offsetSeconds &&
      result.waveform.durationSeconds === current.durationSeconds
        ? { ...result.waveform, identity }
        : undefined;
    if (JSON.stringify(current.waveform) !== JSON.stringify(waveform)) {
      host.apply({
        ...live,
        audioClips: live.audioClips.map((c) => {
          if (c.id !== clip.id) return c;
          const rest = { ...c };
          delete rest.waveform;
          return waveform ? { ...rest, waveform } : rest;
        }),
      });
    }
    if (waveform) host.verified(clip.id, audioWaveformToken(waveform)!);
  }
}

/** Synchronous invalidation on a source/version/trim edit, before any next decode. */
export function invalidateAudioWaveforms(film: FilmProject): FilmProject {
  const audioClips = film.audioClips.map((clip) => {
    if (!clip.waveform || clip.waveform.identity === filmAudioSourceIdentity(film, clip))
      return clip;
    const rest = { ...clip };
    delete rest.waveform;
    return rest;
  });
  return audioClips.some((clip, index) => clip !== film.audioClips[index])
    ? { ...film, audioClips }
    : film;
}
