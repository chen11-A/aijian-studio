import type { FilmShot } from "./project";
import { bindPerformanceRows, normalizeAgentReply } from "./agent-reply-compat";
import { plainCue } from "./phase2";
export type PerformerPlan = {
  name: string;
  emotion: string;
  intensity?: number;
  face: string[];
  faceAt: (number | null)[];
  eyes: string;
  gaze: string;
  holdSeconds?: number;
  hands: string;
  breath: string;
  voice: { tone: string; pace: string; pauses: string; emotion: string };
};
export type ShotPerformancePlan = {
  binding?: "explicit" | "scope-order";
  sourceId?: string;
  people: PerformerPlan[];
  scopeCues: PerformerPlan[];
  promptAddon: string;
};
export type PerformanceState = {
  unassigned: {
    shotId: string;
    reason: "UNKNOWN_SHOT" | "DUPLICATE_SHOT" | "USER_EDITED" | "PERFORMER_UNSPECIFIED";
    plan: ShotPerformancePlan;
  }[];
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? plainCue(v) : "");
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
function person(value: unknown): PerformerPlan {
  const p = object(value);
  const voice = object(p.voice);
  const eyes = object(p.eyes);
  const face = list(p.micro_expressions ?? p.face).map((v) =>
    typeof v === "string" ? text(v) : text(object(v).text),
  );
  const times = list(p.face_at);
  const intensity = number(p.intensity);
  const holdSeconds = number(p.hold_s ?? eyes.hold_seconds);
  return {
    name: text(p.who ?? p.name),
    emotion: text(p.emotion),
    ...(intensity !== undefined ? { intensity } : {}),
    face,
    faceAt: face.map((_, i) => number(times[i]) ?? null),
    eyes: text(p.eyes),
    gaze: text(p.gaze ?? eyes.gaze),
    ...(holdSeconds !== undefined ? { holdSeconds } : {}),
    hands: text(p.hands),
    breath: text(p.breath),
    voice: {
      tone: text(voice.tone),
      pace: text(voice.pace),
      pauses: text(voice.pauses ?? voice.pause),
      emotion: text(voice.emotion),
    },
  };
}
export function parsePerformancePlans(
  value: unknown,
): { shotId: string; plan: ShotPerformancePlan }[] {
  return list(normalizeAgentReply("performance", value)?.shots).map((raw) => {
    const row = object(raw);
    const main = Array.isArray(row.performances) ? row.performances : [row];
    const performers = [...main, ...list(row.others)].map(person);
    return {
      shotId: text(row.shot_id ?? row.id),
      plan: {
        people: performers.filter((p) => p.name),
        scopeCues: performers.filter((p) => !p.name),
        promptAddon: text(row.prompt_addon),
      },
    };
  });
}
export function applyPerformancePlans(
  shots: FilmShot[],
  value: unknown,
  options: { draft?: boolean } = {},
): { shots: FilmShot[]; state: PerformanceState; assignedIds: string[] } {
  const rows = parsePerformancePlans(value);
  const bindings = bindPerformanceRows(
    rows.map((row) => row.shotId),
    shots.map((shot) => shot.id),
  );
  const state: PerformanceState = { unassigned: [] };
  const accepted = new Map<string, ShotPerformancePlan>();
  rows.forEach((row, index) => {
    const bound = bindings[index]!;
    const shot = shots.find((s) => s.id === bound.targetId);
    const reason =
      bound.reason ||
      (!shot
        ? "UNKNOWN_SHOT"
        : !options.draft &&
            (shot.userFields.includes("performance") || shot.userFields.includes("performancePlan"))
          ? "USER_EDITED"
          : null);
    if (reason) state.unassigned.push({ ...row, reason });
    else accepted.set(shot!.id, { ...row.plan, binding: bound.binding, sourceId: bound.sourceId });
  });
  return {
    assignedIds: [...accepted.keys()],
    shots: shots.map((shot) =>
      accepted.has(shot.id) ? { ...shot, performancePlan: accepted.get(shot.id)! } : shot,
    ),
    state,
  };
}
export function performancePlanPrompt(shot: FilmShot): string {
  if (!shot.performancePlan || shot.userFields.includes("performance")) return "";
  return [
    ...[...shot.performancePlan.people, ...(shot.performancePlan.scopeCues ?? [])].map(
      (p) =>
        `${p.name || "本镜表演"}：${[
          p.emotion,
          p.intensity !== undefined ? `表演强度${p.intensity}` : "",
          ...p.face.map((face, i) => (p.faceAt[i] != null ? `第${p.faceAt[i]}秒${face}` : face)),
          p.eyes,
          p.gaze ? `视线${p.gaze}` : "",
          p.holdSeconds !== undefined ? `保持${p.holdSeconds}秒` : "",
          p.hands,
          p.breath,
        ]
          .filter(Boolean)
          .join("，")}`,
    ),
    shot.performancePlan.promptAddon,
  ]
    .filter(Boolean)
    .map(plainCue)
    .join("。");
}
