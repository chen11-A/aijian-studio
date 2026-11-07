import {
  applyStoryConfirmation,
  undoStoryConfirmation,
  type StoryConfirmation,
} from "./story-confirmation";
import {
  applyShotDirection,
  undoShotDirection,
  type ShotDirectionTransaction,
} from "./shot-direction-transaction";
import { applyArtTransaction, undoArtTransaction, type ArtTransaction } from "./art-transaction";
import {
  diffEditorStructure,
  diffUserShotEdit,
  applyEditorStructure,
  undoEditorStructure,
  type EditorStructureTransaction,
} from "./editor-structure";
import type { FilmProject } from "../../film/project";
import {
  applyEditorSuggestion,
  diffEditorSuggestion,
  undoEditorReceipt,
  type EditorFieldChange,
  type EditorReceipt,
} from "./editor-changes";
import type { EditorSelection } from "./editor-context";

const fieldLabels: Record<string, string> = {
  title: "名称",
  styleZh: "画风",
  stylePreset: "画风",
  aspectRatio: "画面比例",
  sourceText: "原文",
  narrationVoiceId: "旁白声音",
  where: "地点",
  text: "剧本",
  ambience: "环境声音",
  tags: "标签",
  size: "景别",
  angle: "角度",
  move: "运镜",
  seconds: "时长",
  picture: "画面",
  action: "动作",
  actionBeats: "动作",
  actionPlan: "动作",
  performance: "表演",
  performancePlan: "表演",
  performanceSource: "表演",
  styleNote: "画风",
  characters: "人物",
  line: "台词",
  lines: "台词",
  speaker: "说话人",
  delivery: "语气",
  sound: "声音",
  tag: "标签",
  blocking: "站位",
  facing: "朝向",
  promptZh: "画面说明",
  promptEn: "画面说明",
  reviewedVideoPrompt: "视频说明",
  selectedTakeId: "所选版本",
  name: "名称",
  identity: "介绍",
  gender: "性别",
  ageBand: "年龄段",
  voiceId: "声音",
  prompt: "环境描述",
  note: "描述",
  startSeconds: "位置",
  durationSeconds: "时长",
  offsetSeconds: "起点",
  gainDb: "音量",
  label: "名称",
  source: "来源说明",
  userFields: "编辑保护",
};

/** Describe the fields actually changed, including the successful subset of a partial undo. */
function fieldHistoryLabel(film: FilmProject, changes: EditorFieldChange[]) {
  const content = changes.filter((change) => !["source", "userFields"].includes(change.field));
  const relevant = content.length ? content : changes;
  const targets = new Set(
    relevant.map(({ target }) =>
      JSON.stringify([target.collection, target.collection === "project" ? null : target.id]),
    ),
  );
  const first = relevant[0]!;
  const collection = first.target.collection;
  if (relevant.some((change) => change.target.collection !== collection)) return "修改多项内容";
  const names = [...new Set(relevant.map((change) => fieldLabels[change.field] ?? "内容"))];
  const detail = names.length === 1 ? names[0]! : "多项内容";
  if (collection === "project") return `修改作品${detail}`;
  const kinds = {
    scenes: "场次",
    shots: "镜头",
    characters: "人物",
    locations: "场景",
    props: "道具",
    audioClips: "声音片段",
  };
  const kind = kinds[collection];
  if (targets.size > 1) return `修改 ${targets.size} 个${kind}的${detail}`;
  const target = first.target;
  if (target.collection === "shots") {
    const shot = film.shots.find((item) => item.id === target.id);
    if (shot) return `修改镜头 ${shot.no} 的${detail}`;
  }
  return `修改${kind}的${detail}`;
}

/** Session-only field history: snapshots are inputs to diff, never restored to the editor. */
type Entry =
  | (EditorReceipt & { protectLocks?: boolean })
  | { blocked: true }
  | { structure: EditorStructureTransaction }
  | { art: ArtTransaction }
  | { direction: ShotDirectionTransaction; directionToken: string }
  | { story: StoryConfirmation };
