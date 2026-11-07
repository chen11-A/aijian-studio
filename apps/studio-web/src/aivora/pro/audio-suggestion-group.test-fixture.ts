import type {
  ApplyBundledFilmShotAudioInput,
  ApplyBundledFilmShotAudioResult,
  AudioSuggestionReceipt,
} from "@aijian/contracts/film-audio-library";
import {
  audioSuggestionMemberInput,
  audioSuggestionMemberSetInput,
} from "@aijian/contracts/film-audio-suggestion-group";
import { audioSuggestionDigest } from "./actions/audio-suggestion-proof";
import type { ShotAudioPlan } from "./actions/shot-audio-suggestions";
/** Synthetic IPC producer, not actual copy, native authority or media validation. */
export async function groupNativeResult(
  raw: Record<string, unknown>,
  plan: ShotAudioPlan,
  input: ApplyBundledFilmShotAudioInput,
  serial = 1,
): Promise<Extract<ApplyBundledFilmShotAudioResult, { kind: "ADDED" }>> {
  const selected = plan.clips.filter((c) => input.lanes.includes(c.lane));
  const clips = selected.map((segment, i) => ({
    id: `group-${serial}-clip-${i}`,
    shotId: input.shotId,
    takeId: input.takeId,
    lane: segment.lane,
    label: segment.asset.name,
    ...segment.placement,
    enabled: true,
    path: `/trusted/group-${serial}-asset-${segment.asset.id}.ogg`,
    ...(segment.envelope ? { envelope: structuredClone(segment.envelope) } : {}),
    libraryAsset: {
      assetId: segment.asset.id,
      source: segment.asset.source,
      author: segment.asset.author,
      license: segment.asset.license,
      sha256: segment.asset.sha256,
      loopable: segment.asset.loopable,
      loudness: segment.asset.loudness,
    },
  }));
  const members = await Promise.all(
    clips.map(async (c, i) => ({
      key: selected[i]!.key,
      clipId: c.id,
      creativeSha256: await audioSuggestionDigest(audioSuggestionMemberInput(c)),
    })),
  );
  const receipt: AudioSuggestionReceipt = {
    schemaVersion: 1,
    groupId: `audio-group-${serial}`,
    planFingerprint: plan.planFingerprint,
    memberCount: clips.length,
    memberSetSha256: await audioSuggestionDigest(audioSuggestionMemberSetInput(members)),
    members,
  };
  return {
    kind: "ADDED",
    receipt,
    project: {
      ...structuredClone(raw),
      audioClips: [
        ...(raw.audioClips as unknown[]),
        ...clips.map((clip, i) => ({
          ...clip,
          suggestionGroup: {
            schemaVersion: 1,
            groupId: receipt.groupId,
            planFingerprint: receipt.planFingerprint,
            key: members[i]!.key,
            memberCount: receipt.memberCount,
            memberSetSha256: receipt.memberSetSha256,
          },
        })),
      ],
    },
  };
}
