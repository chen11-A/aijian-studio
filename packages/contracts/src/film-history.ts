export type FilmHistoryReason =
  | "manual"
  | "before-batch-generation"
  | "before-pipeline"
  | "before-restore"
  | "before-dialogue-split";
export type FilmHistoryEntry = {
  id: string;
  createdAt: string;
  reason: FilmHistoryReason;
  summary: { scenes: number; shots: number; done: number };
};
export type FilmHistoryFailure = {
  kind: "FAILED";
  code:
    | "INVALID_INPUT"
    | "PROJECT_CHANGED"
    | "HISTORY_DAMAGED"
    | "READ_FAILED"
    | "BACKUP_FAILED"
    | "WRITE_FAILED";
  unchanged: boolean;
};
export type FilmHistoryList =
  { kind: "LIST"; entries: FilmHistoryEntry[]; unreadable: number } | FilmHistoryFailure;
export type FilmHistoryCapture = { kind: "CAPTURED"; entry: FilmHistoryEntry } | FilmHistoryFailure;
export type FilmHistoryRestore =
  | { kind: "RESTORED"; project: unknown; backup: FilmHistoryEntry }
  | { kind: "PARTIAL"; project: unknown | null; backup: FilmHistoryEntry }
  | FilmHistoryFailure;
export type FilmHistoryGateway = {
  listFilmHistory: (projectId: string) => Promise<FilmHistoryList>;
  captureFilmHistory: (input: {
    projectId: string;
    expectedHash: string;
    reason: Exclude<FilmHistoryReason, "before-restore" | "before-dialogue-split">;
  }) => Promise<FilmHistoryCapture>;
  restoreFilmHistory: (input: {
    projectId: string;
    historyId: string;
    expectedHash: string;
  }) => Promise<FilmHistoryRestore>;
};
