/** Opaque local attempts. Neither provider IDs nor paths are accepted from a renderer. */
export type RecoveredGenerationVideoFile = {
  fileName: string;
  sha256: string;
  bytes: number;
};
export type GenerationVideoRecoveryItem = {
  attemptId: string;
  state: "UNKNOWN" | "RECOVERED";
  file?: RecoveredGenerationVideoFile;
};
export type GenerationVideoRecoveryFailure = {
  kind: "FAILED";
  code: "ACCOUNT_UNAVAILABLE" | "NOT_FOUND" | "BUSY" | "UNAVAILABLE" | "WRITE_UNCONFIRMED";
};
export type GenerationVideoRecoveryListResult =
  | { kind: "ATTEMPTS"; items: GenerationVideoRecoveryItem[]; hasMore: boolean }
  | GenerationVideoRecoveryFailure;
export type GenerationVideoRecoveryResult =
  | { kind: "RECOVERED"; attemptId: string; file: RecoveredGenerationVideoFile }
  | {
      kind: "UNKNOWN";
      attemptId: string;
      reason: "WAITING" | "UNREACHABLE" | "NO_VALID_VIDEO" | "PROVIDER_FAILED";
    }
  | GenerationVideoRecoveryFailure;
/** Explicitly save recovered raw footage; never automatically replace a take or resume generation. */
export type SaveRecoveredGenerationVideoResult =
  | { kind: "SAVED"; file: RecoveredGenerationVideoFile }
  | { kind: "CANCELLED" }
  | GenerationVideoRecoveryFailure;
