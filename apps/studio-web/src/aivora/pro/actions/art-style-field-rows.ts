import type { SuggestionFieldRow } from "../../next/SuggestionFieldDiff";
import type { ArtTransaction } from "./art-transaction";
import type { EditorSelection } from "./editor-context";

function safeText(value: unknown, origin: EditorSelection): value is string {
  if (typeof value !== "string") return false;
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    return false;
  if (
    /^\s*[{[]/u.test(value) ||
    /(?:https?:|file:|aivora-media:|data:|blob:)/iu.test(value) ||
    /\b[A-Za-z]:[\\/]|\\\\[^\s\\]+\\|(?:^|[\s'"(=:：])\/[^\s，。；]+/u.test(value) ||
    /\bBearer\s+\S+|\bsk[-_][A-Za-z0-9_-]{8,}|(?:authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu.test(
      value,
    ) ||
    /\b(?:film|prj|shot|take|scene|asset)_[A-Za-z0-9_-]{6,}|\b(?:shotId|takeId|projectId|selectedTakeId|videoPath|poster|source)\s*[:=]/u.test(
      value,
    )
  )
    return false;
  return ![origin.projectId, origin.sceneId, origin.shotId].some(
    (id) => id && (id.length >= 4 ? value.includes(id) : value.trim() === id),
  );
}

/** Whole-card projection, restricted to a complete style-only art transaction. */
export function projectArtStyleFields(
  transaction: ArtTransaction | undefined,
  origin: EditorSelection,
): SuggestionFieldRow[] | null {
  if (
    !transaction ||
    !origin.projectId ||
    origin.page !== "cast" ||
    transaction.unsupported.length ||
    transaction.additions.length ||
    transaction.recomputeCostumes ||
    transaction.changes.length !== 1
  )
    return null;
  const scope = transaction.selection;
  if (
    scope.projectId !== origin.projectId ||
    scope.page !== origin.page ||
    scope.sceneId !== origin.sceneId ||
    scope.shotId !== origin.shotId
  )
    return null;
  const [change] = transaction.changes;
  if (
    !change ||
    change.target.collection !== "project" ||
    change.field !== "styleZh" ||
    !change.before.present ||
    !change.after.present ||
    !safeText(change.before.value, origin) ||
    !safeText(change.after.value, origin) ||
    change.before.value === change.after.value
  )
    return null;
  return [
    {
      key: "art-style",
      label: "画风说明",
      kind: "changed",
      before: change.before.value,
      after: change.after.value,
    },
  ];
}
