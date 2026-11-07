import { expect, it } from "vitest";
import {
  dialogueVideoCap,
  planDialogueSplit,
  type DialogueSplitInput,
  type DialogueSplitPlan,
} from "./dialogue-split-plan";
function ready(input: DialogueSplitInput) {
  const plan = planDialogueSplit(input);
  expect(plan.kind).toBe("READY");
  if (plan.kind !== "READY") throw Error(plan.code);
  return plan;
}
function exact(plan: Extract<DialogueSplitPlan, { kind: "READY" }>) {
  for (const [index, line] of plan.sourceLines.entries()) {
    const pieces = plan.parts.filter((part) => part.sourceLineIndex === index);
    expect(pieces.map((part) => part.text).join("")).toBe(line.text);
    let at = 0;
    for (const part of pieces) {
      expect(part.startOffset).toBe(at);
      expect(part.speaker).toBe(line.speaker);
      expect(line.text.slice(part.startOffset, part.endOffset)).toBe(part.text);
      at = part.endOffset;
    }
    expect(at).toBe(line.text.length);
  }
}
it("preserves complete UTF-16 text, whitespace, CJK/emoji punctuation and CRLF while planning more than two shots", () => {
  const text = `\n \r\n${"甲".repeat(35)}。  ${"😀".repeat(34)}！？\r\n\n${"乙".repeat(35)}！  `;
  const input: DialogueSplitInput = {
      lines: [{ speaker: "甲", text }],
      maxVideoSeconds: 15,
      versions: 4,
    },
    before = structuredClone(input);
  const result = ready(input);
  exact(result);
  expect(input).toEqual(before);
  expect(result.parts).toHaveLength(3);
  expect(result.videoCount).toBe(12);
  expect(result.newShotCount).toBe(3);
  expect(result.parts.every((part) => part.estimatedSeconds <= 15)).toBe(true);
  expect(result.timing).toBe("estimate");
  expect(result.headSeconds).toBe(0.4);
  expect(result.tailSeconds).toBe(0.6);
});
it("never merges different speakers or duplicate authored rows into the wrong source mapping", () => {
  const text = ` ${"我".repeat(30)}。\n`;
  const plan = ready({
    lines: [
      { speaker: "甲", text },
      { speaker: "乙", text },
      { speaker: "甲", text },
    ],
    maxVideoSeconds: 15,
    versions: 2,
  });
  exact(plan);
  expect(plan.parts.map((part) => part.sourceLineIndex)).toEqual([0, 1, 2]);
  expect(plan.parts.map((part) => part.speaker)).toEqual(["甲", "乙", "甲"]);
  expect(plan.videoCount).toBe(6);
});
it("uses language sentence boundaries rather than splitting English words, initials or honorifics", () => {
  const sentence = "Dr. A. Smith can stay here. ";
  const plan = ready({
    lines: [{ speaker: "A", text: sentence.repeat(4) }],
    maxVideoSeconds: 15,
    versions: 1,
  });
  exact(plan);
  expect(
    plan.parts.every((part) => !/^Dr\.\s*$/u.test(part.text) && !/^A\.\s*$/u.test(part.text)),
  ).toBe(true);
  expect(plan.parts.every((part) => part.text.trimEnd().endsWith("here."))).toBe(true);
});
it("uses explicit authored newlines as safe boundaries without inventing missing punctuation", () => {
  const plan = ready({
    lines: [{ speaker: "", text: `${"长".repeat(35)}\r\n${"话".repeat(35)}` }],
    maxVideoSeconds: 15,
    versions: 1,
  });
  exact(plan);
  expect(plan.parts).toHaveLength(2);
});
it("refuses an oversized complete sentence instead of cutting characters or raw audio", () => {
  expect(
    planDialogueSplit({
      lines: [{ speaker: "", text: "长".repeat(100) }],
      maxVideoSeconds: 15,
      versions: 1,
    }),
  ).toMatchObject({ kind: "UNSUPPORTED", code: "NO_SAFE_SENTENCE_BOUNDARY", sourceLineIndex: 0 });
});
it("keeps cap and video-only version counts exact, with no silent model or count clamp", () => {
  expect(dialogueVideoCap("grok-imagine-video", true)).toBe(10);
  expect(dialogueVideoCap("grok-imagine-video", false)).toBe(15);
  for (const model of ["grok-imagine-video-1.5", "grok-imagine-video-1.5-lite"])
    expect(dialogueVideoCap(model, true)).toBe(15);
  expect(dialogueVideoCap("future-model", true)).toBeNull();
  const lines = [{ speaker: "甲", text: `${"长".repeat(24)}。${"话".repeat(24)}。` }];
  expect(ready({ lines, maxVideoSeconds: 10, versions: 4 }).videoCount).toBe(8);
  expect(planDialogueSplit({ lines, maxVideoSeconds: 15, versions: 4 })).toMatchObject({
    code: "WITHIN_CAP",
  });
});
it("bounds input/parts and rejects extra fields, malformed lines and empty utterances", () => {
  const base = {
    lines: [{ speaker: "甲", text: "长".repeat(70) + "。" }],
    maxVideoSeconds: 15,
    versions: 1,
  };
  for (const changed of [
    null,
    { ...base, path: "/bad" },
    { ...base, versions: 0 },
    { ...base, versions: 5 },
    { ...base, versions: 1.5 },
    { ...base, maxVideoSeconds: 14 },
    { ...base, maxVideoSeconds: "15" },
    { ...base, lines: [] },
    { ...base, lines: [{ speaker: "甲", text: "一句。", voice_path: "/bad" }] },
    { ...base, lines: [{ speaker: "甲", text: "甲".repeat(2001) }] },
  ])
    expect(planDialogueSplit(changed)).toMatchObject({
      kind: "UNSUPPORTED",
      code: "INVALID_INPUT",
    });
  expect(planDialogueSplit({ ...base, lines: [{ speaker: "甲", text: " \n" }] })).toMatchObject({
    code: "NO_DIALOGUE",
  });
  expect(
    planDialogueSplit({
      lines: [
        { speaker: "", text: ("字".repeat(30) + "。").repeat(64) },
        { speaker: "", text: ("字".repeat(30) + "。").repeat(64) },
        { speaker: "", text: "末".repeat(31) },
      ],
      maxVideoSeconds: 10,
      versions: 1,
    }),
  ).toMatchObject({ code: "PLAN_LIMIT" });
});
it("reports limitations without claiming actual duration, alignment, a price or automatic extra paid calls", () => {
  const result = ready({
    lines: [{ speaker: "甲", text: ("字".repeat(35) + "。").repeat(3) }],
    maxVideoSeconds: 15,
    versions: 1,
  });
  expect(result.limitations.join(" ")).toContain("不含未来配音调用或失败重试");
  expect(result.limitations.join(" ")).toContain("当前没有发起生成");
  expect(result.limitations.join(" ")).toContain("不代表每段实际语音");
});

it("does not join an honorific across an explicit line boundary and reject otherwise valid complete sentences", () => {
  const plan = ready({
    lines: [{ speaker: "甲", text: `Dr.\r\n${"字".repeat(54)}。\n${"乙".repeat(54)}。` }],
    maxVideoSeconds: 15,
    versions: 1,
  });
  exact(plan);
  expect(plan.parts).toHaveLength(3);
  expect(plan.parts[0]!.text).toBe("Dr.\r\n");
});
