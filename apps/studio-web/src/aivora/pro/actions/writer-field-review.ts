import type { FilmProject, FilmScene, FilmShot } from "../../film/project";
import { resolveEditorContext, type EditorSelection } from "./editor-context";
import type { StoryConfirmation } from "./story-confirmation";
import type { SuggestionFieldRow } from "../../next/SuggestionFieldDiff";
import { applyStoryConfirmation } from "./story-confirmation";
import { applyContinuityChecks } from "../../film/continuity-rules";
import { castExtractionStory } from "./cast";
import { writerFieldValues } from "./writer-field-values";
import { equal, reject } from "./direction-field-format";
export type WriterFieldReview = { fieldRows: SuggestionFieldRow[]; notes: string[] };
/** One whole-project writer transaction. All actual effects are represented, or none use field mode. */
export function prepareWriterFieldReview(
  base: FilmProject,
  tx: StoryConfirmation,
  origin: EditorSelection,
): WriterFieldReview | null {
  try {
    if (
      tx.kind !== "writer" ||
      "batches" in tx ||
      tx.projectId !== base.id ||
      origin.projectId !== base.id ||
      !["script", "board", "cast", "edit"].includes(origin.page) ||
      !resolveEditorContext(base, origin).ok ||
      tx.unsupported.length ||
      tx.structure.collection !== "scenes" ||
      tx.structure.userEdit ||
      tx.structure.unsupported.length
    )
      return null;
    if (tx.coverage || tx.shotBudget || tx.beats || tx.numbering?.length) return null;
    const applied = applyStoryConfirmation(base, tx);
    if (!applied.receipt) return null;
    if (castExtractionStory(applied.film) !== null) return null;
    const display = applyContinuityChecks(applied.film),
      values = writerFieldValues(base, display, origin),
      rows: SuggestionFieldRow[] = [];
    let total = 0;
    const add = (label: string, before: string | null, after: string | null) => {
      if ((before?.length ?? 0) > 65536 || (after?.length ?? 0) > 65536) reject();
      total += label.length + (before?.length ?? 0) + (after?.length ?? 0);
      if (total > 524288 || rows.length >= 512) reject();
      rows.push({
        key: `writer-field-${rows.length + 1}`,
        label,
        kind: before === null ? "added" : after === null ? "removed" : "changed",
        before,
        after,
      });
    };
    const order = (film: FilmProject) =>
      film.scenes
        .map((scene, index) => `${index + 1}. ${values.sceneLabel(scene.id)}`)
        .join("\n") || "无场次";
    if (!equal(tx.structure.beforeOrder, tx.structure.afterOrder))
      add("全项目 · 场次顺序", order(base), order(applied.film));
    const before = new Map(tx.structure.before.map((row) => [row.id, row as FilmScene])),
      after = new Map(tx.structure.after.map((row) => [row.id, row as FilmScene]));
    if (before.size !== tx.structure.before.length || after.size !== tx.structure.after.length)
      reject();
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id),
        next = after.get(id),
        scene = next ?? old!,
        label = values.sceneLabel(id);
      if (!old || !next) {
        const text = Object.keys(scene)
          .filter((field) => field !== "id")
          .map(
            (field) =>
              `${values.sceneLabels[field] ?? reject()}：${values.sceneValue(field, (scene as unknown as Record<string, unknown>)[field])}`,
          )
          .join("\n");
        add(`${next ? "新增" : "移除"} · ${label}`, old ? text : null, next ? text : null);
      } else
        for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
          const left = {
              present: Object.hasOwn(old, field),
              value: (old as unknown as Record<string, unknown>)[field],
            },
            right = {
              present: Object.hasOwn(next, field),
              value: (next as unknown as Record<string, unknown>)[field],
            };
          if (equal(left, right)) continue;
          if (field === "id" || !Object.hasOwn(values.sceneLabels, field)) reject();
          add(
            `${label} · ${values.sceneLabels[field]}`,
            left.present ? values.sceneValue(field, left.value) : null,
            right.present ? values.sceneValue(field, right.value) : null,
          );
        }
    }
    if (
      new Set((tx.sceneNumbering ?? []).map((change) => change.id)).size !==
      (tx.sceneNumbering ?? []).length
    )
      reject();
    for (const change of tx.sceneNumbering ?? []) {
      if (
        !base.scenes.some((scene) => scene.id === change.id) ||
        !applied.film.scenes.some((scene) => scene.id === change.id)
      )
        reject();
      add(
        `${values.sceneLabel(change.id)} · 保留场编号`,
        values.number(change.before, 1, 10000),
        values.number(change.after, 1, 10000),
      );
    }
    for (const child of tx.shotChanges ?? []) {
      if (
        child.structure.collection !== "shots" ||
        child.structure.userEdit ||
        child.structure.unsupported.length ||
        child.structure.after.length
      )
        reject();
      for (const row of child.structure.before) {
        const shot = row as FilmShot;
        add(
          `清理未使用自动镜头 · ${values.shotLabel(shot.id)}`,
          values.shotContents(shot, shot),
          null,
        );
      }
    }
    if (tx.sourceAfter !== undefined) {
      if (typeof tx.sourceBefore !== "string") reject();
      add("全项目 · 保留原稿（逐字）", values.text(tx.sourceBefore), values.text(tx.sourceAfter));
    }
    if (tx.writerAssets) {
      // Use the actual original producer's resulting creative arrays; no hand-built cast merge.
      for (const collection of ["characters", "locations"] as const) {
        const left = base[collection],
          right = applied.film[collection];
        if (
          left.length + right.length > 512 ||
          new Set(left.map((row) => row.id)).size !== left.length ||
          new Set(right.map((row) => row.id)).size !== right.length
        )
          reject();
        if (
          !equal(
            left.map((row) => row.id),
            right.map((row) => row.id),
          )
        ) {
          const order = (rows: typeof left) =>
            rows.map((row, index) => `${index + 1}. ${values.text(row.name)}`).join("\n") || "无";
          add(
            `全项目 · ${collection === "characters" ? "人物" : "地点"}顺序`,
            order(left),
            order(right),
          );
        }
        const leftMap = new Map(left.map((row) => [row.id, row])),
          rightMap = new Map(right.map((row) => [row.id, row]));
        for (const id of new Set([...leftMap.keys(), ...rightMap.keys()])) {
          const old = leftMap.get(id),
            next = rightMap.get(id),
            row = next ?? old!,
            label = `${collection === "characters" ? "人物" : "地点"} · ${values.text((old ?? next)!.name)}`;
          if (!old || !next) {
            const content = Object.keys(row)
              .filter((field) => field !== "id")
              .map(
                (field) =>
                  `${values.assetLabels[field] ?? reject()}：${values.assetValue(collection, field, (row as unknown as Record<string, unknown>)[field])}`,
              )
              .join("\n");
            add(
              `${next ? "新增" : "移除"} · ${label}`,
              old ? content : null,
              next ? content : null,
            );
          } else
            for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
              const a = {
                  present: Object.hasOwn(old, field),
                  value: (old as unknown as Record<string, unknown>)[field],
                },
                b = {
                  present: Object.hasOwn(next, field),
                  value: (next as unknown as Record<string, unknown>)[field],
                };
              if (equal(a, b)) continue;
              if (field === "id" || !Object.hasOwn(values.assetLabels, field)) reject();
              add(
                `${label} · ${values.assetLabels[field]}`,
                a.present ? values.assetValue(collection, field, a.value) : null,
                b.present ? values.assetValue(collection, field, b.value) : null,
              );
            }
        }
      }
      if (!equal(tx.writerAssets.before.plan, tx.writerAssets.after.plan)) {
        const a = tx.writerAssets.before.plan,
          b = tx.writerAssets.after.plan;
        add(
          "全项目 · 编剧完整创作声明",
          a.present ? (a.value === undefined ? "未设置" : values.projectPlan(a.value)) : null,
          b.present ? (b.value === undefined ? "未设置" : values.projectPlan(b.value)) : null,
        );
      }
    }
    for (const shot of display.shots) {
      const old = applied.film.shots.find((row) => row.id === shot.id);
      if (old && !equal(old.continuity, shot.continuity)) {
        // Unrelated surviving media/creative rows are not silently rewritten by this display path.
        add(
          `${values.shotLabel(shot.id)} · 原文字与记录检查重算`,
          values.shotContents(old, old),
          values.shotContents(shot, old),
        );
      }
    }
    return {
      fieldRows: rows,
      notes: [
        "本次是全项目编剧场次结构建议；当前选中场只提供上下文，不代表只改这一场。",
        "原场按固定请求场号识别，新增场使用建议场号。完整列出场次变化、未使用自动镜头清理、人物/地点和编剧声明；原稿保留不删字，不截短显示后提交全部。",
        "仅模拟原事务和原通用文字检查。段落归属、人物/地点声明和预计秒数不是新的事实或语音证据；确认不会生成媒体或自动补提人物地点。",
        "原素材、音轨、任务、用户锁、来源与依赖仍由原结构事务守卫；有新工作则拒绝覆盖。专属撤销使用同一原逆事务，不回放旧作品。",
      ],
    };
  } catch {
    return null;
  }
}
