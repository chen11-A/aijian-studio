import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { novelHeadingSlices, numberParagraphs, parseWriterScenes } from "./operations";
import { parseDirectorShots, shotBudget } from "./project";
import { actionFromModel, lineInScript, plainCue, scriptDialogue } from "./phase2";

const shot = { picture: "站在窗前", characters: ["甲甲", "乙乙"] };
const writer = (groups: string[][]) =>
  JSON.stringify({
    scenes: groups.map((ids, index) => ({
      title: `场景${index}`,
      text: "模型摘要",
      source_paragraphs: ids,
    })),
  });

describe("source continuity regressions from phase3i audit", () => {
  it("rejects missing, duplicate, and invalid paragraph ownership without writing partial scenes", () => {
    const source = "甲说：“第一句。”\n乙说：“第二句。”\n丙说：“第三句。”";
    expect(parseWriterScenes(writer([["P01"], ["P02"]]), source)).toBeNull();
    expect(
      parseWriterScenes(
        writer([
          ["P01", "P02"],
          ["P02", "P03"],
        ]),
        source,
      ),
    ).toBeNull();
    expect(parseWriterScenes(writer([["P01", "P02"], ["P99"]]), source)).toBeNull();
    const valid = parseWriterScenes(writer([["P01"], ["P02", "P03"]]), source);
    expect(valid?.map((scene) => scene.text).join("\n")).toBe(source);
  });

  it("keeps explicitly attributed unpunctuated dialogue without treating names or sounds as speech", () => {
    const line = "雨".repeat(80);
    expect(lineInScript(`林骁：“${line}”`, line)).toBe(line);
    expect(lineInScript(`林骁说：「${line}」`, line)).toBe(line);
    expect(lineInScript('林骁说："快走"', "快走")).toBe("快走");
    expect(lineInScript("那家“晚照书店”还亮着灯。", "晚照书店")).toBe("");
    expect(lineInScript("铁棍“当啷”落地。", "当啷")).toBe("");
    const shots = parseDirectorShots(
      JSON.stringify({ shots: [{ ...shot, line }] }),
      "scene-1",
      `林骁：“${line}”`,
    );
    expect(shots?.[0]?.line).toBe(line);
  });

  it("preserves the target shot ids of flat action beats", () => {
    expect(
      actionFromModel({
        beats: [
          { shot_id: "scene-1-shot-2", text: "侧身避开", feasibility: "稳" },
          { id: "scene-1-shot-3", text: "抬手格挡", feasibility: "稳" },
        ],
      })?.map((row) => row.shotId),
    ).toEqual(["scene-1-shot-2", "scene-1-shot-3"]);
  });

  it("hides absent hold fields and describes invalid timing without changing valid seconds", () => {
    for (const field of [
      "hold_s:null",
      "hold_seconds=null",
      "hold_s=undefined",
      "hold_s:",
      "hold_s none",
    ])
      expect(plainCue(field)).toBe("");
    expect(plainCue("抬眼，hold_s:null，放下手")).toBe("抬眼，放下手");
    for (const value of ["NaN", "Infinity", "-1", "1.2.3", "unknown", "1s"])
      expect(plainCue(`hold_s=${value}`)).toBe("停顿时间未指定");
    expect(plainCue("hold_seconds: 1.5，hold_s=0，hold_s .25，hold_s 2")).toBe(
      "停 1.5 秒，停 0 秒，停 .25 秒，停 2 秒",
    );
  });

  it("preserves multiple sentences in unquoted speaker lines", () => {
    expect(scriptDialogue("林晚：走吧。跟我来。", ["林晚"])).toEqual([
      { speaker: "林晚", line: "走吧。跟我来。" },
    ]);
    expect(scriptDialogue("林晚：走吧。她还在等我们。", ["林晚"])).toEqual([
      { speaker: "林晚", line: "走吧。她还在等我们。" },
    ]);
    expect(scriptDialogue("林晚：走吧。跟我来。随后他转身离开。", ["林晚"])).toEqual([
      { speaker: "林晚", line: "走吧。跟我来。" },
    ]);
  });

  it("round trips P100 and later paragraphs", () => {
    const source = Array.from({ length: 105 }, (_, index) => `第${index + 1}段原文。`).join("\n");
    const ids = numberParagraphs(source).map((paragraph) => paragraph.id);
    expect(ids[99]).toBe("P100");
    expect(
      parseWriterScenes(writer([ids.slice(0, 99), ids.slice(99)]), source)
        ?.map((scene) => scene.text)
        .join("\n"),
    ).toBe(source);
  });

  it("retains over-budget shots and assigns unique ids after repeated scene blocks", () => {
    const block = { scene_id: "scene-1", shots: Array.from({ length: 20 }, () => shot) };
    const result = parseDirectorShots(JSON.stringify({ scenes: [block, block] }), "scene-1", "");
    expect(result).toHaveLength(40);
    expect(new Set(result?.map((item) => item.id)).size).toBe(40);
    expect(shotBudget("短场")).toBe(1);
  });

  it("adds omitted source coverage only once after combining repeated blocks", () => {
    const block = { scene_id: "scene-1", shots: [shot] };
    const result = parseDirectorShots(
      JSON.stringify({ scenes: [block, block] }),
      "scene-1",
      "末段警笛响起。",
    );
    expect(result?.filter((item) => item.source === "source:coverage")).toHaveLength(1);
    expect(plainCue("抬手。。保留原文：肘击，hold_s: 1，hold_s=2")).toBe(
      "抬手。肘击，停 1 秒，停 2 秒",
    );
  });

  it("maps unknown ids in multi-scene replies in requested source order", () => {
    const scenes = [1, 2].map((no) => ({
      id: `scene-${no}`,
      title: `场${no}`,
      where: "",
      text: "",
    }));
    const result = parseDirectorShots(
      JSON.stringify({
        scenes: [
          { scene_id: "unknown-a", shots: [shot] },
          { scene_id: "unknown-b", shots: [shot] },
        ],
      }),
      "scene-1",
      "",
      scenes,
    );
    expect(result?.map((item) => item.sceneId)).toEqual(["scene-1", "scene-2"]);
  });

  it("keeps both dialogue entries and punctuation without narrating a trailing action", () => {
    const source = "甲甲说：“第一句。”\n乙乙说：“第二句。”";
    const result = parseDirectorShots(
      JSON.stringify({
        shots: [
          {
            ...shot,
            dialogue: [
              { speaker: "甲甲", line: "第一句。" },
              { speaker: "乙乙", line: "第二句。" },
            ],
          },
        ],
      }),
      "scene-1",
      source,
    );
    expect(result?.filter((item) => item.line).map((item) => item.line)).toEqual([
      "第一句。",
      "第二句。",
    ]);
    expect(scriptDialogue("林骁：走吧。随后他转身离开。", ["林骁"])).toEqual([
      { speaker: "林骁", line: "走吧。" },
    ]);
  });

  it("uses the actual repository novel and preserves every paragraph, quoted line and ending", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
      "utf8",
    );
    const scenes = novelHeadingSlices(source);
    expect(scenes.map((scene) => scene.title)).toEqual(["雨夜旧书店", "码头仓库", "医院走廊"]);
    for (const [index, scene] of scenes.entries()) {
      const result = parseDirectorShots(
        JSON.stringify({ shots: Array.from({ length: 20 }, () => shot) }),
        `scene-${index + 1}`,
        scene.text,
      );
      expect(result!.length).toBeGreaterThan(20);
      const output = result!.map((item) => `${item.picture}\n${item.line}`).join("\n");
      const paragraphs = scene.text
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(1);
      for (const paragraph of paragraphs) expect(output).toContain(paragraph);
      for (const quote of scene.text.matchAll(/“([^”]+)”/gu)) expect(output).toContain(quote[1]);
      expect(output).toContain(paragraphs.at(-1));
    }
    const ids = numberParagraphs(source).map((paragraph) => paragraph.id);
    const result = parseWriterScenes(
      JSON.stringify({
        scenes: [{ title: "第 1 场", text: scenes[0]!.text, source_paragraphs: ids }],
      }),
      source,
    );
    expect(result?.[0]?.title).toBe("雨夜旧书店");
  });
});
