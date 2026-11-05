import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { planArtDraft } from "./art";
import { prepareArtTransaction, applyArtTransaction, undoArtTransaction } from "./art-transaction";
async function fixture() {
  const base = sampleFilm();
  const person = base.characters[0]!;
  const result = await planArtDraft(base, {
    current: () => true,
    request: async () => ({
      detail: "",
      text: JSON.stringify({
        prompt_block_zh: "新的画风",
        identities: [{ name: person.name, identity: "新外貌", gender: "男", age_band: "中年" }],
        locations: [{ name: "新增书店", prompt: "旧书架", ambience: "雨声", layout: "门在左侧" }],
        props: [{ name: "新增照片", note: "合影" }],
      }),
    }),
  });
  if (result.status !== "ready") throw new Error("draft");
  const tx = prepareArtTransaction(base, result.draft, { projectId: base.id, page: "cast" });
  return { base, tx, proposed: result.draft };
}
it("applies actual art metadata without replacing new media and derives live style state", async () => {
  const { base, tx, proposed } = await fixture();
  expect(tx.unsupported).toEqual([]);
  const live = structuredClone(base);
  live.shots[0]!.poster = "/later.png";
  live.characters[0]!.portraits = [{ view: "正面", url: "/later-face.png", prompt: "p" }];
  const result = applyArtTransaction(live, tx);
  expect(result.conflicts).toEqual([]);
  expect({ ...result.film.characters[0]!, portraits: [] }).toEqual({
    ...proposed.characters[0]!,
    portraits: [],
  });
  expect(result.film.shots[0]!.poster).toBe("/later.png");
  expect(result.film.characters[0]!.portraits[0]!.url).toBe("/later-face.png");
  expect(result.film.locations.find((row) => row.name === "新增书店")!.artFields?.prompt).toBe(
    "旧书架",
  );
  expect(result.film.props.find((row) => row.name === "新增照片")!.artFields?.note).toBe("合影");
  expect(result.film.shots[0]!.regenerationRequired?.styleRevision).toBe(result.film.styleRevision);
});
it.each(["edit", "lock", "same-id"])("rejects %s conflicts atomically", async (kind) => {
  const { base, tx } = await fixture();
  if (kind === "edit") base.characters[0]!.identity = "用户手改";
  if (kind === "lock") base.characters[0]!.userFields.push("identity");
  if (kind === "same-id") {
    const row = tx.additions.find((item) => item.collection === "locations")!;
    base.locations.push({ ...row.row, name: "用户自己新增" });
  }
  const result = applyArtTransaction(base, tx);
  expect(result.film).toBe(base);
  expect(result.receipt).toBeNull();
  expect(base.styleZh).not.toBe("新的画风");
});
it("refuses undo deletion after an added location receives a reference image", async () => {
  const { base, tx } = await fixture();
  const result = applyArtTransaction(base, tx);
  const row = result.film.locations.find((row) => row.name === "新增书店")!;
  row.referenceImage = "/new-reference.png";
  const undone = undoArtTransaction(result.film, tx);
  expect(undone.film).toBe(result.film);
  expect(undone.conflicts).toContain("ADDED_ENTITY_CHANGED");
});
it("undo preserves later shot media and restores art fields", async () => {
  const { base, tx } = await fixture();
  const applied = applyArtTransaction(base, tx);
  applied.film.shots[0]!.poster = "/later.png";
  const result = undoArtTransaction(applied.film, tx);
  expect(result.conflicts).toEqual([]);
  expect(result.film.styleZh).toBe(base.styleZh);
  expect(result.film.shots[0]!.poster).toBe("/later.png");
  expect(result.film.characters[0]!.identity).toBe(base.characters[0]!.identity);
});

it("preserves costume rule metadata and recomputes risks from the latest scenes", async () => {
  const { mergeCostumes, resolveCostumes } = await import("../../film/costume-rules");
  const base = sampleFilm();
  const proposed = mergeCostumes(base, [
    {
      id: "costume-new",
      name: base.characters[0]!.name,
      title: "雨夜外套",
      description: "深色外套",
      artDescription: "深色外套",
      ranges: [{ sceneId: base.scenes[0]!.id, from: "P1", to: "P2" }],
    },
  ]);
  const tx = prepareArtTransaction(base, proposed, { projectId: base.id, page: "cast" });
  const live = structuredClone(base);
  live.scenes[0]!.sourceParagraphIds = ["P1", "P2"];
  const result = applyArtTransaction(live, tx);
  expect(result.conflicts).toEqual([]);
  expect(result.film.costumes).toEqual(proposed.costumes);
  expect(result.film.costumeRisks).toEqual(resolveCostumes(result.film).risks);
  live.characters[0]!.userFields.push("costumes");
  expect(applyArtTransaction(live, tx).conflicts).toContain("FIELD_LOCKED:costumes");
});

it("atomically refuses undo after another page references the added location", async () => {
  const { base, tx } = await fixture();
  const applied = applyArtTransaction(base, tx);
  applied.film.scenes[0]!.where = " 新增书店 ";
  const result = undoArtTransaction(applied.film, tx);
  expect(result.conflicts).toEqual(["ADDED_ENTITY_REFERENCED"]);
  expect(result.film).toBe(applied.film);
  expect(result.receipt).toBeNull();
  expect(result.film.styleZh).toBe("新的画风");
  expect(result.film.locations.some((row) => row.name === "新增书店")).toBe(true);
});

it("allows undo when the location reference already existed before the art request", async () => {
  const { base, proposed } = await fixture();
  base.scenes[0]!.where = "新增书店";
  proposed.scenes[0]!.where = "新增书店";
  const tx = prepareArtTransaction(base, proposed, { projectId: base.id, page: "cast" });
  const applied = applyArtTransaction(base, tx);
  const result = undoArtTransaction(applied.film, tx);
  expect(result.conflicts).toEqual([]);
  expect(result.film.scenes).toEqual(base.scenes);
  expect(result.film.locations).toEqual(base.locations);
});

it("applies and undoes provisional voice provenance through art confirmation", () => {
  const base = sampleFilm();
  const proposed = structuredClone(base);
  proposed.characters[0]!.voiceDefault = {
    basis: "adult-default",
    evidenceSource: "casting-default",
    evidence: "年龄未注明，暂用成人声音，可调整。",
  };
  const tx = prepareArtTransaction(base, proposed, { projectId: base.id, page: "cast" });
  expect(tx.unsupported).toEqual([]);
  const applied = applyArtTransaction(base, tx);
  expect(applied.receipt).not.toBeNull();
  expect(applied.film.characters[0]!.voiceDefault).toEqual(proposed.characters[0]!.voiceDefault);
  const undone = undoArtTransaction(applied.film, tx);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film.characters[0]!.voiceDefault).toBeUndefined();
});
