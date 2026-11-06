import { expect, it } from "vitest";
import {
  audioMixEnvelope,
  audioMixEnvelopeCurves,
  audioMixCurveGain,
  buildAudioMixPlan,
  evaluateAudioMix,
  soloAudioMixPlan,
} from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixEnvelope, AudioMixInput } from "@aijian/contracts/film-audio-mix";
const envelope: AudioMixEnvelope = {
  schemaVersion: 1,
  baseGainDb: -6,
  fades: [
    { direction: "in", startSeconds: -0.25, durationSeconds: 0.5 },
    { direction: "in", startSeconds: -2, durationSeconds: 4 },
  ],
  gainAutomation: [
    { startSeconds: 1, endSeconds: 2, gainDb: -12 },
    { startSeconds: 2, endSeconds: 3, gainDb: -9 },
  ],
};
function input(): AudioMixInput {
  return {
    projectId: "p",
    durationSeconds: 8,
    shots: [
      {
        shotId: "s",
        takeId: "t",
        startSeconds: 0,
        durationSeconds: 8,
        nativeSourceKey: "native",
        hasDialogue: false,
      },
    ],
    sources: {
      native: { durationSeconds: 8, hasAudio: false },
      a: { durationSeconds: 1, hasAudio: true },
    },
    clips: [
      {
        id: "a",
        sourceKey: "a",
        lane: "ambience",
        shotId: "",
        takeId: "",
        label: "rain",
        startSeconds: 2,
        durationSeconds: 4,
        offsetSeconds: 0.25,
        loop: true,
        gainDb: -3,
        envelope,
      },
    ],
    controls: {
      lanes: {
        dialogue: { gainDb: 0, muted: false },
        ambience: { gainDb: -2, muted: false },
        score: { gainDb: 0, muted: false },
        sfx: { gainDb: 0, muted: false },
      },
    },
  };
}
it("retains absolute clip gain, multiplies cropped/global fades and applies automation-base only once", () => {
  const plan = buildAudioMixPlan(input());
  const value = (at: number) => evaluateAudioMix(plan, at)[0]!;
  expect(value(2).gain).toBeCloseTo(10 ** (-5 / 20) * 0.5 * 0.5, 10);
  expect(value(3).gain).toBeCloseTo(10 ** (-11 / 20) * 0.75, 10);
  // Adjacent next interval overrides the previous interval end, never resetting to1.
  expect(value(4).gain).toBeCloseTo(10 ** (-8 / 20), 10);
  expect(value(5).gain).toBeCloseTo(10 ** (-5 / 20), 10);
  expect(value(4).sourceSeconds).toBeCloseTo(0.25 + (2 % 0.75), 10);
  const curves = audioMixEnvelopeCurves(plan.tracks[0]!);
  expect(curves.reduce((gain, curve) => gain * audioMixCurveGain(curve, 3), 1)).toBeCloseTo(
    0.75 * 10 ** (-6 / 20),
    10,
  );
  expect(evaluateAudioMix(soloAudioMixPlan(plan, "sfx"), 3)).toEqual([]);
  const before = JSON.stringify(envelope);
  const changed = input();
  changed.clips[0]!.gainDb = 0;
  expect(evaluateAudioMix(buildAudioMixPlan(changed), 3)[0]!.gain / value(3).gain).toBeCloseTo(
    10 ** (3 / 20),
    10,
  );
  expect(JSON.stringify(envelope)).toBe(before);
});
it("keeps legacy gains unchanged when no envelope exists and does not restart fades at a loop boundary", () => {
  const value = input();
  delete value.clips[0]!.envelope;
  const plan = buildAudioMixPlan(value);
  expect(evaluateAudioMix(plan, 3)[0]!.gain).toBeCloseTo(10 ** (-5 / 20), 10);
  const mixed = buildAudioMixPlan(input());
  expect(evaluateAudioMix(mixed, 2.749)[0]!.gain).toBeCloseTo(
    evaluateAudioMix(mixed, 2.751)[0]!.gain,
    3,
  );
});
it.each([
  null,
  [],
  { ...envelope, extra: "filter" },
  { ...envelope, fades: null },
  { ...envelope, gainAutomation: [null, {}] },
  {
    ...envelope,
    gainAutomation: [
      { startSeconds: 1, endSeconds: 3, gainDb: -6 },
      { startSeconds: 2, endSeconds: 4, gainDb: -9 },
    ],
  },
  { ...envelope, fades: [{ direction: "in", startSeconds: 0, durationSeconds: 1e-9 }] },
  { ...envelope, fades: Array.from({ length: 9 }, () => envelope.fades![0]) },
  {
    ...envelope,
    gainAutomation: Array.from({ length: 65 }, (_, index) => ({
      startSeconds: index,
      endSeconds: index + 1,
      gainDb: 0,
    })),
  },
])("rejects malformed or over-budget envelope with a stable code (%j)", (bad) => {
  expect(() => audioMixEnvelope(bad)).toThrow("INVALID_AUDIO_ENVELOPE");
  const value = input();
  value.clips[0]!.envelope = bad as AudioMixEnvelope;
  const plan = buildAudioMixPlan(value);
  expect(plan.tracks).toEqual([]);
  expect(plan.limitations).toContain("INVALID_CLIP");
});
it("applies shared score duck once after envelope automation and preserves solo's original unducked semantics", () => {
  const value = input();
  value.sources = { ...value.sources, voice: { durationSeconds: 8, hasAudio: true } };
  value.clips = [
    {
      ...value.clips[0]!,
      lane: "score",
      gainDb: -6,
      envelope: {
        schemaVersion: 1,
        baseGainDb: -6,
        gainAutomation: [{ startSeconds: 1, endSeconds: 2, gainDb: -12 }],
      },
    },
    {
      id: "voice",
      sourceKey: "voice",
      lane: "dialogue",
      label: "旁白",
      shotId: "",
      takeId: "",
      startSeconds: 0,
      durationSeconds: 8,
      offsetSeconds: 0,
      gainDb: 0,
    },
  ];
  const plan = buildAudioMixPlan(value);
  expect(evaluateAudioMix(plan, 3).find((row) => row.key === "a")!.gain).toBeCloseTo(
    10 ** (-12 / 20) * 0.25,
    10,
  );
  expect(evaluateAudioMix(soloAudioMixPlan(plan, "score"), 3)[0]!.gain).toBeCloseTo(
    10 ** (-12 / 20),
    10,
  );
});
