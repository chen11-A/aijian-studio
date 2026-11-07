import type {
  AudioSuggestionReceipt,
  ApplyBundledFilmShotAudioInput,
  ApplyBundledFilmSceneAudioInput,
} from "@aijian/contracts/film-audio-library";
import {
  audioSuggestionGroupInputs,
  audioSuggestionMemberInput,
  audioSuggestionMemberSetInput,
} from "@aijian/contracts/film-audio-suggestion-group";
import type { FilmProject } from "../../film/project";
import {
  validSceneAudioPlan,
  sceneAudioClockMatches,
  type SceneAudioPlan,
} from "./scene-audio-suggestions";
import type { ShotAudioPlan } from "./shot-audio-suggestions";
import { historyRecordHash } from "./persistent-history";
type Clip = FilmProject["audioClips"][number];
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export async function audioSuggestionDigest(input: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
/** Full body proof, not merely group metadata, path authorization or source-file validation. */
export async function verifiedAudioGroup(
  clips: readonly unknown[],
  groupId: string,
): Promise<AudioSuggestionReceipt | null> {
  try {
    const candidate = audioSuggestionGroupInputs(clips, groupId);
    if (!candidate) return null;
    const members = await Promise.all(
      candidate.members.map(async (member) => ({
        key: member.key,
        clipId: member.clipId,
        creativeSha256: await audioSuggestionDigest(member.creativeInput),
      })),
    );
    const digest = await audioSuggestionDigest(audioSuggestionMemberSetInput(members));
    if (digest !== candidate.group.memberSetSha256) return null;
    return {
      schemaVersion: 1,
      groupId: candidate.group.groupId,
      planFingerprint: candidate.group.planFingerprint,
      memberCount: candidate.group.memberCount,
      memberSetSha256: digest,
      members,
    };
  } catch {
    return null;
  }
}
export function validAudioReceipt(value: unknown): value is AudioSuggestionReceipt {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !==
      "groupId,memberCount,memberSetSha256,members,planFingerprint,schemaVersion" ||
    value.schemaVersion !== 1 ||
    typeof value.groupId !== "string" ||
    !value.groupId ||
    value.groupId.length > 80 ||
    !Array.isArray(value.members) ||
    value.members.length !== value.memberCount
  )
    return false;
  try {
    audioSuggestionMemberSetInput(value.members);
    return [value.planFingerprint, value.memberSetSha256].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    );
  } catch {
    return false;
  }
}
type GroupAppendBase = {
  rawBefore: Record<string, unknown>;
  canonicalBefore: FilmProject;
  receiptClaimed?: boolean;
  expectedReceipt?: unknown;
};
export type GroupAppendIntent = GroupAppendBase &
  (
    | { input: ApplyBundledFilmShotAudioInput; plan: ShotAudioPlan }
    | { input: ApplyBundledFilmSceneAudioInput; plan: SceneAudioPlan }
  );
const isScene = (
  p: GroupAppendIntent,
): p is GroupAppendBase & { input: ApplyBundledFilmSceneAudioInput; plan: SceneAudioPlan } =>
  p.plan.kind === "SCENE_SUGGESTED";
const rawClips = (raw: Record<string, unknown>) =>
  Array.isArray(raw.audioClips) ? raw.audioClips : null;
const withoutClipsAndSave = (raw: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(raw).filter(([key]) => !["savedAt", "directory", "audioClips"].includes(key)),
  );
