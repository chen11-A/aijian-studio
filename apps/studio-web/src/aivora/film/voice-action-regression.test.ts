import { describe, expect, it } from "vitest";
import { blankFilm, sampleFilm, readFilm, writeFilm } from "./project";
import {
  assignVoice,
  beatsForShot,
  castTraits,
  keepFightDetails,
  mergeCast,
  parseCastReply,
  shotReference,
} from "./operations";
const men = ["leo", "rex", "atlas", "perseus", "zagan", "sal", "lux"];
describe("phase3j cast, actions and reference regressions", () => {
  it("prioritizes structured traits and reuses the proper voice category", () => {
    const film = mergeCast(blankFilm(), {
      characters: [
        { name: "周明", gender: "男", ageBand: "成年", identity: "女主角的丈夫，照看孩子的保安" },
      ],
      locations: [],
    });
    expect(men).toContain(film.characters[0]?.voiceId);
    expect(men).toContain(assignVoice("男 成年", "周明", new Set(men)));
    expect(men).toContain(
      assignVoice("男 成年", "周明", new Set([...men, "ara", "eve", "luna", "carina", "celeste"])),
    );
  });
  it("serializes reply traits and fills existing characters from source", () => {
    const parsed = parseCastReply(
      '{"characters":[{"name":"林晚","gender":"女","age_band":"成年"}]}',
    );
    expect(JSON.parse(JSON.stringify(parsed)).characters[0]).toMatchObject({
      gender: "女",
      ageBand: "成年",
    });
    expect(castTraits("", "林国栋", "她想起父亲林国栋。")).toEqual({
      gender: "男",
      ageBand: "成年",
    });
    expect(castTraits("", "阿婆")).toEqual({ gender: "女", ageBand: "老年" });
    expect(castTraits("", "林国栋", "父亲林国栋，六十五岁。")).toEqual({
      gender: "男",
      ageBand: "老年",
    });
    expect(assignVoice("照看孩子的男人", "甲", new Set(), "male", "elderly")).toBe("orion");
    const film = blankFilm();
    film.sourceText = "父亲林国栋早已离开。";
    film.characters = [
      {
        id: "father",
        name: "林国栋",
        identity: "",
        voiceId: "eve",
        portraits: [],
        source: "script",
        userFields: [],
      },
    ];
    const result = mergeCast(film, { characters: [], locations: [] });
    expect(result.characters[0]).toMatchObject({ gender: "男", ageBand: "成年" });
    expect(men).toContain(result.characters[0]?.voiceId);
    writeFilm(localStorage, result);
    expect(readFilm(localStorage)?.characters[0]).toMatchObject({ gender: "男", ageBand: "成年" });
  });
  it("respects existing structured traits when choosing missing voices", () => {
    const film = blankFilm();
    film.characters = [
      {
        id: "a",
        name: "甲",
        identity: "西装",
        gender: "女",
        ageBand: "成年",
        voiceId: "",
        portraits: [],
        source: "script",
        userFields: [],
      },
    ];
    expect(["ara", "eve", "luna", "carina", "celeste"]).toContain(
      mergeCast(film, { characters: [], locations: [] }).characters[0]?.voiceId,
    );
  });
  it("never moves another shot's node by position", () => {
    const beats = [
      { shotId: "one", text: "周烈挥动铁棍" },
      { shotId: "one", text: "沈砚抬手格挡" },
    ];
    expect(beatsForShot(beats, 2, "two")).toBe("");
    expect(beatsForShot([{ text: "镜头2·周烈挥动铁棍" }], 2, "two")).toBe("");
    expect(beatsForShot([{ text: "周烈挥动铁棍" }], 2, "two", "周烈挥动手臂向朋友致意")).toBe("");
    expect(beatsForShot(beats, 1, "one")).toContain("周烈挥动铁棍");
    expect(beatsForShot([{ text: "周烈挥动铁棍" }], 1, "before", "林晚问：报警？")).toBe("");
    expect(beatsForShot([{ text: "周烈挥动铁棍" }], 2, "fight", "周烈挥动铁棍，沈砚闪开。")).toBe(
      "周烈挥动铁棍",
    );
    expect(keepFightDetails("沈砚肘击周烈。", "闪开。。保留原文：肘击")).not.toContain("保留原文");
  });
  it("keeps a sole HTTPS portrait as reference and caps at thirteen", () => {
    const film = sampleFilm();
    const shot = film.shots[0]!;
    shot.poster = "";
    shot.stills = [];
    shot.characters = [film.characters[0]!.name];
    film.characters[0]!.portraits = [
      { view: "正面", prompt: "", url: "https://cdn.example/face.png" },
    ];
    expect(shotReference(shot, film)).toEqual({
      still: "",
      references: [{ url: "https://cdn.example/face.png", who: film.characters[0]!.name }],
    });
    shot.poster = "/tmp/still.png";
    film.characters[0]!.portraits = Array.from({ length: 16 }, (_, i) => ({
      view: "正面",
      prompt: "",
      url: `https://cdn.example/${i}.png`,
    }));
    expect(shotReference(shot, film).still).toBe("/tmp/still.png");
    expect(shotReference(shot, film).references).toHaveLength(13);
  });
});
