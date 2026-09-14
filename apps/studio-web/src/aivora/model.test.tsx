import { describe, expect, it } from "vitest";
import { moveShot, shotAtTime } from "./model";
import { initialShots } from "./data";

describe("demo animatic timeline", () => {
  it("advances at the exact shot boundary, and holds the final still at the end", () => {
    expect(shotAtTime(initialShots, 0)?.id).toBe(1);
    expect(shotAtTime(initialShots, 29.99)?.id).toBe(1);
    expect(shotAtTime(initialShots, 30)?.id).toBe(2);
    expect(shotAtTime(initialShots, 84.75)?.id).toBe(3);
    expect(shotAtTime(initialShots, 239.99)?.id).toBe(8);
    expect(shotAtTime(initialShots, 240)?.id).toBe(8);
    expect(shotAtTime(initialShots, 241)?.id).toBe(8);
  });
  it("uses edited durations to locate the reference frame", () => {
    const edited = initialShots.map((shot) => (shot.id === 1 ? { ...shot, duration: 1.5 } : shot));
    expect(shotAtTime(edited, 1.49)?.id).toBe(1);
    expect(shotAtTime(edited, 1.5)?.id).toBe(2);
  });
  it("reorders in both directions without losing objects or mutating the baseline", () => {
    const original = initialShots.map((shot) => shot.id);
    const moved = moveShot(initialShots, 1, 3);
    expect(moved.slice(0, 3).map((shot) => shot.id)).toEqual([2, 3, 1]);
    expect(moveShot(moved, 1, 2).map((shot) => shot.id)).toEqual(original);
    expect(initialShots.map((shot) => shot.id)).toEqual(original);
    expect(moved.reduce((sum, shot) => sum + shot.duration, 0)).toBe(240);
  });
  it("ignores stale drag references and identical targets", () => {
    expect(moveShot(initialShots, 999, 1)).toBe(initialShots);
    expect(moveShot(initialShots, 1, 999)).toBe(initialShots);
    expect(moveShot(initialShots, 1, 1)).toBe(initialShots);
    expect(shotAtTime([], 0)).toBeUndefined();
  });
});
