import type { FilmShot } from "../../film/project";

/**
 * 4C-U01: 「版本 2/3」 on a shot that has more than one made version: which one the cut uses,
 * out of the made ones. The one in use is the chosen version, or with none chosen the first one
 * made (the rule chosenExport uses). Nothing for a shot with one version or none.
 */
export function takeBadge(shot: FilmShot): string | null {
  const made = shot.takes.filter((take) => take.status === "done");
  if (made.length < 2) return null;
  const chosen = shot.selectedTakeId
    ? made.findIndex((take) => take.id === shot.selectedTakeId)
    : 0;
  return chosen < 0 ? null : `版本 ${chosen + 1}/${made.length}`;
}

/**
 * 4C-U01: the selected part of the cut, from in to out: which shots, where it starts and how long
 * it is, and whether it contains dialogue. This coarse selection supplies no speech timing;
 * seconds-level visual redo keeps the original audio and cannot infer sentence boundaries.
 */
export function selection(
  shots: readonly FilmShot[],
  span: { from: number; to: number } | null,
  shot: number,
): { first: number; last: number; start: number; seconds: number; hasLine: boolean } {
  const first = Math.max(0, Math.min(span?.from ?? shot, span?.to ?? shot));
  const last = Math.min(shots.length - 1, Math.max(span?.from ?? shot, span?.to ?? shot));
  const picked = shots.slice(first, last + 1);
  return {
    first,
    last,
    start: shots.slice(0, first).reduce((sum, item) => sum + item.seconds, 0),
    seconds: picked.reduce((sum, item) => sum + item.seconds, 0),
    hasLine: picked.some((item) => item.line.trim().length > 0),
  };
}
