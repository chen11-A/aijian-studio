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

it("splits single-speaker structured dialogue without duplicating the original lines", async () => {
  const { shotLines } = await import("../../film/director-continuity");
  const spoken = `${"甲".repeat(35)}。  ${"乙".repeat(35)}！`;
  const shot = {
    ...sampleFilm().shots[0]!,
    line: spoken,
    lines: [{ speaker: "林晚", text: spoken }],
    speaker: "林晚",
    userFields: [],
  };
  const before = structuredClone(shot);
  const result = planShotDuration(shot, 20);
  expect(result.kind).toBe("split");
  if (result.kind !== "split") return;
  expect(result.shots.map((item) => item.line).join("")).toBe(spoken);
  expect(
    result.shots
      .flatMap(shotLines)
      .map((row) => row.text)
      .join(""),
  ).toBe(spoken);
  for (const item of result.shots) {
    expect(item.lines).toEqual([{ speaker: "林晚", text: item.line }]);
    expect(item.speaker).toBe("林晚");
    expect(item.line).not.toBe(spoken);
  }
  expect(shot).toEqual(before);
});

it("never copies completed assets or full-shot generation plans into split proposals", () => {
  const shot = structuredClone(sampleFilm().shots[0]!);
  shot.line = "长台词".repeat(30);
  shot.lines = [{ speaker: "林晚", text: shot.line }];
  shot.speaker = "林晚";
  shot.poster = "/films/old.png";
  shot.stills = [{ id: "old", prompt: "old", url: "/films/old.png" }];
  shot.takes = [
    {
      id: "old-video",
      shotId: shot.id,
      index: 1,
      status: "done",
      videoPath: "/films/old.mp4",
      videoUrl: "",
      stillUrl: "",
      prompt: "old",
      createdAt: "",
      reason: "",
    },
  ];
  shot.selectedTakeId = "old-video";
  shot.continuityFrame = {
    sourceShotId: "previous",
    sourceTakeId: "take",
    sourceVideoPath: "/films/previous.mp4",
    path: "/films/frame.png",
  };
  shot.continuityFromShotId = "previous";
  shot.promptZh = "old complete-shot prompt";
  const before = structuredClone(shot);
  const result = planShotDuration(shot, 25);
  expect(result.kind).toBe("split");
  if (result.kind !== "split") return;
  expect(result.shots[0]!.id).toBe(shot.id);
  expect(result.shots[1]!.id).not.toBe(shot.id);
  expect(result.shots[1]!.id).not.toBe(`${shot.id}-b`);
  for (const item of result.shots) {
    expect(item).toMatchObject({ poster: "", takes: [], stills: [], selectedTakeId: "" });
    expect(item.continuityFrame).toBeUndefined();
    expect(item.continuityFromShotId).toBeUndefined();
    expect(item.promptZh).toBeUndefined();
    expect(item.sound.source).toBe(shot.sound.source);
  }
  // The transaction must still see original dependencies, rather than an already-cleared base.
  expect(shot).toEqual(before);
});

it("refuses multiple speakers instead of assigning both utterances to the first voice", () => {
  const shot = {
    ...sampleFilm().shots[0]!,
    line: "第一句",
    speaker: "甲",
    lines: [
      { speaker: "甲", text: "第一句" },
      { speaker: "乙", text: "第二句" },
    ],
  };
  const before = structuredClone(shot);
  expect(planShotDuration(shot, 30)).toMatchObject({
    kind: "notice",
    notice: expect.stringContaining("多位说话人"),
  });
  expect(shot).toEqual(before);
});

it("times all effective structured utterances and guards a changed speaker", () => {
  const text = "长台词".repeat(15);
  const shot = {
    ...sampleFilm().shots[0]!,
    line: text,
    speaker: "甲",
    userFields: [],
    lines: [
      { speaker: "甲", text },
      { speaker: "甲", text },
    ],
  };
  const result = planShotDuration(shot, 2);
  expect(result.kind).toBe("split");
  if (result.kind === "split")
    expect(result.shots.map((item) => item.line).join("")).toBe(`${text}\n${text}`);
  expect(durationInputUnchanged(shot, { ...shot, lines: [{ speaker: "乙", text }] })).toBe(false);
});

it("does not assign an unattributed utterance to the known speaker", () => {
  const shot = {
    ...sampleFilm().shots[0]!,
    line: "第一句",
    speaker: "甲",
    lines: [
      { speaker: "甲", text: "第一句" },
      { speaker: "", text: "未注明是谁的第二句" },
    ],
  };
  expect(planShotDuration(shot, 30)).toMatchObject({ kind: "notice" });
});

it.each(["长对白".repeat(100), `开头很短。${"后半对白".repeat(80)}`])(
  "requires more shots when a proposed half still exceeds the limit",
  (text) => {
    const shot = {
      ...sampleFilm().shots[0]!,
      line: text,
      speaker: "甲",
      lines: [{ speaker: "甲", text }],
    };
    const original = structuredClone(shot);
    expect(planShotDuration(shot, undefined)).toMatchObject({
      kind: "notice",
      notice: expect.stringContaining("需要更多分镜"),
    });
    expect(shot).toEqual(original);
  },
);
