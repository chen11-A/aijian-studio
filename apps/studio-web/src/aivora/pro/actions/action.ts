import type { UiNotice } from "../../film/contracts3j";
import { shotActions, withShotActions } from "../../film/shot-actions";
import { applyActionPlan, type SceneActionState } from "../../film/action-plan";
import {
  actionBeats,
  assignActionBeats,
  fightConstraints,
  resolveActionBeatShot,
} from "../../film/operations";
import { actionFromModel, difficultyLabel, parseLooseJson } from "../../film/phase2";
import { shotLines } from "../../film/director-continuity";
import type { FilmProject, FilmShot } from "../../film/project";
import type { AgentReply } from "../workflow";
export type ActionDraftHost = {
  request: (agent: "action", context: string, instruction: string) => Promise<AgentReply>;
  current: () => boolean;
  connected: boolean;
};
export type ActionDraftResult =
  | { status: "stale" }
  | { status: "rejected"; notice: string; logRejection: boolean }
  | {
      status: "ready";
      shot: FilmShot;
      notes: string[];
      notice: string;
      structuredNotice?: UiNotice;
      event: "beats" | "offline";
      unassigned?: FilmProject["unassignedBeats"];
      actionState?: SceneActionState;
    };
/** Manual assistant scope is exactly one selected shot; never use array position as model identity. */
export async function planActionDraft(
  film: FilmProject,
  current: FilmShot | undefined,
  host: ActionDraftHost,
): Promise<ActionDraftResult> {
  let unassigned: FilmProject["unassignedBeats"];
  let resolvedActions: string[] | undefined;
  const text = current?.picture || current?.action || film.title;
  let sentence = actionBeats(text)
    .map(
      (beat) =>
        `${beat.text}（${beat.feasibility}${beat.workaround ? `，${beat.workaround}` : ""}，来自动作指导）`,
    )
    .join("");
  let note = "没有登录，已用离线动作指导。点「写入分镜」写到这一镜。";
  const context = `人物：${film.characters.map((item) => item.name).join("、")}\n当前镜头 id：${current?.id ?? ""}；只返回这个 id 的动作。\n${fightConstraints(film.scenes.find((item) => item.id === current?.sceneId)?.text ?? "")}\n镜头：${JSON.stringify(current ? [{ id: current.id, no: current.no, size: current.size, picture: current.picture, line: current.line, lines: shotLines(current) }] : [])}`;
  const reply = await host.request("action", context, text);
  if (!host.current()) return { status: "stale" };
  let structured = reply.text ? parseLooseJson(reply.text) : null;
  let parsed = actionFromModel(structured);
  if (!parsed && host.connected) {
    const again = await host.request("action", context, `${text}\n只输出 JSON，不要解释。`);
    if (!host.current()) return { status: "stale" };
    structured = again.text ? parseLooseJson(again.text) : null;
    parsed = actionFromModel(structured);
    if (!parsed) {
      return {
        status: "rejected",
        notice: `${again.detail || reply.detail || "模型没有按格式返回。"} 没有写入。`,
        logRejection: false,
      };
    }
  }
  if (parsed && current) {
    const sourceScene = film.scenes.find((scene) => scene.id === current.sceneId);
    const source = sourceScene?.text ?? "";
    const assigned = assignActionBeats([current], current.sceneId, parsed, source, sourceScene);
    unassigned = assigned.unassignedBeats;
    parsed = parsed.filter(
      (row) =>
        resolveActionBeatShot([current], current.sceneId, row, source, sourceScene)?.id ===
          current.id && !assigned.unassignedBeats.some((item) => item.text === row.text),
    );
    sentence = assigned.shots[0]?.action ?? current.action;
    resolvedActions = shotActions(assigned.shots[0] ?? current);
    note = assigned.unassignedBeats.length
      ? "有动作没对上镜头，去分镜看看。"
      : "动作指导写好了。点「写入分镜」写到这一镜。";
  }
  if (!current) {
    return { status: "rejected", notice: "先拆出镜头，再请动作指导。", logRejection: true };
  }
  const cues = parsed
    ? parsed.filter((row) => row.text).map((row) => ({ atSeconds: row.at, text: row.text }))
    : current.sound.sfx;
  const actionNotes = parsed
    ? parsed.map((row) => `难度：${difficultyLabel(row.feasibility)} · ${row.text}`)
    : sentence
      ? [sentence]
      : [];
  const planned = applyActionPlan({ ...film, shots: [current] }, current.sceneId, structured);
  const actionState = planned.scenes.find((scene) => scene.id === current.sceneId)?.actionState;
  const actionLocked =
    current.userFields.includes("action") || current.userFields.includes("actionPlan");
  if (actionState?.unassigned.length) note = "有动作没对上镜头，去分镜看看。";
  const missingActions = [
    ...(unassigned ?? []).map((item) => item.text),
    ...(actionState?.unassigned ?? []).flatMap((item) => item.plan.nodes.map((node) => node.move)),
  ].filter(Boolean);
  const structuredNotice: UiNotice | undefined =
    unassigned?.length || actionState?.unassigned.length
      ? {
          code: "ACTION_UNASSIGNED",
          text: "有动作没对上镜头，去分镜看看。",
          detail: `未找到可安全对应的镜头${missingActions.length ? `：${[...new Set(missingActions)].join("；")}` : ""}。请到分镜核对这些动作与镜头内容，再重新生成动作建议。`,
        }
      : undefined;
  const actionShot = {
    ...current,
    actionPlan: planned.shots[0]?.actionPlan,
    action: actionLocked ? current.action : sentence,
    sound: actionLocked ? current.sound : { ...current.sound, sfx: cues },
    source: actionLocked ? current.source : "agent:action",
    userFields: current.userFields,
  };
  return {
    status: "ready",
    shot: actionLocked ? actionShot : withShotActions(actionShot, resolvedActions ?? [sentence]),
    notes: actionNotes,
    notice: note,
    ...(structuredNotice ? { structuredNotice } : {}),
    event: parsed ? "beats" : "offline",
    ...(unassigned ? { unassigned } : {}),
    ...(actionState ? { actionState } : {}),
  };
}
