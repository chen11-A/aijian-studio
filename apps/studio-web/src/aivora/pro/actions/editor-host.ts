import type { FilmProject } from "../../film/project";
import { resolveEditorContext, type EditorSelection } from "./editor-context";
import {
  applyEditorSuggestion,
  diffEditorSuggestion,
  undoEditorReceipt,
  type EditorReceipt,
  type EditorSuggestion,
} from "./editor-changes";

type Request = { id: number; base: FilmProject; selection: EditorSelection };
type Draft = { request: Request; suggestion: EditorSuggestion };
export type EditorHostResult = {
  status: "saved" | "applied_unsaved" | "rejected";
  conflicts: string[];
};
const scopeKey = (scope: EditorSelection) =>
  JSON.stringify([scope.projectId, scope.page, scope.sceneId ?? null, scope.shotId ?? null]);
const pageKey = (scope: EditorSelection) => JSON.stringify([scope.projectId, scope.page]);

/** Session-only coordinator. Saving must use the host's existing persistence queue/lease. */
export function createEditorHost(host: {
  current: () => FilmProject | null;
  selection: () => EditorSelection;
  applyLive: (film: FilmProject) => void;
  /** Return false/null when an owner defers the write; throw on disk failure. */
  save: (film: FilmProject) => Promise<unknown>;
  applied?: (receipt: EditorReceipt) => void;
}) {
  let serial = 0;
  let busy = false;
  const requests = new Map<string, number>();
  const drafts = new Map<number, Draft>();
  const history = new Map<string, EditorReceipt[]>();
  const reject = (...conflicts: string[]): EditorHostResult => ({ status: "rejected", conflicts });
  function capture(): Request | null {
    const base = host.current();
    const selection = structuredClone(host.selection());
    if (!base || !resolveEditorContext(base, selection).ok) return null;
    // Board/edit operations require an actual selected scene or shot.
    if (
      (selection.page === "board" || selection.page === "edit") &&
      !selection.sceneId &&
      !selection.shotId
    )
      return null;
    const request = { id: ++serial, base: structuredClone(base), selection };
    requests.set(scopeKey(selection), request.id);
    return request;
  }
  function preview(request: Request, proposed: FilmProject): EditorSuggestion | null {
    if (requests.get(scopeKey(request.selection)) !== request.id) return null;
    const suggestion = diffEditorSuggestion(request.base, proposed, request.selection);
    if (suggestion.changes.some((change) => change.field === "userFields"))
      suggestion.unsupported.push("LOCK_METADATA_CHANGED");
    drafts.set(request.id, { request: structuredClone(request), suggestion });
    return structuredClone(suggestion);
  }
  function locked(current: FilmProject, receipt: EditorReceipt): string[] {
    return receipt.changes.flatMap(({ target, field }) => {
      if (target.collection === "project") return [];
      const row = current[target.collection].find((item) => item.id === target.id);
      const locks = row && "userFields" in row ? row.userFields : [];
      const family =
        field === "actionPlan" ? "action" : field === "performancePlan" ? "performance" : field;
      const coupled =
        field === "action" ? "actionPlan" : field === "performance" ? "performancePlan" : field;
      return Array.isArray(locks) &&
        (locks.includes(field) || locks.includes(family) || locks.includes(coupled))
        ? [`LOCKED:${target.collection}:${target.id}:${field}`]
        : [];
    });
  }
  async function persist(film: FilmProject, conflicts: string[]): Promise<EditorHostResult> {
    try {
      const stored = await host.save(film);
      if (stored === null || stored === false)
        return { status: "applied_unsaved", conflicts: [...conflicts, "SAVE_DEFERRED"] };
      return { status: "saved", conflicts };
    } catch {
      return { status: "applied_unsaved", conflicts: [...conflicts, "SAVE_FAILED"] };
    }
  }
  async function apply(id: number): Promise<EditorHostResult> {
    if (busy) return reject("BUSY");
    const draft = drafts.get(id),
      current = host.current();
    if (!draft || !current) return reject("SUGGESTION_MISSING");
    const scope = draft.request.selection;
    if (scopeKey(scope) !== scopeKey(host.selection()) || current.id !== scope.projectId)
      return reject("SELECTION_MISMATCH");
    if (requests.get(scopeKey(scope)) !== id) return reject("REQUEST_STALE");
    const locks = locked(current, draft.suggestion);
    if (locks.length) return reject(...locks);
    const result = applyEditorSuggestion(current, draft.suggestion);
    if (!result.receipt)
      return reject(...result.conflicts, ...(result.conflicts.length ? [] : ["NO_CHANGES"]));
    busy = true;
    try {
      host.applyLive(result.film);
      const key = pageKey(scope);
      history.set(key, [...(history.get(key) ?? []), result.receipt].slice(-50));
      drafts.delete(id);
      host.applied?.(structuredClone(result.receipt));
      return await persist(result.film, result.conflicts);
    } finally {
      busy = false;
    }
  }
  function canUndo() {
    return Boolean(history.get(pageKey(host.selection()))?.length);
  }
  async function undo(): Promise<EditorHostResult> {
    if (busy) return reject("BUSY");
    const current = host.current(),
      scope = host.selection();
    if (!current || current.id !== scope.projectId) return reject("PROJECT_MISMATCH");
    const stack = history.get(pageKey(scope)),
      receipt = stack?.at(-1);
    if (!receipt) return reject("NOTHING_TO_UNDO");
    const locks = locked(current, receipt);
    if (locks.length) return reject(...locks);
    const result = undoEditorReceipt(current, receipt);
    if (!result.receipt) return reject(...result.conflicts);
    busy = true;
    try {
      host.applyLive(result.film);
      stack!.pop();
      return await persist(result.film, result.conflicts);
    } finally {
      busy = false;
    }
  }
  return { capture, preview, apply, undo, canUndo };
}
