import { describe, expect, it } from "vitest";
import { assignVoice } from "../../film/operations";
import { voiceGroups, voicePoolFor, voicesForGender } from "./voices";

const list = (...ids: string[]) => ids.map((id) => ({ id, label: id }));

describe("voicePoolFor", () => {
  it("follows GPT's own choice: the first voice of the pool is the one GPT hands out", () => {
    for (const ageBand of ["儿童", "少年", "青年", "中年", "老年"] as const) {
      const pool = voicePoolFor("男", ageBand);
      expect(pool.length, ageBand).toBeGreaterThan(0);
      expect(pool[0]).toBe(assignVoice("", "", new Set(), "男", ageBand));
      expect(new Set(pool).size).toBe(pool.length);
    }
  });

  it("is empty until both gender and age band are known", () => {
    expect(voicePoolFor("", "中年")).toEqual([]);
    expect(voicePoolFor("女", "")).toEqual([]);
  });

  it("never mixes the two genders", () => {
    const male = voicesForGender("男");
    for (const id of voicesForGender("女")) expect(male.has(id), id).toBe(false);
  });
});

describe("voiceGroups", () => {
  const male = [...voicesForGender("男")];
  const female = [...voicesForGender("女")];
  const middleMan = voicePoolFor("男", "中年");
  const elderMan = voicePoolFor("男", "老年").find((id) => !middleMan.includes(id))!;

  it("lists only voices of the character's gender, fitting ones first", () => {
    const groups = voiceGroups(list(female[0]!, middleMan[0]!, elderMan), "男", "中年");
    expect(groups.fitting.map((voice) => voice.id)).toEqual([middleMan[0]]);
    expect(groups.others.map((voice) => voice.id)).toEqual([elderMan]);
  });

  it("offers every voice while the gender is not written", () => {
    const groups = voiceGroups(list(female[0]!, male[0]!), "", "");
    expect(groups.fitting).toEqual([]);
    expect(groups.others).toHaveLength(2);
  });

  it("keeps the voice the character already has, even of the other gender", () => {
    const groups = voiceGroups(list(female[0]!, middleMan[0]!), "男", "中年", female[0]);
    expect(groups.others.map((voice) => voice.id)).toContain(female[0]);
  });

  it("leaves out voices GPT has not put under any gender", () => {
    const groups = voiceGroups(list("not-a-preset", middleMan[0]!), "男", "中年");
    expect([...groups.fitting, ...groups.others].map((voice) => voice.id)).toEqual([middleMan[0]]);
  });
});
