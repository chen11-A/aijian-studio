import { expect, it } from "vitest";
import { LOWEST_GAIN_DB } from "./sound-export-decision";
import { VOLUME_STOPS } from "../film/audio";
import {
  gainAtLowestStop,
  soundChoicePending,
  soundRowLabel,
  UNGENERATED_SOUND_LABEL,
} from "./sound-export-decision";

it("uses the lowest volume stop as a diagnostic and not as an export decision", () => {
  expect(LOWEST_GAIN_DB).toBe(VOLUME_STOPS[VOLUME_STOPS.length - 1]!.db);
  expect(gainAtLowestStop(LOWEST_GAIN_DB)).toBe(true);
  expect(soundRowLabel({ path: "/mix/quiet.aac", gainDb: LOWEST_GAIN_DB })).toContain(
    "增益在最低档",
  );
  expect(soundRowLabel({ path: "/mix/quiet.aac", gainDb: LOWEST_GAIN_DB })).not.toMatch(
    /可听|完成|已生成/,
  );
  expect(soundChoicePending({})).toBe(true);
  expect(soundChoicePending({ audioDecision: "SILENT_BY_USER" })).toBe(false);
  expect(soundChoicePending({ audioDecision: "WITH_AUDIO" })).toBe(false);
});

it("labels an ungenerated suggestion and does not call it finished", () => {
  expect(UNGENERATED_SOUND_LABEL).toBe("建议 · 未生成");
  expect(
    soundRowLabel({
      path: undefined,
      gainDb: 0,
      suggestionGroup: { groupId: "g" } as never,
    }),
  ).toBe("建议 · 未生成");
});
