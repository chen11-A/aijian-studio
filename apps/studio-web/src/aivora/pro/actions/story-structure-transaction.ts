import { applyScenes } from "../../film/operations";
import { detectDirectorCoverage } from "../../film/director-continuity";
import type { FilmProject, FilmScene, FilmShot } from "../../film/project";
import { applyDirectorPlan } from "../director-workflow";
import {
  applyEditorStructure,
  diffEditorStructure,
  undoEditorStructure,
  type EditorStructureTransaction,
} from "./editor-structure";

type Coverage = { present: boolean; value: FilmScene["coverage"] };
type Beats = NonNullable<FilmProject["unassignedBeats"]>;
export type StoryStructureTransaction = {
  kind: "writer" | "director";
  projectId: string;
  sceneId: string;
  structure: EditorStructureTransaction;
  /** Source evidence is a CAS dependency, not a field patch. */
  sourceBefore: unknown;
  /** Initial manuscript retained verbatim when its placeholder scene is split. */
  sourceAfter?: string;
  coverage?: { before: Coverage; after: Coverage };
  beats?: {
    before: Beats;
    after: Beats;
    beforePresent: boolean;
    afterPresent: boolean;
    beforePositions: number[];
    afterPositions: number[];
  };
  workBefore: unknown;
  workAfter: unknown;
  /** Writer-only, ordered cleanup of obsolete automatic shots before replacing their scenes. */
  shotChanges?: {
    structure: EditorStructureTransaction;
    workBefore: unknown;
    workAfter: unknown;
  }[];
  /** Explicit splitting shifts only subsequent labels, without replacing their live shot content. */
  numbering?: { id: string; before: number; after: number }[];
  sceneNumbering?: { id: string; before: number; after: number }[];
  unsupported: string[];
};
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
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
const coverage = (scene: FilmScene): Coverage => ({
  present: Object.hasOwn(scene, "coverage"),
  value: scene.coverage,
});
const source = (film: FilmProject, kind: StoryStructureTransaction["kind"], sceneId: string) => {
  if (kind === "writer") return film.sourceText;
  const scene = film.scenes.find((row) => row.id === sceneId);
  if (!scene) return null;
  const {
    id,
    title,
    where,
    text,
    paragraphCoverage,
    elements,
    sourceParagraphIds,
    writerSourceText,
    writerParagraphIds,
    userFields,
  } = scene;
  return {
    id,
    title,
    where,
    text,
    paragraphCoverage,
    elements,
    sourceParagraphIds,
    writerSourceText,
    writerParagraphIds,
    userFields,
  };
};
const media = (shot: FilmShot) =>
  Boolean(
    shot.poster ||
    shot.selectedTakeId ||
    shot.takes.length ||
    shot.stills.length ||
    shot.continuityFrame ||
    shot.continuityFromShotId,
  );
const relatedTasks = (film: FilmProject, ids: Set<string>) =>
  (film.productionPipeline?.steps ?? []).flatMap((step) =>
    step.targets
      .filter((target) => ids.has(target.id))
      .map((target) => ({ step: step.id, ...target })),
  );
const shotWork = (film: FilmProject, id: string) => {
  const shot = film.shots.find((item) => item.id === id);
  return Boolean(
    (shot && media(shot)) ||
    film.jobs.some((job) => job.shotId === id) ||
    film.audioClips.some((clip) => clip.shotId === id) ||
    film.shots.some(
      (row) => row.continuityFromShotId === id || row.continuityFrame?.sourceShotId === id,
    ) ||
    relatedTasks(film, new Set([id, ...(shot ? [shot.sceneId] : [])])).length,
  );
};
const sceneWork = (film: FilmProject, id: string) =>
  Boolean(
    film.shots.some((shot) => shot.sceneId === id) ||
    film.unassignedBeats?.some((beat) => beat.sceneId === id) ||
    relatedTasks(film, new Set([id, "script"])).length,
  );
const changedIds = (structure: EditorStructureTransaction) =>
  new Set([...structure.before, ...structure.after].map((row) => row.id));
