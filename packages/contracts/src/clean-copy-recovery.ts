/** Expected identity only; execution paths are read by main from the persisted project. */
export type CleanCopyRecoveryInput = {
  projectId: string;
  shotId: string;
  takeId: string;
  selectionHash: string;
};
export type CleanCopyRecoveryResult =
  | { kind: "RECOVERED"; project: unknown }
  | { kind: "REUSED_ORIGINAL"; project: unknown }
  | { kind: "UNCHANGED"; reason: "ALREADY_VERIFIED" | "NO_BURNED_SUBTITLES" }
  | {
      kind: "FAILED";
      code:
        | "INVALID_INPUT"
        | "PROJECT_CHANGED"
        | "SOURCE_UNVERIFIED"
        | "REBUILD_FAILED"
        | "EVIDENCE_FAILED"
        | "SAVE_FAILED"
        | "BUSY";
    };
export type CleanCopyRecoveryGateway = {
  recoverFilmCleanCopy: (input: CleanCopyRecoveryInput) => Promise<CleanCopyRecoveryResult>;
};
