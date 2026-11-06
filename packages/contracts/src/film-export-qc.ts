/** Renderer sends identities and presentation settings, never execution or output paths. */
export type FilmExportQcSettings = {
  aspects: ("16:9" | "9:16")[];
  quality: "720p" | "1080p";
  subtitles: "burn" | "srt" | "none";
  style: "white" | "bar" | "yellow" | "film";
  aiMark: boolean;
};
export type FilmExportQcInput = {
  projectId: string;
  expectedSelection: { shotId: string; takeId: string }[];
  settings: FilmExportQcSettings;
};
export type FilmExportQcFailure = {
  kind: "FAILED";
  code:
    | "INVALID_INPUT"
    | "PROJECT_CHANGED"
    | "MISSING_MEDIA"
    | "CLEAN_COPY_REQUIRED"
    | "TOOLS_UNAVAILABLE"
    | "CHECK_FAILED"
    | "RECEIPT_STALE"
    | "PUBLISH_FAILED"
    | "QC_BLOCKED"
    | "SOURCE_UNVERIFIED"
    | "BUSY";
};
export type FilmExportQcPrepared = {
  kind: "READY";
  qcReceipt: string;
  outputs: { aspectRatio: "16:9" | "9:16"; report: unknown }[];
  shots: { id: string; label: string; start: number; end: number }[];
  fileName: string;
  unverified: string[];
};
export type FilmExportQcPublishInput = FilmExportQcInput & { qcReceipt: string };
export type FilmExportQcPublishResult =
  | {
      kind: "PUBLISHED" | "PARTIAL";
      outputs: {
        aspectRatio: "16:9" | "9:16";
        path: string;
        subtitlePath?: string;
        coverPath?: string;
      }[];
    }
  | { kind: "CANCELLED" }
  | FilmExportQcFailure;
export type FilmExportQcGateway = {
  prepareFilmExport: (
    input: FilmExportQcInput,
  ) => Promise<FilmExportQcPrepared | FilmExportQcFailure>;
  publishFilmExport: (input: FilmExportQcPublishInput) => Promise<FilmExportQcPublishResult>;
  discardFilmExport: (qcReceipt: string) => Promise<void>;
};
