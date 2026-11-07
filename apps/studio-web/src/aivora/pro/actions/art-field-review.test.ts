import { expect, it } from "vitest";
import { fullArtFixture } from "./art-field-fixture";
import { applyArtTransaction } from "./art-transaction";
import { prepareArtFieldReview, artReviewCurrent } from "./art-field-review";

it("projects the complete real art producer transaction, additions, references and pure derived risks without raw IDs or paths", () => {
  const f = fullArtFixture(),
    review = prepareArtFieldReview(f.base, f.tx)!;
  expect(f.tx.unsupported).toEqual([]);
  expect(review).not.toBeNull();
  expect(review.fieldRows.length).toBe(f.tx.changes.length + f.tx.additions.length + 1);
  const text = review.fieldRows
    .map((row) => [row.label, row.before, row.after].join("\n"))
    .join("\n");
  for (const value of [
    "固定外貌",
    "声音",
    "人物服装规则",
    "原文第 1 段",
    "新增场景",
    "新增道具",
    "当前场景引用",
    "第 1 场",
    "未证实已有文件",
    "服装原文来源未核验",
    "参考图画风待核对",
  ])
    expect(text).toContain(value);
  for (const value of [
    f.base.id,
    f.base.characters[0]!.id,
    f.base.scenes[0]!.id,
    "costume-one",
    "portrait-declaration",
    "/private/",
  ])
    expect(text).not.toContain(value);
  expect(review.notes.join(" ")).toMatch(/全项目.*已有素材保留.*不会自动生成/);
  expect(artReviewCurrent(f.base, f.tx, review.input)).toBe(true);
  const actual = applyArtTransaction(f.base, f.tx);
  expect(actual.receipt).not.toBeNull();
  expect(
    actual.film.shots.every((shot) => shot.regenerationRequired?.code === "STYLE_CHANGED"),
  ).toBe(true);
});
it.each([
  "unknown-field",
  "unknown-design",
  "unknown-voice",
  "bad-scope",
  "unknown-asset",
  "unsafe",
  "addition-media",
  "unknown-ref",
])("falls back completely for %s", (mode) => {
  const f = fullArtFixture(),
    tx = structuredClone(f.tx);
  if (mode === "unknown-field") tx.changes[0]!.field = "sourceText";
  if (mode === "unknown-design")
    (
      tx.changes.find((row) => row.field === "artDesign")!.after.value as Record<string, unknown>
    ).hidden = "unshown";
  if (mode === "unknown-voice")
    tx.changes.find((row) => row.field === "voiceId")!.after.value = "private-voice";
  if (mode === "bad-scope") tx.selection.projectId = "another";
  if (mode === "unknown-asset")
    (
      tx.changes.find((row) => row.field === "artDesign")!.after.value as { asset_ids: string[] }
    ).asset_ids.push("unmapped-asset");
  if (mode === "unsafe")
    tx.changes.find((row) => row.field === "styleZh")!.after.value = "secret=private";
  if (mode === "addition-media")
    (
      tx.additions.find((row) => row.collection === "locations")!.row as Record<string, unknown>
    ).referenceImage = "/private/new.png";
  if (mode === "unknown-ref")
    (
      tx.additions.find((row) => row.collection === "locations") as {
        referencingSceneIds: string[];
      }
    ).referencingSceneIds = ["foreign-scene"];
  expect(prepareArtFieldReview(f.base, tx)).toBeNull();
});
it("binds only consumed creative effects and keeps the fixed review unchanged by save/cache/late media", () => {
  const f = fullArtFixture(),
    review = prepareArtFieldReview(f.base, f.tx)!;
  expect(review).not.toBeNull();
  const before = structuredClone(review.fieldRows),
    live = structuredClone(f.base);
  live.savedAt = "later";
  live.shots[0]!.poster = "/late.png";
  live.characters[0]!.portraits = [];
  expect(artReviewCurrent(live, f.tx, review.input)).toBe(true);
  expect(review.fieldRows).toEqual(before);
  live.shots.push({ ...structuredClone(live.shots[0]!), id: "new-shot" });
  expect(artReviewCurrent(live, f.tx, review.input)).toBe(false);
});
