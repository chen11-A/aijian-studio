import { describe, expect, it } from "vitest";
import { detectDirectorCoverage } from "./director-continuity";
import { parseDirectorShots } from "./project";

describe("3JR-B03 tail coverage uses dialogue and narration evidence separately", () => {
  it("still requires quoted writing which is not spoken dialogue", () => {
    const shots = parseDirectorShots('{"shots":[{"picture":"纸条"}]}', "scene-2", "", [], false)!;
    const scene = { id: "scene-2", text: "纸条：“禁止入内。”" };
    expect(detectDirectorCoverage(scene, shots).ok).toBe(false);
    shots[0]!.picture = "纸条上写着禁止入内。";
    expect(detectDirectorCoverage(scene, shots).ok).toBe(true);
  });
  it.each(["“算你狠。”", "“算你狠……”", "周烈：算你狠。"])(
    "covers spoken tail %s despite quote formatting",
    (text) => {
      const shots = parseDirectorShots(
        '{"shots":[{"picture":"周烈开口","speaker":"周烈","line":"算你狠。"}]}',
        "scene-2",
        "周烈：“算你狠。”",
        [],
        false,
      )!;
      expect(detectDirectorCoverage({ id: "scene-2", text }, shots)).toMatchObject({
        ok: true,
        missingLines: [],
        missingTail: null,
      });
    },
  );
  it("accepts tail dialogue and full narrative spread across actual shot fields", () => {
    const text = "“算你狠。”周烈啐了一口，带着人钻进雨里，消失在仓库后门。";
    const shots = parseDirectorShots(
      JSON.stringify({
        shots: [
          { picture: "周烈啐了一口", speaker: "周烈", line: "算你狠。" },
          { picture: "带着人钻进雨里", action: "消失在仓库后门。" },
        ],
      }),
      "scene-2",
      text,
      [],
      false,
    )!;
    expect(detectDirectorCoverage({ id: "scene-2", text }, shots).ok).toBe(true);
    shots[1]!.action = "";
    expect(detectDirectorCoverage({ id: "scene-2", text }, shots)).toMatchObject({
      ok: false,
      missingLines: [],
      missingTail: text,
    });
  });
  it("does not count a missing or reordered sentence as covered by punctuation tolerance", () => {
    const shots = parseDirectorShots(
      '{"shots":[{"picture":"周烈开口","speaker":"周烈","line":"算你狠。先走吧。"}]}',
      "scene-2",
      "周烈：“算你狠。先走吧。”",
      [],
      false,
    )!;
    expect(
      detectDirectorCoverage({ id: "scene-2", text: "周烈：“先走吧。算你狠。”" }, shots)
        .missingLines,
    ).toContain("算你狠。");
    expect(
      detectDirectorCoverage({ id: "scene-2", text: "周烈：“算你狠。别再来了。”" }, shots)
        .missingLines,
    ).toContain("别再来了。");
  });

  // 3JR-B03: the scene ends of test-novel-2000 as a director would write them.
  const bookstoreEnd = "就在这时，门外传来刺耳的刹车声。两束车灯穿透雨幕，直直打在玻璃门上。";
  it("counts a reworded ending, with its sound in the sound design, as shot", () => {
    const shots = parseDirectorShots(
      JSON.stringify({
        shots: [
          { picture: "林晚低头整理发票", speaker: "林晚", line: "你来晚了。" },
          { picture: "两束车灯穿透雨幕，打在书店玻璃门上" },
        ],
      }),
      "scene-1",
      bookstoreEnd,
      [],
      false,
    )!;
    shots[1]!.sound = { ...shots[1]!.sound, sfx: [{ atSeconds: 0, text: "门外刺耳的刹车声" }] };
    expect(
      detectDirectorCoverage({ id: "scene-1", text: bookstoreEnd }, shots).missingTail,
    ).toBeNull();
  });
  it("still reports an ending that the last shots do not show", () => {
    const shots = parseDirectorShots(
      JSON.stringify({
        shots: [{ picture: "沈砚环顾四周" }, { picture: "墙上一张泛黄的合影" }],
      }),
      "scene-1",
      bookstoreEnd,
      [],
      false,
    )!;
    expect(detectDirectorCoverage({ id: "scene-1", text: bookstoreEnd }, shots).missingTail).toBe(
      bookstoreEnd,
    );
  });
  it("reports an ending event with none of its words shot, even when half the words are there", () => {
    const text = "门打开了。警笛响起。";
    const shots = parseDirectorShots(
      '{"shots":[{"picture":"门打开了。","seconds":3}]}',
      "scene-1",
      text,
      [],
      false,
    )!;
    expect(detectDirectorCoverage({ id: "scene-1", text }, shots).missingTail).toBe(text);
  });
  it("counts the warehouse ending reworded into one shot", () => {
    const text = "“算你狠。”周烈啐了一口，带着人钻进雨里，消失在仓库后门。";
    const shots = parseDirectorShots(
      JSON.stringify({
        shots: [
          { picture: "周烈啐了一口，带人消失在后门的雨里", speaker: "周烈", line: "算你狠。" },
        ],
      }),
      "scene-2",
      text,
      [],
      false,
    )!;
    expect(detectDirectorCoverage({ id: "scene-2", text }, shots)).toMatchObject({
      ok: true,
      missingTail: null,
    });
  });
});
