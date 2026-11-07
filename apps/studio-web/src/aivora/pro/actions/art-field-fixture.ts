import { sampleFilm } from "../../film/project";
import { artFromModel } from "../../film/phase2";
import { applyArtDraft } from "../workflow";
import { prepareArtTransaction } from "./art-transaction";
export function fullArtFixture() {
  const base = sampleFilm();
  base.locations = [
    {
      id: "place-existing",
      name: "旧房间",
      prompt: "旧描述",
      ambience: "旧环境",
      layout: "旧布局",
      referenceImage: "/private/old.png",
      referenceStyleRevision: 0,
    },
  ];
  base.props = [];
  base.costumes = [];
  delete base.costumeRisks;
  base.characters = base.characters.slice(0, 1).map((person) => ({
    ...person,
    userFields: [],
    identity: "旧外貌",
    gender: undefined,
    ageBand: undefined,
    voiceId: "leo",
  }));
  const name = base.characters[0]!.name,
    scene = base.scenes[0]!;
  scene.where = "新的院落";
  const raw = {
    prompt_block_zh: "暖色电影光，柔和侧光。",
    style_status: "待核对",
    era: "现代",
    palette: [{ name: "暖米色", hex: "#eee0cf" }],
    lighting: "柔光",
    prompt_block_en: "Warm cinematic light.",
    avoid: ["过曝"],
    identities: [
      {
        name,
        identity: "短发成年女性，深色外套",
        gender: "女",
        age_band: "青年",
        char_id: base.characters[0]!.id,
        status: "建议",
      },
    ],
    locations: [
      { name: "旧房间", prompt: "旧描述", ambience: "旧环境", layout: "旧布局" },
      {
        name: "新的院落",
        prompt: "木门和石阶",
        ambience: "轻微雨声",
        layout: "门在画面右侧",
        loc_id: "loc-2",
        asset_id: "location-declaration",
        status: "待生成",
      },
    ],
    props: [
      {
        name: "纸伞",
        note: "素色纸伞",
        prop_id: "prop-1",
        asset_id: "prop-declaration",
        status: "待生成",
      },
    ],
    costumes: [
      {
        costume_id: "costume-one",
        name,
        title: "雨衣",
        description: "深色长雨衣",
        ranges: [{ scene_id: scene.id, from: "P1", to: "P1" }],
      },
    ],
    portraits: [
      {
        name,
        asset_id: "portrait-declaration",
        view: "正面",
        costume_id: "costume-one",
        prompt: "自然站立",
      },
    ],
    asset_ids: ["portrait-declaration", "location-declaration", "prop-declaration"],
  };
  const parsed = artFromModel(raw);
  if (!parsed) throw Error("ART_PARSE_FAILED");
  const draft = applyArtDraft(base, parsed),
    scope = { projectId: base.id, page: "cast" as const },
    tx = prepareArtTransaction(base, draft, scope);
  return { base, draft, tx, scope, raw };
}
