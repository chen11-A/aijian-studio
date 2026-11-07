import { expect, it } from "vitest";
import {
  audioSuggestionMemberInput,
  audioSuggestionMemberSetInput,
} from "@aijian/contracts/film-audio-suggestion-group";
import { soundFilm, soundPlan } from "../shot-audio-suggestions.test-fixture";
import { upgradeFilm } from "../../film/project";
import type { AudioClip } from "../../film/audio";
import {
  audioSuggestionDigest,
  matchAudioGroupAppend,
  validAudioReceipt,
  verifiedAudioGroup,
  type GroupAppendIntent,
} from "./audio-suggestion-proof";
async function setup() {
  const before = soundFilm(),
    baseInput = {
      projectId: before.id,
      shotId: before.shots[0]!.id,
      takeId: before.shots[0]!.selectedTakeId!,
      expectedProjectHash: "e".repeat(64),
    },
    plan = soundPlan(baseInput);
  // Equal-content repetitions remain separate planned segments with distinct keys.
  plan.clips[2] = { ...structuredClone(plan.clips[1]!), key: plan.clips[2]!.key };
  const input = {
    ...baseInput,
    catalogSha256: plan.catalogSha256,
    pickerSha256: plan.pickerSha256,
    planFingerprint: plan.planFingerprint,
    lanes: ["sfx"] as "sfx"[],
  };
  const selected = plan.clips.filter((c) => input.lanes.includes(c.lane as "sfx"));
  const additions = selected.map((segment, i) => {
    const a = segment.asset;
    return {
      id: `new-clip-${i}`,
      shotId: input.shotId,
      takeId: input.takeId,
      lane: segment.lane,
      label: a.name,
      ...segment.placement,
      envelope: structuredClone(segment.envelope),
      enabled: true,
      path: "/trusted/same-sha.ogg",
      libraryAsset: {
        assetId: a.id,
        source: a.source,
        author: a.author,
        license: a.license,
        sha256: a.sha256,
        loopable: a.loopable,
        loudness: a.loudness,
      },
    } satisfies AudioClip;
  });
  const members = await Promise.all(
    additions.map(async (clip, i) => ({
      key: selected[i]!.key,
      clipId: clip.id,
      creativeSha256: await audioSuggestionDigest(audioSuggestionMemberInput(clip)),
    })),
  );
  const receipt = {
    schemaVersion: 1 as const,
    groupId: "audio-group-test",
    planFingerprint: plan.planFingerprint,
    memberCount: additions.length,
    memberSetSha256: await audioSuggestionDigest(audioSuggestionMemberSetInput(members)),
    members,
  };
  const withGroup = additions.map((clip, i) => ({
    ...clip,
    suggestionGroup: {
      schemaVersion: 1 as const,
      groupId: receipt.groupId,
      planFingerprint: receipt.planFingerprint,
      key: members[i]!.key,
      memberCount: receipt.memberCount,
      memberSetSha256: receipt.memberSetSha256,
    },
  }));
  const raw = {
    ...structuredClone(before),
    savedAt: "new-saved-time",
    audioClips: [...before.audioClips, ...withGroup],
  } as unknown as Record<string, unknown>;
  const pending: GroupAppendIntent = {
    rawBefore: structuredClone(before) as unknown as Record<string, unknown>,
    canonicalBefore: before,
    input,
    plan,
    receiptClaimed: true,
    expectedReceipt: receipt,
  };
  return { pending, receipt, raw, saved: () => upgradeFilm(raw)!, additions: withGroup };
}
it("verifies both UTF8 member and sorted set digests, retaining equal-content segments as two real members", async () => {
  const f = await setup(),
    saved = f.saved(),
    before = structuredClone(f.raw);
  expect(await verifiedAudioGroup(saved.audioClips, f.receipt.groupId)).toEqual(f.receipt);
  expect(await matchAudioGroupAppend(f.pending, saved, f.raw)).toHaveLength(2);
  expect(f.raw).toEqual(before);
  const reordered = { ...f.receipt, members: [...f.receipt.members].reverse() };
  f.pending.expectedReceipt = reordered;
  expect(await matchAudioGroupAppend(f.pending, saved, f.raw)).toHaveLength(2);
});
it("does not add JSON string quotes when hashing shared serialized inputs", async () => {
  expect(await audioSuggestionDigest("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
it.each(["missing", "extra-key", "partial", "wrong-id", "wrong-digest", "wrong-key"])(
  "rejects %s native ADDED receipts rather than claiming success",
  async (kind) => {
    const f = await setup();
    const value = structuredClone(f.receipt) as unknown as Record<string, unknown>;
    if (kind === "missing") delete value.members;
    if (kind === "extra-key") value.extra = "untrusted";
    if (kind === "partial") value.members = f.receipt.members.slice(0, 1);
    if (kind === "wrong-id")
      value.members = f.receipt.members.map((m, i) => (i ? m : { ...m, clipId: "other-id" }));
    if (kind === "wrong-digest") value.memberSetSha256 = "0".repeat(64);
    if (kind === "wrong-key")
      value.members = f.receipt.members.map((m, i) => (i ? m : { ...m, key: "different-key" }));
    f.pending.expectedReceipt = value;
    expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toBeNull();
  },
);
it("can prove a no-ACK complete result by raw delta and complete intent, never metadata alone", async () => {
  const f = await setup();
  delete f.pending.expectedReceipt;
  f.pending.receiptClaimed = false;
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toHaveLength(2);
  const clips = f.raw.audioClips as AudioClip[];
  clips[clips.length - 1]!.gainDb = -20;
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toBeNull();
});
it.each([
  "partial-group",
  "non-group-id-collision",
  "old-clip-edit",
  "old-clip-delete",
  "extra-clip",
  "creative-edit",
  "duplicate-key",
  "envelope-edit",
  "wrong-take",
  "source-metadata",
  "raw-clamp",
])("rejects complete-delta violation %s", async (kind) => {
  const f = await setup(),
    clips = f.raw.audioClips as AudioClip[],
    last = clips.at(-1)!;
  if (kind === "partial-group") clips.pop();
  if (kind === "non-group-id-collision") clips.push({ ...clips[0]!, id: last.id });
  if (kind === "old-clip-edit") clips[0]!.gainDb = 1;
  if (kind === "old-clip-delete") clips.shift();
  if (kind === "extra-clip") clips.push({ ...clips[0]!, id: "extra-unrelated" });
  if (kind === "creative-edit") f.raw.title = "unrelated canonical change";
  if (kind === "duplicate-key")
    last.suggestionGroup = { ...last.suggestionGroup!, key: clips[1]!.suggestionGroup!.key };
  if (kind === "envelope-edit") last.envelope = { ...last.envelope!, fades: [] };
  if (kind === "wrong-take") last.takeId = "different-take";
  if (kind === "source-metadata")
    last.libraryAsset = { ...last.libraryAsset!, license: "different-license" };
  if (kind === "raw-clamp") last.gainDb = 900;
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toBeNull();
});
it("refuses body-drift, missing membership and collision outside the group before removal proof", async () => {
  const f = await setup(),
    clips = f.saved().audioClips,
    groupId = f.receipt.groupId;
  expect(
    await verifiedAudioGroup(
      [...clips, { ...clips[0]!, id: f.receipt.members[0]!.clipId }],
      groupId,
    ),
  ).toBeNull();
  expect(await verifiedAudioGroup(clips.slice(0, -1), groupId)).toBeNull();
  const changed = structuredClone(clips);
  changed.at(-1)!.envelope!.gainAutomation![0]!.gainDb = -20;
  expect(await verifiedAudioGroup(changed, groupId)).toBeNull();
  expect(
    validAudioReceipt({ ...f.receipt, members: [...f.receipt.members, f.receipt.members[0]] }),
  ).toBe(false);
});
it("allows save metadata drift but refuses plan/scope or lane substitutions", async () => {
  const f = await setup();
  f.raw.directory = "materialized/saved/location";
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toHaveLength(2);
  f.pending.input.lanes = ["sfx", "sfx"];
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toBeNull();
  const g = await setup();
  g.pending.plan.planFingerprint = "f".repeat(64);
  expect(await matchAudioGroupAppend(g.pending, g.saved(), g.raw)).toBeNull();
});

it("requires the original raw old-clip order, not only the same old members", async () => {
  const f = await setup(),
    second = {
      ...structuredClone(f.pending.canonicalBefore.audioClips[0]!),
      id: "second-old-clip",
    };
  f.pending.canonicalBefore.audioClips.push(second);
  (f.pending.rawBefore.audioClips as AudioClip[]).push(structuredClone(second));
  const clips = f.raw.audioClips as AudioClip[];
  clips.splice(1, 0, structuredClone(second));
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toHaveLength(2);
  [clips[0], clips[1]] = [clips[1]!, clips[0]!];
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toBeNull();
});
it("does not let normalization discard malformed persistent group fields", async () => {
  const f = await setup(),
    clips = f.raw.audioClips as AudioClip[];
  (clips.at(-1)!.suggestionGroup as unknown as Record<string, unknown>).extra = "invalid";
  expect(await matchAudioGroupAppend(f.pending, f.saved(), f.raw)).toBeNull();
});
