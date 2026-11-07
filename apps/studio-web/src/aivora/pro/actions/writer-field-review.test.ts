import { writerFieldValues } from "./writer-field-values";
import { expect, it } from "vitest";
import { writerFieldFixture } from "./writer-field-fixture";
import { prepareWriterFieldReview } from "./writer-field-review";
import { applyStoryConfirmation, undoStoryConfirmation } from "./story-confirmation";
import { createEditorPageHistory } from "./page-history";
it("shows all real writer scene, cleanup, cast and complete plan effects from the original pure producer", () => {
  const f = writerFieldFixture();
  expect(f.tx.unsupported).toEqual([]);
  expect(f.tx.shotChanges?.length).toBeGreaterThan(0);
  expect(f.tx.writerAssets).toBeDefined();
  const review = prepareWriterFieldReview(f.base, f.tx, f.origin)!;
  expect(review).not.toBeNull();
  const text = JSON.stringify(review);
  for (const phrase of [
    "全项目",
    "场次顺序",
    "清理未使用自动镜头",
    "新增 · 人物",
    "新增 · 地点",
    "编剧完整创作声明",
    "别走。",
    "原解析器归属",
    "预计秒数",
    "不是新的事实",
  ])
    expect(text).toContain(phrase);
  for (const id of [
    f.base.id,
    ...f.base.scenes.map((scene) => scene.id),
    ...f.base.shots.map((shot) => shot.id),
    "cast-3",
  ].filter((id) => id.length >= 4))
    expect(text).not.toContain(id);
  expect(text).not.toContain('"id":');
  expect(f.base.shots.length).toBeGreaterThan(0);
  const applied = applyStoryConfirmation(f.base, f.tx);
  expect(applied.receipt).not.toBeNull();
  expect(applied.film.shots).toEqual([]);
  expect(applied.film.characters.some((person) => person.name === "梅子")).toBe(true);
});
it("keeps the initial manuscript byte-for-byte in the explicit original sourceAfter effect", () => {
  const f = writerFieldFixture(true);
  expect(f.tx.unsupported).toEqual([]);
  expect(f.tx.sourceAfter).toBe(f.manuscript);
  const review = prepareWriterFieldReview(f.base, f.tx, f.origin)!;
  expect(review).not.toBeNull();
  expect(review.fieldRows.find((row) => row.label.includes("保留原稿"))?.after).toBe(f.manuscript);
  const applied = applyStoryConfirmation(f.base, f.tx);
  expect(applied.film.sourceText).toBe(f.manuscript);
  expect(undoStoryConfirmation(applied.film, f.tx).film).toEqual(f.base);
});
it.each([
  "unknown-scene-field",
  "unknown-plan-field",
  "unknown-person-field",
  "unknown-voice",
  "unsafe",
  "large-text",
  "needs-cast",
  "raw-json-text",
  "numbered-secret",
  "invalid-paragraph-id",
])("uses whole legacy mode for %s without truncating or applying", (mode) => {
  const f = writerFieldFixture();
  if (mode === "unknown-scene-field")
    (f.tx.structure.after[0] as unknown as Record<string, unknown>).hidden = "unknown";
  if (mode === "unknown-plan-field")
    (f.tx.writerAssets!.after.plan.value as unknown as Record<string, unknown>).hidden = "unknown";
  if (mode === "unknown-person-field")
    (f.tx.writerAssets!.after.characters.at(-1)! as unknown as Record<string, unknown>).hidden =
      "unknown";
  if (mode === "unknown-voice")
    f.tx.writerAssets!.after.characters.at(-1)!.voiceId = "unmapped-private-voice";
  if (mode === "unsafe") f.tx.writerAssets!.after.locations.at(-1)!.prompt = "secret=private";
  if (mode === "large-text") (f.tx.structure.after[0] as { text: string }).text = "全".repeat(8193);
  if (mode === "raw-json-text")
    f.tx.writerAssets!.after.plan.value!.sourceText = '{"redacted":true}';
  if (mode === "numbered-secret")
    f.tx.writerAssets!.after.plan.value!.sourceText =
      "[P01] authorization: Bearer synthetic-secret";
  if (mode === "invalid-paragraph-id")
    (f.tx.structure.after[0] as { writerParagraphIds: string[] }).writerParagraphIds = ["P0"];
  if (mode === "needs-cast") {
    f.tx.writerAssets!.after.locations = [];
    f.tx.writerAssets!.after.characters = [];
  }
  expect(prepareWriterFieldReview(f.base, f.tx, f.origin)).toBeNull();
  expect(f.base.shots.length).toBeGreaterThan(0);
});
it.each(["source", "late-media", "late-audio"])(
  "keeps the fixed review while the original transaction refuses new %s work",
  (mode) => {
    const f = writerFieldFixture(),
      review = prepareWriterFieldReview(f.base, f.tx, f.origin)!;
    expect(review).not.toBeNull();
    const fixed = structuredClone(review),
      live = structuredClone(f.base);
    if (mode === "source") live.sourceText = "用户后来改了原稿";
    if (mode === "late-media") live.shots[0]!.poster = "/private/late.png";
    if (mode === "late-audio")
      live.audioClips.push({
        id: "late-clip",
        shotId: live.shots[0]!.id,
        takeId: "",
        lane: "dialogue",
        startSeconds: 0,
        durationSeconds: 1,
        offsetSeconds: 0,
        gainDb: 0,
        path: "/private/late.wav",
        label: "晚配音",
      });
    const result = applyStoryConfirmation(live, f.tx);
    expect(result.receipt).toBeNull();
    expect(result.film).toBe(live);
    expect(review).toEqual(fixed);
  },
);
it("uses an independent original story token and preserves unrelated live project fields on inverse", () => {
  const f = writerFieldFixture(),
    history = createEditorPageHistory(),
    applied = applyStoryConfirmation(f.base, f.tx);
  expect(applied.receipt).not.toBeNull();
  const token = history.recordStory(applied.receipt!, f.origin),
    live = structuredClone(applied.film);
  live.title = "用户新标题";
  const result = history.undoStoryReceipt(live, f.origin, token);
  expect(result.receipt).not.toBeNull();
  expect(result.film.title).toBe("用户新标题");
  expect(result.film.shots).toEqual(f.base.shots);
  expect(result.film.characters).toEqual(f.base.characters);
  expect(history.storyReceiptState(f.origin, token)).toBe("undone");
});

