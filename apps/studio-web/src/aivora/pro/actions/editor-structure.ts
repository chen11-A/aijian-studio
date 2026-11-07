import { withoutGeneratedContinuity } from "../../film/continuity-rules";
import type { FilmProject, FilmScene, FilmShot } from "../../film/project";
import { resolveEditorContext, type EditorSelection } from "./editor-context";

type Collection = "scenes" | "shots";
type Row = FilmScene | FilmShot;
export type EditorStructureScope = {
  collection: Collection;
  /** Explicitly reviewed IDs. Scenes default to the selected scene; shots to the selected shot/scene. */
  ids?: readonly string[];
};
export type EditorStructureTransaction = {
  selection: EditorSelection;
  collection: Collection;
  beforeOrder: string[];
  afterOrder: string[];
  before: Row[];
  after: Row[];
  unsupported: string[];
  dependenciesAtReview: Record<string, unknown>;
  dependenciesAfter: Record<string, unknown>;
  /**
   * 5-3: the user's own change to one scene's shots (diffUserShotEdit). Its rows are kept whole,
   * so shots with pictures or videos may be taken out and put back; files stay on disk.
   */
  userEdit?: boolean;
  /** 5-3-03: what the change was, for 「已撤销：…」. */
  label?: string;
};
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
};
const ids = (rows: readonly Row[]) => rows.map((row) => row.id);
const unique = (values: readonly string[]) =>
  values.every((id) => typeof id === "string" && id.length > 0) &&
  new Set(values).size === values.length;
const media = (shot: FilmShot) =>
  Boolean(
    shot.poster ||
    shot.selectedTakeId ||
    shot.stills.length ||
    shot.takes.length ||
    shot.continuityFrame,
  );
const dependencies = (film: FilmProject, collection: Collection, id: string) =>
  collection === "scenes"
    ? film.shots.some((shot) => shot.sceneId === id) ||
      (film.unassignedBeats ?? []).some((beat) => beat.sceneId === id)
    : film.jobs.some((job) => job.shotId === id) ||
      film.audioClips.some((clip) => clip.shotId === id) ||
      film.shots.some(
        (shot) => shot.continuityFromShotId === id || shot.continuityFrame?.sourceShotId === id,
      );
const dependencySnapshot = (film: FilmProject, collection: Collection, id: string) =>
  collection === "scenes"
    ? {
        shots: film.shots.filter((shot) => shot.sceneId === id),
        beats: (film.unassignedBeats ?? []).filter((beat) => beat.sceneId === id),
      }
    : {
        jobs: film.jobs.filter((job) => job.shotId === id),
        clips: film.audioClips.filter((clip) => clip.shotId === id),
        continuations: film.shots.filter(
          (shot) => shot.continuityFromShotId === id || shot.continuityFrame?.sourceShotId === id,
        ),
      };
const protectedShotFields = [
  "takes",
  "stills",
  "poster",
  "posterPosition",
  "selectedTakeId",
  "continuityFrame",
] as const;

