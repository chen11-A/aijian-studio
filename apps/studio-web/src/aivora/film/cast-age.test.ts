import { describe, expect, it } from "vitest";
import { applyArtDraft } from "../pro/workflow";
import { castTraits } from "./operations";
import { artCastContext, sampleFilm } from "./project";

describe("3JR-B15 (R2-B04) side characters get an age band", () => {
  it.each([
    ["二十多岁的壮实男人，平头", "青年"],
    ["二十几岁的瘦高男人", "青年"],
    ["三十来岁的女人", "青年"],
    ["四十出头的男人，寸头", "中年"],
    ["四十岁左右的男人", "中年"],
    ["十几岁的少年", "少年"],
    ["六十多岁的老人", "老年"],
  ])("reads 「%s」 as %s", (identity, band) => {
    expect(castTraits(identity, "打手甲").ageBand).toBe(band);
  });

  it("asks the art agent to decide each unknown gender and age band", () => {
    const film = sampleFilm();
    film.characters = film.characters.slice(0, 2).map((person, index) => ({
      ...person,
      name: index ? "周烈" : "林晚",
      gender: index ? "男" : "女",
      ageBand: index ? "" : "青年",
    }));
    const context = artCastContext(film);
    expect(context.startsWith("人物：")).toBe(true);
    const people = JSON.parse(context.slice("人物：".length)) as Record<string, string>[];
    expect(people.map(({ name, gender, age_band }) => [name, gender, age_band])).toEqual([
      ["林晚", "女", "青年"],
      ["周烈", "男", "未知"],
    ]);
  });

  it("takes the age band from the looks the art agent writes", () => {
    const film = sampleFilm();
    const person = {
      ...film.characters[0]!,
      name: "周烈",
      gender: "男" as const,
      ageBand: "" as const,
      userFields: [],
    };
    film.characters = [person];
    const next = applyArtDraft(film, {
      styleZh: film.styleZh,
      identities: [{ name: "周烈", identity: "四十岁左右的男人，剃着寸头，一颗金牙" }],
      places: [],
      props: [],
    } as unknown as Parameters<typeof applyArtDraft>[1]);
    expect(next.characters[0]!.ageBand).toBe("中年");
  });
});
