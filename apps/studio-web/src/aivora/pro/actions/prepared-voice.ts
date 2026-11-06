import type { AudioClip } from "../../film/audio";
import type { FilmProject } from "../../film/project";
export function isPreparedVoice(clip: AudioClip) {
  return Boolean(
    clip.shotId && !clip.takeId && clip.lane === "dialogue" && clip.label !== "原声" && clip.path,
  );
}
export function preparedVoiceBinding(film: FilmProject, clip: AudioClip) {
  const shot = film.shots.find((row) => row.id === clip.shotId);
  const take = shot?.selectedTakeId
    ? shot.takes.find((row) => row.id === shot.selectedTakeId)
    : shot?.takes.find((row) => row.status === "done" && row.videoPath);
  if (
    !shot ||
    !take ||
    take.status !== "done" ||
    !take.videoPath ||
    clip.lane !== "dialogue" ||
    clip.label === "原声" ||
    !clip.path ||
    (clip.takeId && clip.takeId !== take.id)
  )
    return null;
  const existing = clip.takeId
    ? clip
    : film.audioClips.find(
        (row) =>
          row.shotId === shot.id &&
          row.takeId === take.id &&
          row.lane === "dialogue" &&
          row.label !== "原声" &&
          row.path === clip.path &&
          row.startSeconds === clip.startSeconds &&
          row.durationSeconds === clip.durationSeconds &&
          row.offsetSeconds === clip.offsetSeconds &&
          row.gainDb === clip.gainDb,
      );
  return {
    shotId: shot.id,
    takeId: take.id,
    existing,
    alreadyBound: Boolean(existing && existing.enabled !== false),
  };
}
/** Explicit local choice only: retained alternatives are disabled, never deleted or regenerated. */
export function bindPreparedVoice(
  film: FilmProject,
  expected: { projectId: string; clipId: string; shotId: string; takeId: string },
): FilmProject | null {
  if (
    film.id !== expected.projectId ||
    film.shots.filter((shot) => shot.id === expected.shotId).length !== 1 ||
    film.audioClips.filter((clip) => clip.id === expected.clipId).length !== 1
  )
    return null;
  const clip = film.audioClips.find((row) => row.id === expected.clipId)!;
  const binding = preparedVoiceBinding(film, clip);
  const shot = film.shots.find((row) => row.id === expected.shotId)!;
  if (
    !binding ||
    binding.shotId !== expected.shotId ||
    binding.takeId !== expected.takeId ||
    binding.alreadyBound ||
    shot.takes.filter((take) => take.id === binding.takeId).length !== 1
  )
    return null;
  const source = {
    ...clip,
    id: binding.existing?.id ?? `prepared-${crypto.randomUUID()}`,
    takeId: binding.takeId,
    enabled: true,
  };
  delete source.waveform;
  const retained = film.audioClips.map((row) =>
    row.shotId === binding.shotId &&
    row.takeId === binding.takeId &&
    row.lane === "dialogue" &&
    row.label !== "原声" &&
    row.path
      ? { ...row, enabled: row.id === source.id }
      : row,
  );
  if (!binding.existing) retained.push(source);
  return { ...film, audioClips: retained };
}
