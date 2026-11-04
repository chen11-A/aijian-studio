import { expect, it } from "vitest";
import {
  applyShots,
  keyframePrompt,
  parseDirectorShots,
  sampleFilm,
  upgradeFilm,
  videoPrompt,
} from "./project";
import { motionPrompt, storyFilmBatches } from "./operations";
import { mergeAdjacentShots } from "./director-continuity";

function parsed() {
  return parseDirectorShots(
    JSON.stringify({
      shots: [
        {
          id: "scene-1-shot-1",
          picture: "用户卡片描述",
          action: "抬起手",
          seconds: 3,
          start_frame_prompt: "手还停在门把上，静止的起始构图",
          video_prompt: "手离开门把，再向后退一步",
        },
      ],
    }),
    "scene-1",
    "",
    [],
    false,
  )![0]!;
}
it("persists separate director plans and uses them in real first-frame and video payload builders", () => {
  const film = sampleFilm();
  const shot = parsed();
  film.shots = [shot];
  const restored = upgradeFilm(JSON.parse(JSON.stringify(film)))!;
  const saved = restored.shots[0]!;
  expect(saved.picture).toBe("用户卡片描述");
  expect(keyframePrompt(saved, restored)).toContain("手还停在门把上");
  expect(keyframePrompt(saved, restored)).not.toContain("再向后退一步");
  const payload = storyFilmBatches(restored, [saved], false)[0]!.shots![0]!;
  expect(payload.prompt).toContain("手离开门把，再向后退一步");
  expect(payload.prompt).not.toContain("静止的起始构图");
  expect(videoPrompt(saved)).toContain("再向后退一步");
});
it("merges generation plans in source order without losing a shot that has no dedicated plan", () => {
  const left = parsed();
  const right = {
    ...left,
    id: "scene-1-shot-2",
    no: 2,
    picture: "走到窗口",
    directorFramePrompt: "窗边起始构图",
    directorVideoPrompt: "推开窗户",
  };
  const merged = mergeAdjacentShots([left, right], 1)[0]!;
  expect(merged.directorFramePrompt).toBe(`${left.directorFramePrompt}\n窗边起始构图`);
  expect(merged.directorVideoPrompt).toBe(`${left.directorVideoPrompt}\n推开窗户`);
  const fallback = mergeAdjacentShots(
    [left, { ...right, directorFramePrompt: undefined, directorVideoPrompt: undefined }],
    1,
  )[0]!;
  expect(fallback.directorVideoPrompt).toContain("走到窗口");
  expect(fallback.directorFramePrompt).toContain("走到窗口");
});
it("honors later picture/action edits and explicit user prompt edits, while keyframe polishing never replaces video movement", () => {
  const film = sampleFilm();
  const shot = { ...parsed(), promptZh: "工程师优化的首帧" };
  expect(keyframePrompt(shot, film)).toContain("工程师优化的首帧");
  expect(motionPrompt(shot)).toContain("再向后退一步");
  const explicit = { ...shot, promptZh: "用户明确描述", userFields: ["promptZh"] };
  expect(keyframePrompt(explicit, film)).toContain("用户明确描述");
  expect(motionPrompt(explicit)).toContain("用户明确描述");
  const edited = { ...shot, picture: "用户新画面", userFields: ["picture"] };
  expect(keyframePrompt(edited, film)).not.toContain("工程师优化");
  expect(keyframePrompt(edited, film)).not.toContain("门把");
  expect(motionPrompt(edited)).toContain("用户新画面");
  expect(motionPrompt(edited)).not.toContain("退一步");
  const actionEdited = { ...edited, userFields: ["action"] };
  expect(motionPrompt(actionEdited)).not.toContain("退一步");
  expect(mergeAdjacentShots([explicit, { ...shot, id: "second" }], 1)).toHaveLength(2);
  film.shots = [explicit];
  expect(applyShots(film, [parsed()], "scene-1").shots[0]!.promptZh).toBe("用户明确描述");
});