function workSnapshot(film: FilmProject, structure: EditorStructureTransaction) {
  const ids = changedIds(structure);
  const sceneIds =
    structure.collection === "shots"
      ? new Set([
          ...ids,
          ...(ids.size && structure.selection.sceneId ? [structure.selection.sceneId] : []),
          ...film.shots.filter((shot) => ids.has(shot.id)).map((shot) => shot.sceneId),
        ])
      : new Set([...ids, "script"]);
  return relatedTasks(film, sceneIds);
}

/** Keep validation from the structural editor, but don't CAS untouched rows or their new media. */
function changedRowsOnly(structure: EditorStructureTransaction): EditorStructureTransaction {
  const unchanged = new Set(
    structure.before
      .filter((before) =>
        same(
          before,
          structure.after.find((after) => after.id === before.id),
        ),
      )
      .map((row) => row.id),
  );
  return {
    ...structure,
    before: structure.before.filter((row) => !unchanged.has(row.id)),
    after: structure.after.filter((row) => !unchanged.has(row.id)),
  };
}

function prepare(
  base: FilmProject,
  proposed: FilmProject,
  kind: StoryStructureTransaction["kind"],
  sceneId: string,
): StoryStructureTransaction {
  const collection = kind === "director" ? "shots" : "scenes";
  const structural = diffEditorStructure(
    base,
    { ...base, [collection]: proposed[collection] },
    { projectId: base.id, page: kind === "director" ? "board" : "script", sceneId },
    { collection, ...(kind === "writer" ? { ids: base.scenes.map((scene) => scene.id) } : {}) },
  );
  const structure = changedRowsOnly(structural);
  const tx: StoryStructureTransaction = {
    kind,
    projectId: base.id,
    sceneId,
    structure,
    sourceBefore: source(base, kind, sceneId),
    workBefore: workSnapshot(base, structure),
    workAfter: workSnapshot(proposed, structure),
    unsupported: [...structure.unsupported],
  };
  for (const old of structure.before) {
    if (kind === "director" ? shotWork(base, old.id) : sceneWork(base, old.id))
      tx.unsupported.push(`DEPENDENT_WORK_EXISTS:${old.id}`);
  }
  for (const added of structure.after.filter(
    (row) => !structure.before.some((old) => old.id === row.id),
  )) {
    if (kind === "director" ? shotWork(base, added.id) : sceneWork(base, added.id))
      tx.unsupported.push(`DEPENDENT_WORK_EXISTS:${added.id}`);
  }
  if (kind === "director") {
    const before = base.scenes.find((scene) => scene.id === sceneId);
    const after = proposed.scenes.find((scene) => scene.id === sceneId);
    if (before && after && !same(coverage(before), coverage(after)))
      tx.coverage = { before: coverage(before), after: coverage(after) };
    const beforeBeats = (base.unassignedBeats ?? []).filter((beat) => beat.sceneId === sceneId);
    const afterBeats = (proposed.unassignedBeats ?? []).filter((beat) => beat.sceneId === sceneId);
    if (!same(beforeBeats, afterBeats))
      tx.beats = {
        before: beforeBeats,
        after: afterBeats,
        beforePresent: Object.hasOwn(base, "unassignedBeats"),
        afterPresent: Object.hasOwn(proposed, "unassignedBeats"),
        beforePositions: (base.unassignedBeats ?? []).flatMap((beat, index) =>
          beat.sceneId === sceneId ? [index] : [],
        ),
        afterPositions: (proposed.unassignedBeats ?? []).flatMap((beat, index) =>
          beat.sceneId === sceneId ? [index] : [],
        ),
      };
  }
  return structuredClone(tx);
}