export function createEditorPageHistory() {
  let directionSerial = 0;
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
        let transaction = diffEditorStructure(before, after, selection, { collection });
        // 5-3: a drag, a multi-delete, a cut or a deleted shot with pictures, in one scene.
        if (transaction.unsupported.length && collection === "shots") {
          const own = diffUserShotEdit(before, after, selection);
          if (!own.unsupported.length) transaction = own;
        }
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
    if ("story" in receipt) {
      const result = inverse
        ? undoStoryConfirmation(current, receipt.story)
        : applyStoryConfirmation(current, receipt.story);
      if (result.receipt) {
        stack!.pop();
        to.set(id, [...(to.get(id) ?? []), { story: result.receipt }]);
      }
      return { film: result.film, conflicts: result.conflicts };
    }
    if ("direction" in receipt) {
      const result = inverse
        ? undoShotDirection(current, receipt.direction)
        : applyShotDirection(current, receipt.direction);
      if (result.receipt) {
        stack!.pop();
        to.set(id, [
          ...(to.get(id) ?? []),
          { direction: result.receipt, directionToken: receipt.directionToken },
        ]);
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
      // 5-3-03: what was taken back or put again, for the status line.
      return {
        film: result.film,
        conflicts: result.conflicts,
        ...(result.receipt && receipt.structure.label ? { label: receipt.structure.label } : {}),
      };
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
    return {
      ...result,
      ...(result.receipt ? { label: fieldHistoryLabel(current, result.receipt.changes) } : {}),
    };
  }
  const sameSelection = (a: EditorSelection, b: EditorSelection) =>
    a.projectId === b.projectId &&
    a.page === b.page &&
    a.sceneId === b.sceneId &&
    a.shotId === b.shotId;
  function directionEntry(scope: EditorSelection, token: string) {
    if (!token || typeof token !== "string") return null;
    const id = key(scope);
    const entries = [past, future].flatMap((map, side) =>
      (map.get(id) ?? []).flatMap((entry, index) =>
        "direction" in entry && entry.directionToken === token ? [{ entry, index, side }] : [],
      ),
    );
    if (entries.length !== 1 || !sameSelection(entries[0]!.entry.direction.selection, scope))
      return null;
    return entries[0]!;
  }
  function directionReceiptState(scope: EditorSelection, token: string) {
    const found = directionEntry(scope, token);
    return !found
      ? ("missing" as const)
      : found.side === 0
        ? ("applied" as const)
        : ("undone" as const);
  }
  function undoDirectionReceipt(current: FilmProject, scope: EditorSelection, token: string) {
    const reject = (code: string) => ({ film: current, receipt: null, conflicts: [code] });
    if (current.id !== scope.projectId) return reject("PROJECT_MISMATCH");
    const found = directionEntry(scope, token);
    if (!found || found.side !== 0) return reject("DIRECTION_RECEIPT_MISSING");
    const result = undoShotDirection(current, found.entry.direction);
    if (!result.receipt) return result;
    past.get(key(scope))!.splice(found.index, 1);
    future.set(key(scope), [
      ...(future.get(key(scope)) ?? []),
      { direction: result.receipt, directionToken: token },
    ]);
    return result;
  }
  return {
    record,
    directionReceiptState,
    undoDirectionReceipt,
    recordStory: (story: StoryConfirmation, origin: EditorSelection) => {
      const id = key(origin);
      past.set(id, [...(past.get(id) ?? []), { story: structuredClone(story) }].slice(-50));
      future.delete(id);
    },
    recordDirection: (direction: ShotDirectionTransaction) => {
      const id = key(direction.selection);
      const directionToken = `direction-receipt-${++directionSerial}`;
      past.set(
        id,
        [...(past.get(id) ?? []), { direction: structuredClone(direction), directionToken }].slice(
          -50,
        ),
      );
      future.delete(id);
      return directionToken;
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
