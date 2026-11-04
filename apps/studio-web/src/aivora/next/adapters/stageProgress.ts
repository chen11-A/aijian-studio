import { shotProgress } from "../../film/operations";
import type { FilmProject } from "../../film/project";

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
  const board =
    film.shots.length > 0 && film.shots.every((shot) => shotProgress(shot) === "视频已出");
  return { script, cast, board };
}
