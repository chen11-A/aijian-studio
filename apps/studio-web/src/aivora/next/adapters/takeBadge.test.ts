import { describe, expect, it } from "vitest";
import type { FilmShot, FilmTake } from "../../film/project";
import { selection, takeBadge } from "./takeBadge";

const take = (id: string, status: FilmTake["status"]) => ({ id, status }) as FilmTake;
const shot = (takes: FilmTake[], selectedTakeId = "", seconds = 3, line = ""): FilmShot =>
  ({ takes, selectedTakeId, seconds, line }) as unknown as FilmShot;

describe("takeBadge", () => {
  it("counts only made versions and says which one is in use", () => {
    expect(takeBadge(shot([take("a", "done")]))).toBeNull();
    const takes = [take("a", "done"), take("b", "failed"), take("c", "done"), take("d", "done")];
    expect(takeBadge(shot(takes))).toBe("版本 1/3");
    expect(takeBadge(shot(takes, "c"))).toBe("版本 2/3");
    expect(takeBadge(shot(takes, "b"))).toBeNull();
  });
});

describe("selection", () => {
  const shots = [shot([], "", 2), shot([], "", 3, "你来晚了。"), shot([], "", 4)];

  it("covers in to out in either order, and finds a spoken line in it", () => {
    expect(selection(shots, { from: 2, to: 1 }, 0)).toEqual({
      first: 1,
      last: 2,
      start: 2,
      seconds: 7,
      hasLine: true,
    });
    expect(selection(shots, null, 2)).toMatchObject({
      first: 2,
      last: 2,
      start: 5,
      hasLine: false,
    });
  });
});
