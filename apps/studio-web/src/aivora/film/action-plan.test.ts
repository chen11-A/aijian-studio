import { expect, it } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import { parseActionPlan, applyActionPlan, actionPlanPrompt } from "./action-plan";
import { sampleFilm } from "./project";
import { motionPrompt } from "./operations";

for (const entry of fixtures.examples.filter((item) => item.role === "action")) {
  it(`${entry.example.id}: projects actual node timing/contact/force, injury and final prop state`, () => {
    const output = entry.example.output as unknown as {
      scene_id: string;
      shots: {
        shot_id: string;
        nodes: {
          node_id: string;
          move: string;
          at_seconds: number;
          duration_seconds: number;
          contact: boolean;
          force: number;
          sfx_cue: string | null;
        }[];
      }[];
      props_after: { name: string; left: string | null; right: string | null }[];
      injuries: { from_shot: string; visible_as: string }[];
    };
    const parsed = parseActionPlan(output);
    for (const shot of output.shots)
      for (const node of shot.nodes) {
        expect(
          parsed.shots
            .find((s) => s.shotId === shot.shot_id)
            ?.plan.nodes.find((n) => n.id === node.node_id),
        ).toMatchObject({
          move: node.move,
          at: node.at_seconds,
          duration: node.duration_seconds,
          contact: node.contact,
          force: node.force,
          sfxCue: node.sfx_cue,
        });
      }
    expect(parsed.state.propsAfter).toEqual(output.props_after);
    for (const injury of output.injuries)
      expect(
        parsed.shots
          .find((s) => s.shotId === injury.from_shot)
          ?.plan.injuries.some((i) => i.visibleAs === injury.visible_as),
      ).toBe(true);
    const film = sampleFilm();
    film.scenes = [{ ...film.scenes[0]!, id: output.scene_id }];
    film.shots = output.shots.map((s) => ({
      ...film.shots[0]!,
      id: s.shot_id,
      sceneId: output.scene_id,
      line: "",
      lines: [],
      userFields: [],
      picture: s.nodes.map((n) => n.move).join("。"),
      action: s.nodes.map((n) => n.move).join("。"),
    }));
    const saved = JSON.parse(JSON.stringify(applyActionPlan(film, output.scene_id, output)));
    expect(saved.scenes[0].actionState.propsAfter).toEqual(output.props_after);
    expect(saved.shots.every((s: { actionPlan?: unknown }) => s.actionPlan)).toBe(true);
  });
}
it("consumes typed physical constraints without treating unlocated final states as initial holds", () => {
  const film = sampleFilm();
  const shot = {
    ...film.shots[0]!,
    picture: "甲挥铁棍",
    action: "挥铁棍",
    userFields: [],
    lines: [],
    line: "",
  };
  film.shots = [shot];
  const raw = {
    shots: [
      {
        shot_id: shot.id,
        nodes: [
          {
            node_id: "n",
            actor: "甲",
            move: "挥铁棍",
            at_seconds: 0.5,
            duration_seconds: 1,
            contact: false,
            force: 2,
            sfx_cue: "秘密音效",
          },
        ],
      },
    ],
    beats: [{ node_id: "n", feasibility: "难", workaround: "切成两个动作" }],
    injuries: [
      {
        from_shot: shot.id,
        name: "甲",
        side: "左",
        body_part: "手臂",
        kind: "擦伤",
        visible_as: "衣袖破口",
      },
    ],
    props_after: [
      { name: "甲", left: "场末道具", right: null },
      { name: "甲", shot_id: shot.id, left: null, right: "铁棍" },
    ],
  };
  const next = applyActionPlan(film, shot.sceneId, raw);
  const prompt = motionPrompt(next.shots[0]!);
  for (const part of [
    "第0.5秒",
    "持续1秒",
    "不发生接触",
    "力度2",
    "切成两个动作",
    "衣袖破口",
    "本镜结束时甲",
  ])
    expect(prompt).toContain(part);
  expect(prompt).not.toContain("秘密音效");
  expect(prompt).not.toContain("场末道具");
  expect(next.shots[0]!.actionPlan!.nodes[0]!.feasibility).toBe("难");
});
it("does not assign by position, preserves rejected structures and respects user action locks", () => {
  const film = sampleFilm();
  const shot = { ...film.shots[0]!, userFields: ["action"], action: "用户动作" };
  film.shots = [shot];
  const node = { node_id: "n", move: "保留原文：挥铁棍。。", contact: true };
  const next = applyActionPlan(film, shot.sceneId, {
    shots: [
      { shot_id: shot.id, nodes: [node] },
      { shot_id: "unknown", nodes: [node] },
      { nodes: [node] },
    ],
  });
  expect(next.shots[0]).toBe(shot);
  expect(
    next.scenes.find((s) => s.id === shot.sceneId)?.actionState?.unassigned.map((u) => u.reason),
  ).toEqual(["USER_EDITED", "UNKNOWN_SHOT", "UNKNOWN_SHOT"]);
  expect(JSON.stringify(next)).not.toContain("保留原文");
  const dialogue = {
    ...shot,
    userFields: [],
    picture: "她问：“报警？”",
    action: "",
    line: "报警？",
    lines: [{ speaker: "她", text: "报警？" }],
  };
  const rejected = applyActionPlan({ ...film, shots: [dialogue] }, shot.sceneId, {
    shots: [{ shot_id: shot.id, nodes: [node] }],
  });
  expect(rejected.shots[0]!.actionPlan!.nodes).toEqual([]);
  expect(actionPlanPrompt(rejected.shots[0]!)).toBe("");
  expect(
    rejected.scenes.find((s) => s.id === shot.sceneId)?.actionState?.unassigned[0]?.reason,
  ).toBe("ACTION_REJECTED");
});

