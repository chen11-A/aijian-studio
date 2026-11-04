import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { durationInputUnchanged, planShotDuration } from "./shot-duration";
it("uses measured seconds or the existing text estimate", () => {
  const shot = { ...sampleFilm().shots[0]!, line: "别走。", seconds: 2 };
  expect(planShotDuration(shot, 5)).toMatchObject({ kind: "update" });
  expect(planShotDuration(shot, undefined)).toMatchObject({
    kind: "update",
    notice: expect.stringContaining("按字数估算"),
  });
});
it.each(["line", "seconds", "scene", "lock"])(
  "rejects duration updates after %s edits",
  (field) => {
    const before = sampleFilm().shots[0]!;
    const after = { ...before };
    if (field === "line") after.line += "新台词";
    if (field === "seconds") after.seconds += 2;
    if (field === "scene") after.sceneId = "new-scene";
    if (field === "lock") after.userFields = ["seconds"];
    expect(durationInputUnchanged(before, after)).toBe(false);
  },
);
it("preserves unrelated sound edits when accepting a duration result", () => {
  const before = { ...sampleFilm().shots[0]!, userFields: [] };
  expect(
    durationInputUnchanged(before, {
      ...before,
      sound: { ...before.sound, ambience: "用户背景声" },
    }),
  ).toBe(true);
});
