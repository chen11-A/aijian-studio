import type { SuggestionFieldRow } from "../../next/SuggestionFieldDiff";
import type { EditorSelection } from "./editor-context";
import type { EditorFieldChange, EditorSuggestion } from "./editor-changes";

const fields = {
  promptZh: { key: "prompt-zh", label: "中文画面说明" },
  promptEn: { key: "prompt-en", label: "英文画面说明" },
} as const;

/** Text-only projection: a transaction/asset object must never reach a display prop. */
function safeText(value: string) {
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    return false;
  return !(
    /^\s*[{[]/u.test(value) ||
    /(?:https?:|file:|aivora-media:|data:|blob:)/iu.test(value) ||
    /\b[A-Za-z]:[\\/]|\\\\[^\s\\]+\\|(?:^|[\s'"(=:：])\/[^\s，。；]+/u.test(value) ||
    /\bBearer\s+\S+|\bsk[-_][A-Za-z0-9_-]{8,}|(?:authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu.test(
      value,
    ) ||
    /\b(?:film|prj|shot|take|scene|asset)_[A-Za-z0-9_-]{6,}|\b(?:shotId|takeId|projectId|selectedTakeId|videoPath|poster)\s*[:=]/u.test(
      value,
    )
  );
}

function textCell(cell: EditorFieldChange["before"]): { value: string | null } | null {
  if (!cell || typeof cell.present !== "boolean") return null;
  if (!cell.present) return cell.value === undefined ? { value: null } : null;
  return typeof cell.value === "string" && safeText(cell.value) ? { value: cell.value } : null;
}

/** Uses only the stored request diff. An unsupported transaction falls back as a whole. */
export function projectShotPromptFields(
  suggestion: EditorSuggestion | undefined,
  origin: EditorSelection,
): SuggestionFieldRow[] | null {
  if (
    !suggestion ||
    suggestion.unsupported.length ||
    !origin.projectId ||
    !origin.shotId ||
    !["board", "edit"].includes(origin.page)
  )
    return null;
  const scope = suggestion.selection;
  if (
    scope.projectId !== origin.projectId ||
    scope.page !== origin.page ||
    scope.shotId !== origin.shotId ||
    scope.sceneId !== origin.sceneId
  )
    return null;
  const rows = new Map<string, SuggestionFieldRow>();
  for (const change of suggestion.changes) {
    if (
      change.target.collection !== "shots" ||
      change.target.id !== origin.shotId ||
      !Object.hasOwn(fields, change.field) ||
      rows.has(change.field)
    )
      return null;
    const field = fields[change.field as keyof typeof fields];
    const before = textCell(change.before),
      after = textCell(change.after);
    if (!before || !after || before.value === after.value) return null;
    const identities = [origin.projectId, origin.shotId, origin.sceneId].filter(
      (id): id is string => Boolean(id),
    );
    if (
      [before.value, after.value].some(
        (text) =>
          text !== null &&
          identities.some((id) => (id.length >= 4 ? text.includes(id) : text.trim() === id)),
      )
    )
      return null;
    rows.set(change.field, {
      ...field,
      kind: before.value === null ? "added" : after.value === null ? "removed" : "changed",
      before: before.value,
      after: after.value,
    });
  }
  return (Object.keys(fields) as (keyof typeof fields)[]).flatMap((field) => {
    const row = rows.get(field);
    return row ? [row] : [];
  });
}
