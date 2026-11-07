import type { DialogueSplitPlan } from "./film-dialogue-split-plan.js";
import type { FilmHistoryEntry } from "./film-history.js";
export type FilmDialogueSplitInput = {
  projectId: string;
  expectedHash: string;
  shotId: string;
  versions: number;
  /** Session-local main receipt; never persist in a project or portable archive. */
  limitEvidenceId?: string;
};
export type FilmDialogueSplitFailure = {
  kind: "FAILED";
  code:
    | "INVALID_INPUT"
    | "PROJECT_CHANGED"
    | "BUSY"
    | "UNSUPPORTED_PLAN"
    | "BACKUP_FAILED"
    | "WRITE_FAILED"
    | "WRITE_UNCONFIRMED";
  unchanged: boolean;
  reason?: string;
  backup?: FilmHistoryEntry;
};
export type FilmDialogueSplitReady = {
  kind: "READY";
  projectId: string;
  shotId: string;
  projectHash: string;
  reviewFingerprint: string;
  model: string;
  plan: Extract<DialogueSplitPlan, { kind: "READY" }>;
  notes: string[];
  actualLimit?: {
    requiredSeconds: number;
    maxSeconds: 10 | 15;
    rawAudioSaved: boolean;
    targetVideoSubmitted: false;
  };
};
export type FilmDialogueSplitPrepareResult = FilmDialogueSplitReady | FilmDialogueSplitFailure;
export type FilmDialogueSplitApplyInput = FilmDialogueSplitInput & { reviewFingerprint: string };
/** Creative linkage, not an authority or guarantee a portable archive contains local history. */
export type DialogueSplitSource = {
  schemaVersion: 1;
  historyId: string;
  sourceShotId: string;
  sourceLineIndex: number;
  startOffset: number;
  endOffset: number;
  reviewFingerprint: string;
};
export type FilmDialogueSplitApplyResult =
  | {
      kind: "APPLIED";
      project: Record<string, unknown>;
      backup: FilmHistoryEntry;
      childIds: string[];
    }
  | FilmDialogueSplitFailure;
export type FilmDialogueSplitBackupInput = {
  projectId: string;
  historyId: string;
  beforeHash: string;
};
export type FilmDialogueSplitBackupResult =
  | {
      kind: "VERIFIED";
      projectId: string;
      historyId: string;
      beforeHash: string;
      entry: FilmHistoryEntry;
    }
  | FilmDialogueSplitFailure;
export type FilmDialogueSplitGateway = {
  verifyFilmDialogueSplitBackup: (
    input: FilmDialogueSplitBackupInput,
  ) => Promise<FilmDialogueSplitBackupResult>;
  prepareFilmDialogueSplit: (
    input: FilmDialogueSplitInput,
  ) => Promise<FilmDialogueSplitPrepareResult>;
  applyFilmDialogueSplit: (
    input: FilmDialogueSplitApplyInput,
  ) => Promise<FilmDialogueSplitApplyResult>;
};

/** IPC-only target identity. Never forwarded to the HTTP/provider body. */
export type StoryFilmLocalScope = {
  projectId: string;
  shotId: string;
  takeId: string;
  inputFingerprint: string;
};
