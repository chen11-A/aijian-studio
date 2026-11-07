import type { FilmProject } from "../film/project";
import { filmAudioSourceIdentity } from "../film/audio-waveform-data";
import { assemblyRenderKey } from "./assembly";
/** Scheduling equality, never ownership or permission to reuse a main-process hash check. */
export function audioMixPreviewKey(film: FilmProject): string {
  return JSON.stringify([
    assemblyRenderKey(film),
    film.backendProjectId ?? "",
    film.audioClips.map((clip) => [
      clip.id,
      clip.waveform?.identity === filmAudioSourceIdentity(film, clip) &&
      /^[a-f0-9]{64}$/.test(clip.waveform.sourceSha256)
        ? clip.waveform.sourceSha256
        : null,
    ]),
  ]);
}
