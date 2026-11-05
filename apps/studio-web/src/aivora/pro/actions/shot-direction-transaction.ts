import type { FilmProject, FilmShot, FilmScene } from "../../film/project";
import type { EditorSelection } from "./editor-context";
import type { EditorFieldChange } from "./editor-changes";

export type ShotDirectionTransaction = {
  selection: EditorSelection;
  role: "action" | "performance";
  input: ReturnType<typeof directionInput> | null;
  changes: EditorFieldChange[];
  stateField: "actionState" | "performanceState";
  stateBefore: {
    present: boolean;
    value: FilmScene["actionState"] | FilmScene["performanceState"];
  };
  stateAfter: ShotDirectionTransaction["stateBefore"];
  beatsBefore: NonNullable<FilmProject["unassignedBeats"]>;
  beatsAfter: NonNullable<FilmProject["unassignedBeats"]>;
  unsupported: string[];
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unique = <T>(rows: T[]) =>
  rows.filter((row, index) => rows.findIndex((other) => equal(other, row)) === index);
const fields = {
  action: ["action", "actionBeats", "actionPlan", "sound", "source"],
  performance: ["performance", "performancePlan", "performanceSource", "delivery", "source"],
} satisfies Record<"action" | "performance", (keyof FilmShot)[]>;
const field = (row: FilmShot, key: keyof FilmShot) => ({
  present: Object.hasOwn(row, key),
  value: structuredClone(row[key]),
});
function directionInput(film: FilmProject, shot: FilmShot) {
  return structuredClone({
    picture: shot.picture,
    action: shot.action,
    actionBeats: shot.actionBeats,
    performance: shot.performance,
    line: shot.line,
    lines: shot.lines,
    characters: shot.characters,
    speaker: shot.speaker,
    seconds: shot.seconds,
    size: shot.size,
    angle: shot.angle,
    move: shot.move,
    sceneText: film.scenes.find((scene) => scene.id === shot.sceneId)?.text,
    characterNames: film.characters.map((person) => person.name),
  });
}
export function prepareShotDirection(
  base: FilmProject,
  shot: FilmShot,
  selection: EditorSelection,
  role: "action" | "performance",
  state?: FilmScene["actionState"] | FilmScene["performanceState"],
  beats?: FilmProject["unassignedBeats"],
): ShotDirectionTransaction {
  const original = base.shots.find((row) => row.id === selection.shotId);
  const scene = base.scenes.find((row) => row.id === selection.sceneId);
  const stateField = role === "action" ? "actionState" : "performanceState";
  const stateBefore = {
    present: Boolean(scene && Object.hasOwn(scene, stateField)),
    value: structuredClone(scene?.[stateField]),
  };
  const beatsBefore = structuredClone(
    (base.unassignedBeats ?? []).filter((row) => row.sceneId === selection.sceneId),
  );
  const tx: ShotDirectionTransaction = {
    selection: structuredClone(selection),
    role,
    input: original ? directionInput(base, original) : null,
    changes: [],
    stateField,
    stateBefore,
    stateAfter: structuredClone(stateBefore),
    beatsBefore,
    beatsAfter: structuredClone(beatsBefore),
    unsupported: [],
  };
  if (
    base.shots.filter((row) => row.id === selection.shotId).length !== 1 ||
    base.scenes.filter((row) => row.id === selection.sceneId).length !== 1 ||
    base.id !== selection.projectId ||
    !original ||
    !scene ||
    original.sceneId !== scene.id ||
    shot.id !== original.id ||
    shot.sceneId !== scene.id
  ) {
    tx.unsupported.push("SELECTION_MISMATCH");
    return tx;
  }
  for (const key of fields[role]) {
    if (key === "delivery" && original.userFields.includes("delivery")) continue;
    if (key === "source" && (original.source === "user" || original.userFields.length > 0))
      continue;
    const before = field(original, key),
      after = field(shot, key);
    if (!equal(before, after))
      tx.changes.push({ target: { collection: "shots", id: shot.id }, field: key, before, after });
  }
  if (state && role === "action") {
    const incoming = state as NonNullable<FilmScene["actionState"]>,
      old = scene.actionState;
    if (incoming.propsAfter.some((row) => row.shotId && row.shotId !== shot.id))
      tx.unsupported.push("STATE_OUTSIDE_SHOT");
    if (
      incoming.propsAfter.some(
        (row) =>
          !row.shotId &&
          old?.propsAfter.some(
            (previous) => !previous.shotId && previous.name === row.name && !equal(previous, row),
          ),
      )
    )
      tx.unsupported.push("AMBIGUOUS_PROP_STATE");
    tx.stateAfter = {
      present: true,
      value: {
        propsAfter: unique([
          ...(old?.propsAfter ?? []).filter((row) => row.shotId !== shot.id),
          ...incoming.propsAfter,
        ]),
        safetyNotes: unique([...(old?.safetyNotes ?? []), ...incoming.safetyNotes]),
        unassigned: unique([
          ...(old?.unassigned ?? []).filter((row) => row.shotId !== shot.id),
          ...incoming.unassigned,
        ]),
      },
    };
  } else if (state && role === "performance") {
    const incoming = state as NonNullable<FilmScene["performanceState"]>,
      old = scene.performanceState;
    if (incoming.voiceReviews?.some((row) => row.shotId !== shot.id))
      tx.unsupported.push("STATE_OUTSIDE_SHOT");
    tx.stateAfter = {
      present: true,
      value: {
        ...old,
        unassigned: unique([
          ...(old?.unassigned ?? []).filter((row) => row.shotId !== shot.id),
          ...incoming.unassigned,
        ]),
        ...(old?.voiceReviews || incoming.voiceReviews
          ? {
              voiceReviews: unique([
                ...(old?.voiceReviews ?? []).filter((row) => row.shotId !== shot.id),
                ...(incoming.voiceReviews ?? []),
              ]),
            }
          : {}),
      },
    };
  }
  if (role === "action" && beats) {
    if (beats.some((row) => row.sceneId !== scene.id)) tx.unsupported.push("BEATS_OUTSIDE_SCENE");
    tx.beatsAfter = unique([...beatsBefore, ...structuredClone(beats)]);
  }
  return tx;
}
export function applyShotDirection(film: FilmProject, tx: ShotDirectionTransaction) {
  return change(film, tx, false);
}
export function undoShotDirection(film: FilmProject, tx: ShotDirectionTransaction) {
  return change(film, tx, true);
}
function change(current: FilmProject, tx: ShotDirectionTransaction, inverse: boolean) {
  const reject = (code: string) => ({ film: current, receipt: null, conflicts: [code] });
  if (tx.unsupported.length) return reject(tx.unsupported.join(","));
  const shot = current.shots.find((row) => row.id === tx.selection.shotId),
    scene = current.scenes.find((row) => row.id === tx.selection.sceneId);
  if (
    current.shots.filter((row) => row.id === tx.selection.shotId).length !== 1 ||
    current.scenes.filter((row) => row.id === tx.selection.sceneId).length !== 1 ||
    current.id !== tx.selection.projectId ||
    !shot ||
    !scene ||
    shot.sceneId !== scene.id
  )
    return reject("SELECTION_MISMATCH");
  if (!inverse && !equal(directionInput(current, shot), tx.input)) return reject("INPUT_CHANGED");
  if (shot.userFields.some((key) => [tx.role, `${tx.role}Plan`].includes(key)))
    return reject("FIELD_LOCKED");
  for (const item of tx.changes) {
    if (shot.userFields.includes(item.field)) return reject("FIELD_LOCKED");
    if (!equal(field(shot, item.field as keyof FilmShot), inverse ? item.after : item.before))
      return reject(`FIELD_CHANGED:${item.field}`);
  }
  const state = { present: Object.hasOwn(scene, tx.stateField), value: scene[tx.stateField] };
  if (!equal(state, inverse ? tx.stateAfter : tx.stateBefore)) return reject("SCENE_STATE_CHANGED");
  if (
    tx.role === "action" &&
    !equal(
      (current.unassignedBeats ?? []).filter((row) => row.sceneId === scene.id),
      inverse ? tx.beatsAfter : tx.beatsBefore,
    )
  )
    return reject("UNASSIGNED_CHANGED");
  const film = structuredClone(current),
    next = film.shots.find((row) => row.id === shot.id)!;
  for (const item of tx.changes) {
    const value = inverse ? item.before : item.after;
    if (value.present)
      (next as unknown as Record<string, unknown>)[item.field] = structuredClone(value.value);
    else delete (next as unknown as Record<string, unknown>)[item.field];
  }
  const target = film.scenes.find((row) => row.id === scene.id)!,
    value = inverse ? tx.stateBefore : tx.stateAfter;
  if (value.present)
    (target as unknown as Record<string, unknown>)[tx.stateField] = structuredClone(value.value);
  else delete target[tx.stateField];
  if (tx.role === "action" && !equal(tx.beatsBefore, tx.beatsAfter))
    film.unassignedBeats = [
      ...(film.unassignedBeats ?? []).filter((row) => row.sceneId !== scene.id),
      ...structuredClone(inverse ? tx.beatsBefore : tx.beatsAfter),
    ];
  return { film, receipt: tx, conflicts: [] as string[] };
}
