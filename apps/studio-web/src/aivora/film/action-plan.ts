import type { FilmProject, FilmShot } from "./project";
import { normalizeAgentReply } from "./agent-reply-compat";
import { plainCue } from "./phase2";
import { assignActionBeats } from "./operations";

export type ActionNode = {
  id: string;
  at: number | null;
  duration: number | null;
  actor: string;
  target: string | null;
  move: string;
  bodyPart: string;
  direction: string;
  force: number | null;
  forceCue: string | null;
  contact: boolean | null;
  reaction: string | null;
  sfxCue: string | null;
  feasibility?: "稳" | "难" | "看运气";
  workaround?: string;
};
export type ActionInjury = {
  name: string;
  bodyPart: string;
  side: string;
  kind: string;
  fromShot: string;
  visibleAs: string;
};
export type ActionPropState = {
  name: string;
  left?: string | null;
  right?: string | null;
  shotId?: string;
};
export type ShotActionPlan = {
  nodes: ActionNode[];
  injuries: ActionInjury[];
  propsAfter: ActionPropState[];
  promptAddon: string;
};
export type UnassignedAction = {
  shotId: string;
  reason: "UNKNOWN_SHOT" | "USER_EDITED" | "ACTION_REJECTED";
  plan: ShotActionPlan;
};
export type SceneActionState = {
  propsAfter: ActionPropState[];
  safetyNotes: string[];
  unassigned: UnassignedAction[];
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? plainCue(v) : "");
const nullable = (v: unknown) => (typeof v === "string" ? text(v) : null);
const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const empty = (): ShotActionPlan => ({ nodes: [], injuries: [], propsAfter: [], promptAddon: "" });

export function parseActionPlan(value: unknown): {
  shots: { shotId: string; plan: ShotActionPlan }[];
  state: SceneActionState;
} {
  const row = normalizeAgentReply("action", value) ?? {};
  const shots = list(row.shots).map((raw) => {
    const shot = object(raw);
    return {
      shotId: text(shot.shot_id ?? shot.id),
      plan: {
        ...empty(),
        promptAddon: text(shot.prompt_addon),
        nodes: list(shot.nodes).map((rawNode): ActionNode => {
          const n = object(rawNode);
          return {
            id: text(n.node_id),
            at: seconds(n.at_seconds),
            duration: seconds(n.duration_seconds),
            actor: text(n.actor),
            target: nullable(n.target),
            move: text(n.move ?? n.text),
            bodyPart: text(n.body_part),
            direction: text(n.direction),
            force: typeof n.force === "number" && Number.isFinite(n.force) ? n.force : null,
            forceCue: nullable(n.force_cue),
            contact: typeof n.contact === "boolean" ? n.contact : null,
            reaction: nullable(n.reaction),
            sfxCue: nullable(n.sfx_cue),
          };
        }),
      },
    };
  });
  const forShot = (id: string) => {
    let found = shots.find((s) => s.shotId === id);
    if (!found) {
      found = { shotId: id, plan: empty() };
      shots.push(found);
    }
    return found.plan;
  };
  for (const raw of list(row.beats)) {
    const beat = object(raw);
    const matches = shots.flatMap((s) => s.plan.nodes.filter((n) => n.id && n.id === beat.node_id));
    if (matches.length > 1) {
      // Ambiguous duplicate node IDs cannot authorize a shot assignment.
      forShot("").nodes.push({
        id: text(beat.node_id),
        at: seconds(beat.at_seconds),
        duration: null,
        actor: "",
        target: null,
        move: text(beat.text),
        bodyPart: "",
        direction: "",
        force: null,
        forceCue: null,
        contact: null,
        reaction: null,
        sfxCue: null,
      });
      continue;
    }
    let node = matches[0];
    if (!node) {
      node = {
        id: text(beat.node_id),
        at: seconds(beat.at_seconds),
        duration: null,
        actor: "",
        target: null,
        move: text(beat.text),
        bodyPart: "",
        direction: "",
        force: null,
        forceCue: null,
        contact: null,
        reaction: null,
        sfxCue: null,
      };
      forShot(text(beat.shot_id ?? beat.id)).nodes.push(node);
    }
    node.feasibility =
      beat.feasibility === "难" || beat.feasibility === "看运气" ? beat.feasibility : "稳";
    node.workaround = text(beat.workaround);
  }
  for (const raw of list(row.injuries)) {
    const injury = object(raw);
    const fromShot = text(injury.from_shot);
    forShot(fromShot).injuries.push({
      name: text(injury.name),
      bodyPart: text(injury.body_part),
      side: text(injury.side),
      kind: text(injury.kind),
      fromShot,
      visibleAs: text(injury.visible_as),
    });
  }
  const state: SceneActionState = {
    propsAfter: [],
    safetyNotes: list(row.safety_notes).map(text).filter(Boolean),
    unassigned: [],
  };
  for (const raw of list(row.props_after)) {
    const prop = object(raw);
    const shotId = text(prop.shot_id);
    const parsed = {
      name: text(prop.name),
      ...(prop.left === null || typeof prop.left === "string" ? { left: nullable(prop.left) } : {}),
      ...(prop.right === null || typeof prop.right === "string"
        ? { right: nullable(prop.right) }
        : {}),
      ...(shotId ? { shotId } : {}),
    };
    if (shotId) forShot(shotId).propsAfter.push(parsed);
    else state.propsAfter.push(parsed);
  }
  return { shots, state };
}

