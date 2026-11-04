import { describe, expect, it } from "vitest";
import { blankFilm, sampleFilm, readFilm, writeFilm } from "./project";
import {
  assignVoice,
  assignActionBeats,
  autoVoiceForCharacter,
  firstFrameReferences,
  updateShot,
  storyFilmBatches,
  fightConstraints,
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
        { name: "周明", gender: "男", ageBand: "中年", identity: "女主角的丈夫，照看孩子的保安" },
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
      ageBand: "中年",
    });
    expect(castTraits("", "林国栋", "她想起父亲林国栋。")).toEqual({
      gender: "男",
      ageBand: "中年",
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
    expect(result.characters[0]).toMatchObject({ gender: "男", ageBand: "中年" });
    expect(men).toContain(result.characters[0]?.voiceId);
    writeFilm(localStorage, result);
    expect(readFilm(localStorage)?.characters[0]).toMatchObject({ gender: "男", ageBand: "中年" });
  });
  it("respects existing structured traits when choosing missing voices", () => {
    const film = blankFilm();
    film.characters = [
      {
        id: "a",
        name: "甲",
        identity: "西装",
        gender: "女",
        ageBand: "中年",
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
      "",
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

it("normalizes metadata and preserves a manual voice lock across edits", () => {
  const base = {
    ...sampleFilm().characters[0]!,
    gender: "男" as const,
    ageBand: "中年" as const,
    voiceId: "leo",
    userFields: [],
  };
  const changed = autoVoiceForCharacter({ ...base, gender: "女" });
  expect(["ara", "eve", "luna", "carina", "celeste"]).toContain(changed.voiceId);
  expect(autoVoiceForCharacter({ ...changed, ageBand: "老年" }).voiceId).toBe("naksh");
  expect(autoVoiceForCharacter({ ...base, gender: "女", userFields: ["voiceId"] }).voiceId).toBe(
    "leo",
  );
  const unknown = autoVoiceForCharacter({ ...base, gender: "", userFields: ["gender"] });
  expect(unknown.voiceId).toBe("");
  expect(unknown.voiceCode).toBe("VOICE_TRAITS_REQUIRED");
  expect(
    parseCastReply('{"characters":[{"name":"乙","gender":"female","ageBand":"child"}]}')
      ?.characters[0],
  ).toMatchObject({ gender: "女", ageBand: "儿童" });
  expect(keepFightDetails("原文挥铁棍。", "人物站住。")).toBe("人物站住。");
  expect(castTraits("", "陌生人", "", "unknown", "unknown")).toEqual({ gender: "", ageBand: "" });
  expect(
    parseCastReply('{"characters":[{"name":"甲","gender":"male","age_band":"adult"}]}')
      ?.characters[0],
  ).toMatchObject({ gender: "男", ageBand: "中年" });
});

it("stores all unassigned beats and refuses combat on dialogue shots even with a valid id", () => {
  const base = sampleFilm().shots[0]!;
  const dialogue = {
    ...base,
    id: "talk",
    sceneId: "scene",
    picture: "林晚在书店问话",
    action: "",
    line: "报警？",
  };
  const fight = { ...base, id: "fight", sceneId: "scene", picture: "周烈挥动铁棍", action: "" };
  const result = assignActionBeats([dialogue, fight], "scene", [
    { shotId: "talk", text: "周烈挥动铁棍" },
    { text: "周烈挥动铁棍" },
    { shotId: "missing", text: "沈砚肘击" },
    { shotId: "fight", text: "周烈挥棍。。保留原文：沈砚肘击。" },
  ]);
  expect(result.shots[0]?.action).toBe("");
  expect(result.shots[1]?.action).toContain("沈砚肘击");
  expect(result.shots[1]?.action).not.toMatch(/保留原文|。。/);
  expect(result.unassignedBeats).toEqual([
    { sceneId: "scene", text: "周烈挥动铁棍" },
    { sceneId: "scene", text: "周烈挥动铁棍" },
    { sceneId: "scene", text: "沈砚肘击" },
  ]);
  expect(fightConstraints("铁棍划开小臂。")).toContain("铁棍");
});

it("prioritizes the speaker's front reference before other people and limits first frame to five", () => {
  const film = sampleFilm();
  film.characters = ["甲", "乙"].map((name) => ({
    ...film.characters[0]!,
    name,
    portraits: ["侧面", "背面", "正面", "脸部"].map((view) => ({
      view,
      prompt: "",
      url: `https://example.test/${name}/${view}`,
    })),
  }));
  const shot = { ...film.shots[0]!, speaker: "乙", characters: ["甲", "乙"] };
  const references = firstFrameReferences(film, shot);
  expect(references).toHaveLength(5);
  expect(references.slice(0, 2)).toEqual([
    "https://example.test/乙/正面",
    "https://example.test/甲/正面",
  ]);
});

it("keeps old dialogue edits and structured lines in sync and blocks wrong multi-speaker TTS", () => {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  const changed = updateShot(film, shot.id, {
    lines: [
      { speaker: "甲", text: "第一句。" },
      { speaker: "乙", text: "第二句！" },
    ],
  });
  const edited = changed.shots.find((item) => item.id === shot.id)!;
  expect(edited.line).toBe("第一句。\n第二句！");
  expect(edited.speaker).toBe("");
  expect(() => storyFilmBatches(changed, [edited], false)).toThrow(
    expect.objectContaining({ code: "MULTI_VOICE_REQUIRED" }),
  );
  expect(edited.lines).toHaveLength(2);
  const legacy = updateShot(changed, shot.id, { line: "修改句。", speaker: "甲" }).shots.find(
    (item) => item.id === shot.id,
  )!;
  expect(legacy.lines).toEqual([{ speaker: "甲", text: "修改句。" }]);
});

it("keeps a lone local portrait as a reference until a shot first frame is generated", () => {
  const film = sampleFilm();
  const shot = {
    ...film.shots[0]!,
    poster: "",
    stills: [],
    characters: [film.characters[0]!.name],
  };
  film.characters[0]!.portraits = [{ view: "正面", prompt: "定妆", url: "/tmp/portrait.png" }];
  expect(shotReference(shot, film)).toEqual({
    still: "",
    references: [{ url: "/tmp/portrait.png", who: film.characters[0]!.name }],
  });
  expect(firstFrameReferences(film, shot)).toEqual(["/tmp/portrait.png"]);
  expect(shotReference({ ...shot, poster: "/tmp/generated-shot.png" }, film)).toEqual({
    still: "/tmp/generated-shot.png",
    references: [{ url: "/tmp/portrait.png", who: film.characters[0]!.name }],
  });
});
