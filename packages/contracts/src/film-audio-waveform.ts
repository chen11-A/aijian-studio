/** Peaks describe one source/trim window before lane gain, ducking or final mixing. */
export type FilmAudioWaveform = {
  schemaVersion: 1;
  sourceKey: string;
  sourceSha256: string;
  offsetSeconds: number;
  durationSeconds: number;
  analyzedSeconds: number;
  peaks: number[];
};
export type FilmAudioWaveformInput = {
  projectId: string;
  clipId: string;
  expectedSourceKey: string;
};
export type FilmAudioWaveformResult =
  | { kind: "READY"; waveform: FilmAudioWaveform }
  | { kind: "EMPTY"; code: "NO_SOURCE" | "NO_AUDIO" | "WINDOW_UNKNOWN" }
  | {
      kind: "FAILED";
      code:
        | "BUSY"
        | "INVALID_INPUT"
        | "SOURCE_CHANGED"
        | "SOURCE_UNVERIFIED"
        | "LIMIT_EXCEEDED"
        | "TOOLS_UNAVAILABLE"
        | "DECODE_FAILED";
    };