it("preserves canonical padded paragraph labels without collapsing distinct source markers or accepting arbitrary JSON", () => {
  const f = writerFieldFixture(),
    values = writerFieldValues(f.base, applyStoryConfirmation(f.base, f.tx).film, f.origin);
  expect(values.sceneValue("writerParagraphIds", ["P01", "P001"])).toBe(
    "原文第 01 段、原文第 001 段",
  );
  expect(() => values.sceneValue("writerParagraphIds", ["P0"])).toThrow();
  expect(() => values.text('["raw-object"]')).toThrow();
});

it("shows the original producer's retained manual-scene renumbering without replacing its authored text", async () => {
  const { prepareWriterTransaction } = await import("./story-structure-transaction");
  const f = writerFieldFixture(),
    kept = f.base.scenes[3]!;
  kept.text = "用户必须保留的独立正文";
  kept.userFields = ["text"];
  kept.source = "user";
  const tx = prepareWriterTransaction(f.base, f.scenes, f.plan);
  expect(tx.unsupported).toEqual([]);
  expect(tx.sceneNumbering?.some((change) => change.id === kept.id)).toBe(true);
  const review = prepareWriterFieldReview(f.base, tx, f.origin)!;
  expect(review).not.toBeNull();
  const row = review.fieldRows.find((row) => row.label.includes("保留场编号"))!;
  expect(row.before).toBe(String(kept.no));
  expect(row.after).toBe("1");
  const applied = applyStoryConfirmation(f.base, tx);
  expect(applied.film.scenes.find((scene) => scene.id === kept.id)!.text).toBe(kept.text);
  expect(undoStoryConfirmation(applied.film, tx).film.scenes).toEqual(f.base.scenes);
});

it("shows writerAssets roster order as well as all member changes, and refuses ambiguous numbering", () => {
  const f = writerFieldFixture();
  f.tx.writerAssets!.after.characters.reverse();
  const review = prepareWriterFieldReview(f.base, f.tx, f.origin)!;
  expect(review).not.toBeNull();
  const row = review.fieldRows.find((row) => row.label === "全项目 · 人物顺序")!;
  expect(row.before).toMatch(/^1\. 林骁/);
  expect(row.after).toMatch(/^1\. 梅子/);
  f.tx.sceneNumbering = [
    { id: f.base.scenes[0]!.id, before: 1, after: 2 },
    { id: f.base.scenes[0]!.id, before: 1, after: 3 },
  ];
  expect(prepareWriterFieldReview(f.base, f.tx, f.origin)).toBeNull();
});

it.each(["board", "cast", "edit"] as const)(
  "keeps the writer projection whole-project under a real %s request origin",
  (page) => {
    const f = writerFieldFixture();
    expect(prepareWriterFieldReview(f.base, f.tx, f.origin)).not.toBeNull();
    const review = prepareWriterFieldReview(f.base, f.tx, { ...f.origin, page });
    expect(review).not.toBeNull();
    expect(review!.notes[0]).toContain("全项目");
    expect(review!.fieldRows.some((row) => row.label.includes("清理未使用自动镜头"))).toBe(true);
  },
);
