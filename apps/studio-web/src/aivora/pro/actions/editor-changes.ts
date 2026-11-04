import type { FilmProject } from "../../film/project";
import { resolveEditorContext, type EditorPage, type EditorSelection } from "./editor-context";

type Collection = "scenes" | "shots" | "characters" | "locations" | "props" | "audioClips";
export type EditorTarget = { collection: "project" } | { collection: Collection; id: string };
export type EditorFieldChange = {
  target: EditorTarget;
  field: string;
  before: { present: boolean; value: unknown };
  after: { present: boolean; value: unknown };
};
export type EditorSuggestion = {
  selection: EditorSelection;
  changes: EditorFieldChange[];
  unsupported: string[];
};
export type EditorReceipt = { selection: EditorSelection; changes: EditorFieldChange[] };

const fields = {
  project: ["title", "styleZh", "stylePreset", "aspectRatio", "sourceText", "narrationVoiceId"],
  scenes: ["title", "where", "text", "ambience", "tags", "source", "userFields"],
  shots: [
    "size",
    "angle",
    "move",
    "seconds",
    "picture",
    "action",
    "performance",
    "performanceSource",
    "styleNote",
    "characters",
    "line",
    "lines",
    "speaker",
    "delivery",
    "sound",
    "tag",
    "blocking",
    "facing",
    "promptZh",
    "promptEn",
    "source",
    "userFields",
    "selectedTakeId",
  ],
  characters: ["name", "identity", "gender", "ageBand", "voiceId", "source", "userFields"],
  locations: ["name", "prompt", "ambience"],
  props: ["name", "note"],
  audioClips: ["startSeconds", "durationSeconds", "offsetSeconds", "gainDb", "label"],
} satisfies Record<string, string[]>;
const pages: Record<EditorPage, readonly (Collection | "project")[]> = {
  script: ["project", "scenes"],
  cast: ["project", "characters", "locations", "props"],
  board: ["shots"],
  edit: ["shots", "audioClips"],
};
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
};
const rows = (film: FilmProject, collection: Collection): Record<string, unknown>[] =>
  film[collection] as unknown as Record<string, unknown>[];
const record = (film: FilmProject, target: EditorTarget): Record<string, unknown> | undefined => {
  if (target.collection === "project") return film as unknown as Record<string, unknown>;
  const found = rows(film, target.collection).filter((row) => row.id === target.id);
  return found.length === 1 ? found[0] : undefined;
};
const value = (row: Record<string, unknown>, field: string) => ({
  present: Object.hasOwn(row, field),
  value: structuredClone(row[field]),
});
const allowed = (selection: EditorSelection, target: EditorTarget, field: string) =>
  pages[selection.page].includes(target.collection) && fields[target.collection].includes(field);

/** Field transactions only. Structural changes are explicit blockers, never silently flattened. */
export function diffEditorSuggestion(
  current: FilmProject,
  proposed: FilmProject,
  selection: EditorSelection,
): EditorSuggestion {
  const result: EditorSuggestion = {
    selection: structuredClone(selection),
    changes: [],
    unsupported: [],
  };
  const context = resolveEditorContext(current, selection);
  if (!context.ok || proposed.id !== current.id) {
    result.unsupported.push(context.ok ? "PROJECT_MISMATCH" : context.code);
    return result;
  }
  // Pin a shot-derived scene too, so moving the shot later invalidates this receipt.
  if (context.context.scene) result.selection.sceneId = context.context.scene.id;
  const compare = (
    target: EditorTarget,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) => {
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const left = value(before, field),
        right = value(after, field);
      if (equal(left, right)) continue;
      if (!allowed(selection, target, field)) {
        result.unsupported.push(
          `${target.collection}:${"id" in target ? target.id : current.id}:${field}`,
        );
        continue;
      }
      result.changes.push({ target, field, before: left, after: right });
    }
  };
  const collections: Collection[] = [
    "scenes",
    "shots",
    "characters",
    "locations",
    "props",
    "audioClips",
  ];
  const currentProject = { ...current } as Record<string, unknown>;
  const proposedProject = { ...proposed } as Record<string, unknown>;
  for (const collection of collections) {
    delete currentProject[collection];
    delete proposedProject[collection];
    const before = rows(current, collection),
      after = rows(proposed, collection);
    const ids = before.map((row) => row.id);
    if (
      !equal(
        ids,
        after.map((row) => row.id),
      ) ||
      new Set(ids).size !== ids.length
    ) {
      result.unsupported.push(`${collection}:STRUCTURE_CHANGED`);
      continue;
    }
    before.forEach((row, index) => {
      const target: EditorTarget = { collection, id: String(row.id) };
      const inSelection =
        collection === "shots"
          ? (!selection.shotId || row.id === selection.shotId) &&
            (!selection.sceneId || row.sceneId === selection.sceneId)
          : collection !== "scenes" || !selection.sceneId || row.id === selection.sceneId;
      if (!inSelection && !equal(row, after[index]))
        result.unsupported.push(`${collection}:${row.id}:OUTSIDE_SELECTION`);
      else compare(target, row, after[index]!);
    });
  }
  compare({ collection: "project" }, currentProject, proposedProject);
  return result;
}