export function applyActionPlan(film: FilmProject, sceneId: string, value: unknown): FilmProject {
  const parsed = parseActionPlan(value);
  const byId = new Map<string, ShotActionPlan>();
  for (const entry of parsed.shots) {
    const shot = film.shots.find((s) => s.sceneId === sceneId && s.id === entry.shotId);
    const reason = !shot
      ? "UNKNOWN_SHOT"
      : shot.userFields.includes("action") || shot.userFields.includes("actionPlan")
        ? "USER_EDITED"
        : null;
    if (reason) {
      parsed.state.unassigned.push({ ...entry, reason });
      continue;
    }
    const accepted: ActionNode[] = [];
    const rejected: ActionNode[] = [];
    for (const node of entry.plan.nodes) {
      const cue = [node.actor, node.move, node.bodyPart, node.direction, node.reaction]
        .filter(Boolean)
        .join("，");
      const check = assignActionBeats([shot!], sceneId, [{ shotId: entry.shotId, text: cue }]);
      (check.unassignedBeats.length ? rejected : accepted).push(node);
    }
    if (rejected.length)
      parsed.state.unassigned.push({
        shotId: entry.shotId,
        reason: "ACTION_REJECTED",
        plan: { ...empty(), nodes: rejected },
      });
    const previous = byId.get(entry.shotId) ?? empty();
    byId.set(entry.shotId, {
      nodes: [...previous.nodes, ...accepted],
      injuries: [...previous.injuries, ...entry.plan.injuries],
      propsAfter: [...previous.propsAfter, ...entry.plan.propsAfter],
      promptAddon: [previous.promptAddon, rejected.length ? "" : entry.plan.promptAddon]
        .filter(Boolean)
        .join("。"),
    });
  }
  return {
    ...film,
    shots: film.shots.map((shot) =>
      shot.sceneId === sceneId && byId.has(shot.id)
        ? { ...shot, actionPlan: byId.get(shot.id)! }
        : shot,
    ),
    scenes: film.scenes.map((scene) =>
      scene.id === sceneId ? { ...scene, actionState: parsed.state } : scene,
    ),
  };
}

/** Physical constraints only. Sound cues remain structured suggestions, never mixed audio. */
export function actionPlanPrompt(shot: FilmShot): string {
  if (!shot.actionPlan || shot.userFields.includes("action")) return "";
  const p = shot.actionPlan;
  return [
    ...p.nodes.map((n) =>
      [
        n.at !== null ? `第${n.at}秒起` : "",
        n.duration !== null ? `持续${n.duration}秒` : "",
        n.actor,
        n.target ? `对${n.target}` : "",
        n.move,
        n.bodyPart,
        n.direction,
        n.contact === true ? "发生接触" : n.contact === false ? "不发生接触" : "",
        n.force !== null ? `力度${n.force}` : "",
        n.forceCue,
        n.reaction,
        n.workaround ? `拍法：${n.workaround}` : "",
      ]
        .filter(Boolean)
        .join("，"),
    ),
    ...p.injuries.map((i) => `${i.name}${i.side}${i.bodyPart}${i.kind}，${i.visibleAs}`),
    ...p.propsAfter.map((p) => {
      const hands = [
        p.left === null ? "左手空手" : p.left ? `左手${p.left}` : "",
        p.right === null ? "右手空手" : p.right ? `右手${p.right}` : "",
      ].filter(Boolean);
      return hands.length ? `本镜结束时${p.name}：${hands.join("，")}` : "";
    }),
    p.promptAddon,
  ]
    .filter(Boolean)
    .map(plainCue)
    .join("。");
}
