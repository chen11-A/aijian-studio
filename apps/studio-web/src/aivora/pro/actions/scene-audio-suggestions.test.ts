import { expect, it } from "vitest";
import { soundFilm } from "../shot-audio-suggestions.test-fixture";
import { scenePlan, sceneGroupResult } from "../scene-audio-suggestions.test-fixture";
import {
  sceneAudioInputKey,
  sceneAudioSelection,
  validSceneAudioPlan,
} from "./scene-audio-suggestions";
import {
  matchAudioGroupAppend,
  verifiedAudioGroup,
  type GroupAppendIntent,
} from "./audio-suggestion-proof";
import { upgradeFilm, type FilmProject } from "../../film/project";
function setup() {
  const film = soundFilm(),
    input = {
      projectId: film.id,
      sceneId: film.scenes[0]!.id,
      expectedProjectHash: "e".repeat(64),
      expectedSelection: sceneAudioSelection(film)!,
    };
  return { film, input, plan: scenePlan(input) };
}
it("requires the complete ordered measured clock and every segment instead of accepting a scene subset", () => {
  const { input, plan } = setup();
  expect(validSceneAudioPlan(plan, input)).toBe(true);
  for (const change of [
    (p: typeof plan) => p.clock.shots.pop(),
    (p: typeof plan) => {
      p.clock.shots[1]!.startSeconds += 0.5;
    },
    (p: typeof plan) => {
      p.clock.shots[0]!.startSeconds = -0.0000001;
    },
    (p: typeof plan) => {
      p.clips[0]!.takeId = "wrong";
    },
    (p: typeof plan) => {
      p.clips[1]!.key = p.clips[0]!.key;
    },
    (p: typeof plan) => {
      p.clips[1]!.placement.durationSeconds = 99;
    },
    (p: typeof plan) => {
      p.catalogSha256 = "";
    },
    (p: typeof plan) => {
      p.warnings[0]!.shotIndex = 999;
    },
  ]) {
    const changed = structuredClone(plan);
    change(changed);
    expect(validSceneAudioPlan(changed, input)).toBe(false);
  }
});
it("keeps review stable through save/cache metadata, but rejects changed selection, source and creative input", () => {
  const { film } = setup(),
    scope = { projectId: film.id, page: "edit", sceneId: film.scenes[0]!.id };
  const key = sceneAudioInputKey(film, scope);
  const saved = { ...structuredClone(film), savedAt: "later", directory: "/new/local/location" };
  expect(sceneAudioInputKey(saved, scope)).toBe(key);
  saved.audioClips[0]!.waveform = {
    schemaVersion: 1,
    sourceKey: "cached-analysis",
    identity: "cached-analysis",
    sourceSha256: "a".repeat(64),
    offsetSeconds: 0,
    durationSeconds: 1,
    analyzedSeconds: 1,
    peaks: Array(256).fill(0.2),
  };
  expect(sceneAudioInputKey(saved, scope)).toBe(key);
  for (const change of [
    (p: typeof film) => {
      p.shots[1]!.selectedTakeId = p.shots[1]!.takes[1]!.id;
    },
    (p: typeof film) => {
      p.shots[0]!.takes[0]!.videoPath += "changed";
    },
    (p: typeof film) => {
      p.shots[1]!.action += "changed";
    },
    (p: typeof film) => {
      p.audioClips[0]!.gainDb = -12;
    },
  ]) {
    const changed = structuredClone(film);
    change(changed);
    expect(sceneAudioInputKey(changed, scope)).not.toBe(key);
  }
});
it("requires full cross-shot member bodies, old order and raw delta; metadata cannot authenticate a partial scene group", async () => {
  const { film, input, plan } = setup(),
    apply = {
      ...input,
      catalogSha256: plan.catalogSha256,
      pickerSha256: plan.pickerSha256,
      planFingerprint: plan.planFingerprint,
      lanes: ["sfx"] as "sfx"[],
    };
  const result = await sceneGroupResult(film as unknown as Record<string, unknown>, plan, apply);
  const pending: GroupAppendIntent = {
    rawBefore: structuredClone(film) as unknown as Record<string, unknown>,
    canonicalBefore: film,
    input: apply,
    plan,
    receiptClaimed: true,
    expectedReceipt: result.receipt,
  };
  const saved = upgradeFilm(result.project as unknown as Partial<FilmProject>)!;
  expect(await matchAudioGroupAppend(pending, saved, result.project)).toHaveLength(2);
  expect(await verifiedAudioGroup(saved.audioClips, result.receipt.groupId)).not.toBeNull();
  expect(
    await verifiedAudioGroup(
      saved.audioClips.filter((c) => c.shotId === plan.clips[1]!.shotId),
      result.receipt.groupId,
    ),
  ).toBeNull();
  for (const change of [
    (p: typeof result.project) => p.audioClips.pop(),
    (p: typeof result.project) => {
      p.audioClips.push(structuredClone(p.audioClips.at(-1)!));
    },
    (p: typeof result.project) => {
      p.audioClips.reverse();
    },
    (p: typeof result.project) => {
      Object.assign(p, { styleZh: "unexpected creative change" });
    },
    (p: typeof result.project) => {
      Object.assign(p.audioClips.at(-1)!, { gainDb: -1 });
    },
  ]) {
    const changed = structuredClone(result.project);
    change(changed);
    expect(
      await matchAudioGroupAppend(
        pending,
        upgradeFilm(changed as unknown as Partial<FilmProject>)!,
        changed,
      ),
    ).toBeNull();
  }
});