export function applyEditorSuggestion(current: FilmProject, suggestion: EditorSuggestion) {
  if (suggestion.unsupported.length)
    return { film: current, receipt: null, conflicts: suggestion.unsupported };
  return changeFields(current, suggestion, false);
}

/** Compare-and-set inverse: later user edits and new generation assets are preserved. */
export function undoEditorReceipt(current: FilmProject, receipt: EditorReceipt) {
  return changeFields(current, receipt, true);
}

function changeFields(current: FilmProject, transaction: EditorReceipt, inverse: boolean) {
  const context = resolveEditorContext(current, transaction.selection);
  if (!context.ok) return { film: current, receipt: null, conflicts: [context.code] };
  const conflicts: string[] = [];
  const applicable: EditorFieldChange[] = [];
  for (const change of transaction.changes) {
    const row = record(current, change.target);
    const scope = transaction.selection;
    const outsideSelection =
      change.target.collection === "shots"
        ? Boolean(
            (scope.shotId && change.target.id !== scope.shotId) ||
            (scope.sceneId && row?.sceneId !== scope.sceneId),
          )
        : change.target.collection === "scenes" &&
          Boolean(scope.sceneId && change.target.id !== scope.sceneId);
    if (
      !row ||
      outsideSelection ||
      !allowed(transaction.selection, change.target, change.field) ||
      !equal(value(row, change.field), inverse ? change.after : change.before)
    ) {
      conflicts.push(
        `${change.target.collection}:${"id" in change.target ? change.target.id : current.id}:${change.field}`,
      );
    } else applicable.push(change);
  }
  // A proposal applies atomically; an undo may safely restore only untouched fields.
  if ((!inverse && conflicts.length) || !applicable.length)
    return { film: current, receipt: null, conflicts };
  const film = structuredClone(current);
  for (const change of applicable) {
    const row = record(film, change.target)!;
    const next = inverse ? change.before : change.after;
    if (next.present) row[change.field] = structuredClone(next.value);
    else delete row[change.field];
  }
  return {
    film,
    receipt: {
      selection: structuredClone(transaction.selection),
      changes: structuredClone(applicable),
    },
    conflicts,
  };
}

/** Host records only successful applications; each project/page has an independent undo stack. */
export function createPageUndoHistory(limit = 50) {
  const stacks = new Map<string, EditorReceipt[]>();
  const key = (projectId: string, page: EditorPage) => JSON.stringify([projectId, page]);
  return {
    record(receipt: EditorReceipt) {
      const id = key(receipt.selection.projectId, receipt.selection.page);
      stacks.set(
        id,
        [...(stacks.get(id) ?? []), structuredClone(receipt)].slice(-Math.max(1, limit)),
      );
    },
    canUndo(projectId: string, page: EditorPage) {
      return Boolean(stacks.get(key(projectId, page))?.length);
    },
    undo(current: FilmProject, page: EditorPage) {
      const stack = stacks.get(key(current.id, page));
      const receipt = stack?.at(-1);
      if (!receipt) return { film: current, receipt: null, conflicts: ["NOTHING_TO_UNDO"] };
      const result = undoEditorReceipt(current, receipt);
      if (result.receipt) stack!.pop();
      return result;
    },
    clear(projectId: string) {
      for (const page of Object.keys(pages) as EditorPage[]) stacks.delete(key(projectId, page));
    },
  };
}
