import { shotActionText } from "./shot-actions";
import { describe, expect, it } from "vitest";
import { parseDirectorShots } from "./project";
import { detectDirectorCoverage, mergeAdjacentShots, shotLines } from "./director-continuity";

describe("3JR-B01 lossless scene compression (synthetic director replies)", () => {
  it.each([19, 21])(
    "compresses %i differently framed shots to sixteen with the tail intact",
    (count) => {
      const raw = Array.from({ length: count }, (_, i) => ({
        picture: i === count - 1 ? "警笛渐近，周烈从后门离开。" : `沈砚完成第${i + 1}个节拍。`,
        action: `动作${i + 1}`,
        size: i % 2 ? "近景" : "全景",
        angle: i % 2 ? "平视" : "俯视",
        seconds: 3,
        speaker: "林晚",
        line: `第${i + 1}句话。`,
      }));
      const source =
        raw.map((row) => `林晚：“${row.line}”`).join("\n") + "\n警笛渐近，周烈从后门离开。";
      const result = parseDirectorShots(JSON.stringify({ shots: raw }), "scene-1", source)!;
      expect(result.length).toBeLessThanOrEqual(16);
      expect(result.flatMap(shotLines).map((line) => line.text)).toEqual(
        raw.map((row) => row.line),
      );
      for (const row of raw) {
        expect(result.map((shot) => shot.picture).join("\n")).toContain(row.picture);
        expect(result.map(shotActionText).join("\n")).toContain(row.action);
      }
      expect(result.reduce((sum, shot) => sum + shot.seconds, 0)).toBe(count * 3);
      expect(detectDirectorCoverage({ id: "scene-1", text: source }, result).ok).toBe(true);
    },
  );

  it("does not destroy media or truncate unmergeable material to fake sixteen", () => {
    const shots = parseDirectorShots(
      JSON.stringify({
        shots: Array.from({ length: 19 }, (_, i) => ({
          picture: `节拍${i}`,
          seconds: 15,
        })),
      }),
      "scene-1",
      "",
      [],
      false,
    )!;
    shots[0]!.poster = "aivora-media://existing.png";
    const result = mergeAdjacentShots(shots, 16);
    expect(result).toHaveLength(19);
    expect(result[0]!.poster).toBe("aivora-media://existing.png");
    expect(result.at(-1)!.picture).toBe("节拍18");
  });
});

it("compresses alternating speakers above sixteen without dropping or reassigning dialogue", () => {
  const raw = Array.from({ length: 21 }, (_, i) => ({
    picture: i === 20 ? "警笛渐近，周烈离开。" : `第${i + 1}个画面。`,
    action: `第${i + 1}个动作`,
    seconds: 3,
    speaker: i % 2 ? "沈砚" : "林晚",
    line: `第${i + 1}句话。`,
  }));
  const source =
    raw.map((row) => `${row.speaker}：“${row.line}”`).join("\n") + "\n警笛渐近，周烈离开。";
  const shots = parseDirectorShots(JSON.stringify({ shots: raw }), "scene-1", source)!;
  expect(shots.length).toBeLessThanOrEqual(16);
  expect(shots.flatMap(shotLines)).toEqual(
    raw.map((row) => ({ speaker: row.speaker, text: row.line })),
  );
  expect(shots.reduce((sum, shot) => sum + shot.seconds, 0)).toBe(63);
  expect(shots.map(shotActionText).join("\n")).toContain("第21个动作");
  expect(detectDirectorCoverage({ id: "scene-1", text: source }, shots).ok).toBe(true);
  expect(shots.map((s) => s.id)).toEqual(shots.map((_, i) => `scene-1-shot-${i + 1}`));
});
