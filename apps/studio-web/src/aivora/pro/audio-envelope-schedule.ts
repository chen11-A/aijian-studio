import { audioMixCurveGain } from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixGainCurve } from "@aijian/contracts/film-audio-mix";
/** Film-clock curves become native sample-accurate AudioParam ramps. Seek/rate changes
 * create a new source/chain; an envelope never restarts at a source loop boundary. */
export function scheduleEnvelopeCurve(
  parameter: Pick<AudioParam, "setValueAtTime" | "linearRampToValueAtTime">,
  curve: AudioMixGainCurve,
  filmSeconds: number,
  audioSeconds: number,
  rate: number,
): void {
  if (![filmSeconds, audioSeconds, rate].every(Number.isFinite) || rate <= 0)
    throw new Error("INVALID_PREVIEW_CLOCK");
  parameter.setValueAtTime(audioMixCurveGain(curve, filmSeconds), audioSeconds);
  for (const point of curve.points) {
    if (point.seconds <= filmSeconds) continue;
    const at = audioSeconds + (point.seconds - filmSeconds) / rate;
    if (point.interpolation === "linear") parameter.linearRampToValueAtTime(point.gain, at);
    else parameter.setValueAtTime(point.gain, at);
  }
}
