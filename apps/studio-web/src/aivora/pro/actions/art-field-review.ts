import type { FilmProject } from "../../film/project";
import type { SuggestionFieldRow } from "../../next/SuggestionFieldDiff";
import { applyArtTransaction, type ArtTransaction } from "./art-transaction";
import { artReviewInput, artReviewCurrent } from "./art-review-scope";
import { artFieldValues } from "./art-field-values";
import { equal, object, reject } from "./direction-field-format";
export type ArtFieldReview = { fieldRows: SuggestionFieldRow[]; notes: string[]; input: string };
/** Simulate only the original pure producer on the captured request baseline. Never restore this film. */
export function prepareArtFieldReview(
  base: FilmProject,
  tx: ArtTransaction,
): ArtFieldReview | null {
  try {
    if (
      base.id !== tx.selection.projectId ||
      !Array.isArray(tx.changes) ||
      !Array.isArray(tx.additions) ||
      !Array.isArray(tx.unsupported) ||
      tx.unsupported.length ||
      tx.changes.length + tx.additions.length > 256
    )
      return null;
    const prepared = applyArtTransaction(base, tx);
    if (!prepared.receipt) return null;
    const values = artFieldValues(base, prepared.film, tx.selection),
      rows: SuggestionFieldRow[] = [],
      seen = new Set<string>();
    const labels: Record<string, string> = {
      styleZh: "画风说明",
      costumes: "人物服装规则",
      artDesign: "美术声明（不证明已有素材）",
      artDesignBaseline: "后续建议参考声明",
      identity: "固定外貌",
      gender: "性别",
      ageBand: "年龄段",
      voiceId: "声音",
      voiceCode: "选声待核项",
      voiceDefault: "默认选声依据",
      name: "名称",
      prompt: "场景描述",
      ambience: "环境声音",
      layout: "场景布局",
      note: "道具描述",
      artFields: "后续建议参考内容",
      userFields: "用户编辑保护",
      referenceStyleRevision: "参考图画风状态",
    };
    const cell = (v: { present: boolean; value: unknown }, collection: string, field: string) => {
      if (!v || typeof v.present !== "boolean") reject();
      if (!v.present) {
        if (v.value !== undefined) reject();
        return null;
      }
      return v.value === undefined ? "未设置" : values.value(collection, field, v.value);
    };
    for (const change of tx.changes) {
      if (!Object.hasOwn(labels, change.field)) reject();
      const key = JSON.stringify([
        change.target.collection,
        "id" in change.target ? change.target.id : null,
        change.field,
      ]);
      if (seen.has(key)) reject();
      seen.add(key);
      const prefix =
        change.target.collection === "project"
          ? "全项目"
          : `${({ characters: "人物", locations: "场景", props: "道具" } as Record<string, string>)[change.target.collection] ?? reject()} · ${values.ref(change.target.collection as "characters" | "locations" | "props", "id" in change.target ? change.target.id : undefined)}`;
      rows.push({
        key: `art-field-${rows.length + 1}`,
        label: `${prefix} · ${labels[change.field]}`,
        kind: !change.before.present ? "added" : !change.after.present ? "removed" : "changed",
        before: cell(change.before, change.target.collection, change.field),
        after: cell(change.after, change.target.collection, change.field),
      });
    }
    for (const addition of tx.additions) {
      if (!object(addition.row) || !["locations", "props"].includes(addition.collection)) reject();
      rows.push({
        key: `art-addition-${rows.length + 1}`,
        label: `新增${addition.collection === "locations" ? "场景" : "道具"} · ${values.ref(addition.collection, addition.row.id)}`,
        kind: "added",
        before: null,
        after: values.addition(
          addition.collection,
          addition.row,
          addition.collection === "locations" ? addition.referencingSceneIds : undefined,
        ),
      });
    }
    const notes = ["本次美术建议作用于全项目；当前选中对象仅供参考，不代表只修改该对象。"];
    if (tx.changes.some((row) => row.target.collection === "project" && row.field === "styleZh"))
      notes.push(
        "修改画风会将全项目镜头标为需要核对画风，已有素材保留，不会自动生成；已有场景参考图会标为待核对。撤销也按当前作品重新标记，不回放旧素材状态。",
      );
    if (tx.recomputeCostumes) {
      notes.push(
        "服装待核风险由原规则按当前原文范围重新计算，不代表新增原文证据。撤销时也重新计算。",
      );
      if (!equal(base.costumeRisks, prepared.film.costumeRisks))
        rows.push({
          key: "art-derived-costume-risks",
          label: "全项目 · 服装待核风险",
          kind:
            base.costumeRisks === undefined
              ? "added"
              : prepared.film.costumeRisks === undefined
                ? "removed"
                : "changed",
          before: base.costumeRisks === undefined ? null : values.risks(base.costumeRisks),
          after:
            prepared.film.costumeRisks === undefined
              ? null
              : values.risks(prepared.film.costumeRisks),
        });
    }
    return { fieldRows: rows, notes, input: artReviewInput(base, tx) };
  } catch {
    return null;
  }
}
export { artReviewCurrent };
