import type {
  AudioMixInput,
  AudioMixEnvelope,
  AudioMixGainCurve,
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

export function audioMixEnvelope(value: unknown): AudioMixEnvelope;
export function audioMixEnvelopeGain(track: MixTrack, seconds: number): number;

export function audioMixEnvelopeCurves(track: MixTrack): AudioMixGainCurve[];
export function audioMixCurveGain(curve: AudioMixGainCurve, seconds: number): number;
export function audioMixBaseGain(plan: AudioMixPlan, track: MixTrack, seconds: number): number;
