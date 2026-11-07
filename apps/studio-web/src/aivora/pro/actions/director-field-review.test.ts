import { expect, it } from "vitest";
import { directorFieldFixture as fixture } from "./director-field-fixture";
import { applyStoryConfirmation } from "./story-confirmation";
import { prepareDirectorFieldReview } from "./director-field-review";

it("projects every actual current-scene structure/field/budget/coverage/beat effect using the original pure producer", () => {
  const f = fixture();
  expect(f.tx.unsupported).toEqual([]);
  const review = prepareDirectorFieldReview(f.base, f.tx, f.origin)!;
  expect(review).not.toBeNull();
  const text = JSON.stringify(review);
  for (const phrase of [
    "镜头顺序",
    "移除",
    "新增",
    "新画面",
    "新台词",
    "原文文本覆盖",
    "镜头预算",
    "未分配的转身",
    "门响",
    "创作计划",
  ])
    expect(text).toContain(phrase);
  for (const id of [
    f.base.id,
    ...f.base.shots.map((row) => row.id),
    f.base.scenes[0]!.id,
    "new-director-shot",
  ])
    expect(text).not.toContain(id);
  expect(f.base.shots[0]!.picture).toBe("原画面0");
  const applied = applyStoryConfirmation(f.base, f.tx);
  expect(applied.receipt).not.toBeNull();
  expect(applied.film.shots.at(-1)).toEqual(f.base.shots.at(-1));
});
it.each(["multi-scene", "writer", "unknown-field", "unknown-ref", "needs-cast", "unsafe"])(
  "uses the entire legacy mode for %s rather than showing a subset",
  (mode) => {
    const f = fixture();
    if (mode === "multi-scene")
      f.tx.batches.push({ ...structuredClone(f.tx.batches[0]!), sceneId: f.base.scenes[1]!.id });
    if (mode === "writer") f.tx.batches[0]!.kind = "writer";
    if (mode === "unknown-field")
      (f.tx.batches[0]!.structure.after[0] as unknown as Record<string, unknown>).unknown =
        "hidden edit";
    if (mode === "unknown-ref")
      (
        f.tx.batches[0]!.structure.after[0] as unknown as Record<string, unknown>
      ).continuityFromShotId = "unknown-private-shot";
    if (mode === "needs-cast") f.base.locations = [];
    if (mode === "unsafe")
      (f.tx.batches[0]!.structure.after[0] as unknown as Record<string, unknown>).picture =
        "secret=private";
    expect(prepareDirectorFieldReview(f.base, f.tx, f.origin)).toBeNull();
  },
);
it("keeps its captured projection fixed and lets the original source/media guards refuse stale writes", () => {
  const f = fixture(),
    review = prepareDirectorFieldReview(f.base, f.tx, f.origin)!;
  expect(review).not.toBeNull();
  const fixed = structuredClone(review);
  const unrelated = structuredClone(f.base);
  unrelated.shots[2]!.poster = "/private/late.png";
  expect(applyStoryConfirmation(unrelated, f.tx).receipt).not.toBeNull();
  const target = structuredClone(f.base);
  target.shots[0]!.poster = "/private/target.png";
  expect(applyStoryConfirmation(target, f.tx).receipt).toBeNull();
  expect(review).toEqual(fixed);
});

it("projects the actual parser's complete director plan, source declarations and creative timing without replaying its serialized source object", async () => {
  const { parseDirectorShots } = await import("../../film/project");
  const { prepareDirectorConfirmation } = await import("./story-confirmation");
  const f = fixture(),
    name = f.base.characters[0]!.name;
  const parsed = parseDirectorShots(
    JSON.stringify({
      shots: [
        {
          id: f.base.shots[0]!.id,
          no: 1,
          picture: "雨中推门",
          size: "中景",
          seconds: 5,
          characters: [name],
          speaker: name,
          line: "门开了。",
          purpose: "建立方位",
          emotion: "克制",
          positions: [{ name, position: "左侧", depth: "近景", visible: "入镜" }],
          line_at_seconds: 1,
          source_paragraph_ids: ["P1"],
        },
      ],
    }),
    f.origin.sceneId,
    f.base.scenes[0]!.text,
    [f.base.scenes[0]!],
  );
  expect(parsed).not.toBeNull();
  expect(parsed![0]!.directorPlan).toBeDefined();
  const tx = prepareDirectorConfirmation(f.base, parsed!),
    review = prepareDirectorFieldReview(f.base, tx, f.origin);
  expect(review).not.toBeNull();
  const text = JSON.stringify(review);
  expect(text).toContain("导演完整计划");
  expect(text).toContain("创作建议");
  expect(text).toContain("非事实证明");
  expect(text).not.toContain("sourceSnapshot");
  expect(text).not.toContain(f.origin.sceneId);
});

it("names reordered existing shots by their fixed original identity while showing the real new order and number fields", async () => {
  const { prepareDirectorConfirmation } = await import("./story-confirmation");
  const f = fixture();
  const tx = prepareDirectorConfirmation(f.base, [
    { ...structuredClone(f.base.shots[1]!), no: 1 },
    { ...structuredClone(f.base.shots[0]!), no: 2 },
  ]);
  const review = prepareDirectorFieldReview(f.base, tx, f.origin)!;
  expect(review).not.toBeNull();
  const order = review.fieldRows.find((row) => row.label.endsWith("镜头顺序"))!;
  expect(order.before).toMatch(/^1\. 原第 1 镜\n2\. 原第 2 镜/);
  expect(order.after).toMatch(/^1\. 原第 2 镜\n2\. 原第 1 镜/);
  expect(review.fieldRows.filter((row) => row.label.endsWith("镜号"))).toHaveLength(2);
});
