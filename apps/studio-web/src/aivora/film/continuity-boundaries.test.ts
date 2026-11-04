import { describe, expect, it } from "vitest";
import { detectDirectorCoverage, mergeAdjacentShots } from "./director-continuity";
import { extractScriptLines } from "./phase2";
import { blankFilm, parseDirectorShots } from "./project";
import { parseWriterScenes, storyFilmBatches } from "./operations";

describe("revised continuity review boundaries", () => {
  it("does not absorb narration into unquoted dialogue or read a sign aloud", () => {
    expect(extractScriptLines("林晚：这书店我不卖。她转身关门。")).toEqual([
      { speaker: "林晚", text: "这书店我不卖。" },
    ]);
    expect(extractScriptLines("林晚：“走吧。跟我来。”她转身关门。")).toEqual([
      { speaker: "林晚", text: "走吧。跟我来。" },
    ]);
    expect(extractScriptLines("纸条：“禁止入内。”")).toEqual([]);
  });

  it("never merges different speakers just to meet the shot target", () => {
    const source = "林晚：“走吧。”\n沈砚：“好。”";
    const raw = parseDirectorShots(
      JSON.stringify({
        shots: [
          { picture: "林晚转身", line: "走吧。", speaker: "林晚", seconds: 3 },
          { picture: "沈砚点头", line: "好。", speaker: "沈砚", seconds: 3 },
        ],
      }),
      "scene-1",
      source,
      [],
      false,
    )!;
    const result = mergeAdjacentShots(raw, 1);
    expect(result).toHaveLength(2);
    expect(result.map((shot) => shot.speaker)).toEqual(["林晚", "沈砚"]);
    const silent = { ...raw[1]!, line: "", lines: [], speaker: "" };
    const compatible = mergeAdjacentShots([raw[0]!, silent], 1);
    expect(compatible).toHaveLength(1);
    expect(compatible[0]?.lines).toEqual([{ speaker: "林晚", text: "走吧。" }]);
    const multi = {
      ...raw[0]!,
      line: "走吧。\n好。",
      lines: [
        { speaker: "林晚", text: "走吧。" },
        { speaker: "沈砚", text: "好。" },
      ],
    };
    expect(mergeAdjacentShots([multi, silent], 1)).toHaveLength(2);
    expect(() => storyFilmBatches(blankFilm(), [multi], false)).toThrow();
    try {
      storyFilmBatches(blankFilm(), [multi], false);
    } catch (error) {
      expect(error).toMatchObject({ code: "MULTI_VOICE_REQUIRED" });
    }
  });

  it("preserves protected shot ids and media during a merge pass", () => {
    const shot = parseDirectorShots('{"shots":[{"picture":"警笛远去。"}]}', "scene-1")![0]!;
    const protectedShot = {
      ...shot,
      id: "scene-1-shot-9",
      poster: "aivora-media://still.png",
      userFields: ["picture"],
    };
    const result = mergeAdjacentShots([protectedShot], 16);
    expect(result[0]).toMatchObject({
      id: "scene-1-shot-9",
      poster: "aivora-media://still.png",
      userFields: ["picture"],
    });
  });

  it("does not mark disputed paragraph ownership as covered even with exact copied text", () => {
    const scene = {
      id: "scene-1",
      text: "警笛远去。",
      paragraphCoverage: {
        ok: false,
        missingParagraphs: ["P02"],
        duplicateParagraphs: [],
        invalidParagraphs: [],
        crossSceneRisk: true,
      },
    };
    const shots = parseDirectorShots('{"shots":[{"picture":"警笛远去。"}]}', scene.id, scene.text)!;
    expect(detectDirectorCoverage(scene, shots)).toMatchObject({
      ok: false,
      missingLines: [],
      missingTail: null,
    });
  });

  it("flags assignments without evidence even when the novel has no scene headings", () => {
    const source = "书店里灯亮着。\n码头的警笛响起。";
    const result = parseWriterScenes(
      JSON.stringify({ scenes: [{ title: "模型场景", text: "模型猜测另一件事情。" }] }),
      source,
    )!;
    expect(result.map((scene) => scene.text).join("\n")).toBe(source);
    expect(result[0]?.paragraphCoverage).toMatchObject({
      ok: false,
      missingParagraphs: ["P01", "P02"],
    });
  });

  it("uniquifies repeated scene ids from separate writer batches without conflating scenes", () => {
    const result = parseWriterScenes(
      JSON.stringify({
        scenes: [
          { id: "scene-1", title: "书店 · 夜", text: "灯亮着。", source_paragraphs: ["P01"] },
          { id: "scene-1", title: "码头 · 晨", text: "警笛响起。", source_paragraphs: ["P02"] },
        ],
      }),
      "灯亮着。\n警笛响起。",
    );
    expect(result?.map((scene) => scene.id)).toEqual(["scene-1", "scene-2"]);
    expect(result?.map((scene) => scene.no)).toEqual([1, 2]);
    expect(result?.map((scene) => scene.title)).toEqual(["书店 · 夜", "码头 · 晨"]);
  });
});