/** Exact complete delta: N expected segments including duplicates, never some/every subset. */
export async function matchAudioGroupAppend(
  pending: GroupAppendIntent,
  saved: FilmProject,
  raw: Record<string, unknown>,
): Promise<Clip[] | null> {
  try {
    if (
      pending.plan.projectId !== pending.input.projectId ||
      (isScene(pending)
        ? !sceneAudioClockMatches(pending.plan, pending.canonicalBefore) ||
          !validSceneAudioPlan(pending.plan, {
            ...pending.input,
            expectedProjectHash: pending.plan.projectHash,
          }) ||
          pending.plan.sceneId !== pending.input.sceneId ||
          JSON.stringify(
            pending.plan.clock.shots.map(({ shotId, takeId }) => ({ shotId, takeId })),
          ) !== JSON.stringify(pending.input.expectedSelection)
        : pending.plan.kind !== "SUGGESTED" ||
          !("shotId" in pending.input) ||
          pending.plan.shotId !== pending.input.shotId ||
          pending.plan.takeId !== pending.input.takeId) ||
      pending.plan.planFingerprint !== pending.input.planFingerprint ||
      pending.plan.catalogSha256 !== pending.input.catalogSha256 ||
      pending.plan.pickerSha256 !== pending.input.pickerSha256 ||
      !pending.input.lanes.length ||
      new Set(pending.input.lanes).size !== pending.input.lanes.length ||
      pending.input.lanes.some((lane) => !["ambience", "sfx", "score"].includes(lane))
    )
      return null;
    const expected = pending.plan.clips.filter((c) => pending.input.lanes.includes(c.lane));
    const old = rawClips(pending.rawBefore),
      now = rawClips(raw);
    if (
      !old ||
      !now ||
      !expected.length ||
      new Set(expected.map((c) => c.key)).size !== expected.length ||
      old.length !== pending.canonicalBefore.audioClips.length ||
      now.length !== old.length + expected.length ||
      saved.audioClips.length !== now.length ||
      saved.id !== pending.input.projectId ||
      raw.id !== saved.id ||
      new Set(saved.audioClips.map((c) => c.id)).size !== saved.audioClips.length
    )
      return null;
    if (
      (await historyRecordHash(withoutClipsAndSave(raw))) !==
      (await historyRecordHash(withoutClipsAndSave(pending.rawBefore)))
    )
      return null;
    const ids = (clips: unknown[]) =>
      clips.map((c) => (object(c) && typeof c.id === "string" ? c.id : null));
    const oldIds = ids(old),
      nowIds = ids(now);
    if (
      oldIds.some((id) => !id) ||
      nowIds.some((id) => !id) ||
      new Set(oldIds).size !== oldIds.length ||
      new Set(nowIds).size !== nowIds.length
    )
      return null;
    if ((await historyRecordHash(now.slice(0, old.length))) !== (await historyRecordHash(old)))
      return null;
    const additions = saved.audioClips.filter((c) => !oldIds.includes(c.id));
    if (additions.length !== expected.length) return null;
    const groupId = additions[0]?.suggestionGroup?.groupId;
    if (!groupId || !additions.every((c) => c.suggestionGroup?.groupId === groupId)) return null;
    const receipt = await verifiedAudioGroup(saved.audioClips, groupId);
    if (
      !receipt ||
      receipt.planFingerprint !== pending.input.planFingerprint ||
      receipt.memberCount !== expected.length
    )
      return null;
    const rawReceipt = await verifiedAudioGroup(now, groupId);
    if (
      !rawReceipt ||
      rawReceipt.memberSetSha256 !== receipt.memberSetSha256 ||
      audioSuggestionMemberSetInput(rawReceipt.members) !==
        audioSuggestionMemberSetInput(receipt.members)
    )
      return null;
    if (pending.receiptClaimed) {
      if (!validAudioReceipt(pending.expectedReceipt)) return null;
      const acknowledged = pending.expectedReceipt;
      if (
        acknowledged.groupId !== receipt.groupId ||
        acknowledged.planFingerprint !== receipt.planFingerprint ||
        acknowledged.memberCount !== receipt.memberCount ||
        acknowledged.memberSetSha256 !== receipt.memberSetSha256 ||
        audioSuggestionMemberSetInput(acknowledged.members) !==
          audioSuggestionMemberSetInput(receipt.members)
      )
        return null;
    }
    const used = new Set<string>();
    for (const added of additions) {
      const key = added.suggestionGroup?.key,
        segment = expected.find((c) => c.key === key);
      if (!key || !segment || used.has(key) || !added.path) return null;
      used.add(key);
      const asset = segment.asset,
        provenance = added.libraryAsset;
      if (
        !provenance ||
        provenance.assetId !== asset.id ||
        provenance.sha256 !== asset.sha256 ||
        provenance.source !== asset.source ||
        provenance.author !== asset.author ||
        provenance.license !== asset.license ||
        provenance.loopable !== asset.loopable ||
        provenance.loudness !== asset.loudness
      )
        return null;
      const intent = {
        id: added.id,
        shotId:
          "shotId" in segment
            ? segment.shotId
            : "shotId" in pending.input
              ? pending.input.shotId
              : undefined,
        takeId:
          "takeId" in segment
            ? segment.takeId
            : "takeId" in pending.input
              ? pending.input.takeId
              : undefined,
        ...(isScene(pending) ? { sceneAudioBinding: pending.plan.sceneAudioBinding } : {}),
        lane: segment.lane,
        label: asset.name,
        ...segment.placement,
        enabled: true,
        libraryAsset: { assetId: asset.id, sha256: asset.sha256 },
        ...(segment.envelope ? { envelope: segment.envelope } : {}),
      };
      const original = now.find((clip) => object(clip) && clip.id === added.id);
      if (
        audioSuggestionMemberInput(original) !== audioSuggestionMemberInput(added) ||
        audioSuggestionMemberInput(added) !== audioSuggestionMemberInput(intent)
      )
        return null;
    }
    return used.size === expected.length ? additions : null;
  } catch {
    return null;
  }
}
