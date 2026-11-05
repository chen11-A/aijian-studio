import { describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import { applyScenes, parseWriterScenes } from "./operations";
import { blankFilm } from "./project";
import { writerNumberedScript, writerSceneContext } from "./writer-elements";
import { directorRequestInput, requestDirectorDraft } from "../pro/actions/director";
import { runPipelineAgentAction } from "../pro/pipeline-agent-actions";

type Example = {
  input: { paragraphs: { id: string; text: string }[] };
  output: {
    scenes: {
      elements: {
        type: string;
        source: string;
        line?: string;
        speaker?: string;
        kind?: string;
        delivery?: string | null;
      }[];
    }[];
  };
};
const writers = fixtures.examples.filter((item) => item.role === "writer");
describe("writer structure and source ownership", () => {
  it.each(writers)(
    "retains real Claude writer example $example.id with complete dialogue",
    ({ example }) => {
      const { input, output } = example as unknown as Example;
      const source = input.paragraphs.map(({ id, text }) => `[${id}] ${text}`).join("\n");
      const scenes = parseWriterScenes(JSON.stringify(output), source)!;
      expect(scenes.map((scene) => scene.text).join("\n")).toBe(
        input.paragraphs.map(({ text }) => text).join("\n"),
      );
      expect(scenes.flatMap((scene) => scene.sourceParagraphIds ?? [])).toEqual(
        input.paragraphs.map(({ id }) => id),
      );
      const elements = scenes.flatMap((scene) => scene.elements ?? []);
      expect(elements).toHaveLength(output.scenes.flatMap((scene) => scene.elements).length);
      for (const raw of output.scenes.flatMap((scene) => scene.elements)) {
        expect(elements).toContainEqual(
          expect.objectContaining({
            ...raw,
            sourceParagraphIds: [raw.source],
            verification: "attributed",
          }),
        );
      }
      expect(scenes.every((scene) => scene.paragraphCoverage?.ok)).toBe(true);
    },
  );

  it("orders elements by source paragraphs and retains long dialogue without truncation", () => {
    const long = "这是必须逐字保留的完整台词。".repeat(40);
    const source = `[P101] 甲说：“${long}”\n[P102] 乙说：“结尾。”`;
    const scene = parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            title: "走廊",
            text: source,
            source_paragraphs: ["P102", "P101"],
            elements: [
              { type: "dialogue", line: "结尾。", speaker: "乙", source: "P102" },
              { type: "dialogue", line: long, speaker: "甲", source: "P101" },
            ],
          },
        ],
      }),
      source,
    )![0]!;
    expect(scene.sourceParagraphIds).toEqual(["P101", "P102"]);
    expect(scene.elements?.map((element) => element.line)).toEqual([long, "结尾。"]);
    expect(scene.text).toBe(`甲说：“${long}”\n乙说：“结尾。”`);
    expect(writerSceneContext(scene)).toContain(long);
  });

  function parsed() {
    return parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            title: "走廊",
            text: "甲说话",
            source_paragraphs: ["P101", "P102", "P999"],
            elements: [
              {
                type: "dialogue",
                speaker: "甲",
                kind: "画外音",
                delivery: "低声",
                line: "别走。",
                source: "P101",
              },
              {
                type: "dialogue",
                speaker: "乙",
                kind: "对白",
                line: "不存在的台词",
                source: "P102",
              },
              { type: "action", text: "模型动作", source: "P999" },
            ],
          },
        ],
      }),
      "[P101] 甲说：“别走。”\n[P102] 门关了。",
    )![0]!;
  }
  it("keeps three-digit IDs and quarantines invented lines and unknown source IDs", () => {
    const scene = parsed();
    expect(scene.sourceParagraphIds).toEqual(["P101", "P102"]);
    expect(scene.elements?.map((item) => item.verification)).toEqual([
      "attributed",
      "needs_review",
      "needs_review",
    ]);
    expect(scene.text).not.toContain("不存在的台词");
    expect(scene.paragraphCoverage).toMatchObject({ ok: false, invalidParagraphs: ["P999"] });
    const context = writerSceneContext(scene);
    expect(context).toContain('"delivery":"低声"');
    expect(context).toContain('"pendingElementCount":2');
    expect(context).not.toContain("不存在的台词");
    expect(context).not.toContain("模型动作");
  });
  it("retains missing/duplicate coverage risks and refuses ambiguous element ownership", () => {
    const scenes = parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            title: "甲",
            text: "甲",
            source_paragraphs: ["P101"],
            elements: [{ type: "dialogue", line: "别走。", source: "P101" }],
          },
          { title: "乙", text: "乙", source_paragraphs: ["P101", "P103"] },
        ],
      }),
      "[P101] 甲说：“别走。”\n[P102] 门关了。\n[P103] 警笛声。",
    )!;
    expect(scenes[0]!.paragraphCoverage).toMatchObject({
      ok: false,
      missingParagraphs: ["P102"],
      duplicateParagraphs: ["P101"],
    });
    expect(scenes[0]!.sourceParagraphIds).toEqual([]);
    expect(scenes[0]!.elements?.[0]?.verification).toBe("needs_review");
    expect(scenes.map((scene) => scene.text).join("\n")).toBe("甲说：“别走。”\n门关了。\n警笛声。");
  });
  it("does not treat an overlapping short fragment as reliable paragraph ownership", () => {
    const source = "这是一个非常长的段落开头，用于区分错误片段。后续完全没有出现在场次内容里。";
    const scenes = parseWriterScenes(
      JSON.stringify({
        scenes: [
          {
            title: "甲",
            text: source.slice(0, 18),
            elements: [{ type: "dialogue", line: source.slice(0, 8), source: "P01" }],
          },
          { title: "乙", text: source.slice(0, 18) },
        ],
      }),
      source,
    )!;
    expect(scenes.flatMap((scene) => scene.sourceParagraphIds ?? [])).toEqual([]);
  });
  it("invalidates annotations on manual edits with and without explicit user field marks", () => {
    const scene = parsed();
    expect(writerSceneContext({ ...scene, text: "用户改写" })).toBe("");
    expect(writerNumberedScript({ ...scene, text: "用户改写" }, "用户改写")).toBeNull();
    expect(writerSceneContext({ ...scene, userFields: ["text"] })).toBe("");
    const manual = { ...scene, text: "用户改写", userFields: ["text"] };
    const film = { ...blankFilm(), scenes: [manual] };
    expect(applyScenes(film, [scene]).scenes[0]).toMatchObject(manual);
  });
  it("sends verified structured dialogue through both real director request paths", async () => {
    const scene = parsed();
    const other = { ...scene, id: "scene-before", text: "另一场" };
    const film = { ...blankFilm(), scenes: [other, scene] };
    const request = vi.fn(async () => ({ text: null, detail: "stop" }));
    await requestDirectorDraft(directorRequestInput(film, scene.id, scene.text, scene.text), {
      request,
      progress: vi.fn(),
      current: () => true,
    });
    await runPipelineAgentAction(
      film,
      { step: "director", targetId: scene.id },
      { request, valid: () => true },
    );
    expect(request).toHaveBeenCalledTimes(2);
    for (const call of request.mock.calls as unknown as [string, string][]) {
      expect(call[1]).toContain("[P101] 甲说：“别走。”");
      expect(call[1]).toContain("[P102] 门关了。");
      expect(call[1]).not.toContain("[P01]");
      expect(call[1]).not.toContain("另一场");
      expect(call[1]).toContain('"speaker":"甲"');
      expect(call[1]).toContain('"kind":"画外音"');
      expect(call[1]).toContain('"sourceParagraphIds":["P101"]');
      expect(call[1]).not.toContain("不存在的台词");
    }
  });
});
