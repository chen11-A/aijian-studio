import type {
  AudioMixInput,
  AudioMixPlan,
  MixTrack,
  AudioMixSettings,
  MixLane,
} from "./film-audio-mix.js";
export function buildAudioMixPlan(input: AudioMixInput): AudioMixPlan;
export function audioMixGain(plan: AudioMixPlan, track: MixTrack, seconds: number): number;
export function evaluateAudioMix(
  plan: AudioMixPlan,
  seconds: number,
): {
  key: string;
  sourceKey: string;
  sourceSeconds: number;
  gain: number;
}[];

export function audioMixSettings(value: unknown): AudioMixSettings;

export function soloAudioMixPlan(plan: AudioMixPlan, lane: MixLane | null): AudioMixPlan;