/** Compute once from the request-time baseline. Never rebuild from live state at confirmation. */
export function prepareDirectorTransaction(
  base: FilmProject,
  sceneId: string,
  shots: FilmShot[],
  unassigned: Beats = [],
): StoryStructureTransaction {
  const outside =
    shots.some((shot) => shot.sceneId !== sceneId) ||
    unassigned.some((beat) => beat.sceneId !== sceneId);
  const tx = prepare(
    base,
    outside ? base : applyDirectorPlan(base, shots, sceneId, unassigned),
    "director",
    sceneId,
  );
  if (outside) tx.unsupported.push("OUTSIDE_SCENE_PROPOSAL");
  if (!shots.length) tx.unsupported.push("EMPTY_PROPOSAL");
  return tx;
}
export function prepareWriterTransaction(
  base: FilmProject,
  scenes: FilmScene[],
): StoryStructureTransaction {
  const initial = base.scenes[0];
  const initialManuscript =
    base.scenes.length === 1 &&
    initial?.id === "scene-1" &&
    initial.no === 1 &&
    initial.title === "地点待定 · 时间待定" &&
    initial.source === "user" &&
    !initial.where &&
    !initial.ambience &&
    initial.text.trim().length > 0 &&
    initial.userFields.every((field) => field === "text") &&
    Object.keys(initial).every((key) =>
      ["id", "no", "title", "where", "text", "ambience", "source", "userFields"].includes(key),
    ) &&
    !base.shots.length &&
    !base.jobs.length &&
    !base.audioClips.length &&
    !sceneWork(base, initial.id) &&
    (!base.sourceText || base.sourceText === initial.text);
  // The initial text box is the writer's manuscript input, not an existing authored scene.
  // Keep its exact text in the same receipt, including whitespace omitted by scene splitting.
  let proposed = initialManuscript
    ? { ...base, scenes: scenes.map((scene, index) => ({ ...scene, no: index + 1 })) }
    : applyScenes(base, scenes);
  const sceneNumbering: NonNullable<StoryStructureTransaction["sceneNumbering"]> = [];
  proposed = {
    ...proposed,
    scenes: proposed.scenes.map((scene) => {
      const old = base.scenes.find((row) => row.id === scene.id);
      if (!old || old.no === scene.no || !same(old, { ...scene, no: old.no })) return scene;
      sceneNumbering.push({ id: scene.id, before: old.no, after: scene.no });
      // Keep preserved rows outside the structural CAS; only their labels are being changed.
      return { ...scene, no: old.no };
    }),
  };
  const affected = base.scenes.filter(
    (scene) =>
      !same(
        scene,
        proposed.scenes.find((row) => row.id === scene.id),
      ),
  );
  const unsupported: string[] = [];
  const shotChanges: NonNullable<StoryStructureTransaction["shotChanges"]> = [];
  let cleared = base;
  for (const scene of affected) {
    const next = proposed.scenes.find((row) => row.id === scene.id);
    // State without a replacement is not silently discarded, even if it has no media yet.
    if (
      (!initialManuscript &&
        (scene.userFields.length || (scene.source === "user" && scene.text.trim()))) ||
      (["actionState", "performanceState", "sound"] as const).some(
        (field) => scene[field] !== undefined && !same(scene[field], next?.[field]),
      )
    )
      unsupported.push(`SCENE_STATE_PROTECTED:${scene.id}`);
    const children = cleared.shots.filter((shot) => shot.sceneId === scene.id);
    if (!children.length) continue;
    if (
      children.some(
        (shot) =>
          shot.userFields.length ||
          !["sample", "agent:director", "offline:director"].includes(shot.source) ||
          shotWork(base, shot.id),
      )
    ) {
      unsupported.push(`DEPENDENT_WORK_EXISTS:${scene.id}`);
      continue;
    }
    const after = { ...cleared, shots: cleared.shots.filter((shot) => shot.sceneId !== scene.id) };
    const structure = diffEditorStructure(
      cleared,
      after,
      { projectId: base.id, page: "board", sceneId: scene.id },
      { collection: "shots" },
    );
    unsupported.push(...structure.unsupported);
    shotChanges.push({
      structure,
      workBefore: workSnapshot(cleared, structure),
      workAfter: workSnapshot(after, structure),
    });
    cleared = after;
  }
  const tx = prepare(
    cleared,
    { ...proposed, shots: cleared.shots },
    "writer",
    base.scenes[0]?.id ?? "",
  );
  if (sceneNumbering.length) tx.sceneNumbering = sceneNumbering;
  if (initialManuscript) tx.sourceAfter = initial.text;
  tx.unsupported.push(...unsupported);
  if (shotChanges.length) tx.shotChanges = structuredClone(shotChanges);
  if (!scenes.length) tx.unsupported.push("EMPTY_PROPOSAL");
  return tx;
}

