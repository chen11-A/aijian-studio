import { expect, it } from "vitest";
import {
  clipAudible,
  exportSoundReady,
  soundRowLabel,
  UNGENERATED_SOUND_LABEL,
} from "./sound-export-decision";

it("does not treat an AAC path as audible sound", () => {
  expect(clipAudible({ path: "/mix/silent.aac", gainDb: -91 })).toBe(false);
  expect(clipAudible({ path: "/mix/voice.aac", gainDb: -12 })).toBe(true);
  expect(clipAudible({ path: "", gainDb: 0 })).toBe(false);
});

it("keeps an ungenerated suggestion unlabeled as finished", () => {
  expect(UNGENERATED_SOUND_LABEL).toBe("建议 · 未生成");
  expect(
    soundRowLabel({
      path: undefined,
      gainDb: 0,
      suggestionGroup: {
        groupId: "g",
        key: "k",
        memberCount: 1,
        lane: "ambience",
      } as never,
    }),
  ).toBe("建议 · 未生成");
  expect(soundRowLabel({ path: "/mix/silent.aac", gainDb: -91 })).not.toMatch(/完成|已生成/);
});

it("records a silent export choice without calling it audible", () => {
  const silent = {
    audioClips: [{ path: "/mix/silent.aac", gainDb: -91 }],
    audioDecision: "SILENT_BY_USER" as const,
  };
  expect(exportSoundReady(silent)).toBe(true);
  expect(exportSoundReady({ audioClips: silent.audioClips })).toBe(false);
  expect(exportSoundReady({ audioClips: [{ path: "/mix/voice.aac", gainDb: -6 }] })).toBe(true);
});
