import type { FilmProject, FilmShot } from "../../film/project";
import type { EditorSelection } from "./editor-context";
import type { StoryConfirmation } from "./story-confirmation";
import type { SuggestionFieldRow } from "../../next/SuggestionFieldDiff";
import { applyStoryConfirmation } from "./story-confirmation";
import { applyContinuityChecks } from "../../film/continuity-rules";
import { castExtractionStory } from "./cast";
import { directorFieldValues } from "./director-field-values";
import { shape, list, equal, reject } from "./direction-field-format";
export type DirectorFieldReview = { fieldRows: SuggestionFieldRow[]; notes: string[] };
/** Only one current scene, using the original complete pure story producer. */
export function prepareDirectorFieldReview(
  base: FilmProject,
  tx: StoryConfirmation,
  origin: EditorSelection,
): DirectorFieldReview | null {
  try {
    if (
      tx.kind !== "director" ||
      !("batches" in tx) ||
      tx.projectId !== base.id ||
      origin.projectId !== base.id ||
      !origin.sceneId ||
      tx.unsupported.length ||
      tx.batches.length !== 1
    )
      return null;
    const part = tx.batches[0]!;
    if (
      part.kind !== "director" ||
      part.sceneId !== origin.sceneId ||
      part.unsupported.length ||
      part.writerAssets ||
      part.sourceAfter !== undefined ||
      part.shotChanges?.length ||
      part.numbering?.length ||
      part.sceneNumbering?.length
    )
      return null;
    const structure = part.structure;
    if (
      structure.collection !== "shots" ||
      structure.userEdit ||
      structure.unsupported.length ||
      structure.before.length + structure.after.length > 128
    )
      return null;
    const result = applyStoryConfirmation(base, tx);
    if (!result.receipt) return null;
    // This legacy follow-up may ask a writer to merge people/places; it has no fixed reply to review.
    if (castExtractionStory(result.film) !== null) return null;
    const displayFilm = applyContinuityChecks(result.film);
    const values = directorFieldValues(base, displayFilm, origin),
      rows: SuggestionFieldRow[] = [];
    const add = (label: string, before: string | null, after: string | null) => {
      if ((before !== null && before.length > 65536) || (after !== null && after.length > 65536))
        reject();
      rows.push({
        key: `director-field-${rows.length + 1}`,
        label,
        kind: before === null ? "added" : after === null ? "removed" : "changed",
        before,
        after,
      });
    };
    const order = (film: FilmProject) =>
      film.shots
        .filter((row) => row.sceneId === origin.sceneId)
        .map((shot, index) => `${index + 1}. ${values.shotLabel(shot.id)}`)
        .join("\n") || "无镜头";
    if (!equal(structure.beforeOrder, structure.afterOrder))
      add(`${values.sceneLabel} · 镜头顺序`, order(base), order(result.film));
    const before = new Map(structure.before.map((row) => [row.id, row as FilmShot])),
      after = new Map(structure.after.map((row) => [row.id, row as FilmShot]));
    if (before.size !== structure.before.length || after.size !== structure.after.length) reject();
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id),
        next = after.get(id),
        shot = next ?? old!;
      if (shot.sceneId !== origin.sceneId) reject();
      const label = values.shotLabel(id);
      if (!old || !next) {
        const full = Object.keys(shot)
          .filter((field) => field !== "id" && field !== "sceneId")
          .map(
            (field) =>
              `${values.labels[field] ?? ({ poster: "画面素材", posterPosition: "画面定位", selectedTakeId: "选用视频版本", takes: "视频版本", stills: "画面版本", continuityFrame: "衔接帧", reviewedVideoPrompt: "已确认画面说明", splitSource: "拆镜来源", continuity: "连续性待核项" } as Record<string, string>)[field] ?? reject()}：${values.value(field, (shot as unknown as Record<string, unknown>)[field], shot, old)}`,
          )
          .join("\n");
        add(`${next ? "新增" : "移除"} · ${label}`, old ? full : null, next ? full : null);
      } else {
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
          if (field === "id" || field === "sceneId" || !Object.hasOwn(values.labels, field))
            reject();
          add(
            `${label} · ${values.labels[field]}`,
            left.present ? values.value(field, left.value, old, old) : null,
            right.present ? values.value(field, right.value, next, old) : null,
          );
        }
      }
    }
    for (const shot of displayFilm.shots) {
      const raw = result.film.shots.find((row) => row.id === shot.id);
      if (raw && !equal(raw.continuity, shot.continuity)) {
        if (shot.sceneId !== origin.sceneId) reject();
        add(
          `${values.shotLabel(shot.id)} · 文字与记录检查（原规则重算）`,
          raw.continuity === undefined
            ? null
            : values.value("continuity", raw.continuity, raw, raw),
          shot.continuity === undefined
            ? null
            : values.value("continuity", shot.continuity, shot, raw),
        );
      }
    }
    const cell = (v: { present: boolean; value: unknown }, format: (v: unknown) => string) => {
      if (typeof v.present !== "boolean") reject();
      return v.present ? (v.value === undefined ? "未设置" : format(v.value)) : null;
    };
    if (part.coverage) {
      const format = (raw: unknown) => {
        const report = shape(raw, ["sceneId", "ok", "lastLine", "missingLines", "missingTail"]);
        if (report.sceneId !== origin.sceneId || typeof report.ok !== "boolean") reject();
        return [
          `台词/结尾文本覆盖：${report.ok ? "符合原检测规则" : "有缺项"}（不代表语音已说完）`,
          `原文最后一句：${values.text(report.lastLine)}`,
          `缺少台词：${list(report.missingLines, 256).map(values.text).join("\n") || "无"}`,
          `缺少结尾：${report.missingTail === null ? "无" : values.text(report.missingTail)}`,
        ].join("\n");
      };
      add(
        `${values.sceneLabel} · 原文文本覆盖`,
        cell(part.coverage.before, format),
        cell(part.coverage.after, format),
      );
    }
    if (part.shotBudget) {
      const reasons: Record<string, string> = {
        SCENE_MISMATCH: "不在同一场",
        HAS_MEDIA: "已有媒体",
        HAS_SELECTED_TAKE: "已有选用版本",
        HAS_CONTINUITY_FRAME: "已有衔接帧",
        USER_LOCKED: "用户已保护",
        INVALID_DURATION: "时长无效",
        DURATION_OVER_15S: "合并预计时长超过15秒",
        FRAMING_MISMATCH: "景别不匹配",
        SPEAKER_MISMATCH: "说话人不同",
        SOUND_SOURCE_MISMATCH: "原声/配音来源不同",
        MUSIC_MOOD_MISMATCH: "配乐情绪不同",
        STYLE_MISMATCH: "单镜画风不同",
      };
      const format = (raw: unknown) => {
        const budget = shape(raw, ["sceneId", "limit", "count", "ok", "blockedPairs"]);
        if (
          budget.sceneId !== origin.sceneId ||
          budget.limit !== 16 ||
          typeof budget.ok !== "boolean"
        )
          reject();
        return [
          `单场镜头预算：${values.numeric(budget.count, 0, 10000)} / 16 镜；${budget.ok ? "符合原预算规则" : "需人工核对"}`,
          ...list(budget.blockedPairs, 512).map((raw) => {
            const pair = shape(raw, ["shotIds", "reasons"]),
              ids = list(pair.shotIds, 2);
            if (ids.length !== 2) reject();
            return `${ids.map(values.shotLabel).join(" / ")}：${list(pair.reasons, 32)
              .map((reason) => {
                if (typeof reason !== "string" || !Object.hasOwn(reasons, reason)) reject();
                return reasons[reason]!;
              })
              .join("、")}`;
          }),
        ].join("\n");
      };
      add(
        `${values.sceneLabel} · 镜头预算`,
        cell(part.shotBudget.before, format),
        cell(part.shotBudget.after, format),
      );
    }
    if (part.beats) {
      if (
        !Array.isArray(part.beats.beforePositions) ||
        part.beats.beforePositions.length !== part.beats.before.length ||
        !Array.isArray(part.beats.afterPositions) ||
        part.beats.afterPositions.length !== part.beats.after.length
      )
        reject();
      const format = (raw: unknown, positions: number[]) =>
        list(raw, 256)
          .map((raw, index) => {
            const beat = shape(raw, ["sceneId", "text"]);
            if (
              beat.sceneId !== origin.sceneId ||
              !Number.isInteger(positions[index]) ||
              positions[index]! < 0 ||
              positions[index]! > 100000 ||
              positions.indexOf(positions[index]!) !== index
            )
              reject();
            return `待分配列表第 ${positions[index]! + 1} 项 · ${values.sceneLabel}：${values.text(beat.text)}`;
          })
          .join("\n") || "无";
      add(
        `${values.sceneLabel} · 未分配动作`,
        part.beats.beforePresent ? format(part.beats.before, part.beats.beforePositions) : null,
        part.beats.afterPresent ? format(part.beats.after, part.beats.afterPositions) : null,
      );
    }
    if (rows.length > 512) return null;
    return {
      fieldRows: rows,
      notes: [
        `本次只修改${values.sceneLabel}的导演镜头结构；保留其他场内容，也不是全项目编剧结构建议；待分配清单按显示位置插入本场条目。`,
        "新增、移除与排序及创作字段以请求时基线展示；原镜以请求时镜号识别，新增镜使用建议镜号。预计秒数和节点时间是创作计划，不是实际视频或逐词语音对齐；原文来源声明不增加事实证据；通用文字与记录检查按原纯规则重算，不代表看过图像。",
        "确认不会生成媒体或自动补提人物/地点；受影响镜头已有素材、音轨、任务或用户保护发生变化时，沿原结构守卫拒绝覆盖。未受影响镜头和晚到媒体保留。",
      ],
    };
  } catch {
    return null;
  }
}