/** Only the explicitly reviewed contiguous segment can change; unrelated objects stay live. */
export function diffEditorStructure(
  current: FilmProject,
  proposed: FilmProject,
  selection: EditorSelection,
  scope: EditorStructureScope,
): EditorStructureTransaction {
  const result: EditorStructureTransaction = {
    selection: structuredClone(selection),
    collection: scope.collection,
    beforeOrder: ids(current[scope.collection]),
    afterOrder: ids(proposed[scope.collection]),
    before: [],
    after: [],
    unsupported: [],
    dependenciesAtReview: {},
    dependenciesAfter: {},
  };
  const reject = (code: string) => {
    result.unsupported.push(code);
    return result;
  };
  const context = resolveEditorContext(current, selection);
  if (!context.ok) return reject(context.code);
  if (current.id !== proposed.id) return reject("PROJECT_MISMATCH");
  const sceneId = context.context.scene?.id;
  if (!sceneId) return reject("SELECTION_REQUIRED");
  result.selection.sceneId = sceneId;
  if (
    scope.collection === "scenes"
      ? selection.page !== "script" || Boolean(selection.shotId)
      : !["script", "board"].includes(selection.page)
  )
    return reject("PAGE_SCOPE_MISMATCH");
  const before = current[scope.collection];
  const after = proposed[scope.collection];
  if (!unique(result.beforeOrder) || !unique(result.afterOrder))
    return reject("DUPLICATE_OR_EMPTY_ID");
  const selected = scope.ids
    ? [...scope.ids]
    : scope.collection === "scenes"
      ? [sceneId]
      : selection.shotId
        ? [selection.shotId]
        : current.shots.filter((shot) => shot.sceneId === sceneId).map((shot) => shot.id);
  if (!unique(selected) || selected.some((id) => !result.beforeOrder.includes(id)))
    return reject("INVALID_SCOPE_IDS");
  if (scope.collection === "scenes" && !selected.includes(sceneId))
    return reject("SELECTION_MISMATCH");
  if (
    scope.collection === "shots" &&
    selected.some(
      (id) =>
        current.shots.find((shot) => shot.id === id)?.sceneId !== sceneId ||
        (selection.shotId && id !== selection.shotId),
    )
  )
    return reject("SELECTION_MISMATCH");
  const positions = selected.map((id) => result.beforeOrder.indexOf(id));
  let start: number, end: number;
  if (!selected.length) {
    if (
      scope.collection !== "shots" ||
      scope.ids ||
      selection.shotId ||
      current.shots.some((shot) => shot.sceneId === sceneId)
    )
      return reject("INVALID_SCOPE_IDS");
    const sceneIndex = current.scenes.findIndex((scene) => scene.id === sceneId);
    const next = current.shots.findIndex(
      (shot) => current.scenes.findIndex((scene) => scene.id === shot.sceneId) > sceneIndex,
    );
    start = next < 0 ? current.shots.length : next;
    end = start - 1;
  } else {
    start = Math.min(...positions);
    end = Math.max(...positions);
    if (end - start + 1 !== selected.length) return reject("NONCONTIGUOUS_SCOPE");
  }
  const prefix = result.beforeOrder.slice(0, start),
    suffix = result.beforeOrder.slice(end + 1);
  if (
    after.length < prefix.length + suffix.length ||
    !same(ids(after.slice(0, prefix.length)), prefix) ||
    !same(ids(after.slice(after.length - suffix.length)), suffix)
  )
    return reject("OUTSIDE_SCOPE_STRUCTURE");
  const replacement = after.slice(prefix.length, after.length - suffix.length);
  for (const row of before.filter((row) => !selected.includes(row.id))) {
    if (
      !same(
        row,
        after.find((item) => item.id === row.id),
      )
    )
      return reject("OUTSIDE_SCOPE_EDIT");
  }
  const beforeRest = { ...current } as Record<string, unknown>,
    afterRest = { ...proposed } as Record<string, unknown>;
  delete beforeRest[scope.collection];
  delete afterRest[scope.collection];
  if (!same(beforeRest, afterRest)) return reject("OTHER_COLLECTION_CHANGED");
  result.before = structuredClone(before.slice(start, end + 1));
  result.after = structuredClone(replacement);
  for (const row of result.before) {
    if (
      !replacement.some((item) => item.id === row.id) &&
      ((scope.collection === "shots" && media(row as FilmShot)) ||
        dependencies(current, scope.collection, row.id))
    )
      return reject("DEPENDENT_WORK_EXISTS");
  }
  for (const row of replacement) {
    if (scope.collection === "shots") {
      const shot = row as FilmShot;
      if (shot.sceneId !== sceneId) return reject("SELECTION_MISMATCH");
      if (shot.continuityFromShotId) {
        const previous = proposed.shots.find((item) => item.id === shot.continuityFromShotId);
        if (
          !previous ||
          previous.sceneId !== sceneId ||
          proposed.shots.indexOf(previous) >= proposed.shots.indexOf(shot)
        )
          return reject("INVALID_CONTINUITY_REFERENCE");
      }
      const old = current.shots.find((item) => item.id === row.id);
      if (!old && (media(shot) || dependencies(current, "shots", row.id)))
        return reject("NEW_SHOT_HAS_ASSETS_OR_DEPENDENCIES");
      if (old && protectedShotFields.some((field) => !same(old[field], shot[field])))
        return reject("MEDIA_REPLACEMENT_UNSUPPORTED");
    }
  }
  for (const id of new Set([...ids(result.before), ...ids(result.after)])) {
    result.dependenciesAtReview[id] = structuredClone(
      dependencySnapshot(current, scope.collection, id),
    );
    result.dependenciesAfter[id] = structuredClone(
      dependencySnapshot(proposed, scope.collection, id),
    );
  }
  return result;
}

