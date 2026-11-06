/** Bundled library identifiers and creative metadata only; no renderer-selected source paths. */
export type BundledAudioAsset = {
  id: string;
  name: string;
  type: "sfx" | "music";
  category: string;
  tags: string[];
  scene: string;
  durationSeconds: number;
  loopable: boolean;
  loudness: number | null;
  source: string;
  author: string;
  license: string;
  sha256: string;
};
export type AudioLibraryProvenance = {
  assetId: string;
  source: string;
  author: string;
  license: string;
  sha256: string;
  loopable: boolean;
  loudness: number | null;
  /** Already applied to bundled bytes, never added to clip gain a second time. */
  processingGainDb?: number;
};
export type FilmAudioLibraryFailure = {
  kind: "FAILED";
  code:
    | "INVALID_INPUT"
    | "LIBRARY_UNAVAILABLE"
    | "ASSET_CHANGED"
    | "PROJECT_CHANGED"
    | "SOURCE_UNVERIFIED"
    | "PLACEMENT_UNSUPPORTED"
    | "BUSY"
    | "WRITE_FAILED"
    | "WRITE_UNCONFIRMED"
    | "TOOLS_UNAVAILABLE";
  unchanged: boolean;
};
export type FilmAudioLibraryCatalog = {
  kind: "CATALOG";
  manifestSha256: string;
  assets: BundledAudioAsset[];
};
export type AddBundledFilmAudioInput = {
  projectId: string;
  expectedProjectHash: string;
  catalogSha256: string;
  assetId: string;
  expectedAssetSha256: string;
  shotId: string;
  takeId: string;
  lane: "ambience" | "sfx" | "score";
  /** Relative to this bound shot, all values finite and bounded by actual source/shot duration. */
  placement: {
    startSeconds: number;
    durationSeconds: number;
    offsetSeconds: number;
    gainDb: number;
    loop: boolean;
  };
};
export type AddBundledFilmAudioResult =
  { kind: "ADDED"; clipId: string; project: Record<string, unknown> } | FilmAudioLibraryFailure;
export type InspectBundledFilmAudioTargetInput = {
  projectId: string;
  expectedProjectHash: string;
  shotId: string;
  takeId: string;
};
export type InspectBundledFilmAudioTargetResult =
  | {
      kind: "TARGET";
      projectId: string;
      shotId: string;
      takeId: string;
      projectHash: string;
      durationSeconds: number;
    }
  | FilmAudioLibraryFailure;
export type FilmAudioLibraryGateway = {
  inspectBundledFilmAudioTarget: (
    input: InspectBundledFilmAudioTargetInput,
  ) => Promise<InspectBundledFilmAudioTargetResult>;
  listBundledFilmAudio: () => Promise<FilmAudioLibraryCatalog | FilmAudioLibraryFailure>;
  addBundledFilmAudio: (input: AddBundledFilmAudioInput) => Promise<AddBundledFilmAudioResult>;
};
