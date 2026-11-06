import { expect, it } from "vitest";
import {
  buildAudioMixPlan,
  evaluateAudioMix,
  audioMixGain,
  audioMixSettings,
} from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixInput, MixClip } from "@aijian/contracts/film-audio-mix";
const clip = (id: string, extra: Partial<MixClip> = {}): MixClip => ({
  id,
  sourceKey: id,
  lane: "dialogue",
  shotId: "second",
  takeId: "v2",
  label: "配音",
  startSeconds: 1,
  durationSeconds: 2,
  offsetSeconds: 0.5,
  gainDb: 0,
  ...extra,
});
const input = (): AudioMixInput => ({
  projectId: "project",
  durationSeconds: 8,
  shots: [
    {
      shotId: "first",
      takeId: "v1",
      startSeconds: 0,
      durationSeconds: 4,
      nativeSourceKey: "native1",
      hasDialogue: false,
    },
    {
      shotId: "second",
      takeId: "v2",
      startSeconds: 4,
      durationSeconds: 4,
      nativeSourceKey: "native2",
      hasDialogue: true,
    },
  ],
  clips: [
    clip("voice"),
    clip("score", {
      lane: "score",
      shotId: "",
      takeId: "",
      label: "",
      startSeconds: 0,
      durationSeconds: 8,
      offsetSeconds: 0,
      gainDb: -6,
    }),
  ],
  sources: {
    native1: { durationSeconds: 4, hasAudio: true },
    native2: { durationSeconds: 4, hasAudio: true },
    voice: { durationSeconds: 3, hasAudio: true },
    score: { durationSeconds: 8, hasAudio: true },
  },
});
it("shares actual shot-relative timing, source offset and zero-dB arithmetic without duplicating native speech", () => {
  const plan = buildAudioMixPlan(input());
  expect(plan.tracks.map((track) => track.key)).toEqual(["native:first:v1", "voice", "score"]);
  const voice = plan.tracks.find((track) => track.key === "voice")!;
  expect(voice).toMatchObject({ startSeconds: 5, endSeconds: 7, offsetSeconds: 0.5, gainDb: 0 });
  expect(evaluateAudioMix(plan, 5.5).find((track) => track.key === "voice")).toMatchObject({
    sourceSeconds: 1,
    gain: 1,
  });
  expect(audioMixGain(plan, voice, 7)).toBe(0);
});
it("uses exactly the shared 0.3-second attack and 0.5-second release, never subtitle-layout timing", () => {
  const value = input();
  value.sources.native1!.hasAudio = false;
  const plan = buildAudioMixPlan(value),
    score = plan.tracks.find((track) => track.key === "score")!;
  const base = 10 ** (-6 / 20);
  expect(audioMixGain(plan, score, 4.7)).toBeCloseTo(base);
  expect(audioMixGain(plan, score, 4.85)).toBeCloseTo(base * 0.625);
  expect(audioMixGain(plan, score, 5)).toBeCloseTo(base * 0.25);
  expect(audioMixGain(plan, score, 7.25)).toBeCloseTo(base * 0.625);
  expect(audioMixGain(plan, score, 7.5)).toBeCloseTo(base);
  expect(plan.speech).toEqual([{ startSeconds: 5, endSeconds: 7, basis: "conservative-clip" }]);
});
it("ignores stale/missing take bindings and makes muted dub silent without resurrecting embedded native", () => {
  const value = input();
  value.clips = [
    clip("voice", { gainDb: -40 }),
    clip("old", { takeId: "previous" }),
    clip("unbound", { takeId: "" }),
  ];
  const plan = buildAudioMixPlan(value);
  expect(plan.tracks.map((track) => track.key)).toEqual(["native:first:v1"]);
  expect(plan.limitations).toContain("STALE_CLIP_IGNORED");
  const solo = input();
  solo.controls = { soloLane: "score" };
  const score = buildAudioMixPlan(solo);
  expect(score.tracks.map((track) => track.key)).toEqual(["score"]);
  expect(score.speech).toEqual([]);
});
it("does not duck music for confirmed non-dialogue native audio; unknown native is explicitly conservative", () => {
  const value = input();
  value.clips = [value.clips[1]!];
  value.shots[1]!.hasDialogue = false;
  const plan = buildAudioMixPlan(value),
    score = plan.tracks.find((track) => track.key === "score")!;
  expect(plan.speech).toEqual([]);
  expect(audioMixGain(plan, score, 2)).toBeCloseTo(10 ** (-6 / 20));
  value.shots[1]!.hasDialogue = null;
  const unknown = buildAudioMixPlan(value);
  expect(unknown.limitations).toContain("NATIVE_DIALOGUE_UNKNOWN");
  expect(unknown.speech).toEqual([{ startSeconds: 4, endSeconds: 8, basis: "conservative-clip" }]);
});
it("refuses overlapping native controls and permits nonoverlapping native trims without summing two copies", () => {
  const value = input();
  value.clips = [
    clip("native-a", {
      sourceKey: "native2",
      label: "原声",
      startSeconds: 0,
      durationSeconds: 3,
      offsetSeconds: 0,
    }),
    clip("native-b", {
      sourceKey: "native2",
      label: "原声",
      startSeconds: 2,
      durationSeconds: 2,
      offsetSeconds: 2,
    }),
  ];
  expect(() => buildAudioMixPlan(value)).toThrow("NATIVE_AUDIO_OVERLAP");
  value.clips[0]!.durationSeconds = 2;
  const plan = buildAudioMixPlan(value);
  for (const time of [4.5, 6, 7.5])
    expect(
      evaluateAudioMix(plan, time).filter(
        (track) => track.sourceKey === "native2" && track.gain > 0,
      ),
    ).toHaveLength(1);
});
it("keeps persistent lane mute on a newly selected native without double-applying legacy clip gain", () => {
  const value = input();
  const settings = audioMixSettings(undefined);
  settings.lanes.dialogue.muted = true;
  settings.lanes.score.gainDb = -3;
  value.controls = { lanes: settings.lanes };
  const plan = buildAudioMixPlan(value);
  expect(plan.tracks.map((track) => track.key)).toEqual(["score"]);
  expect(plan.tracks[0]!.gainDb).toBe(-9);
  value.shots[1]!.takeId = "new-version";
  expect(buildAudioMixPlan(value).tracks.map((track) => track.key)).toEqual(["score"]);
  expect(audioMixSettings(undefined).autoAdjustVolume).toBe(false);
});

it("preserves legacy global music repeat, explicit stop and offset modulo without looping other lanes", () => {
  const value = input();
  value.clips = [
    clip("score", {
      lane: "score",
      shotId: "",
      takeId: "",
      startSeconds: 0,
      offsetSeconds: 1,
      durationSeconds: 0,
    }),
  ];
  value.sources = { ...value.sources, score: { hasAudio: true, durationSeconds: 3 } };
  const plan = buildAudioMixPlan(value),
    track = plan.tracks.find((row) => row.key === "score")!;
  expect(track.endSeconds).toBe(8);
  expect(track.loopSeconds).toBe(2);
  expect(evaluateAudioMix(plan, 5.5).find((row) => row.key === "score")!.sourceSeconds).toBe(2.5);
  value.clips[0]!.loop = false;
  expect(buildAudioMixPlan(value).tracks.find((row) => row.key === "score")!.endSeconds).toBe(2);
  value.clips[0]!.loop = undefined;
  value.clips[0]!.lane = "ambience";
  expect(
    buildAudioMixPlan(value).tracks.find((row) => row.key === "score")!.loopSeconds,
  ).toBeUndefined();
});
