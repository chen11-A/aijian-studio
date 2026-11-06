/** Native selectors own all source/archive/destination paths. */
export type FilmProjectArchiveInput = { projectId: string; expectedHash: string };
export type FilmProjectArchiveFailure = {
  kind: "FAILED";
  code:
    | "INVALID_INPUT"
    | "BUSY"
    | "PROJECT_CHANGED"
    | "SOURCE_MISSING"
    | "SOURCE_UNVERIFIED"
    | "ARCHIVE_INVALID"
    | "OUTPUT_EXISTS"
    | "WRITE_FAILED"
    | "RUNTIME_UNAVAILABLE";
};
export type FilmProjectArchiveExport =
  { kind: "EXPORTED"; mediaCount: number } | { kind: "CANCELLED" } | FilmProjectArchiveFailure;
export type FilmProjectArchiveImport =
  | { kind: "IMPORTED"; projectId: string; mediaCount: number }
  | { kind: "CANCELLED" }
  | FilmProjectArchiveFailure;
