import { describe, expect, it } from "vitest";
import { sampleFilm, type FilmProject, type FilmShot } from "./project";
import { applyActionPlan } from "./action-plan";
import { assignActionBeats } from "./operations";

// 3JR-B02: scene 2 of test-novel-2000 (码头仓库) as a director writes it — short, paraphrased
// frames rather than the source sentences — and an action reply that names the shot_id it was
// given for every node, as the action role prompt asks. Synthetic, not a recorded Grok reply.
const frames: [string, string, string?][] = [
  ["s2-1", "雨夜码头仓库，铁皮屋顶被雨砸响，林晚被推到木箱旁"],
  ["s2-2", "周烈握着铁棍逼近沈砚", "小子，你倒是有胆。"],
  ["s2-3", "铁棍砸向沈砚，他侧身让开"],
  ["s2-4", "木箱被砸开，木屑四溅"],
  ["s2-5", "沈砚扣住周烈手腕一拧，铁棍落地"],
  ["s2-6", "打手从背后扑来，沈砚矮身迎上"],
  ["s2-7", "打手倒在积水里"],
  ["s2-8", "第三个人亮出折叠刀，刀刃在灯下一闪"],
  ["s2-9", "林晚惊叫", "小心！"],
  ["s2-10", "刀锋擦过沈砚小臂，血渗出来"],
  ["s2-11", "沈砚压住对方手肘，刀飞进铁链堆"],
  ["s2-12", "周烈喘着粗气，脸色铁青，警笛由远及近"],
  ["s2-13", "周烈带人钻进雨里", "算你狠。"],
];
const nodes: [string, string, string, string?][] = [
  ["s2-2", "周烈", "抄起铁棍", "铁棍"],
  ["s2-3", "周烈", "挥棍砸向沈砚", "铁棍"],
  ["s2-3", "沈砚", "侧身一让", "上身"],
  ["s2-3", "铁棍", "擦着沈砚耳边落下", "铁棍"],
  ["s2-4", "铁棍", "砸在木箱上", "铁棍"],
  ["s2-5", "沈砚", "扣住周烈手腕", "右手"],
  ["s2-5", "沈砚", "一拧", "右手"],
  ["s2-5", "铁棍", "当啷落地", "铁棍"],
  ["s2-6", "打手", "从背后扑向沈砚", "双臂"],
  ["s2-6", "沈砚", "矮身肘击", "右肘"],
  ["s2-6", "沈砚", "肘击正中打手肋下", "右肘"],
  ["s2-7", "打手", "跪倒在积水里", "膝盖"],
  ["s2-8", "第三个人", "掏出折叠刀", "折叠刀"],
  ["s2-10", "沈砚", "抬手去挡", "左小臂"],
  ["s2-10", "折叠刀", "刀锋划过沈砚小臂", "刀锋"],
  ["s2-11", "沈砚", "抓住对方手肘往下一压", "双手"],
  ["s2-11", "沈砚", "膝盖顶上去", "右膝"],
  ["s2-11", "折叠刀", "刀飞了出去", "折叠刀"],
  ["s2-12", "周烈", "从地上爬起来", "全身"],
];

function sceneTwo(): FilmProject {
  const film = sampleFilm();
  const template = film.shots[0]!;
  film.scenes = [{ ...film.scenes[0]!, id: "scene-2", userFields: [] }];
  film.shots = frames.map(([id, picture, line], index): FilmShot => ({
    ...template,
    id,
    no: index + 1,
    sceneId: "scene-2",
    picture,
    action: "",
    actionBeats: [],
    actionPlan: undefined,
    line: line ?? "",
    speaker: line ? (id === "s2-9" ? "林晚" : "周烈") : "",
    lines: line ? [{ speaker: id === "s2-9" ? "林晚" : "周烈", text: line }] : [],
    characters: ["沈砚", "周烈", "林晚"],
    userFields: [],
  }));
  return film;
}

const reply = () => ({
  scene_id: "scene-2",
  shots: frames.map(([id]) => ({
    shot_id: id,
    nodes: nodes
      .filter(([shot]) => shot === id)
      .map(([, actor, move, bodyPart], index) => ({
        node_id: `${id}-node-${index + 1}`,
        actor,
        move,
        body_part: bodyPart ?? "",
      })),
  })),
});

describe("3JR-B02 actions the action director names a shot for", () => {
  it("lands at least 17 of the 19 scene-2 actions on the shot it named", () => {
    const film = applyActionPlan(sceneTwo(), "scene-2", reply());
    const placed = film.shots.reduce((sum, shot) => sum + (shot.actionPlan?.nodes.length ?? 0), 0);
    const left = film.scenes[0]!.actionState!.unassigned.flatMap((entry) => entry.plan.nodes);
    expect(placed + left.length).toBe(19);
    expect(placed).toBeGreaterThanOrEqual(17);
    // Before 3JR-B02 the two below were refused: a silent frame without a fight verb, and a
    // talking shot whose picture shows the very weapon. Now every named node lands.
    expect(left).toEqual([]);
    // Every placed node sits on the shot it was written for.
    for (const shot of film.shots)
      for (const node of shot.actionPlan?.nodes ?? [])
        expect(nodes.some(([id, , move]) => id === shot.id && move === node.move)).toBe(true);
  });

  it("still refuses a fight on a talking shot whose picture shows no fight", () => {
    const film = sceneTwo();
    const talk = film.shots.find((shot) => shot.id === "s2-9")!;
    const result = assignActionBeats(film.shots, "scene-2", [
      { shotId: talk.id, text: "沈砚挥棍击中周烈肩头" },
    ]);
    expect(result.unassignedBeats).toHaveLength(1);
  });

  it("does not read a name such as 刀疤 as a knife in a talking shot", () => {
    const film = sceneTwo();
    const talk = {
      ...film.shots[1]!,
      picture: "刀疤叼着烟开口威胁",
      characters: ["刀疤"],
      speaker: "刀疤",
      line: "东西交出来。",
      lines: [{ speaker: "刀疤", text: "东西交出来。" }],
    };
    expect(
      assignActionBeats([talk], "scene-2", [{ shotId: talk.id, text: "刀疤挥铁棍砸向林骁" }])
        .unassignedBeats,
    ).toHaveLength(1);
  });

  it("puts a named action on a short silent frame without fight words", () => {
    const film = sceneTwo();
    const result = assignActionBeats(film.shots, "scene-2", [
      { shotId: "s2-8", text: "第三个人掏出折叠刀" },
      { shotId: "s2-7", text: "打手被肘击后跪倒" },
    ]);
    expect(result.unassignedBeats).toEqual([]);
    expect(result.shots.find((shot) => shot.id === "s2-8")!.action).toContain("折叠刀");
  });
});
