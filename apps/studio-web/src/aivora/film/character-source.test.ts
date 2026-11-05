import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceCharacterEvidence } from "./character-source";
import { castTraits, mergeCast, parseCastReply } from "./operations";
import { blankFilm, readFilm, writeFilm } from "./project";

const source = readFileSync(
  resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
  "utf8",
);

describe("3JR-B05 explicit source age and persisted voice", () => {
  it("reads the novel's name-linked next-sentence age instead of keeping an incorrect model band", () => {
    expect(sourceCharacterEvidence(source, "林晚")).toEqual({ ageText: "二十六岁", gender: "女" });
    expect(castTraits("女店主", "林晚", source, "女", "中年")).toEqual({
      gender: "女",
      ageBand: "青年",
    });
    const base = { ...blankFilm(), sourceText: source };
    const parsed = parseCastReply(
      '{"characters":[{"name":"林晚","gender":"女","age_band":"中年","identity":"女店主"}]}',
    )!;
    const first = mergeCast(base, parsed);
    expect(first.characters[0]).toMatchObject({ ageBand: "青年", voiceCode: "" });
    expect(["iris", "sirius", "cosmo", "helix"]).toContain(first.characters[0]!.voiceId);
    writeFilm(localStorage, first);
    expect(readFilm(localStorage)!.characters[0]).toMatchObject({
      gender: "女",
      ageBand: "青年",
      voiceId: first.characters[0]!.voiceId,
    });
  });

  it("repairs existing automatic traits but preserves explicitly edited age and voice", () => {
    const base = { ...blankFilm(), sourceText: source };
    const older = mergeCast(
      { ...base, sourceText: "" },
      {
        characters: [{ name: "林晚", identity: "", gender: "女", ageBand: "中年" }],
        locations: [],
      },
    );
    older.sourceText = source;
    expect(mergeCast(older, { characters: [], locations: [] }).characters[0]!.ageBand).toBe("青年");
    const ageLocked = {
      ...older,
      characters: older.characters.map((person) => ({
        ...person,
        userFields: ["ageBand"],
        ageBand: "中年" as const,
      })),
    };
    expect(mergeCast(ageLocked, { characters: [], locations: [] }).characters[0]!.ageBand).toBe(
      "中年",
    );
    const voiceLocked = {
      ...older,
      characters: older.characters.map((person) => ({
        ...person,
        userFields: ["voiceId"],
        voiceId: "eve",
      })),
    };
    expect(mergeCast(voiceLocked, { characters: [], locations: [] }).characters[0]).toMatchObject({
      ageBand: "青年",
      voiceId: "eve",
    });
  });

  it("uses saved scene text when an older project has no top-level manuscript", () => {
    const film = blankFilm();
    film.sourceText = "";
    film.scenes[0]!.text = source;
    const parsed = parseCastReply(
      '{"characters":[{"name":"林晚","gender":"女","age_band":"中年"}]}',
    )!;
    expect(mergeCast(film, parsed).characters[0]).toMatchObject({ ageBand: "青年", voiceCode: "" });
  });

  it("does not borrow another person's age or invent an adult age band for unnamed henchmen", () => {
    expect(castTraits("", "林晚", "林晚看着母亲。她六十五岁。", "女").ageBand).toBe("");
    expect(sourceCharacterEvidence(source, "周烈")).toEqual({ ageText: "", gender: "男" });
    const film = mergeCast(
      { ...blankFilm(), sourceText: source },
      {
        characters: [
          { name: "周烈", identity: "寸头、金链" },
          { name: "打手甲", identity: "", gender: "男" },
          { name: "打手乙", identity: "", gender: "男" },
        ],
        locations: [],
      },
    );
    expect(film.characters[0]).toMatchObject({
      gender: "男",
      ageBand: "",
      voiceCode: "",
      voiceDefault: { basis: "adult-default", evidenceSource: "source" },
    });
    expect(film.characters[0]!.voiceId).toBeTruthy();
    for (const person of film.characters.slice(1))
      expect(person).toMatchObject({
        gender: "男",
        ageBand: "",
        voiceId: "",
        voiceCode: "VOICE_TRAITS_REQUIRED",
      });
  });

  it.each([
    [26, "青年"],
    ["六十五岁", "老年"],
    [100, "老年"],
    [8, "儿童"],
    [15, "少年"],
    [45, "中年"],
  ])("keeps explicit reply age %s without needing a fabricated source age", (age, ageBand) => {
    // Synthetic reply coverage; the novel does not supply these ages for 周烈.
    const cast = parseCastReply(
      JSON.stringify({ characters: [{ name: "周烈", gender: "男", age }] }),
    )!;
    expect(cast.characters[0]!.ageBand).toBe(ageBand);
    const film = mergeCast(blankFilm(), cast);
    expect(film.characters[0]!.voiceId).not.toBe("");
  });

  it("preserves unknown or invalid ages as unknown", () => {
    for (const age of ["未知", 999, -1, 26.5])
      expect(
        parseCastReply(JSON.stringify({ characters: [{ name: "路人", gender: "男", age }] }))!
          .characters[0]!.ageBand,
      ).toBe("");
    expect(castTraits("100岁", "老人", "", "男").ageBand).toBe("老年");
  });
});