/**
 * 5-3: the user's own change to the selected scene's shots as one undoable step — a dragged
 * card (moveShotTo), several cards deleted, a cut on the edit page, a shot with pictures or
 * videos deleted. Unlike a suggestion it covers the whole scene and keeps media: removeShot only
 * takes the shot out of the film, so the takes it held still point at files on disk. Anything
 * outside that scene's shots must be unchanged, apart from the continuity notes setFilm derives.
 */
export function diffUserShotEdit(
  current: FilmProject,
  proposed: FilmProject,
  selection: EditorSelection,
): EditorStructureTransaction {
  const result: EditorStructureTransaction = {
    selection: structuredClone(selection),
    collection: "shots",
    beforeOrder: ids(current.shots),
    afterOrder: ids(proposed.shots),
    before: [],
    after: [],
    unsupported: [],
    dependenciesAtReview: {},
    dependenciesAfter: {},
    userEdit: true,
  };
  const reject = (code: string) => {
    result.unsupported.push(code);
    return result;
  };
  if (current.id !== proposed.id) return reject("PROJECT_MISMATCH");
  if (!["script", "board", "edit"].includes(selection.page)) return reject("PAGE_SCOPE_MISMATCH");
  const context = resolveEditorContext(current, selection);
  if (!context.ok) return reject(context.code);
  const sceneId = context.context.scene?.id;
  if (!sceneId) return reject("SELECTION_REQUIRED");
  // The shot may be gone afterwards; the scene is the scope.
  result.selection = { projectId: selection.projectId, page: selection.page, sceneId };
  if (!unique(result.beforeOrder) || !unique(result.afterOrder))
    return reject("DUPLICATE_OR_EMPTY_ID");
  const positions = current.shots.flatMap((shot, index) =>
    shot.sceneId === sceneId ? [index] : [],
  );
  if (!positions.length) return reject("INVALID_SCOPE_IDS");
  const start = positions[0]!,
    end = positions.at(-1)!;
  if (end - start + 1 !== positions.length) return reject("NONCONTIGUOUS_SCOPE");
  const prefix = result.beforeOrder.slice(0, start),
    suffix = result.beforeOrder.slice(end + 1);
  if (
    proposed.shots.length < prefix.length + suffix.length ||
    !same(ids(proposed.shots.slice(0, prefix.length)), prefix) ||
    !same(ids(proposed.shots.slice(proposed.shots.length - suffix.length)), suffix)
  )
    return reject("OUTSIDE_SCOPE_STRUCTURE");
  const replacement = proposed.shots.slice(prefix.length, proposed.shots.length - suffix.length);
  if (replacement.some((shot) => shot.sceneId !== sceneId)) return reject("SELECTION_MISMATCH");
  for (const row of current.shots.filter((shot) => shot.sceneId !== sceneId)) {
    const after = proposed.shots.find((item) => item.id === row.id);
    if (!after || !same(withoutGeneratedContinuity(row), withoutGeneratedContinuity(after)))
      return reject("OUTSIDE_SCOPE_EDIT");
  }
  const beforeRest = { ...current } as Record<string, unknown>,
    afterRest = { ...proposed } as Record<string, unknown>;
  delete beforeRest.shots;
  delete afterRest.shots;
  // A native reassembly can complete while a user's cut is waiting for its history
  // checkpoint. These are derived playback references, not another creative edit.
  // The inverse still replaces only shots and keeps the current references; the
  // assembly render key must validate/rebuild the clock for the restored selection.
  for (const field of ["assemblyPath", "assemblyUrl"] as const) {
    delete beforeRest[field];
    delete afterRest[field];
  }
  if (!same(beforeRest, afterRest)) return reject("OTHER_COLLECTION_CHANGED");
  const segment = current.shots.slice(start, end + 1);
  for (const shot of replacement) {
    const old = segment.find((item) => item.id === shot.id);
    // A new shot here is not a deletion or a move; and pictures arriving meanwhile are not ours.
    if (!old) return reject("NEW_SHOT_HAS_ASSETS_OR_DEPENDENCIES");
    if (protectedShotFields.some((field) => !same(old[field], shot[field])))
      return reject("MEDIA_REPLACEMENT_UNSUPPORTED");
  }
  if (same(ids(segment), ids(replacement))) return reject("NO_CHANGES");
  result.before = structuredClone(segment);
  result.after = structuredClone(replacement);
  result.label = userShotEditLabel(segment, replacement, selection.page);
  for (const id of ids(segment)) {
    result.dependenciesAtReview[id] = structuredClone(dependencySnapshot(current, "shots", id));
    result.dependenciesAfter[id] = structuredClone(dependencySnapshot(proposed, "shots", id));
  }
  return result;
}

