import type { SuggestionFieldRow } from "../../next/SuggestionFieldDiff";
import type { EditorSelection } from "./editor-context";
import type { ShotDirectionTransaction } from "./shot-direction-transaction";
import {
  object,
  equal,
  reject,
  shape,
  safeText,
  list,
  seconds,
  nullable,
  source,
} from "./direction-field-format";
function bounded(text: string) {
  if (text.length > 32768) reject();
  return text;
}
function number(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000) reject();
  return String(value);
}
function symbol(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    (value !== "" && !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value))
  )
    reject();
  return value;
}
function nodeIds(raw: unknown) {
  if (raw === undefined) return [];
  const nodes = list(
    shape(raw, ["sourceShotIds", "binding", "nodes", "injuries", "propsAfter", "promptAddon"])
      .nodes,
    128,
  );
  const ids = nodes.map((node) => symbol(object(node)?.id));
  if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) reject();
  return ids;
}
function prop(value: unknown, scope: EditorSelection) {
  const row = shape(value, ["name", "left", "right", "shotId"]);
  if (Object.hasOwn(row, "shotId") && row.shotId !== undefined && row.shotId !== scope.shotId)
    reject();
  const lines = [
    `道具：${safeText(row.name, scope)}`,
    `归属：${row.shotId === scope.shotId ? "当前镜头" : "本场未指定镜头"}`,
  ];
  for (const [key, label] of [
    ["left", "左手"],
    ["right", "右手"],
  ] as const)
    if (Object.hasOwn(row, key))
      lines.push(`${label}：${nullable(row[key], (v) => safeText(v, scope))}`);
  return lines.join("；");
}
function actionPlan(
  value: unknown,
  scope: EditorSelection,
  beforeIds: readonly string[],
  after: boolean,
): string {
  const row = shape(value, [
    "sourceShotIds",
    "binding",
    "nodes",
    "injuries",
    "propsAfter",
    "promptAddon",
  ]);
  const nodes = list(row.nodes, 128),
    ids = nodeIds(value);
  const lines: string[] = [];
  if (Object.hasOwn(row, "sourceShotIds"))
    lines.push(
      `原镜头对应：${nullable(row.sourceShotIds, (v) => {
        const sources = list(v, 128);
        if (sources.some((id) => id !== scope.shotId) || new Set(sources).size !== sources.length)
          reject();
        return sources.length ? `当前镜头（${sources.length} 项来源标记）` : "无";
      })}`,
    );
  if (Object.hasOwn(row, "binding")) {
    if (row.binding !== undefined && row.binding !== "source-overlap") reject();
    if (
      row.binding === "source-overlap" &&
      (!Array.isArray(row.sourceShotIds) ||
        row.sourceShotIds.length !== 1 ||
        row.sourceShotIds[0] !== scope.shotId)
    )
      reject();
    lines.push(`对应方式：${row.binding === undefined ? "未设置" : "按原文重叠对应当前镜头"}`);
  }
  lines.push(`动作节点：${nodes.length ? "" : "无"}`);
  for (const [index, value] of nodes.entries()) {
    const node = shape(value, [
      "id",
      "at",
      "duration",
      "actor",
      "target",
      "move",
      "bodyPart",
      "direction",
      "force",
      "forceCue",
      "contact",
      "reaction",
      "sfxCue",
      "feasibility",
      "workaround",
    ]);
    const id = ids[index]!,
      old = id ? beforeIds.indexOf(id) : -1;
    lines.push(
      `第 ${index + 1} 段 · ${!id ? "来源未标记" : !after || old >= 0 ? `原动作段 ${after ? old + 1 : index + 1}` : `新动作段 ${index + 1}`}`,
    );
    for (const [key, label] of [
      ["at", "开始"],
      ["duration", "持续"],
    ] as const) {
      if (!Object.hasOwn(node, key)) reject();
      lines.push(`${label}：${nullable(node[key], seconds)}`);
    }
    for (const [key, label] of [
      ["actor", "执行人物"],
      ["move", "动作"],
      ["bodyPart", "身体部位"],
      ["direction", "方向"],
    ] as const)
      lines.push(`${label}：${safeText(node[key], scope)}`);
    for (const [key, label] of [
      ["target", "对象"],
      ["forceCue", "力度说明"],
      ["reaction", "反应"],
      ["sfxCue", "声音提示"],
    ] as const) {
      if (!Object.hasOwn(node, key)) reject();
      lines.push(`${label}：${nullable(node[key], (v) => safeText(v, scope))}`);
    }
    if (!Object.hasOwn(node, "force") || !Object.hasOwn(node, "contact")) reject();
    lines.push(`力度提示值：${nullable(node.force, number)}`);
    lines.push(
      `接触：${nullable(node.contact, (v) => {
        if (typeof v !== "boolean") reject();
        return v ? "有接触" : "无接触";
      })}`,
    );
    if (Object.hasOwn(node, "feasibility")) {
      if (
        node.feasibility !== undefined &&
        !["稳", "难", "看运气"].includes(String(node.feasibility))
      )
        reject();
      lines.push(`难度：${node.feasibility === undefined ? "未设置" : node.feasibility}`);
    }
    if (Object.hasOwn(node, "workaround"))
      lines.push(`替代动作：${nullable(node.workaround, (v) => safeText(v, scope))}`);
  }
  lines.push(
    `伤情：${
      list(row.injuries, 128)
        .map((value) => {
          const injury = shape(value, [
            "name",
            "bodyPart",
            "side",
            "kind",
            "fromShot",
            "visibleAs",
          ]);
          if (injury.fromShot !== scope.shotId) reject();
          return `当前镜头 · 人物：${safeText(injury.name, scope)}；部位：${safeText(injury.bodyPart, scope)}；左右侧：${safeText(injury.side, scope)}；类型：${safeText(injury.kind, scope)}；可见状态：${safeText(injury.visibleAs, scope)}`;
        })
        .join("\n") || "无"
    }`,
  );
  lines.push(
    `动作后道具：${
      list(row.propsAfter, 128)
        .map((value) => prop(value, scope))
        .join("\n") || "无"
    }`,
  );
  lines.push(`动作补充：${safeText(row.promptAddon, scope)}`);
  const text = lines.join("\n");
  if (text.length > 32768) reject();
  return text;
}
function sound(value: unknown, scope: EditorSelection) {
  const row = shape(value, ["source", "ambience", "sfx", "musicMood"]);
  if (!["native", "dub"].includes(String(row.source))) reject();
  return bounded(
    [
      `声音来源：${row.source === "native" ? "原视频声音" : "配音"}`,
      `环境：${safeText(row.ambience, scope)}`,
      `音效计划：${
        list(row.sfx, 128)
          .map((value) => {
            const cue = shape(value, ["atSeconds", "text"]);
            return `${seconds(cue.atSeconds)}：${safeText(cue.text, scope)}`;
          })
          .join("\n") || "无"
      }`,
      `配乐情绪：${safeText(row.musicMood, scope)}`,
    ].join("\n"),
  );
}
function actionState(value: unknown, scope: EditorSelection) {
  const row = shape(value, ["propsAfter", "safetyNotes", "unassigned"]);
  const reasons: Record<string, string> = {
    UNKNOWN_SHOT: "镜头对应待核对",
    USER_EDITED: "保留用户修改",
    ACTION_REJECTED: "动作尚未采纳",
  };
  return bounded(
    [
      `场内道具状态：${
        list(row.propsAfter, 128)
          .map((value) => prop(value, scope))
          .join("\n") || "无"
      }`,
      `安全提示：${
        list(row.safetyNotes, 128)
          .map((v) => safeText(v, scope))
          .join("\n") || "无"
      }`,
      `待核对动作：${
        list(row.unassigned, 128)
          .map((value) => {
            const pending = shape(value, ["shotId", "reason", "plan"]);
            if (
              pending.shotId !== scope.shotId ||
              typeof pending.reason !== "string" ||
              !Object.hasOwn(reasons, pending.reason)
            )
              reject();
            return `当前镜头：${reasons[pending.reason]}\n${actionPlan(pending.plan, scope, nodeIds(pending.plan), false)}`;
          })
          .join("\n\n") || "无"
      }`,
    ].join("\n"),
  );
}
function beats(value: unknown, scope: EditorSelection) {
  return bounded(
    list(value, 128)
      .map((value) => {
        const row = shape(value, ["sceneId", "text"]);
        if (row.sceneId !== scope.sceneId) reject();
        return `本场：${safeText(row.text, scope)}`;
      })
      .join("\n") || "无",
  );
}
/** Every actual field, scene state and unassigned beat change, or the whole legacy card. */
/** Formatting only: structural cards keep their own original story transaction and receipt. */
export function formatActionFieldValue(
  field: string,
  value: unknown,
  scope: EditorSelection,
  beforePlan: unknown = undefined,
  after = true,
): string {
  if (field === "actionPlan")
    return actionPlan(value, scope, beforePlan === undefined ? [] : nodeIds(beforePlan), after);
  if (field === "actionBeats")
    return bounded(
      list(value, 128)
        .map((item) => safeText(item, scope))
        .join("\n") || "无",
    );
  if (field === "sound") return sound(value, scope);
  if (field === "source") return source(value);
  if (field === "action") return safeText(value, scope);
  return reject();
}
export function projectActionFields(
  tx: ShotDirectionTransaction | undefined,
  origin: EditorSelection,
): SuggestionFieldRow[] | null {
  if (
    !tx ||
    tx.role !== "action" ||
    tx.stateField !== "actionState" ||
    !object(tx.input) ||
    !object(tx.selection) ||
    !Array.isArray(tx.unsupported) ||
    tx.unsupported.length ||
    !Array.isArray(tx.changes) ||
    !Array.isArray(tx.beatsBefore) ||
    !Array.isArray(tx.beatsAfter) ||
    !object(tx.stateBefore) ||
    !object(tx.stateAfter) ||
    !origin.projectId ||
    !origin.sceneId ||
    !origin.shotId ||
    !["board", "edit"].includes(origin.page) ||
    tx.selection.projectId !== origin.projectId ||
    tx.selection.page !== origin.page ||
    tx.selection.sceneId !== origin.sceneId ||
    tx.selection.shotId !== origin.shotId
  )
    return null;
  const labels: Record<string, string> = {
    action: "动作说明",
    actionBeats: "动作要点",
    actionPlan: "动作计划",
    sound: "声音计划",
    source: "镜头建议来源",
  };
  const rows = new Map<string, SuggestionFieldRow>();
  try {
    const planChange = tx.changes.find((change) => change.field === "actionPlan");
    const oldIds =
      planChange?.before.present && planChange.before.value !== undefined
        ? nodeIds(planChange.before.value)
        : [];
    const cell = (
      raw: { present: boolean; value: unknown },
      format: (v: unknown) => string,
    ): string | null => {
      if (!raw || typeof raw.present !== "boolean") reject();
      if (!raw.present) {
        if (raw.value !== undefined) reject();
        return null;
      }
      return raw.value === undefined ? "未设置" : format(raw.value);
    };
    const add = (
      field: string,
      label: string,
      before: { present: boolean; value: unknown },
      after: { present: boolean; value: unknown },
      format: (v: unknown, after: boolean) => string,
    ) => {
      rows.set(field, {
        key: `action-${field}`,
        label,
        kind: !before.present ? "added" : !after.present ? "removed" : "changed",
        before: cell(before, (v) => format(v, false)),
        after: cell(after, (v) => format(v, true)),
      });
    };
    for (const change of tx.changes) {
      if (
        change.target.collection !== "shots" ||
        change.target.id !== origin.shotId ||
        !Object.hasOwn(labels, change.field) ||
        rows.has(change.field)
      )
        reject();
      const format = (v: unknown, after: boolean) =>
        change.field === "actionPlan"
          ? actionPlan(v, origin, oldIds, after)
          : change.field === "actionBeats"
            ? bounded(
                list(v, 128)
                  .map((value) => safeText(value, origin))
                  .join("\n") || "无",
              )
            : change.field === "sound"
              ? sound(v, origin)
              : change.field === "source"
                ? source(v)
                : safeText(v, origin);
      add(change.field, labels[change.field]!, change.before, change.after, format);
    }
    if (!equal(tx.stateBefore, tx.stateAfter))
      add("actionState", "场内动作状态", tx.stateBefore, tx.stateAfter, (v) =>
        actionState(v, origin),
      );
    if (!equal(tx.beatsBefore, tx.beatsAfter))
      add(
        "unassignedBeats",
        "本场待对应动作",
        { present: true, value: tx.beatsBefore },
        { present: true, value: tx.beatsAfter },
        (v) => beats(v, origin),
      );
    return [...Object.keys(labels), "actionState", "unassignedBeats"].flatMap((key) =>
      rows.has(key) ? [rows.get(key)!] : [],
    );
  } catch {
    return null;
  }
}
