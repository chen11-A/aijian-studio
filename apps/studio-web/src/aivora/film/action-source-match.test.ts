import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sampleFilm } from "./project";
import { assignActionBeats } from "./operations";
import { applyActionPlan } from "./action-plan";
import { runPipelineAgentAction } from "../pro/pipeline-agent-actions";
import { planActionDraft } from "../pro/actions/action";

const source = readFileSync(
  resolve(__dirname, "../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt"),
  "utf8",
);
const makeShot = (id: string, picture: string) => ({
  ...sampleFilm().shots[0]!,
  id,
  sceneId: "scene-2",
  picture,
  action: "",
  line: "",
  lines: [],
  userFields: [],
});

describe("3JR-B02 source-based action assignment", () => {
  it.each(["action", "actionPlan"])("preserves an explicitly targeted %s user lock", (field) => {
    const shot = { ...makeShot("locked", "周烈挥动铁棍"), action: "用户动作", userFields: [field] };
    const result = assignActionBeats([shot], "scene-2", [
      { shotId: "locked", text: "周烈挥动铁棍" },
    ]);
    expect(result.shots[0]).toEqual(shot);
    expect(result.unassignedBeats).toEqual([{ sceneId: "scene-2", text: "周烈挥动铁棍" }]);
  });

  it("binds structured unknown-ID nodes separately and keeps their original identity", () => {
    const film = sampleFilm();
    film.scenes = [{ ...film.scenes[0]!, id: "scene-2", text: source }];
    film.shots = [makeShot("arm", "刀锋划过他的小臂"), makeShot("elbow", "沈砚矮身一个肘击")];
    const result = applyActionPlan(film, "scene-2", {
      shots: [
        {
          shot_id: "old-id",
          nodes: [
            { node_id: "elbow", move: "沈砚矮身一个肘击" },
            { node_id: "arm", move: "刀锋划过他的小臂" },
          ],
        },
      ],
    });
    expect(result.scenes[0]!.actionState!.unassigned).toEqual([]);
    expect(result.shots.map((shot) => shot.actionPlan!.nodes.map((node) => node.id))).toEqual([
      ["arm"],
      ["elbow"],
    ]);
    expect(result.shots.map((shot) => shot.actionPlan!.sourceShotIds)).toEqual([
      ["old-id"],
      ["old-id"],
    ]);
    const ungrounded = applyActionPlan(
      { ...film, scenes: [{ ...film.scenes[0]!, text: "他们还在书店说话。" }] },
      "scene-2",
      { shots: [{ shot_id: "old-id", nodes: [{ move: "沈砚矮身一个肘击" }] }] },
    );
    expect(ungrounded.shots[1]!.actionPlan).toBeUndefined();
    expect(ungrounded.scenes[0]!.actionState!.unassigned).toHaveLength(1);
  });

  it("uses the same source match in pipeline assignment and a manual shot's sound cue", async () => {
    const film = sampleFilm();
    film.scenes = [{ ...film.scenes[0]!, id: "scene-2", text: source }];
    film.shots = [makeShot("elbow", "沈砚矮身一个肘击")];
    film.unassignedBeats = [
      { sceneId: "scene-2", text: "沈砚矮身一个肘击" },
      { sceneId: "other-scene", text: "另一场未配动作" },
    ];
    const text = JSON.stringify({
      beats: [{ shot_id: "old-id", text: "沈砚矮身一个肘击", at_seconds: 1 }],
    });
    const request = async () => ({ text, detail: "" });
    const result = await runPipelineAgentAction(
      film,
      { step: "action", targetId: "scene-2" },
      { request, valid: () => true },
    );
    expect(result.status).toBe("done");
    expect(result.film!.unassignedBeats).toEqual([
      { sceneId: "other-scene", text: "另一场未配动作" },
    ]);
    expect(result.film!.scenes[0]!.actionState!.unassigned).toEqual([]);
    const manual = await planActionDraft(film, film.shots[0]!, {
      request,
      connected: true,
      current: () => true,
    });
    expect(manual.status).toBe("ready");
    if (manual.status === "ready") {
      expect(manual.shot.action).toContain("肘击");
      expect(manual.shot.sound.sfx.some((cue) => cue.text.includes("肘击"))).toBe(true);
      expect(manual.actionState!.unassigned).toEqual([]);
    }
  });

  it("matches nineteen source fragments without relying on array order or repaired IDs", () => {
    // Real novel fragments, synthetic shots/reply; this is not a recorded Grok response.
    const fragments = [
      "周烈抄起一根铁棍",
      "他猛地挥棍砸来",
      "沈砚侧身一让",
      "铁棍擦着他耳边落下",
      "砸在木箱上",
      "沈砚顺势扣住周烈的手腕",
      "铁棍“当啷”落地",
      "另一个打手从背后扑上来",
      "沈砚矮身一个肘击",
      "正中对方肋下",
      "跪倒在积水里",
      "第三个人掏出一把折叠刀",
      "沈砚抬手去挡",
      "刀锋划过他的小臂",
      "反手抓住对方的手肘往下一压",
      "膝盖顶上去",
      "刀飞了出去",
      "滑进铁链堆里",
      "周烈喘着粗气，从地上爬起来",
    ];
    for (const fragment of fragments) expect(source).toContain(fragment);
    const shots = fragments.map((text, i) => makeShot(`scene-2-shot-${i + 1}`, text));
    const dialogue = { ...makeShot("talk", "林晚看着周烈"), line: "报警？" };
    const result = assignActionBeats(
      [dialogue, ...shots],
      "scene-2",
      [
        ...[...fragments].reverse().map((text, i) => ({ text, shotId: `obsolete-${i}` })),
        { text: "周烈掏枪射击" },
        { text: "林晚挥棍打倒周烈" },
      ],
      source,
    );
    expect(result.unassignedBeats).toEqual([
      { sceneId: "scene-2", text: "周烈掏枪射击" },
      { sceneId: "scene-2", text: "林晚挥棍打倒周烈" },
    ]);
    expect(result.shots[0]!.action).toBe("");
    fragments.forEach((fragment, i) => expect(result.shots[i + 1]!.action).toBe(fragment));
  });

  it("preserves ambiguous, cross-scene and explicit wrong-target beats", () => {
    const first = makeShot("first", "周烈挥动铁棍");
    const repeated = makeShot("repeated", first.picture);
    const otherScene = { ...makeShot("other", first.picture), sceneId: "scene-1" };
    const dialogue = {
      ...makeShot("talk", "林晚问：周烈会挥动铁棍吗？"),
      line: "周烈会挥动铁棍吗？",
    };
    const beats = [
      { text: first.picture },
      { text: first.picture, shotId: "other" },
      { text: first.picture, shotId: "talk" },
    ];
    const result = assignActionBeats([first, repeated, otherScene, dialogue], "scene-2", beats);
    expect(result.shots.map((shot) => shot.action)).toEqual(["", "", "", ""]);
    expect(result.unassignedBeats).toHaveLength(3);
    expect(
      assignActionBeats([first, repeated], "scene-2", [{ text: first.picture, shotId: "repeated" }])
        .shots[1]!.action,
    ).toBe(first.picture);
  });

  it("does not infer from shared people/weapons, narration outside source, or locked action", () => {
    const shot = makeShot("one", "周烈抓住铁棍，沈砚看向周烈");
    expect(
      assignActionBeats([shot], "scene-2", [{ text: "周烈挥动铁棍" }]).unassignedBeats,
    ).toHaveLength(1);
    const fighting = makeShot("fight", "周烈挥动铁棍");
    expect(
      assignActionBeats([fighting], "scene-2", [{ text: fighting.picture }], "周烈和林晚说话。")
        .unassignedBeats,
    ).toHaveLength(1);
    expect(
      assignActionBeats([{ ...fighting, userFields: ["action"] }], "scene-2", [
        { text: fighting.picture },
      ]).unassignedBeats,
    ).toHaveLength(1);
  });
});
