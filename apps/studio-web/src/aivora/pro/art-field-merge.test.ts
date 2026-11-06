import { expect, it } from "vitest";
import { sampleFilm } from "../film/project";
import { artFromModel } from "../film/phase2";
import { locationPlate } from "../film/operations";
import { applyArtDraft } from "./workflow";

const draft = (style = "") =>
  artFromModel({
    prompt_block_zh: style,
    identities: [{ name: "父亲", identity: "中年男性，短发", gender: "男", age_band: "中年" }],
    locations: [{ name: "书店", prompt: "暖灯照亮书店", ambience: "雨声" }],
    props: [{ name: "信封", note: "旧油纸信封" }],
  })!;

it("replaces known default or empty art fields, preserving images and marking changed prompts stale", () => {
  const film = sampleFilm();
  film.locations = [
    {
      id: "loc",
      name: "书店",
      prompt: locationPlate("书店", film.styleZh, "夜"),
      ambience: "",
      referenceImage: "/plate.png",
      referenceStyleRevision: 4,
    },
  ];
  film.props = [{ id: "prop", name: "信封", note: "" }];
  const next = applyArtDraft(film, draft());
  expect(next.locations[0]).toMatchObject({
    id: "loc",
    prompt: "暖灯照亮书店",
    ambience: "雨声",
    referenceImage: "/plate.png",
    referenceStyleRevision: -1,
    artFields: { prompt: "暖灯照亮书店", ambience: "雨声" },
  });
  expect(next.props[0]).toMatchObject({
    id: "prop",
    note: "旧油纸信封",
    artFields: { note: "旧油纸信封" },
  });
  expect(film.props[0]!.note).toBe("");
});
it("updates AI baselines while protecting individual explicit locks and unmarked subsequent edits", () => {
  const film = sampleFilm();
  film.locations = [
    {
      id: "loc",
      name: "书店",
      prompt: "旧AI画面",
      ambience: "用户改成钟声",
      artFields: { prompt: "旧AI画面", ambience: "旧雨声" },
      referenceImage: "/plate.png",
      referenceStyleRevision: 4,
    },
  ];
  film.props = [
    {
      id: "prop",
      name: "信封",
      note: "用户选红色",
      userFields: ["note"],
      artFields: { note: "旧AI信封" },
    },
  ];
  const next = applyArtDraft(film, draft());
  expect(next.locations[0]!.prompt).toBe("暖灯照亮书店");
  expect(next.locations[0]!.ambience).toBe("用户改成钟声");
  expect(next.locations[0]!.userFields).toContain("ambience");
  expect(next.props[0]!.note).toBe("用户选红色");
});
it("protects legacy nonempty values of unknown origin and invalidates images on style changes", () => {
  const film = sampleFilm();
  film.locations = [
    {
      id: "loc",
      name: "书店",
      prompt: "旧来源未知",
      ambience: "来源未知的声音",
      referenceImage: "/plate.png",
      referenceStyleRevision: 0,
    },
  ];
  film.props = [{ id: "prop", name: "信封", note: "来源未知的道具" }];
  const next = applyArtDraft(film, draft("新画风"));
  expect(next.locations[0]).toMatchObject({
    prompt: "旧来源未知",
    ambience: "来源未知的声音",
    referenceImage: "/plate.png",
    referenceStyleRevision: -1,
  });
  expect(next.props[0]!.note).toBe("来源未知的道具");
});
it("persists normalized cast traits independently of identity locks and retains hand-picked voices", () => {
  const film = sampleFilm();
  film.characters = [
    {
      ...film.characters[0]!,
      name: "父亲",
      identity: "用户的外貌",
      gender: "",
      ageBand: "",
      voiceId: "manual-choice",
      userFields: ["identity", "voiceId"],
    },
  ];
  const next = applyArtDraft(film, draft());
  expect(next.characters[0]).toMatchObject({
    identity: "用户的外貌",
    gender: "男",
    ageBand: "中年",
    voiceId: "manual-choice",
  });
  const locked = {
    ...film,
    characters: [
      {
        ...film.characters[0]!,
        gender: "女" as const,
        ageBand: "老年" as const,
        userFields: ["gender", "ageBand", "voiceId"],
      },
    ],
  };
  expect(applyArtDraft(locked, draft()).characters[0]).toMatchObject({
    gender: "女",
    ageBand: "老年",
    voiceId: "manual-choice",
  });
});
it("new records carry editable AI baselines and unchanged prompts retain their image revision", () => {
  const film = { ...sampleFilm(), locations: [], props: [] };
  const first = applyArtDraft(film, draft());
  first.locations[0]!.referenceImage = "/plate.png";
  first.locations[0]!.referenceStyleRevision = 7;
  const second = applyArtDraft(first, draft());
  expect(second.locations[0]!.referenceStyleRevision).toBe(7);
  expect(second.props[0]!.artFields?.note).toBe("旧油纸信封");
});