function userShotEditLabel(before: FilmShot[], after: FilmShot[], page: string): string {
  const removed = before.filter((shot) => !after.some((item) => item.id === shot.id));
  if (removed.length === 1) return `${page === "edit" ? "剪掉" : "删掉"}镜头 ${removed[0]!.no}`;
  if (removed.length > 1) return `${page === "edit" ? "剪掉" : "删掉"} ${removed.length} 个镜头`;
  const order = ids(after);
  const index = ids(before).findIndex((id, position) => id !== order[position]);
  const without = (list: string[], id: string) => list.filter((item) => item !== id);
  for (const candidate of [before[index], after[index]])
    if (candidate && same(without(ids(before), candidate.id), without(order, candidate.id)))
      return `挪动镜头 ${before.find((shot) => shot.id === candidate.id)?.no ?? candidate.no}`;
  return "调整镜头顺序";
}

export function applyEditorStructure(
  current: FilmProject,
  transaction: EditorStructureTransaction,
) {
  return execute(current, transaction, false);
}
export function undoEditorStructure(current: FilmProject, receipt: EditorStructureTransaction) {
  return execute(current, receipt, true);
}
function execute(current: FilmProject, transaction: EditorStructureTransaction, inverse: boolean) {
  const reject = (code: string) => ({ film: current, receipt: null, conflicts: [code] });
  if (transaction.unsupported.length)
    return { film: current, receipt: null, conflicts: [...transaction.unsupported] };
  if (current.id !== transaction.selection.projectId) return reject("PROJECT_MISMATCH");
  const { collection } = transaction;
  const expectedOrder = inverse ? transaction.afterOrder : transaction.beforeOrder;
  const targetOrder = inverse ? transaction.beforeOrder : transaction.afterOrder;
  const expected = inverse ? transaction.after : transaction.before;
  const replacement = inverse ? transaction.before : transaction.after;
  if (
    !unique(expectedOrder) ||
    !unique(targetOrder) ||
    !same(ids(current[collection]), expectedOrder)
  )
    return reject("STRUCTURE_STALE");
  const dependenciesExpected = inverse
    ? transaction.dependenciesAfter
    : transaction.dependenciesAtReview;
  for (const id of new Set([...ids(expected), ...ids(replacement)]))
    if (
      !Object.hasOwn(dependenciesExpected, id) ||
      !same(dependencySnapshot(current, collection, id), dependenciesExpected[id])
    )
      return reject("DEPENDENCIES_CHANGED");
  for (const row of expected) {
    const live = current[collection].find((item) => item.id === row.id);
    // 3JR-B01: the continuity notes setFilm derives after every change are not an edit, so
    // they do not block taking back a placement the director just made.
    const unchanged =
      collection === "shots"
        ? same(
            live && withoutGeneratedContinuity(live as FilmShot),
            withoutGeneratedContinuity(row as FilmShot),
          )
        : same(live, row);
    if (!unchanged) return reject("TARGET_EDITED");
    const next = replacement.find((item) => item.id === row.id);
    if (
      !next &&
      !transaction.userEdit &&
      ((collection === "shots" && media(live as FilmShot)) ||
        dependencies(current, collection, row.id))
    )
      return reject("DEPENDENT_WORK_EXISTS");
    if (
      collection === "shots" &&
      next &&
      protectedShotFields.some(
        (field) => !same((live as FilmShot)[field], (next as FilmShot)[field]),
      )
    )
      return reject("MEDIA_REPLACEMENT_UNSUPPORTED");
  }
  // Re-check dependencies of resurrected/new IDs: orphan work created meanwhile must not attach
  // silently. A user's own deletion puts its shot back whole; DEPENDENCIES_CHANGED above has
  // already checked that what pointed at it is exactly what pointed at it before.
  if (!transaction.userEdit)
    for (const row of replacement.filter((row) => !expected.some((item) => item.id === row.id)))
      if (
        dependencies(current, collection, row.id) ||
        (collection === "shots" && media(row as FilmShot))
      )
        return reject("DEPENDENT_WORK_EXISTS");
  const fresh = new Map(replacement.map((row) => [row.id, row]));
  const live = new Map(current[collection].map((row) => [row.id, row]));
  const records = targetOrder.map((id) => fresh.get(id) ?? live.get(id));
  if (records.some((row) => !row)) return reject("INVALID_TARGET_ORDER");
  const film = { ...current, [collection]: structuredClone(records) } as FilmProject;
  return { film, receipt: structuredClone(transaction), conflicts: [] as string[] };
}
