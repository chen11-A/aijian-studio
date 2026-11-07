import type { SceneAudioBinding } from "./film-scene-audio-binding.js";
/** Pure timeline/gain arithmetic shared by preview and trusted export. No paths, filesystem,
 * probing, subprocesses or authorization live in this module. */
export type MixLane = "dialogue" | "ambience" | "sfx" | "score";
export type MixSourceInfo = {
  durationSeconds: number;
  hasAudio: boolean;
  channels?: number;
  byteLength?: number;
};
export type MixShot = {
  shotId: string;
  takeId: string;
  startSeconds: number;
  durationSeconds: number;
  nativeSourceKey: string;
  /** null means unclassified native audio: conservative whole-clip speech duck. */
  hasDialogue: boolean | null;
};
/** Creative gain/fade intent, never media ownership evidence. Times are clip-relative.
 * Automation holds the picker's final baseline dB; it offsets the current absolute
 * clip gain by (automation - baseGainDb). Base is a reference, never added twice.
 */
export type AudioMixGainCurve = {
  initialGain: number;
  points: { seconds: number; gain: number; interpolation: "linear" | "step" }[];
};
export type AudioMixEnvelope = {
  schemaVersion: 1;
  baseGainDb: number;
  fades?: { direction: "in" | "out"; startSeconds: number; durationSeconds: number }[];
  gainAutomation?: { startSeconds: number; endSeconds: number; gainDb: number }[];
};
export type MixClip = {
  id: string;
  lane: MixLane;
  shotId: string;
  takeId: string;
  label: string;
  sourceKey: string;
  /** Shot-relative when shotId is present; absolute film time otherwise. */
  startSeconds: number;
  durationSeconds: number;
  offsetSeconds: number;
  gainDb: number;
  /** Repeat source from offset to source end; no seamless-edit claim. */
  loop?: boolean;
  enabled?: boolean;
  envelope?: AudioMixEnvelope;
  sceneAudioBinding?: SceneAudioBinding;
};
export type AudioMixSettings = {
  schemaVersion: 1;
  lanes: Record<MixLane, { gainDb: number; muted: boolean }>;
  autoAdjustVolume: boolean;
};
export type MixControls = {
  lanes?: AudioMixSettings["lanes"];
  mutedLanes?: readonly MixLane[];
  soloLane?: MixLane | null;
};
export type MixTrack = {
  key: string;
  sourceKey: string;
  lane: MixLane;
  startSeconds: number;
  endSeconds: number;
  offsetSeconds: number;
  gainDb: number;
  native: boolean;
  sourceChannels?: number;
  loopSeconds?: number;
  envelope?: AudioMixEnvelope;
};
export type AudioMixPlan = {
  projectId: string;
  durationSeconds: number;
  tracks: MixTrack[];
  shots: MixShot[];
  /** Shared piecewise-linear score duck envelope; gains exclude clip/lane gain. */
  duck: { seconds: number; gain: number }[];
  speech: { startSeconds: number; endSeconds: number; basis: "conservative-clip" }[];
  limitations: (
    | "SPEECH_ALIGNMENT_UNAVAILABLE"
    | "NATIVE_DIALOGUE_UNKNOWN"
    | "STALE_CLIP_IGNORED"
    | "SOURCE_UNAVAILABLE"
    | "SCENE_AUDIO_BINDING_STALE"
    | "INVALID_CLIP"
  )[];
};
export type AudioMixInput = {
  projectId: string;
  durationSeconds: number;
  shots: readonly MixShot[];
  clips: readonly MixClip[];
  sources: Readonly<Record<string, MixSourceInfo>>;
  controls?: MixControls;
  /** Computed from actual selected sources by main. Scheduling consistency, not file authority. */
  sceneAudioEligibleClipIds?: readonly string[];
};
export type AudioMixPreviewResult =
  | {
      kind: "READY";
      plan: AudioMixPlan;
      sourcePaths: Record<string, string>;
      sourceSha256: Record<string, string>;
      sourceInfo: Record<string, MixSourceInfo>;
      fingerprint: string;
    }
  | {
      kind: "FAILED";
      code: "PROJECT_CHANGED" | "SOURCE_UNVERIFIED" | "TOOLS_UNAVAILABLE" | "BUSY";
    };
export type AudioMixPreviewGateway = {
  getFilmAudioMixPreview: (input: {
    projectId: string;
    expectedHash: string;
  }) => Promise<AudioMixPreviewResult>;
};
