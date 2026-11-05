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
});
