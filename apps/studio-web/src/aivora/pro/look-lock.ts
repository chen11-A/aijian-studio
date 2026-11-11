import { offscreenCharacterNames } from "../film/on-screen-characters";
import type { FilmCharacter, FilmProject, FilmShot } from "../film/project";
import { currentStillUrl, stillAccepted } from "./still-acceptance";

export const LOOK_NOT_LOCKED = "LOOK_NOT_LOCKED";

export type LookBlock = {
  code: typeof LOOK_NOT_LOCKED;
  name: string;
  reason: string;
};

/** Only an explicit lock counts. A written look or a front portrait does not. */
export function lookReady(person: FilmCharacter): boolean {
  return person.lookLocked === true;
}

/**
 * People this shot puts on screen. An empty cast is an establishing shot.
 * Someone who is not listed, or who the shot marks as off screen, is exempt.
 */
export function appearingCharacters(film: FilmProject, shot: FilmShot): FilmCharacter[] {
  if (shot.characters.length === 0) return [];
  const names = film.characters.map((person) => person.name);
  const excluded = new Set(offscreenCharacterNames(shot, names));
  const wanted = new Set(shot.characters);
  return film.characters.filter((person) => wanted.has(person.name) && !excluded.has(person.name));
}

export function lookBlock(film: FilmProject, shot: FilmShot): LookBlock | null {
  const missing = appearingCharacters(film, shot).find((person) => !lookReady(person));
  if (!missing) return null;
  return {
    code: LOOK_NOT_LOCKED,
    name: missing.name,
    reason: `${missing.name}还没有锁定定妆`,
  };
}

export function firstLookBlock(
  film: FilmProject,
  shots: FilmShot[],
):
  | (LookBlock & {
      shotNo: number;
    })
  | null {
  for (const shot of shots) {
    const blocked = lookBlock(film, shot);
    if (blocked)
      return { ...blocked, shotNo: shot.no, reason: `镜头 ${shot.no}：${blocked.reason}` };
  }
  return null;
}

/** A chosen video whose still was not adopted, or whose on-screen look is not locked. */
export function exportEntryBlock(
  film: FilmProject,
): { code: "STILL_NOT_ACCEPTED" | typeof LOOK_NOT_LOCKED; text: string } | null {
  for (const shot of film.shots) {
    const chosen = shot.selectedTakeId
      ? shot.takes.find(
          (take) => take.id === shot.selectedTakeId && take.status === "done" && take.videoPath,
        )
      : shot.takes.find((take) => take.status === "done" && take.videoPath);
    if (!chosen?.videoPath) continue;
    if (currentStillUrl(shot) && !stillAccepted(film, shot))
      return {
        code: "STILL_NOT_ACCEPTED",
        text: `镜头 ${shot.no} 的画面还没核对，还不能导出`,
      };
    const look = lookBlock(film, shot);
    if (look) return { code: LOOK_NOT_LOCKED, text: `镜头 ${shot.no} 还不能导出：${look.reason}` };
  }
  return null;
}
