import { describe, expect, it } from "vitest";
import { AUDIO_LANE_GAIN_DB, dbToVolumePercent, volumePercentToDb } from "../film/audio";
import { stepChoice } from "./radio";
import { clockLabel, durationLabel, shotLabel } from "./shot";
import { clampVolume, dbToVolume, DEFAULT_LANE_VOLUMES, SOUND_LANES, volumeToDb } from "./volume";

describe("shot labels", () => {
  it("names shots and takes in words", () => {
    expect(shotLabel("scene-2-shot-17")).toBe("第 2 场第 17 个镜头");
    expect(shotLabel("scene-2-shot-17-take-3")).toBe("第 2 场第 17 个镜头");
    expect(shotLabel("img-asset-1")).toBe("img-asset-1");
  });

  it("writes times as minutes and seconds", () => {
    expect(clockLabel(157.9)).toBe("2:38");
    expect(clockLabel(0)).toBe("0:00");
    expect(clockLabel(-4)).toBe("0:00");
    expect(clockLabel(Number.NaN)).toBe("0:00");
    expect(durationLabel(274)).toBe("4 分 34 秒");
    expect(durationLabel(45)).toBe("45 秒");
    expect(durationLabel(Number.POSITIVE_INFINITY)).toBe("0 秒");
  });
});

describe("volume and dB", () => {
  it("maps 100/70/50/20/0 to 0/−3/−6/−14/−40 dB, with straight lines between", () => {
    expect(volumeToDb(100)).toBe(0);
    expect(volumeToDb(70)).toBe(-3);
    expect(volumeToDb(50)).toBe(-6);
    expect(volumeToDb(20)).toBe(-14);
    expect(volumeToDb(0)).toBe(-40);
    expect(volumeToDb(85)).toBe(-1.5);
    expect(volumeToDb(35)).toBe(-10);
  });

  it("maps dB back to whole steps", () => {
    expect(dbToVolume(0)).toBe(100);
    expect(dbToVolume(-3)).toBe(70);
    expect(dbToVolume(-6)).toBe(50);
    expect(dbToVolume(-10)).toBe(35);
    expect(dbToVolume(-14)).toBe(20);
    expect(dbToVolume(-40)).toBe(0);
    expect(dbToVolume(-80)).toBe(0);
    expect(dbToVolume(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(dbToVolume(Number.NaN)).toBe(0);
    expect(dbToVolume(12)).toBe(100);
    expect(dbToVolume(Number.POSITIVE_INFINITY)).toBe(100);
  });

  it("uses the same conversion as the music volume on the timeline", () => {
    for (let volume = 0; volume <= 100; volume += 5) {
      expect(volumeToDb(volume)).toBe(volumePercentToDb(volume));
      expect(dbToVolume(volumeToDb(volume))).toBe(dbToVolumePercent(volumePercentToDb(volume)));
    }
  });

  it("keeps volumes inside 0–100", () => {
    expect(clampVolume(140)).toBe(100);
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(49.6)).toBe(50);
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampVolume(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(volumeToDb(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("starts each lane where the app's mixer starts", () => {
    for (const lane of SOUND_LANES) {
      expect(volumeToDb(DEFAULT_LANE_VOLUMES[lane])).toBe(AUDIO_LANE_GAIN_DB[lane]);
    }
  });
});

describe("radio groups", () => {
  const items = ["a", "b", "c"] as const;

  it("moves with arrow keys and wraps", () => {
    expect(stepChoice(items, "a", "ArrowRight")).toBe("b");
    expect(stepChoice(items, "c", "ArrowDown")).toBe("a");
    expect(stepChoice(items, "a", "ArrowLeft")).toBe("c");
    expect(stepChoice(items, "b", "ArrowUp")).toBe("a");
  });

  it("ignores other keys and starts at the first item when nothing is chosen", () => {
    expect(stepChoice(items, "a", "Enter")).toBeNull();
    expect(stepChoice(items, "x" as never, "ArrowRight")).toBe("a");
    expect(stepChoice([], "a", "ArrowRight")).toBeNull();
  });
});
