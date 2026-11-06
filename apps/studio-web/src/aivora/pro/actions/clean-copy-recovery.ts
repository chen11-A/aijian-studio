import type { FilmProject } from "../../film/project";
export function legacyCleanCopyTargets(film: FilmProject) {
  return film.shots.flatMap((shot) => {
    const take = shot.selectedTakeId
      ? shot.takes.find(
          (take) => take.id === shot.selectedTakeId && take.status === "done" && take.videoPath,
        )
      : shot.takes.find((take) => take.status === "done" && take.videoPath);
    return take?.cleanVideoPath?.trim()
      ? [
          {
            shotId: shot.id,
            takeId: take.id,
            label: `第 ${film.scenes.find((scene) => scene.id === shot.sceneId)?.no ?? "?"} 场第 ${shot.no} 个镜头`,
            videoPath: take.videoPath,
            cleanVideoPath: take.cleanVideoPath,
          },
        ]
      : [];
  });
}
export async function cleanCopySelectionHash(video: string, clean: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([video, clean]));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
