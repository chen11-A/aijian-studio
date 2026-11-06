import { describe, expect, it } from "vitest";
import { applyDirectorPlan } from "../pro/director-workflow";
import { directorRequestInput } from "../pro/actions/director";
import { motionPrompt } from "./operations";
import { aspectContext, keyframePrompt, sampleFilm, videoPrompt, withWorkFraming } from "./project";

const landscape = () => ({ ...sampleFilm(), aspectRatio: "16:9" as const });

describe("3JR-B12 frame descriptions follow the work's aspect", () => {
  it("names the work's framing once and first", () => {
    expect(withWorkFraming("竖屏构图。人物：林晚。画面：书店。", "16:9")).toBe(
      "横屏构图。人物：林晚。画面：书店。",
    );
    // Two merged shots repeat the sentence.
    expect(withWorkFraming("竖屏构图。画面：书店。\n竖屏构图。画面：门铃。", "16:9")).toBe(
      "横屏构图。画面：书店。\n画面：门铃。",
    );
    expect(withWorkFraming("横屏构图。画面：码头。", "9:16")).toBe("竖屏构图。画面：码头。");
    expect(withWorkFraming("竖屏构图。画面：码头。", "9:16")).toBe("竖屏构图。画面：码头。");
    expect(withWorkFraming("画面：没有写构图。", "16:9")).toBe("画面：没有写构图。");
  });

  it("keeps a portrait sentence out of a landscape keyframe, even for shots directed earlier", () => {
    const film = landscape();
    const shot = {
      ...film.shots[0]!,
      userFields: [],
      directorFramePrompt: "竖屏构图。画面：雨夜的青石巷，旧书店还亮着灯。",
    };
    const prompt = keyframePrompt(shot, { ...film, shots: [shot] });
    expect(prompt).toContain("横屏构图。画面：雨夜的青石巷");
    expect(prompt).not.toContain("竖屏构图");
  });

  it("leaves the framing sentence out of every video description (R2-U01)", () => {
    const film = landscape();
    const shot = {
      ...film.shots[0]!,
      userFields: [],
      directorVideoPrompt: "竖屏构图。从起始画面开始：林晚抬头看门口。",
    };
    for (const text of [motionPrompt(shot), videoPrompt(shot)]) {
      expect(text).toContain("从起始画面开始：林晚抬头看门口");
      expect(text).not.toMatch(/竖屏|横屏构图/);
    }
  });

  it("puts the work's framing into shots as the director's plan is applied", () => {
    const film = landscape();
    const shot = {
      ...film.shots[0]!,
      id: "new-shot",
      directorFramePrompt: "竖屏构图。画面：码头仓库。",
      promptZh: "竖屏构图。画面：码头仓库，铁皮屋顶。",
      directorVideoPrompt: "竖屏构图。从起始画面开始：雨砸在铁皮屋顶上。",
    };
    const next = applyDirectorPlan(film, [shot], shot.sceneId);
    const saved = next.shots.find((item) => item.id === "new-shot")!;
    expect(saved.directorFramePrompt).toBe("横屏构图。画面：码头仓库。");
    expect(saved.promptZh).toBe("横屏构图。画面：码头仓库，铁皮屋顶。");
    expect(saved.directorVideoPrompt).toBe("横屏构图。从起始画面开始：雨砸在铁皮屋顶上。");
  });

  it("tells the director which way the work is framed", () => {
    const film = landscape();
    const scene = film.scenes.find((item) => film.shots.some((shot) => shot.sceneId === item.id))!;
    const input = directorRequestInput(film, scene.id, scene.text, film.sourceText);
    expect(input.context).toContain("画幅：横屏 16:9。起始画面以「横屏构图。」开头，不写竖屏。");
    expect(aspectContext({ aspectRatio: "9:16" })).toBe(
      "画幅：竖屏 9:16。起始画面以「竖屏构图。」开头。",
    );
  });
});
