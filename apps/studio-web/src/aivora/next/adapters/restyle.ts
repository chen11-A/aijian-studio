import { shotProgress } from "../../film/operations";
import type { FilmShot } from "../../film/project";

/**
 * GPT keeps `regenerationRequired` on a shot once the style of the work changes after it was
 * made (4A-B02, film/style-bible.ts setFilmStyle). Read as an optional field, so this file also
 * builds against a project type that does not carry it yet.
 */
type Flagged = FilmShot & { regenerationRequired?: { code: string; styleRevision?: number } };

/**
 * 4A-U02: the shot was already made, and made with a style the work no longer has. A shot with
 * nothing made yet is not counted: it will be made with the current style anyway.
 */
export function needsRestyle(shot: FilmShot): boolean {
  const flag = (shot as Flagged).regenerationRequired;
  return Boolean(flag?.code) && shotProgress(shot) !== "未生成";
}
