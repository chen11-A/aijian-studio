import type { FilmProject, FilmShot } from "../../film/project";

const VIEWS = ["正面", "侧面", "背面", "脸部"];

/**
 * Whether each workspace page has done its part, so the page can turn its primary button into
 * 「下一步」. A page is never done while it has nothing in it.
 *
 * - 剧本: every scene with words has shots (the director has gone through it).
 * - 角色与场景: every character has an appearance and all four portraits.
 * - 分镜: every shot has a video.
 */
export function stageProgress(film: FilmProject): {
  script: boolean;
  cast: boolean;
  board: boolean;
} {
  const written = film.scenes.filter((scene) => scene.text.trim());
  const script =
    written.length > 0 &&
    written.every((scene) => film.shots.some((shot) => shot.sceneId === scene.id));
  const cast =
    film.characters.length > 0 &&
    film.characters.every(
      (person) =>
        person.identity.trim() &&
        VIEWS.every((view) =>
          person.portraits.some((portrait) => portrait.view === view && portrait.url),
        ),
    );
  const board = film.shots.length > 0 && film.shots.every(hasChosenVideo);
  return { script, cast, board };
}

/** The version the shot will be exported with has a video (or, with none chosen, any done one). */
export function hasChosenVideo(shot: FilmShot): boolean {
  return shot.takes.some(
    (take) =>
      take.status === "done" &&
      Boolean(take.videoUrl || take.videoPath) &&
      (!shot.selectedTakeId || take.id === shot.selectedTakeId),
  );
}

export type StageTab = { done: boolean; have: number; total: number };

/**
 * UIR-06: what the 剧本 / 角色与场景 / 分镜 tabs show. A tab is ticked only when its part is
 * done; until then it shows how far it got, like 「角色与场景 0/8」.
 *
 * - 剧本: scenes that have words, out of all scenes.
 * - 角色与场景: characters with a front portrait, out of all characters.
 * - 分镜: shots whose chosen version has a video, out of all shots.
 */
export function stageTabs(film: FilmProject): Record<"script" | "cast" | "board", StageTab> {
  const tab = (have: number, total: number): StageTab => ({
    done: total > 0 && have === total,
    have,
    total,
  });
  return {
    script: tab(film.scenes.filter((scene) => scene.text.trim()).length, film.scenes.length),
    cast: tab(
      film.characters.filter((person) =>
        person.portraits.some((portrait) => portrait.view === "正面" && portrait.url),
      ).length,
      film.characters.length,
    ),
    board: tab(film.shots.filter(hasChosenVideo).length, film.shots.length),
  };
}
