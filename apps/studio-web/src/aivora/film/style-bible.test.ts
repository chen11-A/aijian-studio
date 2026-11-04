import { describe, expect, it, vi } from "vitest";
import { sampleFilm, keyframePrompt, upgradeFilm } from "./project";
import {
  portraitPrompts,
  locationPlate,
  storyFilmBatches,
  keyframeVariants,
  continuityPrompt,
} from "./operations";
import { applyArtDraft, requestShotStill } from "../pro/workflow";
import { artFromModel } from "./phase2";
import { setFilmStyle, styleRequestMetadata, withStyleBible } from "./style-bible";
const style = "固定画风：青灰色。\n柔和逆光；胶片镜头，九十年代。";
const count = (value: string) => value.split(style).length - 1;
describe("persisted style bible", () => {
  it("applies art style, persists its revision and marks old shots without destroying edits or media", () => {
    const film = sampleFilm();
    const shot = film.shots[0]!;
    shot.userFields = ["picture", "action"];
    shot.poster = "/old.png";
    shot.selectedTakeId = "chosen";
    film.characters[0]!.userFields = ["identity"];
    const parsed = artFromModel({
      prompt_block_zh: style,
      identities: [{ name: film.characters[0]!.name, identity: "new" }],
    })!;
    const next = applyArtDraft(film, parsed);
    expect(next.styleZh).toBe(style);
    expect(next.styleRevision).toBe(1);
    expect(next.shots[0]).toMatchObject({
      ...shot,
      regenerationRequired: { code: "STYLE_CHANGED", styleRevision: 1 },
    });
    expect(next.characters[0]?.identity).toBe(film.characters[0]?.identity);
    expect(film.shots[0]?.regenerationRequired).toBeUndefined();
    const restored = upgradeFilm(JSON.parse(JSON.stringify(next)))!;
    expect(restored.styleZh).toBe(style);
    expect(restored.shots[0]?.regenerationRequired?.code).toBe("STYLE_CHANGED");
    expect(setFilmStyle(next, style)).toBe(next);
  });
  it("includes the verbatim bible exactly once in every portrait, location, and first-frame prompt", () => {
    const film = setFilmStyle(sampleFilm(), style);
    const shot = film.shots[0]!;
    for (const portrait of portraitPrompts("人物", "成年男子", style))
      expect(count(portrait.prompt)).toBe(1);
    expect(count(locationPlate("书店", style, "夜"))).toBe(1);
    const keyframe = keyframePrompt(shot, film);
    expect(count(keyframe)).toBe(1);
    for (const variant of keyframeVariants(shot, film)) expect(count(variant)).toBe(1);
    const previousDescription = "雨里奔跑，人物说：不要离开雨里。";
    const continued = continuityPrompt({ ...shot, picture: previousDescription }, shot, film);
    expect(continued).toContain(previousDescription);
    expect(count(continued)).toBe(1);
    expect(withStyleBible(keyframe, style)).toBe(keyframe);
    expect(withStyleBible(`${style}\n${style}`, style)).toContain(`${style}\n${style}`);
  });
  it("preserves the entire video description or rejects it instead of trimming its ending", () => {
    const film = setFilmStyle(sampleFilm(), style);
    const ending = "末尾动作：放下刀，警笛响起。";
    const shot = {
      ...film.shots[0]!,
      line: "",
      lines: [],
      picture: "雨".repeat(300) + ending,
      promptZh: "",
      performance: "",
    };
    const request = storyFilmBatches(film, [shot], false)[0]!.shots[0]!;
    expect(count(request.prompt)).toBe(1);
    expect(request.prompt).toContain(ending);
    expect(request.prompt).toContain(`【画风说明】\n${style}\n【画风说明结束】`);
    expect(() =>
      storyFilmBatches(film, [{ ...shot, picture: "雨".repeat(2000) + ending }], false),
    ).toThrow(expect.objectContaining({ code: "MEDIA_DESCRIPTION_TOO_LONG" }));
    expect(() => withStyleBible("雨".repeat(2000) + ending, "", 2000)).toThrow(
      expect.objectContaining({ code: "MEDIA_DESCRIPTION_TOO_LONG" }),
    );
    expect(withStyleBible("原文末尾。", "", 5)).toBe("原文末尾。");
    const exact = withStyleBible("原文末尾。", "画风");
    expect(withStyleBible("原文末尾。", "画风", exact.length)).toBe(exact);
    expect(() => withStyleBible("原文末尾。", "画风", exact.length - 1)).toThrow(
      expect.objectContaining({ code: "MEDIA_DESCRIPTION_TOO_LONG" }),
    );
    expect(() => withStyleBible("画面", "风".repeat(2001), 2000)).toThrow(
      expect.objectContaining({ code: "STYLE_BIBLE_TOO_LONG" }),
    );
  });
  it("never deletes a short style from narration or dialogue and replaces only constructed blocks", () => {
    const narrative = "雨里奔跑。林晚说：“雨，别停。”";
    const first = withStyleBible(narrative, "雨");
    expect(first.startsWith(narrative)).toBe(true);
    expect(withStyleBible(first, "雨")).toBe(first);
    const changed = withStyleBible(first, "雪");
    expect(changed.startsWith(narrative)).toBe(true);
    expect(changed).not.toContain("【画风说明】\n雨\n【画风说明结束】");
    expect(changed).toContain("【画风说明】\n雪\n【画风说明结束】");
    expect(withStyleBible("雨", "雨")).toBe("雨\n【画风说明】\n雨\n【画风说明结束】");
    expect(withStyleBible(first, "")).toBe(narrative);
  });
  it("does not send a truncated second style and preserves the per-shot note", () => {
    const longStyle = "冷光、自然肤色。".repeat(55);
    const film = setFilmStyle(sampleFilm(), longStyle);
    const shot = { ...film.shots[0]!, styleNote: "这一镜人物眼神光要柔和。" };
    const batch = storyFilmBatches(film, [shot], false)[0]!;
    expect(batch).not.toHaveProperty("style_block");
    expect(batch.shots[0]!.prompt).toContain(longStyle);
    expect(batch.shots[0]!.prompt).toContain(shot.styleNote);
  });

  it("injects at the image bridge boundary even when a caller supplies its own prompt", async () => {
    const film = setFilmStyle(sampleFilm(), style);
    const shot = film.shots[0]!;
    const generate = vi.fn(async (_series: string, _prompt: string) => ({
      path: "/frame.png",
      reason: "",
    }));
    const old = window.aijian;
    window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
    try {
      await requestShotStill(film, shot, "用户独立画面描述。");
      expect(count(generate.mock.calls[0]![1] as string)).toBe(1);
      await requestShotStill(film, shot, keyframePrompt(shot, film));
      expect(count(generate.mock.calls[1]![1] as string)).toBe(1);
    } finally {
      window.aijian = old;
    }
  });
  it("produces digest and count evidence without recording style or source prose", async () => {
    const film = setFilmStyle(sampleFilm(), style);
    const first = await styleRequestMetadata(film);
    const second = await styleRequestMetadata(film);
    expect(first).toEqual(second);
    expect(first.styleSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.styleCharacters).toBe(style.length);
    expect(JSON.stringify(first)).not.toContain("固定画风");
    expect((await styleRequestMetadata({ ...film, styleZh: style + "暖光" })).styleSha256).not.toBe(
      first.styleSha256,
    );
  });
});
