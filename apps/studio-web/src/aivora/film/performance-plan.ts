import type { FilmShot } from "./project";
import { bindPerformanceRows, normalizeAgentReply } from "./agent-reply-compat";
import { plainCue } from "./phase2";
export type PerformanceVoice = { tone: string; pace: string; pauses: string; emotion: string };
export type PerformanceVoiceDeclaration = Partial<PerformanceVoice> & { pause?: string };
export type PerformanceDeclarations = {
  role: "primary" | "other";
  /** Presence is meaningful: null explicitly declares no duration/voice; absence does not. */
  holdS?: number | null;
  voice?: PerformanceVoiceDeclaration | PerformanceVoiceDeclaration[] | null;
};
export type PerformerPlan = {
  /** Source declarations only; generation and voice execution must use the existing projected fields. */
  declarations?: PerformanceDeclarations;
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
  voice: PerformanceVoice;
  voiceAlternatives?: PerformanceVoice[];
};
export type ShotPerformancePlan = {
  binding?: "explicit" | "scope-order";
  sourceId?: string;
  unverifiedPeople?: string[];
  timingWarnings?: { name: string; field: "faceAt" | "holdSeconds"; value: number }[];
  people: PerformerPlan[];
  scopeCues: PerformerPlan[];
  promptAddon: string;
};
export type PerformanceState = {
  voiceReviews?: { shotId: string; reason: string }[];
  unassigned: {
    shotId: string;
    reason:
      | "UNKNOWN_SHOT"
      | "DUPLICATE_SHOT"
      | "USER_EDITED"
      | "PERFORMER_UNSPECIFIED"
      | "UNKNOWN_PERFORMER";
    plan: ShotPerformancePlan;
  }[];
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? plainCue(v) : "");
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
function voiceCue(value: unknown): PerformanceVoice {
  const voice = object(value);
  return {
    tone: text(voice.tone),
    pace: text(voice.pace),
    pauses: text(voice.pauses ?? voice.pause),
    emotion: text(voice.emotion),
  };
}
function voiceDeclaration(value: unknown): PerformanceVoiceDeclaration {
  const row = object(value);
  return Object.fromEntries(
    ["tone", "pace", "pauses", "pause", "emotion"].flatMap((key) =>
      typeof row[key] === "string" ? [[key, row[key]]] : [],
    ),
  );
}
function person(value: unknown, role: PerformanceDeclarations["role"]): PerformerPlan {
  const p = object(value);

  const eyes = object(p.eyes);
  const expressions = list(p.micro_expressions ?? p.face);
  const face = expressions.map((v) => (typeof v === "string" ? text(v) : text(object(v).text)));
  const times = list(p.face_at);
  const intensity = number(p.intensity);
  const holdSeconds = number(p.hold_s ?? eyes.hold_seconds);
  const declarations: PerformanceDeclarations = {
    role,
    ...(p.hold_s === null || (typeof p.hold_s === "number" && Number.isFinite(p.hold_s))
      ? { holdS: p.hold_s }
      : {}),
    ...(p.voice === null
      ? { voice: null }
      : Array.isArray(p.voice)
        ? { voice: p.voice.map(voiceDeclaration) }
        : p.voice && typeof p.voice === "object"
          ? { voice: voiceDeclaration(p.voice) }
          : {}),
  };
  return {
    declarations,
    name: text(p.who ?? p.name),
    emotion: text(p.emotion),
    ...(intensity !== undefined ? { intensity } : {}),
    face,
    faceAt: face.map(
      (_, i) =>
        number(times[i]) ??
        number(object(expressions[i]).at_seconds ?? object(expressions[i]).at) ??
        null,
    ),
    eyes: text(p.eyes),
    gaze: text(p.gaze ?? eyes.gaze),
    ...(holdSeconds !== undefined ? { holdSeconds } : {}),
    hands: text(p.hands),
    breath: text(p.breath),
    voice: voiceCue(p.voice),
    ...(Array.isArray(p.voice) ? { voiceAlternatives: p.voice.map(voiceCue) } : {}),
  };
}
export function parsePerformancePlans(
  value: unknown,
): { shotId: string; plan: ShotPerformancePlan }[] {
  return list(normalizeAgentReply("performance", value)?.shots).map((raw) => {
    const row = object(raw);
    const main = Array.isArray(row.performances) ? row.performances : [row];
    const performers = [
      ...main.map((value) => person(value, "primary")),
      ...list(row.others).map((value) => person(value, "other")),
    ];
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
function performerScope(shot: FilmShot): Set<string> {
  return new Set(
    [
      ...shot.characters,
      shot.speaker ?? "",
      ...(shot.lines ?? []).map((line) => line.speaker),
    ].filter((name) => name && !["人物", "空镜", "旁白", "画外音"].includes(name)),
  );
}
function timingWarnings(
  plan: ShotPerformancePlan,
  seconds: number,
): NonNullable<ShotPerformancePlan["timingWarnings"]> {
  return [...plan.people, ...plan.scopeCues].flatMap((person) => [
    ...person.faceAt
      .filter((at): at is number => at !== null && at >= seconds)
      .map((value) => ({ name: person.name, field: "faceAt" as const, value })),
    ...(person.holdSeconds !== undefined && person.holdSeconds > seconds
      ? [{ name: person.name, field: "holdSeconds" as const, value: person.holdSeconds }]
      : []),
  ]);
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
    else {
      const scope = performerScope(shot!);
      const unknown = scope.size ? row.plan.people.filter((person) => !scope.has(person.name)) : [];
      if (unknown.length) state.unassigned.push({ ...row, reason: "UNKNOWN_PERFORMER" });
      accepted.set(shot!.id, {
        ...row.plan,
        people: row.plan.people.filter((person) => !unknown.includes(person)),
        promptAddon: unknown.length ? "" : row.plan.promptAddon,
        binding: bound.binding,
        sourceId: bound.sourceId,
        ...(scope.size === 0 && row.plan.people.length
          ? { unverifiedPeople: row.plan.people.map((person) => person.name) }
          : {}),
        timingWarnings: timingWarnings(row.plan, shot!.seconds),
      });
    }
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
  const scope = performerScope(shot);
  const unknown =
    scope.size && shot.performancePlan.people.some((person) => !scope.has(person.name));
  return [
    ...[
      ...shot.performancePlan.people.filter((person) => !scope.size || scope.has(person.name)),
      ...(shot.performancePlan.scopeCues ?? []),
    ].map(
      (p) =>
        `${p.name || "本镜表演"}：${[
          p.emotion,
          p.intensity !== undefined ? `表演强度${p.intensity}` : "",
          ...p.face.map((face, i) =>
            p.faceAt[i] != null && p.faceAt[i]! < shot.seconds ? `第${p.faceAt[i]}秒${face}` : face,
          ),
          p.eyes,
          p.gaze ? `视线${p.gaze}` : "",
          p.holdSeconds !== undefined && p.holdSeconds <= shot.seconds
            ? `保持${p.holdSeconds}秒`
            : "",
          p.hands,
          p.breath,
        ]
          .filter(Boolean)
          .join("，")}`,
    ),
    unknown ? "" : shot.performancePlan.promptAddon,
  ]
    .filter(Boolean)
    .map(plainCue)
    .join("。");
}
