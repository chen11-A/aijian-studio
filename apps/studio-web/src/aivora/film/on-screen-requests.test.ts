import { describe, expect, it } from "vitest";
import { keyframePrompt, sampleFilm, shotIdentity } from "./project";
import { firstFrameReferences, shotReference, storyFilmBatches } from "./operations";
import { withShotActions } from "./shot-actions";

function setup() {
  const film = sampleFilm();
  film.characters = ["林晚", "沈砚"].map((name, index) => ({
    ...film.characters[0]!,
    id: `cast-${index}`,
    name,
    identity: index === 0 ? "林晚，白衬衫" : "沈砚，黑风衣",
    voiceId: index === 0 ? "eve" : "leo",
    portraits: [{ view: "正面", prompt: "", url: `https://images.test/${index}.png` }],
  }));
  const shot = {
    ...film.shots[0]!,
    picture: "林晚看着照片。沈砚不入画。",
    action: "林晚抬头。沈砚握拳。",
    performance: "林晚皱眉。沈砚咬牙。",
    directorFramePrompt: "林晚看着照片。沈砚穿黑风衣站在她身后。",
    directorVideoPrompt: "林晚抬头。沈砚走到她身边。",
    characters: ["林晚", "沈砚"],
    speaker: "沈砚",
    lines: [{ speaker: "沈砚", text: "你来晚了。" }],
    line: "你来晚了。",
    userFields: [],
    poster: "https://images.test/frame.png",
    stills: [],
  };
  return { film, shot };
}

describe("3JR-B06 production payload boundaries (synthetic regression)", () => {
  it("does not add an offscreen speaker's identity or stale positive framing", () => {
    const { film, shot } = setup();
    expect(shotIdentity(shot, film)).toBe("林晚，白衬衫");
    const prompt = keyframePrompt(shot, film);
    expect(prompt).toContain("林晚");
    expect(prompt).toContain("沈砚不入画");
    expect(prompt).not.toContain("黑风衣");
    expect(prompt).not.toContain("握拳");
    expect(prompt).not.toContain("咬牙");
  });

  it("filters offscreen portraits from both reference paths, retaining the selected frame", () => {
    const { film, shot } = setup();
    expect(firstFrameReferences(film, shot)).toEqual(["https://images.test/0.png"]);
    expect(shotReference(shot, film)).toEqual({
      still: "https://images.test/frame.png",
      references: [{ url: "https://images.test/0.png", who: "林晚" }],
    });
  });

  it("filters visual video payload fields without deleting offscreen speech", () => {
    const { film, shot } = setup();
    const original = structuredClone(shot);
    const payload = storyFilmBatches(film, [shot], false)[0]!.shots[0]!;
    expect(payload.identity).toBe("林晚，白衬衫");
    expect(payload.prompt).toContain("沈砚不入画");
    expect(payload.prompt).not.toContain("走到她身边");
    expect(payload.action).toBe("林晚抬头。");
    expect(payload.performance).toBe("林晚皱眉。");
    expect(payload.references).toEqual(["https://images.test/0.png"]);
    expect(payload.narration).toBe("你来晚了。");
    expect(payload.voice_id).toBe("leo");
    expect(shot).toEqual(original);
  });

  it("reads a negative constraint in later actionBeats without dropping other actions", () => {
    const { film, shot: original } = setup();
    const shot = withShotActions(
      { ...original, picture: "林晚看照片。", directorFramePrompt: "", directorVideoPrompt: "" },
      ["林晚抬头。", "沈砚不入画。", "林晚放下照片。"],
    );
    expect(shotIdentity(shot, film)).toBe("林晚，白衬衫");
    const payload = storyFilmBatches(film, [shot], false)[0]!.shots[0]!;
    expect(payload.action).toContain("林晚抬头。");
    expect(payload.action).toContain("林晚放下照片。");
    expect(payload.action).toContain("沈砚不入画。");
    expect(payload.references).toEqual(["https://images.test/0.png"]);
  });

  it("keeps the style intact and includes the exclusion inside the video length check", () => {
    const { film, shot } = setup();
    film.styleZh = "林晚与沈砚的雨夜故事，克制的胶片风格。";
    expect(storyFilmBatches(film, [shot], false)[0]!.shots[0]!.prompt).toContain(film.styleZh);
    film.styleZh = "";
    shot.directorVideoPrompt = "雨";
    const fixedCost = storyFilmBatches(film, [shot], false)[0]!.shots[0]!.prompt.length - 1;
    shot.directorVideoPrompt = "雨".repeat(2000 - fixedCost);
    expect(storyFilmBatches(film, [shot], false)[0]!.shots[0]!.prompt).toHaveLength(2000);
    shot.directorVideoPrompt += "雨";
    expect(() => storyFilmBatches(film, [shot], false)).toThrow(
      expect.objectContaining({ code: "MEDIA_DESCRIPTION_TOO_LONG" }),
    );
  });
});
