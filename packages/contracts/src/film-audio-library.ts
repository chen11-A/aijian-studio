import type { AudioMixEnvelope } from "./film-audio-mix.js";
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
    | "PLAN_UNSUPPORTED"
    | "BUSY"
    | "WRITE_FAILED"
    | "WRITE_UNCONFIRMED"
    | "TOOLS_UNAVAILABLE";
  unchanged: boolean;
  reason?: "TRACK_LIMIT";
  maxSegments?: number;
  minimumRequiredSegments?: number;
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
export type ShotAudioSuggestionNote = {
  code:
    | "MUSIC_MOOD_UNDECIDED"
    | "MUSIC_DISABLED"
    | "MUSIC_QUIET"
    | "MUSIC_MATCH_MISSING"
    | "ACTION_TIME_UNCONFIRMED"
    | "ACTION_TIME_INVALID"
    | "ACTION_LABEL_MISSING"
    | "DEVICE_TIME_UNCONFIRMED"
    | "MATCH_MISSING"
    | "PLANNED_TIMES_ONLY";
  message: string;
  index?: number;
  seconds?: number;
};
export type ShotAudioSuggestedClip = {
  key: string;
  asset: BundledAudioAsset;
  lane: "ambience" | "sfx" | "score";
  placement: AddBundledFilmAudioInput["placement"];
  envelope?: AudioMixEnvelope;
  reason: string;
};
export type SuggestBundledFilmShotAudioInput = InspectBundledFilmAudioTargetInput;
export type SuggestBundledFilmShotAudioResult =
  | {
      kind: "SUGGESTED";
      projectId: string;
      shotId: string;
      takeId: string;
      projectHash: string;
      catalogSha256: string;
      pickerSha256: string;
      durationSeconds: number;
      /** Plan equality only, never a file authorization or permission to execute. */
      planFingerprint: string;
      clips: ShotAudioSuggestedClip[];
      warnings: ShotAudioSuggestionNote[];
      limitations: ShotAudioSuggestionNote[];
    }
  | FilmAudioLibraryFailure;
export type AudioSuggestionGroup = {
  schemaVersion: 1;
  groupId: string;
  planFingerprint: string;
  key: string;
  memberCount: number;
  memberSetSha256: string;
};
export type AudioSuggestionMemberReceipt = { key: string; clipId: string; creativeSha256: string };
export type AudioSuggestionReceipt = Omit<AudioSuggestionGroup, "key"> & {
  members: AudioSuggestionMemberReceipt[];
};
export type ApplyBundledFilmShotAudioInput = InspectBundledFilmAudioTargetInput & {
  catalogSha256: string;
  pickerSha256: string;
  planFingerprint: string;
  lanes: ("ambience" | "sfx" | "score")[];
};
export type ApplyBundledFilmShotAudioResult =
  | { kind: "ADDED"; project: Record<string, unknown>; receipt: AudioSuggestionReceipt }
  | FilmAudioLibraryFailure;
export type FilmAudioLibraryGateway = {
  applyBundledFilmShotAudio: (
    input: ApplyBundledFilmShotAudioInput,
  ) => Promise<ApplyBundledFilmShotAudioResult>;
  suggestBundledFilmShotAudio: (
    input: SuggestBundledFilmShotAudioInput,
  ) => Promise<SuggestBundledFilmShotAudioResult>;
  inspectBundledFilmAudioTarget: (
    input: InspectBundledFilmAudioTargetInput,
  ) => Promise<InspectBundledFilmAudioTargetResult>;
  listBundledFilmAudio: () => Promise<FilmAudioLibraryCatalog | FilmAudioLibraryFailure>;
  addBundledFilmAudio: (input: AddBundledFilmAudioInput) => Promise<AddBundledFilmAudioResult>;
};
