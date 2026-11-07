import { sceneAudioContext } from "./film-shot-audio-suggestions";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  sceneAudioBinding,
  sceneAudioSelectionInput,
} from "@aijian/contracts/film-scene-audio-binding";
import {
  audioSuggestionMemberInput,
  audioSuggestionMemberSetInput,
  sceneAudioGroupState,
} from "@aijian/contracts/film-audio-suggestion-group";
import { buildAudioMixPlan } from "@aijian/contracts/film-audio-mix-plan";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const source = (shotId: string, sceneId: string, at: number) => ({
  shotId,
  takeId: `take-${shotId}`,
  sceneId,
  startSeconds: at,
  durationSeconds: 2,
  nativeSha256: "a".repeat(64),
  visualSha256: "b".repeat(64),
});
const clock = [
  source("shot-a", "scene-a", 0),
  source("shot-b", "scene-a", 2),
  source("shot-c", "scene-b", 4),
];
const binding = {
  schemaVersion: 1 as const,
  sceneId: "scene-a",
  selectionSha256: hash(sceneAudioSelectionInput("scene-a", clock)),
};
function members() {
  const clips = clock.slice(0, 2).map((row, i) => ({
    id: `clip-${i}`,
    shotId: row.shotId,
    takeId: row.takeId,
    lane: "ambience" as const,
    label: "环境",
    path: "/trusted/rain.ogg",
    startSeconds: 0,
    durationSeconds: 2,
    offsetSeconds: i * 2,
    gainDb: -6,
    loop: false,
    enabled: true,
    sceneAudioBinding: binding,
    libraryAsset: { assetId: "rain", sha256: "c".repeat(64) },
  }));
  const digest = hash(
    audioSuggestionMemberSetInput(
      clips.map((clip, i) => ({
        key: `key-${i}`,
        clipId: clip.id,
        creativeSha256: hash(audioSuggestionMemberInput(clip)),
      })),
    ),
  );
  return clips.map((clip, i) => ({
    ...clip,
    suggestionGroup: {
      schemaVersion: 1 as const,
      groupId: "group",
      key: `key-${i}`,
      memberCount: 2,
      memberSetSha256: digest,
      planFingerprint: "d".repeat(64),
    },
  }));
}
it("binds source roles, full film prefix and order without paths or project identity", () => {
  expect(sceneAudioBinding(binding)).toEqual(binding);
  const input = sceneAudioSelectionInput("scene-a", clock);
  expect(hash(input)).not.toBe(
    hash(
      sceneAudioSelectionInput(
        "scene-a",
        clock.map((row) => ({
          ...row,
          nativeSha256: row.visualSha256,
          visualSha256: row.nativeSha256,
        })),
      ),
    ),
  );
  expect(() =>
    sceneAudioSelectionInput("scene-a", [
      clock[0]!,
      { ...clock[1]!, sceneId: "scene-b" },
      { ...clock[2]!, sceneId: "scene-a" },
    ]),
  ).toThrow();
  expect(() => sceneAudioSelectionInput("scene-a", [{ ...clock[0]!, startSeconds: 1 }])).toThrow();
  expect(() => sceneAudioBinding({ ...binding, path: "untrusted" })).toThrow();
});
it("keeps old member serialization byte-compatible when there is no binding", () => {
  const clip = members()[0]!;
  const old = { ...clip, sceneAudioBinding: undefined };
  const actual = audioSuggestionMemberInput(old);
  expect(actual).toBe(
    JSON.stringify({
      id: old.id,
      shotId: old.shotId,
      takeId: old.takeId,
      lane: old.lane,
      label: old.label,
      startSeconds: old.startSeconds,
      durationSeconds: old.durationSeconds,
      offsetSeconds: old.offsetSeconds,
      gainDb: old.gainDb,
      loop: old.loop,
      enabled: old.enabled,
      asset: { assetId: "rain", sha256: "c".repeat(64) },
      envelope: null,
    }),
  );
});
it("stops the entire scene group on clock changes, missing members, duplicates or a missing binding", () => {
  const clips = members();
  const current = { [binding.sceneId]: binding.selectionSha256 };
  expect(sceneAudioGroupState(clips, current).eligibleIds).toEqual(["clip-0", "clip-1"]);
  for (const rows of [
    clips.slice(0, 1),
    [...clips, { ...clips[0] }],
    [clips[0], { ...clips[1], sceneAudioBinding: undefined }],
  ])
    expect(sceneAudioGroupState(rows, current).eligibleIds).toEqual([]);
  expect(sceneAudioGroupState(clips, { "scene-a": "e".repeat(64) }).eligibleIds).toEqual([]);
  // An intentional gain edit is audible; removal still compares the original member digest.
  expect(
    sceneAudioGroupState(
      clips.map((clip) => ({ ...clip, gainDb: -3 })),
      current,
    ).eligibleIds,
  ).toHaveLength(2);
});
it("feeds one shared eligibility decision into the actual mix plan", () => {
  const clips = members().map((clip) => ({ ...clip, sourceKey: "rain" }));
  const input = {
    projectId: "project",
    durationSeconds: 4,
    shots: clock
      .slice(0, 2)
      .map((row) => ({ ...row, nativeSourceKey: "silent", hasDialogue: false })),
    clips,
    sources: {
      rain: { hasAudio: true, durationSeconds: 4 },
      silent: { hasAudio: false, durationSeconds: 2 },
    },
  };
  expect(
    buildAudioMixPlan({ ...input, sceneAudioEligibleClipIds: ["clip-0", "clip-1"] }).tracks,
  ).toHaveLength(2);
  const stale = buildAudioMixPlan({ ...input, sceneAudioEligibleClipIds: [] });
  expect(stale.tracks).toHaveLength(0);
  expect(stale.limitations).toContain("SCENE_AUDIO_BINDING_STALE");
});
it("bounds combined scene prose instead of truncating picker inputs", () => {
  const record = {
    id: "film_aaaaaaaaaaaaaaaa",
    seriesId: "film_bbbbbbbbbbbbbbbb",
    scenes: [{ id: "scene" }],
    shots: [
      { id: "a", sceneId: "scene", picture: "x".repeat(4500), sound: { musicMood: "温暖" } },
      { id: "b", sceneId: "scene", picture: "y".repeat(4500), sound: { musicMood: "温暖" } },
    ],
  };
  expect(() =>
    sceneAudioContext(record, [
      { shotId: "a", takeId: "a1", startSeconds: 0, durationSeconds: 2 },
      { shotId: "b", takeId: "b1", startSeconds: 2, durationSeconds: 2 },
    ]),
  ).toThrow("PLAN_UNSUPPORTED");
});
