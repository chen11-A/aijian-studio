import { describe, expect, it } from "vitest";
import { fightSample, planShots } from "./shot-plan";

describe("local shot plan", () => {
  it("turns a short story into six to ten shots", () => {
    const shots = planShots("雾还没散。灯塔亮着。她没有回头。");
    const total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
    expect(shots.length).toBeGreaterThanOrEqual(6);
    expect(shots.length).toBeLessThanOrEqual(10);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(60);
    expect(shots.every((shot) => shot.action && shot.performance && shot.shotSize)).toBe(true);
  });

  it("uses the fight sample without graphic injury", () => {
    const script = fightSample();
    const shots = planShots(script);
    expect(script).toContain("林夏");
    expect(script).toContain("阿凯");
    expect(shots).toHaveLength(8);
    expect(shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)).toBeGreaterThanOrEqual(40);
    expect(shots.some((shot) => shot.action.includes("拳") || shot.action.includes("肩"))).toBe(
      true,
    );
    expect(shots.every((shot) => !shot.action.includes("血腥"))).toBe(true);
  });
});