it("wires typed plans into pipeline output and keeps manual user edits locked", async () => {
  const { runPipelineAgentAction } = await import("../pro/pipeline-agent-actions");
  const { planActionDraft } = await import("../pro/actions/action");
  const film = sampleFilm();
  const shot = {
    ...film.shots[0]!,
    picture: "甲挥铁棍打斗",
    action: "挥铁棍",
    userFields: [],
    line: "",
    lines: [],
  };
  film.shots = [shot];
  film.scenes = [{ ...film.scenes[0]!, id: shot.sceneId, text: "甲挥铁棍打斗。", tags: ["打斗"] }];
  const text = JSON.stringify({
    shots: [
      {
        shot_id: shot.id,
        nodes: [
          {
            node_id: "n",
            actor: "甲",
            move: "挥铁棍",
            at_seconds: 0.2,
            duration_seconds: 1,
            contact: false,
          },
        ],
      },
    ],
    props_after: [{ name: "甲", left: null, right: "铁棍" }],
  });
  const request = async () => ({ text, detail: "" });
  const result = await runPipelineAgentAction(
    film,
    { step: "action", targetId: shot.sceneId },
    { valid: () => true, request },
  );
  expect(result.status).toBe("done");
  expect(result.film?.shots[0]?.actionPlan?.nodes[0]).toMatchObject({
    at: 0.2,
    duration: 1,
    contact: false,
  });
  expect(result.film?.scenes[0]?.actionState?.propsAfter[0]?.right).toBe("铁棍");
  const locked = { ...shot, action: "用户保留动作", userFields: ["action"] };
  const manual = await planActionDraft(film, locked, {
    request,
    current: () => true,
    connected: true,
  });
  expect(manual.status).toBe("ready");
  if (manual.status !== "ready") return;
  expect(manual.shot.action).toBe("用户保留动作");
  expect(manual.shot.userFields).toContain("action");
  expect(manual.actionState?.unassigned[0]?.reason).toBe("USER_EDITED");
});

it("does not invent empty hands for omitted or invalid prop fields, but honors explicit null", () => {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  const parsed = parseActionPlan({
    props_after: [
      { name: "甲", shot_id: shot.id, right: "铁棍" },
      { name: "乙", shot_id: shot.id },
      { name: "丙", shot_id: shot.id, left: null, right: 42 },
    ],
  });
  const plan = parsed.shots[0]!.plan;
  expect(plan.propsAfter[0]).not.toHaveProperty("left");
  expect(plan.propsAfter[1]).not.toHaveProperty("left");
  expect(plan.propsAfter[1]).not.toHaveProperty("right");
  expect(plan.propsAfter[2]).toMatchObject({ left: null });
  expect(plan.propsAfter[2]).not.toHaveProperty("right");
  const prompt = actionPlanPrompt({ ...shot, userFields: [], actionPlan: plan });
  expect(prompt).toContain("甲：右手铁棍");
  expect(prompt).not.toContain("结束时乙");
  expect(prompt).toContain("丙：左手空手");
  expect(prompt.match(/空手/g)).toHaveLength(1);
});
