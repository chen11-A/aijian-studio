import type { DialogueSplitSource } from "./film-dialogue-split.js";
export type DialogueSplitLine = { speaker: string; text: string };
export type DialogueSplitInput = {
  lines: DialogueSplitLine[];
  maxVideoSeconds: 10 | 15;
  versions: number;
};
export type DialogueSplitPart = {
  sourceLineIndex: number;
  /** UTF-16 indices into the exact corresponding sourceLines text. */
  startOffset: number;
  endOffset: number;
  speaker: string;
  text: string;
  estimatedSeconds: number;
};
export type DialogueSplitUnsupportedCode =
  | "INVALID_INPUT"
  | "NO_DIALOGUE"
  | "WITHIN_CAP"
  | "NO_SAFE_SENTENCE_BOUNDARY"
  | "PLAN_LIMIT"
  | "SEGMENTER_UNAVAILABLE"
  | "INPUT_CHANGED"
  | "FINGERPRINT_UNAVAILABLE";
export type DialogueSplitPlan =
  | {
      kind: "READY";
      timing: "estimate";
      requiresSplit: true;
      sourceLines: DialogueSplitLine[];
      modelCapSeconds: 10 | 15;
      versions: number;
      estimatedOriginalSeconds: number;
      headSeconds: number;
      tailSeconds: number;
      parts: DialogueSplitPart[];
      newShotCount: number;
      videoCount: number;
      limitations: string[];
    }
  | { kind: "UNSUPPORTED"; code: DialogueSplitUnsupportedCode; sourceLineIndex?: number };

export const LINE_HEAD_SECONDS: 0.4;
export const LINE_TAIL_SECONDS: 0.6;
export function speechSeconds(line: string, measured: number | null): number;
export function canonicalDialogueLines(shot: {
  line: string;
  speaker?: string;
  lines?: DialogueSplitLine[];
}): DialogueSplitLine[];
export function dialogueVideoCap(model: string, hasReferences: boolean): 10 | 15 | null;
export function planDialogueSplit(value: unknown): DialogueSplitPlan;
export function dialogueSplitContext(
  record: unknown,
  shotId: string,
  versions: number,
): {
  scope: {
    projectId: string;
    sourceShotId: string;
    sceneId: string;
    selectedTakeId: string;
    model: string;
  };
  semantic: Record<string, unknown>;
  request: DialogueSplitInput;
} | null;
export function normalizeDialogueSplitSource(value: unknown): DialogueSplitSource | null;
