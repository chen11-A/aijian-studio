import type { FilmExportQcSettings } from "./film-export-qc.js";

/** Same two literals as the export sound choice. Older records omit the field. */
export const EXPORT_AUDIO_DECISIONS = ["SILENT_BY_USER", "WITH_AUDIO"] as const;
export type ExportAudioDecision = (typeof EXPORT_AUDIO_DECISIONS)[number];

/** Facts from the checked final file. Null is explicitly unknown, never inferred from settings. */
export type FilmDeliveryTechnical = {
  durationSeconds: number | null;
  durationBasis: "video-stream" | "container" | "unknown";
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    displayWidth: number | null;
    displayHeight: number | null;
    /** Average frame rate from the file; this is not a CFR assertion. */
    averageFrameRate: number | null;
    pixelFormat: string | null;
    colorSpace: string | null;
    colorPrimaries: string | null;
    colorTransfer: string | null;
    colorRange: string | null;
  } | null;
  audioTracks:
    | {
        index: number;
        codec: string | null;
        sampleRate: number | null;
        channels: number | null;
        channelLayout: string | null;
      }[]
    | null;
};

export type FilmDeliveryQcSummary = {
  schemaVersion: 1;
  status: "clear" | "warnings" | "blocked" | "unknown";
  counts: { block: number; warn: number; info: number } | null;
  /** Measurements apply only to the first checked audio track. */
  integratedLufs: number | null;
  truePeakDbtp: number | null;
};
export type FilmDeliveryFileReference = {
  role: "video" | "subtitles" | "cover";
  aspectRatio: "16:9" | "9:16";
  /** One relative basename, never an absolute directory or an execution path. */
  fileName: string;
};
export type FilmDeliveryFile = FilmDeliveryFileReference & {
  sha256: string;
  bytes: number;
  technical: FilmDeliveryTechnical | null;
  qc: FilmDeliveryQcSummary | null;
};

/** An immutable description of actual written files, not a transferable authorization. */
export type FilmDeliveryManifest = {
  schemaVersion: 1;
  createdAt: string;
  status: "complete" | "partial";
  /**
   * Same literals as `SoundExportDecision`. Omitted on records written before the field existed.
   * There is no value that means "export the stale cut anyway".
   */
  audioDecision?: ExportAudioDecision;
  selection: {
    shotId: string | null;
    takeId: string | null;
    label: string;
    versionLabel: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
  }[];
  settings: FilmExportQcSettings;
  files: FilmDeliveryFile[];
  unverified: string[];
};
export type FilmDeliveryEvidenceResult =
  | {
      kind: "WRITTEN";
      /** Public files are real; private temporary cleanup was not confirmed. */
      cleanupUnconfirmed?: true;
      fileName: string;
      manifestSha256: string;
      manifest: FilmDeliveryManifest;
    }
  | {
      kind: "FAILED";
      cleanupUnconfirmed?: true;
      code: "EVIDENCE_WRITE_FAILED" | "EVIDENCE_UNAVAILABLE";
      /** Only files main has confirmed exist; no invented sidecars or expected filenames. */
      files: FilmDeliveryFileReference[];
    };
