import { describe, expect, it } from "vitest";
import { sampleFilm } from "../film/project";
import { movedNotice, moveShotBy, readShotDrag } from "./shot-order";

describe("shot order (5-3-05)", () => {
  it("moves a shot several places within its scene in one change", () => {
    const film = sampleFilm();
    const sceneId = film.shots[0]!.sceneId;
    const ids = () => film.shots.filter((item) => item.sceneId === sceneId).map((item) => item.id);
    const scene = ids();
    expect(scene.length).toBeGreaterThanOrEqual(4);
    const later = moveShotBy(film, scene[0]!, 3);
    const order = later.shots.filter((item) => item.sceneId === sceneId);
    expect(order.map((item) => item.id)).toEqual([
      scene[1],
      scene[2],
      scene[3],
      scene[0],
      ...scene.slice(4),
    ]);
    expect(order.map((item) => item.no)).toEqual(order.map((_, index) => index + 1));
    const back = moveShotBy(later, scene[0]!, -3);
    expect(back.shots.filter((item) => item.sceneId === sceneId).map((item) => item.id)).toEqual(
      scene,
    );
    // Past the end it stops there; no steps is no change.
    const end = moveShotBy(film, scene[0]!, 99);
    expect(end.shots.filter((item) => item.sceneId === sceneId).at(-1)?.id).toBe(scene[0]);
    expect(moveShotBy(film, scene[0]!, 0)).toBe(film);
  });

  it("reads only a shot card's drag", () => {
    expect(readShotDrag(JSON.stringify({ scope: "f:01", id: "s1" }))).toEqual({
      scope: "f:01",
      id: "s1",
    });
    expect(readShotDrag("")).toBeNull();
    expect(readShotDrag("not json")).toBeNull();
    // An action dragged from 场记 carries an index, not a shot.
    expect(readShotDrag(JSON.stringify({ scope: "f:01", index: 0, text: "x" }))).toBeNull();
  });

  it("says where the shot went, in the numbers seen while dragging", () => {
    expect(movedNotice(5, 2, true)).toBe("已把镜头 5 挪到镜头 2 前面。Ctrl+Z 可以撤回。");
    expect(movedNotice(1, 3, false)).toBe("已把镜头 1 挪到镜头 3 后面。Ctrl+Z 可以撤回。");
  });
});
