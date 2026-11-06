// 5-3-05: dragging a shot card to another place in its scene. GPT's moveShot moves one place at
// a time; this takes as many steps as the drag asks for, in one change. The page history does
// not undo a reorder yet (INTEGRATION.md, 5-3 撤销); dragging it back puts it back.
import { moveShot } from "../film/operations";
import type { FilmProject } from "../film/project";

/** What a dragged shot card carries; actions dragged from 场记 use their own type. */
export const SHOT_DRAG_TYPE = "application/x-aivora-shot";

/** The shot moved `steps` places within its scene: negative is earlier. Stops at either end. */
export function moveShotBy(film: FilmProject, shotId: string, steps: number): FilmProject {
  const direction = steps < 0 ? -1 : 1;
  let next = film;
  for (let step = 0; step < Math.abs(Math.trunc(steps)); step += 1) {
    next = moveShot(next, shotId, direction);
  }
  return next;
}

/** The card a drag came from, or null for anything else (another kind of drag, old data). */
export function readShotDrag(raw: string): { scope: string; id: string } | null {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { scope?: unknown; id?: unknown };
    return typeof payload.scope === "string" && typeof payload.id === "string" && payload.id
      ? { scope: payload.scope, id: payload.id }
      : null;
  } catch {
    return null;
  }
}

/** The status line after a drop, in the numbers the cards showed while dragging. */
export function movedNotice(fromNo: number, toNo: number, earlier: boolean): string {
  return `已把镜头 ${fromNo} 挪到镜头 ${toNo} ${earlier ? "前面" : "后面"}。`;
}
