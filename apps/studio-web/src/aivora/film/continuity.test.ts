import {
  detectDirectorCoverage,
  directorPlanStatus,
  coverageRepairContext,
  shotLines,
} from "./director-continuity";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { novelHeadingSlices, numberParagraphs, parseWriterScenes, splitNovel } from "./operations";
import { blankFilm, parseDirectorShots, shotBudget, upgradeFilm } from "./project";
import {
  actionFromModel,
  attachScriptLines,
  extractScriptLines,
  lineInScript,
  plainCue,
  scriptDialogue,
} from "./phase2";

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
  it("repairs missing ownership to the preceding scene and keeps only the first duplicate with risks", () => {
    const source = "甲说：“第一句。”\n乙说：“第二句。”\n丙说：“第三句。”";
    for (const groups of [
      [["P01"], ["P02"]],
      [
        ["P01", "P02"],
        ["P02", "P03"],
      ],
      [["P01", "P02"], ["P99"]],
    ]) {
      const result = parseWriterScenes(writer(groups), source);
      expect(result?.map((scene) => scene.text).join("\n")).toBe(source);
      expect(result?.some((scene) => !scene.paragraphCoverage?.ok)).toBe(true);
    }
    const missing = parseWriterScenes(writer([["P01"], ["P03"]]), source);
    expect(missing?.[0]?.text).toContain("第二句");
    expect(missing?.[0]?.paragraphCoverage?.missingParagraphs).toEqual(["P02"]);
    const valid = parseWriterScenes(writer([["P01"], ["P02", "P03"]]), source);
    expect(valid?.every((scene) => scene.paragraphCoverage?.ok)).toBe(true);
    const crossed = parseWriterScenes(
      writer([["P01"], ["P04"]]),
      "第一场 书店\n灯亮着。\n第二场 码头\n警笛响起。",
    );
    expect(crossed?.[0]?.paragraphCoverage).toMatchObject({ ok: false, crossSceneRisk: true });
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

  it("ends unquoted speaker lines at the first sentence while quoted speech stays complete", () => {
    expect(scriptDialogue("林晚：走吧。跟我来。", ["林晚"])).toEqual([
      { speaker: "林晚", line: "走吧。" },
    ]);
    expect(scriptDialogue("林晚：走吧。她还在等我们。", ["林晚"])).toEqual([
      { speaker: "林晚", line: "走吧。" },
    ]);
    expect(scriptDialogue("林晚：走吧。跟我来。随后他转身离开。", ["林晚"])).toEqual([
      { speaker: "林晚", line: "走吧。" },
    ]);
  });

  it("clears a pre-existing invented line in the dialogue attachment helper", () => {
    expect(
      attachScriptLines(
        [
          {
            picture: "林骁站在门边。",
            characters: ["林骁"],
            line: "凭空捏造的台词",
            speaker: "林骁",
          },
        ],
        "林骁站在门边。",
        ["林骁"],
      )[0]?.line,
    ).toBe("");
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
    const block = {
      scene_id: "scene-1",
      shots: Array.from({ length: 20 }, () => ({ ...shot, seconds: 15 })),
    };
    const result = parseDirectorShots(JSON.stringify({ scenes: [block, block] }), "scene-1", "");
    expect(result).toHaveLength(40);
    expect(new Set(result?.map((item) => item.id)).size).toBe(40);
    expect(shotBudget("短场")).toBe(1);
  });

  it("reports omitted source instead of silently adding copied source shots", () => {
    const block = { scene_id: "scene-1", shots: [shot] };
    const result = parseDirectorShots(
      JSON.stringify({ scenes: [block, block] }),
      "scene-1",
      "末段警笛响起。",
    );
    expect(result?.filter((item) => item.source === "source:coverage")).toHaveLength(0);
    expect(
      detectDirectorCoverage({ id: "scene-1", text: "末段警笛响起。" }, result ?? []),
    ).toMatchObject({ ok: false, missingTail: expect.any(String) });
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
    expect(result).toHaveLength(1);
    expect(result?.[0]?.lines).toEqual([
      { speaker: "甲甲", text: "第一句。" },
      { speaker: "乙乙", text: "第二句。" },
    ]);
    expect(result?.[0]?.line).toBe("第一句。\n第二句。");
    expect(scriptDialogue("林骁：走吧。随后他转身离开。", ["林骁"])).toEqual([
      { speaker: "林骁", line: "走吧。" },
    ]);
  });

  it("detects every real novel line in order and the ending without fabricating coverage", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
      "utf8",
    );
    const scenes = novelHeadingSlices(source);
    expect(scenes.map((scene) => scene.title)).toEqual(["雨夜旧书店", "码头仓库", "医院走廊"]);
    for (const [index, scene] of scenes.entries()) {
      const id = `scene-${index + 1}`;
      const rows = scene.text
        .split(/\n+/)
        .filter(Boolean)
        .slice(1)
        .map((picture) => ({ picture, seconds: 3, lines: extractScriptLines(picture) }));
      const parsed = parseDirectorShots(JSON.stringify({ shots: rows }), id, scene.text)!;
      expect(detectDirectorCoverage({ id, text: scene.text }, parsed).ok).toBe(true);
      expect(parsed.length).toBeLessThanOrEqual(shotBudget(scene.text) ?? 16);
      const spoken = parsed.flatMap(shotLines);
      const sourceQuotes = [...scene.text.matchAll(/“([^”]+)”/gu)]
        .map((match) => match[1]!)
        .filter((line) => /[，。！？；：]/u.test(line));
      expect(spoken.map((line) => line.text)).toEqual(sourceQuotes);
      const interior = spoken[Math.floor(spoken.length / 2)]!;
      const missingOne = parsed.map((item) => {
        const lines = shotLines(item).filter((line) => line.text !== interior.text);
        return { ...item, lines, line: lines.map((line) => line.text).join("\n") };
      });
      expect(detectDirectorCoverage({ id, text: scene.text }, missingOne).ok).toBe(false);

      expect(spoken.map((line) => line.text)).toEqual(
        extractScriptLines(scene.text).map((line) => line.text),
      );
      const damaged = parsed.map((item) => ({ ...item, lines: [], line: "" }));
      const coverage = detectDirectorCoverage({ id, text: scene.text }, damaged);
      expect(coverage.ok).toBe(false);
      expect(coverage.missingLines.length).toBeGreaterThan(1);
      expect(coverageRepairContext({ id, text: scene.text }, damaged)).toContain(
        coverage.missingLines[0],
      );
      const reversed = [...parsed].reverse();
      expect(detectDirectorCoverage({ id, text: scene.text }, reversed).ok).toBe(false);
    }
  });

  it("keeps incompatible over-budget shots with an explicit status", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      ...shot,
      size: index % 2 ? "近景" : "中景",
      seconds: 15,
    }));
    const scene = { id: "scene-1", text: "雨夜巷口，警笛响起。" };
    const parsed = parseDirectorShots(JSON.stringify({ shots: rows }), scene.id, scene.text)!;
    expect(parsed).toHaveLength(20);
    expect(directorPlanStatus(scene, parsed)).toMatchObject({
      overBudget: true,
      shotCount: 20,
      coverage: { ok: false, missingTail: expect.any(String) },
    });
  });

  it("migrates legacy single lines and preserves new dialogue and coverage in saved projects", () => {
    const legacy = parseDirectorShots(
      JSON.stringify({ shots: [{ picture: "窗前", line: "走吧。", speaker: "林晚" }] }),
      "scene-1",
      "林晚：走吧。",
    )?.[0];
    const film = blankFilm();
    film.shots = [{ ...legacy!, lines: undefined }];
    const loaded = upgradeFilm(JSON.parse(JSON.stringify(film)));
    expect(loaded?.shots[0]?.lines).toEqual([{ speaker: "林晚", text: "走吧。" }]);
    film.scenes[0]!.coverage = {
      sceneId: "scene-1",
      ok: false,
      lastLine: "走吧。",
      missingLines: ["走吧。"],
      missingTail: "尾段",
    };
    const result = upgradeFilm(JSON.parse(JSON.stringify(film)));
    expect(result?.scenes[0]?.coverage).toEqual(film.scenes[0]?.coverage);
    expect(
      splitNovel("第一场 雨夜旧书店\n灯亮着。\n第二场 医院走廊\n雨停了。").scenes.map(
        (scene) => scene.title,
      ),
    ).toEqual(["雨夜旧书店", "医院走廊"]);
  });

  it("retains quoted compound dialogue and uses place and time as fallback titles", () => {
    expect(
      extractScriptLines("林晚：“走吧。跟我来。”随后她转身。\n沈砚：好。随后他离开。"),
    ).toEqual([
      { speaker: "林晚", text: "走吧。跟我来。" },
      { speaker: "沈砚", text: "好。" },
    ]);
    const result = parseWriterScenes(
      JSON.stringify({ scenes: [{ place: "旧书店", time: "雨夜", text: "灯亮着。" }] }),
    );
    expect(result?.[0]?.title).toBe("旧书店 · 雨夜");
    const real = parseWriterScenes(
      JSON.stringify({ scenes: [{ title: "第 1 场", text: "第一场　雨夜旧书店\n灯亮着。" }] }),
    );
    expect(real?.[0]?.title).toBe("雨夜旧书店");
  });
});
