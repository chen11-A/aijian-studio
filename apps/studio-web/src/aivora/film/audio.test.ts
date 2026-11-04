import { describe, expect, it } from "vitest";
import {
  AUDIO_LANE_GAIN_DB,
  AUDIO_LANE_LABEL,
  emptySoundPlan,
  normalizeAudioClips,
  normalizeSoundPlan,
  shotSecondsForLine,
  storedShotSeconds,
} from "./audio";

describe("audio reservation", () => {
  it("keeps a shot long enough for a line, up to 15 seconds", () => {
    expect(storedShotSeconds(12)).toBe(12);
    expect(storedShotSeconds(99)).toBe(15);
    expect(storedShotSeconds(0)).toBe(1);
    expect(storedShotSeconds(Number.NaN)).toBe(3);
    expect(shotSecondsForLine(3.2, 3)).toEqual({ seconds: 5, fits: true });
    expect(shotSecondsForLine(2, 8)).toEqual({ seconds: 8, fits: true });
    expect(shotSecondsForLine(0, 4)).toEqual({ seconds: 4, fits: true });
    expect(shotSecondsForLine(14.5, 3)).toEqual({ seconds: 15, fits: false });
  });

  it("stores the four lanes and drops a clip that is not one of them", () => {
    expect(AUDIO_LANE_LABEL).toEqual({
      dialogue: "对白",
      ambience: "环境音",
      sfx: "音效",
      score: "配乐",
    });
    expect(emptySoundPlan("雨声").ambience).toBe("雨声");
    expect(normalizeSoundPlan(null).source).toBe("native");
    expect(
      normalizeSoundPlan({
        source: "dub",
        sfx: [{ atSeconds: 1.2, text: "刀出鞘" }, { text: "  " }, null],
        musicMood: "紧张",
      }).sfx,
    ).toEqual([{ atSeconds: 1.2, text: "刀出鞘" }]);
    expect(normalizeSoundPlan({ source: "other" }, "巷子").ambience).toBe("巷子");
    const clips = normalizeAudioClips([
      { id: "a", lane: "dialogue", label: "原声", shotId: "s1" },
      { id: "b", lane: "score", gainDb: -10 },
      { id: "", lane: "sfx" },
      { id: "c", lane: "video" },
      null,
    ]);
    expect(clips.map((clip) => clip.lane)).toEqual(["dialogue", "score"]);
    expect(clips[0]?.gainDb).toBe(AUDIO_LANE_GAIN_DB.dialogue);
    expect(clips[0]?.label).toBe("原声");
    expect(clips[1]?.gainDb).toBe(-10);
    expect(clips[1]?.shotId).toBe("");
    expect(normalizeAudioClips({ lane: "dialogue" })).toEqual([]);
  });
});
