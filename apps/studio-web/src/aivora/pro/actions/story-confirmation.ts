import type { FilmProject, FilmShot } from "../../film/project";
import {
  prepareDirectorTransaction,
  applyStoryStructureTransaction,
  undoStoryStructureTransaction,
  type StoryStructureTransaction,
} from "./story-structure-transaction";
export type DirectorConfirmation = {
  kind: "director";
  projectId: string;
  batches: StoryStructureTransaction[];
  unsupported: string[];
};
export type StoryConfirmation = StoryStructureTransaction | DirectorConfirmation;

/** One reviewed proposal may contain several existing scenes; commit all or none. */
export function prepareDirectorConfirmation(
  base: FilmProject,
  shots: FilmShot[],
  unassigned: NonNullable<FilmProject["unassignedBeats"]> = [],
): DirectorConfirmation {
  const tx: DirectorConfirmation = {
    kind: "director",
    projectId: base.id,
    batches: [],
    unsupported: [],
  };
  const scenes = new Set(base.scenes.map((scene) => scene.id));
  if (
    !shots.length ||
    new Set(shots.map((shot) => shot.id)).size !== shots.length ||
    shots.some((shot) => !shot.id || !scenes.has(shot.sceneId)) ||
    unassigned.some(
      (beat) => !scenes.has(beat.sceneId) || !shots.some((shot) => shot.sceneId === beat.sceneId),
    )
  ) {
    tx.unsupported.push("INVALID_SCOPE_IDS");
    return tx;
  }
  let staged = structuredClone(base);
  for (const scene of base.scenes) {
    const rows = shots.filter((shot) => shot.sceneId === scene.id);
    if (!rows.length) continue;
    const part = prepareDirectorTransaction(
      staged,
      scene.id,
      rows,
      unassigned.filter((beat) => beat.sceneId === scene.id),
    );
    const result = applyStoryStructureTransaction(staged, part);
    if (result.conflicts.length) {
      tx.unsupported.push(...result.conflicts);
      return tx;
    }
    tx.batches.push(part);
    staged = result.film;
  }
  return tx;
}
export function applyStoryConfirmation(current: FilmProject, tx: StoryConfirmation) {
  return change(current, tx, false);
}
export function undoStoryConfirmation(current: FilmProject, tx: StoryConfirmation) {
  return change(current, tx, true);
}
function change(
  current: FilmProject,
  tx: StoryConfirmation,
  inverse: boolean,
): {
  film: FilmProject;
  receipt: StoryConfirmation | null;
  conflicts: string[];
  code: "APPLIED" | "NO_CHANGES" | "STRUCTURE_CONFLICT";
} {
  if (!("batches" in tx))
    return inverse
      ? undoStoryStructureTransaction(current, tx)
      : applyStoryStructureTransaction(current, tx);
  if (tx.projectId !== current.id || tx.unsupported.length)
    return {
      film: current,
      receipt: null,
      conflicts: tx.projectId !== current.id ? ["PROJECT_MISMATCH"] : tx.unsupported,
      code: "STRUCTURE_CONFLICT",
    };
  let staged = current,
    changed = false;
  for (const part of inverse ? [...tx.batches].reverse() : tx.batches) {
    const result = inverse
      ? undoStoryStructureTransaction(staged, part)
      : applyStoryStructureTransaction(staged, part);
    if (result.conflicts.length)
      return {
        film: current,
        receipt: null,
        conflicts: result.conflicts,
        code: "STRUCTURE_CONFLICT",
      };
    if (result.receipt) changed = true;
    staged = result.film;
  }
  return {
    film: staged,
    receipt: changed ? tx : null,
    conflicts: [],
    code: changed ? "APPLIED" : "NO_CHANGES",
  };
}
