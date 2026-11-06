import { describe, expect, it } from "vitest";
import { sampleFilm, type FilmCharacter } from "./project";
import {
  constrainVisualPrompt,
  offscreenCharacterNames,
  onScreenCharacters,
  withoutOffscreenVisuals,
} from "./on-screen-characters";
import { parseDirectorPlan } from "./director-plan";

function setup() {
  const film = sampleFilm();
  film.characters = ["林晚", "沈砚", "周烈"].map((name, i): FilmCharacter => ({
    id: `cast-${i}`,
    name,
    identity: `${name}，独特外貌${i}`,
    voiceId: `voice-${i}`,
    source: "test",
    userFields: [],
    portraits: [{ view: "正面", prompt: name, url: `https://images.test/${i}.png` }],
  }));
  const shot = {
    ...film.shots[0]!,
    picture: "林晚在旧书店门口。沈砚不入画。",
    action: "林晚抬眼。",
    performance: "",
    blocking: "",
    facing: "",
    characters: ["林晚", "沈砚"],
    speaker: "沈砚",
    lines: [{ speaker: "沈砚", text: "你来晚了。" }],
    line: "你来晚了。",
  };
  return { film, shot };
}

describe("3JR-B06 shot-level visual exclusions (synthetic request regression)", () => {
  it("treats punctuation in literal character names as text, not a pattern", () => {
    const { film, shot } = setup();
    film.characters[1]!.name = "沈砚(甲)";
    shot.characters = ["林晚", "沈砚(甲)"];
    shot.speaker = "沈砚(甲)";
    shot.lines = [];
    shot.picture = "沈砚(甲)不入画，林晚在门口。";
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["林晚"]);
  });

  it.each([
    "沈砚不入画。",
    "沈砚（不入画）。",
    "沈砚：画外音。",
    "沈砚的声音从画外传来。",
    "不要让沈砚入画。",
    "画外音：沈砚。",
    "沈砚不在画面中。",
    "沈砚在画外等待。",
    "沈砚不出现在画面里。",
    "沈砚 off-screen。",
  ])("does not turn an absent speaker into a visible reference: %s", (constraint) => {
    const { film, shot } = setup();
    shot.picture = `林晚在门口。${constraint}`;
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["林晚"]);
    expect(shot.speaker).toBe("沈砚");
    expect(shot.line).toBe("你来晚了。");
    expect(shot.characters).toEqual(["林晚", "沈砚"]);
  });

  it("excludes an explicitly named group, but not another person elsewhere in the clause", () => {
    const { film, shot } = setup();
    shot.picture = "沈砚和周烈均不入画。林晚在书店门口。";
    expect(
      offscreenCharacterNames(
        shot,
        film.characters.map((person) => person.name),
      ),
    ).toEqual(["沈砚", "周烈"]);
    shot.picture = "沈砚看着林晚（不入画）。";
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["沈砚"]);
  });

  it("does not interpret spoken words or a negated absence as a visual exclusion", () => {
    const { film, shot } = setup();
    shot.picture = "林晚和沈砚站在门口。";
    shot.line = "沈砚不入画。";
    shot.lines = [{ speaker: "沈砚", text: shot.line }];
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["林晚", "沈砚"]);
    shot.picture = "不是沈砚不入画，而是周烈不出镜。";
    expect(
      offscreenCharacterNames(
        shot,
        film.characters.map((person) => person.name),
      ),
    ).toEqual(["周烈"]);
  });

  it("honors an offscreen annotation on the speaker label without scanning the dialogue", () => {
    const { film, shot } = setup();
    shot.picture = "林晚站在门口。";
    shot.speaker = "沈砚（画外音）";
    shot.lines = [{ speaker: "沈砚（画外音）", text: "你来晚了。" }];
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["林晚"]);
  });

  it("leaves out a person the director placed 画外, while the plan still matches the shot (3JR-B06)", () => {
    const { film, shot } = setup();
    // The knife shot: Lin Wan shouts 「小心！」 from off frame. The director lists her (a speaker
    // must be in characters) and marks her position 画外, as the director prompt asks.
    Object.assign(shot, {
      picture: "第三个人亮出折叠刀，刀刃在灯下一闪。",
      action: "",
      characters: ["沈砚", "林晚"],
      speaker: "林晚",
      lines: [{ speaker: "林晚", text: "小心！" }],
      line: "小心！",
    });
    shot.directorPlan = parseDirectorPlan(
      {
        positions: [
          { name: "沈砚", position: "画中", depth: "中间", visible: "半身" },
          { name: "林晚", position: "画外", depth: "", visible: "画外" },
        ],
      },
      shot,
    );
    expect(offscreenCharacterNames(shot, ["林晚", "沈砚", "周烈"])).toEqual(["林晚"]);
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["沈砚"]);
    // Her voice is untouched.
    expect(shot.lines).toEqual([{ speaker: "林晚", text: "小心！" }]);
    // Once a person edits who is in the shot, the old plan no longer decides.
    shot.userFields = ["characters"];
    expect(offscreenCharacterNames(shot, ["林晚", "沈砚", "周烈"])).toEqual([]);
  });

  it("keeps a person visible in a merged shot when one part shows them (3JR-B06)", () => {
    const { film, shot } = setup();
    Object.assign(shot, { picture: "沈砚挡刀，林晚扑过来。", characters: ["沈砚", "林晚"] });
    const plan = (visible: string) =>
      parseDirectorPlan({ positions: [{ name: "林晚", position: visible, visible }] }, shot)!;
    shot.directorPlan = {
      ...plan("画外"),
      segments: [...plan("画外").segments, ...plan("画右").segments],
    };
    expect(
      offscreenCharacterNames(
        shot,
        film.characters.map((person) => person.name),
      ),
    ).toEqual([]);
  });

  it("does not inject the entire cast when no person is selected or named", () => {
    const { film, shot } = setup();
    Object.assign(shot, {
      picture: "雨水落在书店门前。",
      action: "",
      characters: [],
      speaker: "",
      lines: [],
      line: "",
    });
    expect(onScreenCharacters(film, shot)).toEqual([]);
    shot.picture = "林晚在门口。";
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["林晚"]);
  });

  it("removes stale positive prompt/acting/position clauses and retains the absence", () => {
    const { film, shot } = setup();
    const prompt = "林晚握着照片。沈砚，黑风衣，站在林晚旁边。沈砚：皱眉。沈砚不入画。雨夜冷光。";
    const next = constrainVisualPrompt(prompt, film, shot);
    expect(next).toContain("林晚握着照片");
    expect(next).toContain("雨夜冷光");
    expect(next).toContain("沈砚不入画");
    expect(next).not.toContain("黑风衣");
    expect(next).not.toContain("皱眉");
    expect(next).toContain("画面限制：沈砚不入画。");
    expect(constrainVisualPrompt(next, film, shot)).toBe(next);
    expect(withoutOffscreenVisuals("沈砚挥手。林晚抬头。", film, shot)).toBe("林晚抬头。");
  });

  it("enforces the current picture over a cached prompt without editing saved source", () => {
    const { film, shot } = setup();
    shot.directorFramePrompt = "沈砚走进书店。";
    const saved = structuredClone(shot);
    expect(constrainVisualPrompt(shot.directorFramePrompt, film, shot)).toBe(
      "画面限制：沈砚不入画。",
    );
    expect(shot).toEqual(saved);
    shot.picture = "沈砚走进书店，林晚在门口。";
    expect(constrainVisualPrompt(shot.directorFramePrompt, film, shot)).toBe(
      shot.directorFramePrompt,
    );
  });

  it("honors active prompt exclusions but does not revive a cached prompt after a picture edit", () => {
    const { film, shot } = setup();
    shot.picture = "林晚看着照片。";
    shot.directorFramePrompt = "林晚看着照片，沈砚不入画。";
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["林晚"]);
    shot.picture = "林晚和沈砚在门口。";
    shot.userFields = ["picture"];
    expect(onScreenCharacters(film, shot).map((person) => person.name)).toEqual(["林晚", "沈砚"]);
  });
});
