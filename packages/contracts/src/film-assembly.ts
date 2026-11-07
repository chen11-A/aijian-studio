import type { FilmExportCancelAck, FilmExportProgressEvent } from "./film-export-qc.js";
/** Private rough-cut artifact, not a checked/published export. No caller paths or filters. */
export type FilmAssemblyInput = {
  projectId: string;
  expectedHash: string;
  expectedSelection: { shotId: string; takeId: string }[];
};
export type FilmAssemblyFailure = {
  kind: "FAILED";
  code:
    | "INVALID_INPUT"
    | "PROJECT_CHANGED"
    | "MISSING_MEDIA"
    | "SOURCE_UNVERIFIED"
    | "SOURCE_CHANGED"
    | "SOURCE_TIME_MISMATCH"
    | "TOOLS_UNAVAILABLE"
    | "AUDIO_MIX_LIMIT"
    | "ASSEMBLY_FAILED"
    | "BUSY"
    | "OPERATION_STOPPED";
};
export type FilmAssemblyArtifact = {
  kind: "ASSEMBLED" | "PARTIAL";
  projectId: string;
  projectHash: string;
  path: string;
  durationSeconds: number;
  shots: { shotId: string; takeId: string; startSeconds: number; durationSeconds: number }[];
  limitations: string[];
  /** First incomplete post-join stage. No implication that later stages ran. */
  incomplete?: "audio" | "loudness" | "subtitles";
};
export type FilmAssemblyResult = FilmAssemblyFailure | FilmAssemblyArtifact;
export type FilmAssemblyGateway = {
  assembleFilmProject: (
    input: FilmAssemblyInput,
    operationId?: string,
  ) => Promise<FilmAssemblyResult>;
  cancelFilmAssemblyOperation: (operationId: string) => Promise<FilmExportCancelAck>;
  onFilmAssemblyProgress: (listener: (event: FilmExportProgressEvent) => void) => () => void;
};
