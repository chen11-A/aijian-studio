import { describe, expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { planArtDraft } from "./art";
import { prepareArtTransaction, type ArtTransaction } from "./art-transaction";
import { projectArtStyleFields } from "./art-style-field-rows";

async function fixture() {
  const base = sampleFilm();
  const origin = { projectId: base.id, page: "cast" as const, sceneId: base.scenes[0]!.id };
  const draft = await planArtDraft(base, {
    current: () => true,
    request: async () => ({
      text: JSON.stringify({ prompt_block_zh: "暖色胶片，柔和侧光。" }),
      detail: "",
    }),
  });
  if (draft.status !== "ready") throw new Error("real art action did not prepare a draft");
  return { base, origin, transaction: prepareArtTransaction(base, draft.draft, origin) };
}

describe("complete style-only art field projection", () => {
  it("projects the exact single field from a real art action, with no hidden transaction fields", async () => {
    const { base, origin, transaction } = await fixture();
    expect(transaction.changes).toHaveLength(1);
    expect(transaction.unsupported).toEqual([]);
    expect(projectArtStyleFields(transaction, origin)).toEqual([
      {
        key: "art-style",
        label: "画风说明",
        kind: "changed",
        before: base.styleZh,
        after: "暖色胶片，柔和侧光。",
      },
    ]);
    base.styleZh = "后来改的文字。";
    expect(projectArtStyleFields(transaction, origin)?.[0]?.before).not.toBe(base.styleZh);
  });

  it.each(["extra-field", "extra-target", "addition", "unsupported", "costumes"])(
    "falls back as a whole for %s instead of applying an unshown subset",
    async (kind) => {
      const { origin, transaction } = await fixture();
      if (kind === "extra-field")
        transaction.changes.push({
          target: { collection: "project" },
          field: "artDesign",
          before: { present: false, value: undefined },
          after: { present: true, value: { lighting: "侧光" } },
        });
      if (kind === "extra-target")
        transaction.changes.push({
          target: { collection: "characters", id: "hidden-character" },
          field: "identity",
          before: { present: true, value: "旧外貌" },
          after: { present: true, value: "新外貌" },
        });
      if (kind === "addition")
        transaction.additions.push({
          collection: "props",
          row: { id: "new-prop", name: "旧书", note: "" },
        });
      if (kind === "unsupported") transaction.unsupported.push("SHOTS_CHANGED");
      if (kind === "costumes") transaction.recomputeCostumes = true;
      expect(projectArtStyleFields(transaction, origin)).toBeNull();
    },
  );

  it.each(["projectId", "page", "sceneId", "shotId"] as const)(
    "rejects a mismatched captured %s",
    async (field) => {
      const { origin, transaction } = await fixture();
      const other = { ...origin, [field]: field === "page" ? "board" : "other-scope" };
      expect(projectArtStyleFields(transaction, other as typeof origin)).toBeNull();
    },
  );

  it.each([
    { unsafe: { lighting: "raw object" } },
    { unsafe: '{"style":"raw JSON"}' },
    { unsafe: "/private/output.mp4" },
    { unsafe: "C:\\private\\output.mp4" },
    { unsafe: "https://provider.invalid/private" },
    { unsafe: "source=agent:art" },
    { unsafe: "api_key=private-secret" },
    { unsafe: "film_hiddenproject00001" },
    { unsafe: "bad\u0000control" },
  ])("never projects unsafe or nontext values: %j", async ({ unsafe }) => {
    const { origin, transaction } = await fixture();
    transaction.changes[0]!.after.value = unsafe;
    expect(projectArtStyleFields(transaction, origin)).toBeNull();
    transaction.changes[0]!.after.value = "安全新画风";
    transaction.changes[0]!.before.value = unsafe;
    expect(projectArtStyleFields(transaction, origin)).toBeNull();
  });

  it("rejects missing/equal cells and absent transactions, preserving style's required field semantics", async () => {
    const { origin, transaction } = await fixture();
    expect(projectArtStyleFields(undefined, origin)).toBeNull();
    const noField = structuredClone(transaction);
    noField.changes = [];
    expect(projectArtStyleFields(noField, origin)).toBeNull();
    const absent = structuredClone(transaction);
    absent.changes[0]!.after = { present: false, value: undefined };
    expect(projectArtStyleFields(absent, origin)).toBeNull();
    const equal = structuredClone(transaction);
    equal.changes[0]!.after = structuredClone(equal.changes[0]!.before);
    expect(projectArtStyleFields(equal, origin)).toBeNull();
  });

  it("does not accept another art field disguised as a style-only change", async () => {
    const { origin, transaction } = await fixture();
    const altered: ArtTransaction = structuredClone(transaction);
    altered.changes[0]!.field = "stylePreset";
    expect(projectArtStyleFields(altered, origin)).toBeNull();
  });
});
