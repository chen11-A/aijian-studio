import type {
  ApplyBundledFilmSceneAudioInput,
  SuggestBundledFilmSceneAudioInput,
} from "@aijian/contracts/film-audio-library";
import {
  audioSuggestionMemberInput,
  audioSuggestionMemberSetInput,
} from "@aijian/contracts/film-audio-suggestion-group";
import { audioSuggestionDigest } from "./actions/audio-suggestion-proof";
import type { SceneAudioPlan } from "./actions/scene-audio-suggestions";
import { soundPlan } from "./shot-audio-suggestions.test-fixture";
/** Synthetic ABI only; no filesystem/source authorization or actual listening proof. */
export function scenePlan(input: SuggestBundledFilmSceneAudioInput): SceneAudioPlan {
  const first = input.expectedSelection[0]!;
  const p = soundPlan({ ...input, ...first });
  return {
    ...p,
    kind: "SCENE_SUGGESTED",
    sceneId: input.sceneId,
    clock: {
      durationSeconds: input.expectedSelection.length * 8,
      shots: input.expectedSelection.map((row, i) => ({
        ...row,
        sceneId: input.sceneId,
        startSeconds: i * 8,
        durationSeconds: 8,
      })),
    },
    sceneStartSeconds: 0,
    sceneDurationSeconds: input.expectedSelection.length * 8,
    sceneAudioBinding: {
      schemaVersion: 1,
      sceneId: input.sceneId,
      selectionSha256: "f".repeat(64),
    },
    clips: p.clips.map((clip, i) => ({
      ...clip,
      ...input.expectedSelection[i % Math.min(2, input.expectedSelection.length)]!,
      asset: structuredClone(clip.lane === "sfx" ? p.clips[1]!.asset : clip.asset),
      placement: { ...clip.placement, offsetSeconds: i % 2 ? 2.5 : 0 },
    })),
    warnings: [
      ...p.warnings,
      {
        code: "SCENE_MUSIC_MOOD_CONFLICT",
        message: "场内配乐情绪不一致，需要人工核对",
        shotIndex: 1,
      },
    ],
  };
}
export async function sceneGroupResult(
  raw: Record<string, unknown>,
  plan: SceneAudioPlan,
  input: ApplyBundledFilmSceneAudioInput,
) {
  const selected = plan.clips.filter((c) => input.lanes.includes(c.lane));
  const clips = selected.map((segment, i) => ({
    id: `scene-clip-${i}`,
    shotId: segment.shotId,
    takeId: segment.takeId,
    lane: segment.lane,
    label: segment.asset.name,
    ...segment.placement,
    enabled: true,
    path: `/trusted/scene-${segment.asset.id}.ogg`,
    ...(segment.envelope ? { envelope: structuredClone(segment.envelope) } : {}),
    sceneAudioBinding: plan.sceneAudioBinding,
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
    clips.map(async (clip, i) => ({
      key: selected[i]!.key,
      clipId: clip.id,
      creativeSha256: await audioSuggestionDigest(audioSuggestionMemberInput(clip)),
    })),
  );
  const receipt = {
    schemaVersion: 1 as const,
    groupId: "scene-group",
    planFingerprint: plan.planFingerprint,
    memberCount: clips.length,
    memberSetSha256: await audioSuggestionDigest(audioSuggestionMemberSetInput(members)),
    members,
  };
  return {
    kind: "ADDED" as const,
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
            memberCount: receipt.memberCount,
            memberSetSha256: receipt.memberSetSha256,
            key: members[i]!.key,
          },
        })),
      ],
    },
  };
}