/** An explicit duration split replaces exactly one shot, including a user-edited target.
 * Existing assets/dependencies are checked on base, never on the cleared proposal. */
export function prepareExplicitShotSplitTransaction(
  base: FilmProject,
  targetId: string,
  twoShots: FilmShot[],
): StoryStructureTransaction {
  const matches = base.shots.filter((shot) => shot.id === targetId);
  const target = matches.length === 1 ? matches[0] : undefined;
  const reject = (code: string) => {
    const tx = prepare(base, base, "director", target?.sceneId ?? base.scenes[0]?.id ?? "");
    tx.unsupported.push(code);
    return tx;
  };
  if (!target) return reject("INVALID_SPLIT_TARGET");
  if (
    twoShots.length !== 2 ||
    twoShots[0]!.id !== targetId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(twoShots[1]!.id) ||
    twoShots[1]!.id === targetId ||
    twoShots.some((shot) => shot.sceneId !== target.sceneId)
  )
    return reject("INVALID_SPLIT_PROPOSAL");
  const second = twoShots[1]!;
  const at = base.shots.indexOf(target);
  // Preparing an already-present, identical split is a no-op, not another insertion.
  if (same(target, twoShots[0]) && same(base.shots[at + 1], second))
    return prepare(base, base, "director", target.sceneId);
  if (base.shots.some((shot) => shot.id === second.id)) return reject("SPLIT_ID_COLLISION");
  if (twoShots.some(media)) return reject("SPLIT_PROPOSAL_HAS_ASSETS_OR_CONTINUITY");
  const pair = [
    { ...twoShots[0]!, no: target.no },
    { ...second, no: target.no + 1 },
  ];
  const shots = base.shots.flatMap((shot) => (shot.id === targetId ? pair : [shot]));
  const proposed = {
    ...base,
    shots,
    scenes: base.scenes.map((scene) =>
      scene.id === target.sceneId
        ? { ...scene, coverage: detectDirectorCoverage(scene, shots) }
        : scene,
    ),
  };
  const tx = prepare(base, proposed, "director", target.sceneId);
  tx.numbering = base.shots
    .slice(at + 1)
    .filter((shot) => shot.sceneId === target.sceneId)
    .map((shot) => ({ id: shot.id, before: shot.no, after: shot.no + 1 }));
  return tx;
}
export function applyStoryStructureTransaction(
  current: FilmProject,
  transaction: StoryStructureTransaction,
) {
  return execute(current, transaction, false);
}
export function undoStoryStructureTransaction(
  current: FilmProject,
  receipt: StoryStructureTransaction,
) {
  return execute(current, receipt, true);
}
function execute(current: FilmProject, tx: StoryStructureTransaction, inverse: boolean) {
  const reject = (conflicts: string[]) => ({
    film: current,
    receipt: null,
    conflicts,
    code: "STRUCTURE_CONFLICT" as const,
  });
  if (tx.unsupported.length) return reject([...tx.unsupported]);
  if (current.id !== tx.projectId) return reject(["PROJECT_MISMATCH"]);
  if (
    tx.numbering?.some(
      (change) =>
        current.shots.find((shot) => shot.id === change.id)?.no !==
        (inverse ? change.after : change.before),
    )
  )
    return reject(["SHOT_NUMBER_CHANGED"]);
  if (
    tx.sceneNumbering?.some(
      (change) =>
        current.scenes.find((scene) => scene.id === change.id)?.no !==
        (inverse ? change.after : change.before),
    )
  )
    return reject(["SCENE_NUMBER_CHANGED"]);
  if (
    !same(
      source(current, tx.kind, tx.sceneId),
      inverse ? (tx.sourceAfter ?? tx.sourceBefore) : tx.sourceBefore,
    )
  )
    return reject(["SOURCE_CHANGED"]);
  if (!same(workSnapshot(current, tx.structure), inverse ? tx.workAfter : tx.workBefore))
    return reject(["TASKS_CHANGED"]);
  const scene = current.scenes.find((item) => item.id === tx.sceneId);
  const expectedCoverage = inverse ? tx.coverage?.after : tx.coverage?.before;
  if (expectedCoverage && (!scene || !same(coverage(scene), expectedCoverage)))
    return reject(["COVERAGE_CHANGED"]);
  if (
    tx.beats &&
    !same(
      (current.unassignedBeats ?? []).filter((beat) => beat.sceneId === tx.sceneId),
      inverse ? tx.beats.after : tx.beats.before,
    )
  )
    return reject(["UNASSIGNED_CHANGED"]);
  const noStructure =
    !tx.structure.before.length &&
    !tx.structure.after.length &&
    same(tx.structure.beforeOrder, tx.structure.afterOrder);
  if (
    noStructure &&
    !tx.coverage &&
    !tx.beats &&
    !tx.shotChanges?.length &&
    !tx.sceneNumbering?.length
  )
    return { film: current, receipt: null, conflicts: [] as string[], code: "NO_CHANGES" as const };
  let prepared = current;
  if (!inverse) {
    for (const child of tx.shotChanges ?? []) {
      if (!same(workSnapshot(prepared, child.structure), child.workBefore))
        return reject(["TASKS_CHANGED"]);
      const cleaned = applyEditorStructure(prepared, child.structure);
      if (cleaned.conflicts.length) return reject(cleaned.conflicts);
      prepared = cleaned.film;
    }
  }
  const changed = inverse
    ? undoEditorStructure(prepared, tx.structure)
    : applyEditorStructure(prepared, tx.structure);
  if (changed.conflicts.length) return reject(changed.conflicts);
  let film = changed.film;
  if (tx.sourceAfter !== undefined)
    film = { ...film, sourceText: inverse ? (tx.sourceBefore as string) : tx.sourceAfter };
  if (tx.sceneNumbering?.length) {
    const numbers = new Map(
      tx.sceneNumbering.map((change) => [change.id, inverse ? change.before : change.after]),
    );
    film = {
      ...film,
      scenes: film.scenes.map((scene) =>
        numbers.has(scene.id) ? { ...scene, no: numbers.get(scene.id)! } : scene,
      ),
    };
  }
  if (tx.numbering?.length) {
    const numbers = new Map(
      tx.numbering.map((change) => [change.id, inverse ? change.before : change.after]),
    );
    film = {
      ...film,
      shots: film.shots.map((shot) =>
        numbers.has(shot.id) ? { ...shot, no: numbers.get(shot.id)! } : shot,
      ),
    };
  }
  if (tx.coverage) {
    const replacement = inverse ? tx.coverage.before : tx.coverage.after;
    film = {
      ...film,
      scenes: film.scenes.map((row) => {
        if (row.id !== tx.sceneId) return row;
        const next = { ...row };
        if (replacement.present) next.coverage = structuredClone(replacement.value);
        else delete next.coverage;
        return next;
      }),
    };
  }
  if (tx.beats) {
    const replacement = inverse ? tx.beats.before : tx.beats.after;
    const positions = inverse ? tx.beats.beforePositions : tx.beats.afterPositions;
    const beats = (film.unassignedBeats ?? []).filter((beat) => beat.sceneId !== tx.sceneId);
    replacement.forEach((beat, index) =>
      beats.splice(
        Math.min(positions[index] ?? beats.length, beats.length),
        0,
        structuredClone(beat),
      ),
    );
    film = {
      ...film,
      unassignedBeats: beats,
    };
    if (
      !(inverse ? tx.beats.beforePresent : tx.beats.afterPresent) &&
      !film.unassignedBeats!.length
    )
      delete film.unassignedBeats;
  }
  if (inverse) {
    for (const child of [...(tx.shotChanges ?? [])].reverse()) {
      if (!same(workSnapshot(film, child.structure), child.workAfter))
        return reject(["TASKS_CHANGED"]);
      const restored = undoEditorStructure(film, child.structure);
      if (restored.conflicts.length) return reject(restored.conflicts);
      film = restored.film;
    }
  }
  return {
    film,
    receipt: structuredClone(tx),
    conflicts: [] as string[],
    code: "APPLIED" as const,
  };
}
