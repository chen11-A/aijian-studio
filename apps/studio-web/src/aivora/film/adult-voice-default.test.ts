import { expect, it } from "vitest";
import { adultVoiceEvidence } from "./adult-voice-default";
import { normalizeAgeBand } from "./cast-traits";
import { autoVoiceForCharacter, mergeCast, parseCastReply } from "./operations";
import { blankFilm, readFilm, writeFilm } from "./project";
const cast = (gender = "男", age = "adult") =>
  mergeCast(
    blankFilm(),
    parseCastReply(JSON.stringify({ characters: [{ name: "甲", gender, age_band: age }] }))!,
  );
it("preserves explicit adulthood separately from an unknown age band and serializes its casting default", () => {
  const film = cast();
  const person = film.characters[0]!;
  expect(normalizeAgeBand("adult")).toBe("");
  expect(person.ageBand).toBe("");
  expect(person.voiceId).toBe("leo");
  expect(person.voiceDefault).toEqual({
    basis: "adult-default",
    evidenceSource: "character-reply",
    evidence: "adult",
  });
  writeFilm(localStorage, film);
  expect(readFilm(localStorage)!.characters[0]!.voiceDefault).toEqual(person.voiceDefault);
});
it("uses gender-specific adult voices without inventing an age", () => {
  expect(cast("女").characters[0]).toMatchObject({ ageBand: "", voiceId: "ara" });
  expect(cast("").characters[0]).toMatchObject({
    ageBand: "",
    voiceId: "",
    voiceCode: "VOICE_TRAITS_REQUIRED",
  });
});
it("does not infer adulthood from an occupation or another person's description", () => {
  expect(adultVoiceEvidence("打手甲", "打手", "成年男子周烈站着。")).toBeUndefined();
  expect(adultVoiceEvidence("甲", "", "乙说：“甲是个男人。”")).toBeUndefined();
});
it("clears adult defaults when explicit source age selects a precise category", () => {
  const person = autoVoiceForCharacter(cast().characters[0]!, new Set(), "甲，二十六岁。");
  expect(person).toMatchObject({ ageBand: "青年", voiceId: "helios" });
  expect(person.voiceDefault).toBeUndefined();
});
it("preserves hand-selected voices and explicit unknown age locks", () => {
  const person = cast().characters[0]!;
  expect(
    autoVoiceForCharacter({ ...person, voiceId: "orion", userFields: ["voiceId"] }).voiceId,
  ).toBe("orion");
  expect(autoVoiceForCharacter({ ...person, userFields: ["ageBand"] })).toMatchObject({
    ageBand: "",
    voiceId: "",
    voiceCode: "VOICE_TRAITS_REQUIRED",
  });
});
it("reuses the same gender's adult voice when the pool is exhausted", () => {
  const person = cast().characters[0]!;
  expect(
    autoVoiceForCharacter(
      { ...person, voiceId: "" },
      new Set(["leo", "rex", "atlas", "perseus", "zagan", "sal", "lux"]),
    ).voiceId,
  ).toBe("leo");
});

it("does not mistake a minor or negated adult description for adulthood", () => {
  expect(adultVoiceEvidence("甲", "未成年打手", "")).toBeUndefined();
  expect(adultVoiceEvidence("甲", "", "三个未成年男人走来。领头的叫甲。")).toBeUndefined();
});

it("keeps explicit adult evidence from structured callers that bypass reply parsing", () => {
  const film = mergeCast(blankFilm(), {
    characters: [{ name: "甲", identity: "", gender: "男", ageBand: "adult" }],
    locations: [],
  });
  expect(film.characters[0]).toMatchObject({
    ageBand: "",
    voiceId: "leo",
    voiceDefault: { evidenceSource: "character-reply", evidence: "adult" },
  });
});

it("persists changed default provenance even when the chosen voice does not change", () => {
  const film = cast();
  film.sourceText = "甲是个男人。";
  const refreshed = mergeCast(film, { characters: [], locations: [] });
  expect(refreshed.characters[0]!.voiceId).toBe(film.characters[0]!.voiceId);
  expect(refreshed.characters[0]!.voiceDefault).toMatchObject({
    evidenceSource: "source",
    evidence: "甲：男人",
  });
});
