import type { ProjectScene, ProjectShot, ProjectTake, ProjectView } from "./read";

/**
 * Names come from the saved scene and shot numbers, not from ids: an id such as scene-3-shot-2
 * keeps its number when scenes are added or moved, and the sample film uses ids like 02-shot-1.
 */
export function shotName(project: ProjectView, shot: ProjectShot): string {
  const scene = project.scenes.find((item) => item.id === shot.sceneId);
  if (scene?.no != null && shot.no !== null) return `第 ${scene.no} 场第 ${shot.no} 个镜头`;
  if (shot.no !== null) return `镜头 ${shot.no}`;
  return shot.id;
}

/** 「第 2 场 · 码头仓库」, or 「第 2 场」 when the title only repeats the number. */
export function sceneName(scene: ProjectScene): string {
  const title = scene.title.trim();
  if (scene.no === null) return title || scene.id;
  const head = `第 ${scene.no} 场`;
  return !title || /^第\s*[0-9一二三四五六七八九十百]+\s*场$/.test(title)
    ? head
    : `${head} · ${title}`;
}

/**
 * The take the export uses for a shot, by the rule in chosenExport (film/operations.ts): the
 * selected take if it is done and has a video file, or, when none is selected, the first take
 * that is. A selected take that failed leaves the shot out of the export.
 */
export function takeInUse(shot: ProjectShot): ProjectTake | undefined {
  const usable = (take: ProjectTake) => take.status === "done" && Boolean(take.videoPath);
  return shot.selectedTakeId
    ? shot.takes.find((take) => take.id === shot.selectedTakeId && usable(take))
    : shot.takes.find(usable);
}

/** The shots the export joins, in order, each with the take it uses. */
export function exportedShots(project: ProjectView): { shot: ProjectShot; take: ProjectTake }[] {
  return project.shots.flatMap((shot) => {
    const take = takeInUse(shot);
    return take ? [{ shot, take }] : [];
  });
}

/** The app marks a take this way when it reopens a film that was still generating. */
export const INTERRUPTED_TAKE = "已中断，可以重试。";

/** The reason a take gets when the user cancels it. */
export const CANCELLED_TAKE = "已取消";

export const isCancelled = (take: ProjectTake) =>
  take.status === "failed" && take.reason === CANCELLED_TAKE;
