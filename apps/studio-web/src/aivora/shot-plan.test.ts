import { describe, expect, it } from "vitest";
import { fightSample, planShots } from "./shot-plan";

describe("local shot plan", () => {
  it("turns each sentence into one shot and does not repeat a line", () => {
    const shots = planShots("雾还没散。灯塔亮着。她没有回头。");
    expect(shots.map((shot) => shot.narration)).toEqual(["雾还没散", "灯塔亮着", "她没有回头"]);
    expect(new Set(shots.map((shot) => shot.narration)).size).toBe(shots.length);
    expect(shots.every((shot) => shot.action === "" && shot.performance === "")).toBe(true);
    expect(shots.every((shot) => shot.shotSize === "全景")).toBe(true);
  });

  it("keeps one narration per line", () => {
    const shots = planShots("雨打巷口\n林夏停步\n阿凯抬手\n两人错身\n雨还在下\n巷子静了");
    expect(shots.map((shot) => shot.narration)).toEqual([
      "雨打巷口",
      "林夏停步",
      "阿凯抬手",
      "两人错身",
      "雨还在下",
      "巷子静了",
    ]);
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
