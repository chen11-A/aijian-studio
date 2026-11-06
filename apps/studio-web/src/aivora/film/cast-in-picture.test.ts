import { describe, expect, it } from "vitest";
import { portraitPrompts } from "./operations";
import { castTraitsLine, keyframePrompt, sampleFilm, type FilmProject } from "./project";

function film(): FilmProject {
  const base = sampleFilm();
  const person = base.characters[0]!;
  base.characters = [
    {
      ...person,
      id: "c-shen",
      name: "沈砚",
      identity: "三十岁上下的男人，短发",
      gender: "男",
      ageBand: "青年",
    },
    {
      ...person,
      id: "c-thug",
      name: "打手甲",
      identity: "壮实男人，平头",
      gender: "男",
      ageBand: "",
    },
    {
      ...person,
      id: "c-po",
      name: "阿婆",
      identity: "七十岁上下，花白短发，背有点驼",
      gender: "女",
      ageBand: "老年",
    },
  ];
  return base;
}

const shotWith = (base: FilmProject, characters: string[], picture: string) => ({
  ...base.shots[0]!,
  userFields: [],
  characters,
  picture,
  action: "",
  directorFramePrompt: undefined,
  promptZh: undefined,
});

describe("R2-B06 the cast list's gender and age are written into portraits and pictures", () => {
  it("says who the person is before the looks in every portrait", () => {
    for (const item of portraitPrompts("阿婆", "七十岁上下，花白短发，背有点驼", "写实", {
      gender: "女",
      ageBand: "老年",
    }))
      expect(item.prompt).toContain("阿婆是女性，老年。七十岁上下，花白短发");
    // Without the cast list's traits the portrait is as before.
    for (const item of portraitPrompts("阿婆", "七十岁上下", "写实"))
      expect(item.prompt).not.toContain("是女性");
  });

  it("writes only what is known", () => {
    expect(castTraitsLine({ name: "打手甲", gender: "男", ageBand: "" })).toBe("打手甲是男性。");
    expect(castTraitsLine({ name: "某人", gender: "", ageBand: "不详" })).toBe("");
  });

  it("names each person's gender in the keyframe", () => {
    const base = film();
    const prompt = keyframePrompt(shotWith(base, ["阿婆"], "阿婆端来两碗热豆浆。"), base);
    expect(prompt).toContain("阿婆是女性，老年。");
  });
});

describe("R2-B05 a picture has only the people listed for its shot", () => {
  it("says so for a fight with two people", () => {
    const base = film();
    const prompt = keyframePrompt(
      shotWith(base, ["沈砚", "打手甲"], "沈砚扣住打手甲的手腕。"),
      base,
    );
    expect(prompt).toContain("画面里只有沈砚、打手甲，不要多画别的人。");
  });

  it("leaves a crowd the source names, and an empty street, as they are", () => {
    const base = film();
    expect(keyframePrompt(shotWith(base, ["沈砚"], "沈砚穿过围观的人群。"), base)).not.toContain(
      "画面里只有",
    );
    expect(keyframePrompt(shotWith(base, [], "雨夜的青石巷，没有人。"), base)).not.toContain(
      "画面里只有",
    );
  });
});
