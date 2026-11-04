import {
  applyShotDirection,
  undoShotDirection,
  type ShotDirectionTransaction,
} from "./shot-direction-transaction";
import { applyArtTransaction, undoArtTransaction, type ArtTransaction } from "./art-transaction";
import {
  diffEditorStructure,
  applyEditorStructure,
  undoEditorStructure,
  type EditorStructureTransaction,
} from "./editor-structure";
import type { FilmProject } from "../../film/project";
import {
  applyEditorSuggestion,
  diffEditorSuggestion,
  undoEditorReceipt,
  type EditorReceipt,
} from "./editor-changes";
import type { EditorSelection } from "./editor-context";

/** Session-only field history: snapshots are inputs to diff, never restored to the editor. */
type Entry =
  | (EditorReceipt & { protectLocks?: boolean })
  | { blocked: true }
  | { structure: EditorStructureTransaction }
  | { art: ArtTransaction }
  | { direction: ShotDirectionTransaction };
export function createEditorPageHistory() {
  const past = new Map<string, Entry[]>(),
    future = new Map<string, Entry[]>();
  const key = (scope: EditorSelection) => JSON.stringify([scope.projectId, scope.page]);
  function record(before: FilmProject, after: FilmProject, selection: EditorSelection) {
    if (before.id !== after.id || after.id !== selection.projectId) return ["PROJECT_MISMATCH"];
    // A page can contain edits to several selected rows during the debounce interval.
    const scope = { projectId: selection.projectId, page: selection.page };
    const diff = diffEditorSuggestion(before, after, scope);
    const structural = diff.unsupported.filter((item) => item.includes("STRUCTURE_CHANGED"));
    if (structural.length) {
      const collection = structural.length === 1 ? structural[0]!.split(":")[0] : "";
      if (!diff.changes.length && (collection === "shots" || collection === "scenes")) {
        const transaction = diffEditorStructure(before, after, selection, { collection });
        if (!transaction.unsupported.length) {
          past.set(
            key(scope),
            [...(past.get(key(scope)) ?? []), { structure: transaction }].slice(-50),
          );
          future.delete(key(scope));
          return [];
        }
      }
      past.set(key(scope), [...(past.get(key(scope)) ?? []), { blocked: true }]);
      future.delete(key(scope));
      return ["STRUCTURAL_HISTORY_UNSUPPORTED"];
    }
    // Media, queue and derived state are intentionally absent from field receipts.
    if (!diff.changes.length) return [];
    const id = key(scope);
    past.set(id, [...(past.get(id) ?? []), { selection: scope, changes: diff.changes }].slice(-50));
    future.delete(id);
    return [];
  }
  function move(current: FilmProject, scope: EditorSelection, inverse: boolean) {
    if (current.id !== scope.projectId) return { film: current, conflicts: ["PROJECT_MISMATCH"] };
    const from = inverse ? past : future,
      to = inverse ? future : past;
    const id = key(scope),
      stack = from.get(id),
      receipt = stack?.at(-1);
    if (!receipt) return { film: current, conflicts: ["NOTHING_TO_UNDO"] };
    if ("blocked" in receipt)
      return { film: current, conflicts: ["STRUCTURAL_HISTORY_UNSUPPORTED"] };
    if ("direction" in receipt) {
      const result = inverse
        ? undoShotDirection(current, receipt.direction)
        : applyShotDirection(current, receipt.direction);
      if (result.receipt) {
        stack!.pop();
        to.set(id, [...(to.get(id) ?? []), { direction: result.receipt }]);
      }
      return { film: result.film, conflicts: result.conflicts };
    }
    if ("art" in receipt) {
      const result = inverse
        ? undoArtTransaction(current, receipt.art)
        : applyArtTransaction(current, receipt.art);
      if (result.receipt) {
        stack!.pop();
        to.set(id, [...(to.get(id) ?? []), { art: result.receipt }]);
      }
      return { film: result.film, conflicts: result.conflicts };
    }
    if ("structure" in receipt) {
      const result = inverse
        ? undoEditorStructure(current, receipt.structure)
        : applyEditorStructure(current, receipt.structure);
      if (result.receipt) {
        stack!.pop();
        to.set(id, [...(to.get(id) ?? []), { structure: result.receipt }]);
      }
      return { film: result.film, conflicts: result.conflicts };
    }
    if (
      receipt.protectLocks &&
      receipt.changes.some((change) => {
        if (change.target.collection === "project") return false;
        const target = change.target;
        const row = current[target.collection].find((item) => item.id === target.id);
        return row && "userFields" in row && row.userFields?.includes(change.field);
      })
    )
      return { film: current, conflicts: ["FIELD_LOCKED"] };
    const result = inverse
      ? undoEditorReceipt(current, receipt)
      : applyEditorSuggestion(current, { ...receipt, unsupported: [] });
    if (result.receipt) {
      stack!.pop();
      to.set(id, [
        ...(to.get(id) ?? []),
        { ...result.receipt, protectLocks: receipt.protectLocks },
      ]);
    }
    return result;
  }
  return {
    record,
    recordDirection: (direction: ShotDirectionTransaction) => {
      const id = key(direction.selection);
      past.set(id, [...(past.get(id) ?? []), { direction: structuredClone(direction) }].slice(-50));
      future.delete(id);
    },
    recordArt: (art: ArtTransaction) => {
      const id = key(art.selection);
      past.set(id, [...(past.get(id) ?? []), { art: structuredClone(art) }].slice(-50));
      future.delete(id);
    },
    recordReceipt: (receipt: EditorReceipt) => {
      const id = key(receipt.selection);
      past.set(
        id,
        [...(past.get(id) ?? []), { ...structuredClone(receipt), protectLocks: true }].slice(-50),
      );
      future.delete(id);
    },
    undo: (film: FilmProject, scope: EditorSelection) => move(film, scope, true),
    redo: (film: FilmProject, scope: EditorSelection) => move(film, scope, false),
    canUndo: (scope: EditorSelection) => Boolean(past.get(key(scope))?.length),
    canRedo: (scope: EditorSelection) => Boolean(future.get(key(scope))?.length),
    clear: () => {
      past.clear();
      future.clear();
    },
  };
}
