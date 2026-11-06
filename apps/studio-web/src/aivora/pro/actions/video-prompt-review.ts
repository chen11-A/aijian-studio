import type { FilmProject, FilmShot } from "../../film/project";
import { storyFilmBatches } from "../../film/operations";
import {
  compileSevenPartVideo,
  reviewedVideoText,
  VIDEO_FACTS_STALE,
} from "../../film/seven-part-video";

const stale = (): never => {
  throw Object.assign(new Error(VIDEO_FACTS_STALE.text), VIDEO_FACTS_STALE);
};
/** A queue's automatic first selection is not a new creative decision. Recompile only
 * this request, after checking the original complete review and every creative fact. */
export function generationVideoBody(
  film: FilmProject,
  target: FilmShot,
  original: FilmShot,
  firstNewTakeId: string | undefined,
  draft: boolean,
) {
  if (target.reviewedVideoPrompt === undefined && original.reviewedVideoPrompt === undefined)
    return storyFilmBatches(film, [target], draft)[0];
  if (
    !target.reviewedVideoPrompt ||
    !original.reviewedVideoPrompt ||
    target.reviewedVideoPrompt.text !== original.reviewedVideoPrompt.text ||
    target.reviewedVideoPrompt.factsKey !== original.reviewedVideoPrompt.factsKey
  )
    stale();
  reviewedVideoText(film, original);
  if (target.selectedTakeId === original.selectedTakeId)
    return storyFilmBatches(film, [target], draft)[0];
  if (
    original.selectedTakeId ||
    original.takes.some((take) => take.status !== "failed" || take.videoPath || take.videoUrl) ||
    target.takes.some(
      (take) =>
        original.takes.some((old) => old.id === take.id) &&
        (take.status !== "failed" || take.videoPath || take.videoUrl),
    ) ||
    !firstNewTakeId ||
    target.selectedTakeId !== firstNewTakeId ||
    !target.takes.some((take) => take.id === firstNewTakeId)
  )
    stale();
  const oldIdentity = compileSevenPartVideo(film, {
    ...target,
    selectedTakeId: original.selectedTakeId,
  });
  if (
    oldIdentity.issues.length ||
    oldIdentity.draft.factsKey !== original.reviewedVideoPrompt?.factsKey ||
    oldIdentity.draft.text !== original.reviewedVideoPrompt?.text
  )
    stale();
  const current = compileSevenPartVideo(film, target);
  if (current.issues.length || current.draft.text !== original.reviewedVideoPrompt?.text) stale();
  return storyFilmBatches(film, [{ ...target, reviewedVideoPrompt: current.draft }], draft)[0];
}

/** The existing range confirmation reviews a new temporary visual request. The stored
 * whole-shot review is checked first, never cleared/rebound/persisted for another scope. */
export function rangeVideoBody(
  film: FilmProject,
  target: FilmShot,
  seconds: number,
  draft: boolean,
) {
  const projected = { ...target, line: "", lines: [], seconds };
  if (target.reviewedVideoPrompt !== undefined) {
    reviewedVideoText(film, target);
    const local = compileSevenPartVideo(film, { ...projected, reviewedVideoPrompt: undefined });
    if (local.issues.length) stale();
    projected.reviewedVideoPrompt = local.draft;
  }
  return storyFilmBatches(film, [projected], draft)[0];
}
