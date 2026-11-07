import { sampleFilm, blankFilm, upgradeFilm } from "../../film/project";
import { parseWriterScenes } from "../../film/operations";
import { parseWriterPlan } from "../../film/writer-plan";
import { applyContinuityChecks } from "../../film/continuity-rules";
import { prepareWriterTransaction } from "./story-structure-transaction";
export function writerFieldFixture(initial = false) {
  let base = initial ? blankFilm() : sampleFilm();
  base.jobs = [];
  base.audioClips = [];
  const manuscript = "  梅子说：“别走。”\r\n她推开门。  ";
  if (initial) {
    base.characters = [];
    base.locations = [];
    base.shots = [];
    base.scenes = [
      {
        id: "scene-1",
        no: 1,
        title: "地点待定 · 时间待定",
        where: "",
        text: manuscript,
        ambience: "",
        source: "user",
        userFields: ["text"],
      },
    ];
    base.sourceText = "";
  } else {
    base.sourceText = "[P01] 梅子说：“别走。”\n[P02] 她推开门。";
    base.scenes = base.scenes.map((scene, index) => ({
      ...scene,
      text: index === 0 ? base.sourceText : "",
      userFields: [],
    }));
    base = applyContinuityChecks(upgradeFilm(base)!);
  }
  const source = initial ? manuscript : base.sourceText;
  const raw = {
    title: "门外",
    logline: "门口的决定",
    hook: "她叫住来人",
    cliffhanger: "门后还有脚步声",
    dialogue_count: 1,
    characters: [
      {
        name: "梅子",
        identity: "年轻成年女性，短发",
        gender: "female",
        age_band: "young",
        first_paragraph: "P01",
        brief: "独自守门",
      },
    ],
    locations: [{ name: "门口", prompt: "木门与石阶" }],
    scenes: [
      {
        id: "scene-1",
        no: 1,
        title: "门口",
        place: "门口",
        time: "夜",
        interior: false,
        weather: "雨",
        mood: "克制",
        key_event: "推门",
        characters: ["梅子"],
        source_paragraphs: ["P01", "P02"],
        text: "梅子说：“别走。”\n她推开门。",
        beats: ["叫住来人"],
        est_seconds: 8,
        elements: [
          {
            type: "dialogue",
            source: "P01",
            speaker: "梅子",
            kind: "对白",
            line: "别走。",
            delivery: "低声",
          },
          { type: "action", source: "P02", text: "她推开门。" },
        ],
      },
    ],
  };
  const reply = JSON.stringify(raw),
    scenes = parseWriterScenes(reply, source);
  if (!scenes) throw Error("WRITER_FIXTURE_PARSE_FAILED");
  const plan = parseWriterPlan(reply, source)!;
  const origin = { projectId: base.id, page: "script" as const, sceneId: base.scenes[0]!.id };
  const tx = prepareWriterTransaction(base, scenes, plan);
  return { base, scenes, plan, origin, tx, raw, source, manuscript };
}
