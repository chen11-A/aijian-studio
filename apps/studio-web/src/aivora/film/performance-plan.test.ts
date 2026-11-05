import { expect, it } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import {
  applyPerformancePlans,
  parsePerformancePlans,
  performancePlanPrompt,
} from "./performance-plan";
import { assignPerformance } from "./phase2";
import { sampleFilm } from "./project";
import { motionPrompt } from "./operations";

for (const entry of fixtures.examples.filter((item) => item.role === "performance")) {
  it(`${entry.example.id}: retains actual actor names, facial timings, gaze, intensity and others`, () => {
    const source = entry.example.output as unknown as {
      shot_id: string;
      who: string;
      intensity: number;
      face: string[];
      face_at: number[];
      gaze: string;
      hold_s: number | null;
      others: { name: string; face: string[] }[];
      prompt_addon: string;
    }[];
    const rows = parsePerformancePlans(source);
    source.forEach((row, index) => {
      expect(rows[index]!.shotId).toBe(row.shot_id);
      expect(rows[index]!.plan.people[0]).toMatchObject({
        name: row.who,
        intensity: row.intensity,
        face: row.face,
        faceAt: row.face_at,
        gaze: row.gaze,
      });
      if (row.hold_s !== null) expect(rows[index]!.plan.people[0]!.holdSeconds).toBe(row.hold_s);
      else expect(rows[index]!.plan.people[0]).not.toHaveProperty("holdSeconds");
      expect(rows[index]!.plan.people.slice(1).map((p) => p.name)).toEqual(
        row.others.map((p) => p.name),
      );
      expect(rows[index]!.plan.promptAddon).toBe(row.prompt_addon);
    });
    const base = sampleFilm().shots[0]!;
    const input = entry.example.input as unknown as {
      shots: { shot_id: string; characters: string[]; speaker: string; seconds: number }[];
    };
    const result = applyPerformancePlans(
      source.map((row) => {
        const original = input.shots.find((shot) => shot.shot_id === row.shot_id)!;
        return {
          ...base,
          id: row.shot_id,
          characters: original.characters,
          speaker: original.speaker,
          seconds: original.seconds,
          lines: [],
          userFields: [],
        };
      }),
      source,
    );
    expect(result.state.unassigned).toEqual([]);
    result.shots.forEach((shot, index) => {
      const prompt = motionPrompt(shot);
      for (const person of rows[index]!.plan.people) {
        expect(prompt).toContain(`${person.name}：`);
        for (const face of person.face) expect(prompt).toContain(face);
      }
    });
  });
}
it("keeps missing timings unspecified, preserves named people and never routes wrong IDs by position", () => {
  const shot = {
    ...sampleFilm().shots[0]!,
    characters: ["甲", "乙"],
    userFields: [],
    performance: "",
  };
  const row = {
    shot_id: shot.id,
    who: "甲",
    face: ["皱眉"],
    others: [{ name: "乙", face: ["微笑"], gaze: "画左" }],
  };
  const applied = applyPerformancePlans([shot], [row]);
  const plan = applied.shots[0]!.performancePlan!;
  expect(plan.people[0]!.faceAt).toEqual([null]);
  expect(plan.people[0]).not.toHaveProperty("holdSeconds");
  expect(plan.people[0]).not.toHaveProperty("intensity");
  const prompt = performancePlanPrompt(applied.shots[0]!);
  expect(prompt).toContain("甲：皱眉");
  expect(prompt).toContain("乙：微笑，视线画左");
  expect(prompt).not.toContain("第0秒");
  const invalid = applyPerformancePlans(
    [shot],
    [
      { ...row, shot_id: "wrong" },
      { ...row, shot_id: "" },
    ],
  );
  expect(invalid.shots[0]).toBe(shot);
  expect(invalid.state.unassigned.map((p) => p.reason)).toEqual(["UNKNOWN_SHOT", "UNKNOWN_SHOT"]);
  expect(
    assignPerformance(
      [
        { ...row, shot_id: "wrong" },
        { ...row, shot_id: "other" },
      ],
      [shot],
    )[0]!.performance,
  ).toBe("");
});
it("preserves locked performance, retains duplicate identities for review and rejects unnamed performers", () => {
  const shot = { ...sampleFilm().shots[0]!, performance: "用户表演", userFields: ["performance"] };
  const row = { shot_id: shot.id, who: "甲", face: ["皱眉"] };
  const locked = applyPerformancePlans([shot], [row]);
  expect(locked.shots[0]).toBe(shot);
  expect(locked.state.unassigned[0]!.reason).toBe("USER_EDITED");
  const duplicate = applyPerformancePlans([{ ...shot, userFields: [] }], [row, row]);
  expect(duplicate.state.unassigned).toHaveLength(2);
  expect(duplicate.state.unassigned[0]!.reason).toBe("DUPLICATE_SHOT");
  const unnamed = applyPerformancePlans(
    [{ ...shot, userFields: [] }],
    [{ shot_id: shot.id, face: ["皱眉"] }],
  );
  expect(unnamed.state.unassigned).toEqual([]);
  expect(unnamed.shots[0]!.performancePlan!.people).toEqual([]);
  expect(unnamed.shots[0]!.performancePlan!.scopeCues[0]!.face).toEqual(["皱眉"]);
});

it("creates an explicit manual replacement draft while retaining delivery lock and original input", async () => {
  const { planPerformanceDraft } = await import("../pro/actions/performance");
  const shot = {
    ...sampleFilm().shots[0]!,
    characters: ["甲"],
    performance: "用户表演",
    delivery: "用户语气",
    userFields: ["performance", "delivery"],
  };
  const result = await planPerformanceDraft(shot, {
    current: () => true,
    connected: true,
    request: async () => ({
      text: JSON.stringify([
        { shot_id: shot.id, who: "甲", face: ["皱眉"], voice: { tone: "低声" } },
      ]),
      detail: "",
    }),
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  expect(result.shot.performance).toContain("甲：皱眉");
  expect(shot.performance).toBe("用户表演");
  expect(result.shot.delivery).toBe("用户语气");
  expect(result.shot.userFields).toEqual(["delivery"]);
  expect(result.performanceState?.unassigned).toEqual([]);
});

it("binds exact IDs first then remaining equal-count rows, recording original identity", () => {
  const base = { ...sampleFilm().shots[0]!, characters: ["甲"], userFields: [] };
  const shots = [
    { ...base, id: "a" },
    { ...base, id: "b" },
    { ...base, id: "c" },
  ];
  const result = applyPerformancePlans(shots, [
    { id: "wrong", face: ["皱眉"] },
    { id: "a", who: "甲", face: ["微笑"] },
    { face: ["抬眉"] },
  ]);
  expect(result.state.unassigned).toEqual([]);
  expect(
    result.shots.map((s) => [s.performancePlan?.binding, s.performancePlan?.sourceId]),
  ).toEqual([
    ["explicit", "a"],
    ["scope-order", "wrong"],
    ["scope-order", ""],
  ]);
  expect(motionPrompt(result.shots[1]!)).toContain("本镜表演：皱眉");
  expect(result.shots[1]!.performancePlan!.people).toEqual([]);
  const single = applyPerformancePlans([shots[0]!], [{ face: ["抬眉"] }]);
  expect(single.shots[0]!.performancePlan?.binding).toBe("scope-order");
  expect(motionPrompt(single.shots[0]!)).toContain("抬眉");
});

it("reads micro-expression object times and retains but does not issue out-of-shot timings", () => {
  const shot = {
    ...sampleFilm().shots[0]!,
    characters: ["甲"],
    speaker: "",
    lines: [],
    userFields: [],
    seconds: 3,
  };
  const output = [
    {
      id: shot.id,
      who: "甲",
      micro_expressions: [
        { text: "皱眉", at: 0.5 },
        { text: "抿嘴", at_seconds: 9 },
        { text: "抬眉" },
      ],
      hold_s: 8,
    },
  ];
  const result = applyPerformancePlans([shot], output);
  expect(result.shots[0]!.performancePlan!.people[0]!.faceAt).toEqual([0.5, 9, null]);
  expect(result.shots[0]!.performancePlan!.timingWarnings).toEqual([
    { name: "甲", field: "faceAt", value: 9 },
    { name: "甲", field: "holdSeconds", value: 8 },
  ]);
  const prompt = performancePlanPrompt(result.shots[0]!);
  expect(prompt).toContain("第0.5秒皱眉");
  expect(prompt).toContain("抿嘴");
  expect(prompt).not.toMatch(/第9秒|保持8秒|第0秒/);
});
it("keeps out-of-scope named performers for review without injecting them, and marks empty scopes unverified", () => {
  const shot = {
    ...sampleFilm().shots[0]!,
    characters: ["甲"],
    speaker: "",
    lines: [],
    userFields: [],
  };
  const output = [{ id: shot.id, who: "陌生角色", face: ["微笑"], prompt_addon: "陌生角色挥手" }];
  const result = applyPerformancePlans([shot], output);
  expect(result.state.unassigned[0]?.reason).toBe("UNKNOWN_PERFORMER");
  expect(result.state.unassigned[0]?.plan.people[0]?.name).toBe("陌生角色");
  expect(performancePlanPrompt(result.shots[0]!)).not.toContain("陌生角色");
  const unknown = applyPerformancePlans([{ ...shot, characters: [] }], output);
  expect(unknown.state.unassigned).toEqual([]);
  expect(unknown.shots[0]?.performancePlan?.unverifiedPeople).toEqual(["陌生角色"]);
});

it("selects nested voice only for one explicit speaker and retains ambiguous plans for review", async () => {
  const { runPipelineAgentAction } = await import("../pro/pipeline-agent-actions");
  const { planPerformanceDraft } = await import("../pro/actions/performance");
  const film = sampleFilm();
  const shot = {
    ...film.shots[0]!,
    characters: ["甲", "乙"],
    speaker: "乙",
    lines: [{ speaker: "乙", text: "等等" }],
    line: "等等",
    delivery: "原语气",
    userFields: [],
  };
  film.shots = [shot];
  const reply = [
    {
      id: shot.id,
      performances: [
        { who: "甲", face: ["皱眉"], voice: { tone: "高声", pace: "快" } },
        { who: "乙", face: ["抿嘴"], voice: { tone: "低声", pace: "慢" } },
      ],
    },
  ];
  const selected = assignPerformance(reply, [shot])[0]!;
  expect(selected.delivery).toContain("低声");
  expect(selected.delivery).toContain("语速慢");
  expect(selected.delivery).not.toContain("高声");
  const multiple = {
    ...shot,
    speaker: "",
    lines: [
      { speaker: "甲", text: "先走" },
      { speaker: "乙", text: "等等" },
    ],
  };
  expect(assignPerformance(reply, [multiple])[0]).toMatchObject({
    delivery: "",
    voiceRisk: "MULTIPLE_SPEAKERS",
  });
  expect(assignPerformance(reply, [{ ...shot, speaker: "", lines: [] }])[0]).toMatchObject({
    delivery: "",
    voiceRisk: "SPEAKER_UNSPECIFIED",
  });
  const duplicate = [
    { id: shot.id, performances: [reply[0]!.performances[1], reply[0]!.performances[1]] },
  ];
  expect(assignPerformance(duplicate, [shot])[0]).toMatchObject({
    delivery: "",
    voiceRisk: "VOICE_NOT_UNIQUE",
  });
  expect(
    assignPerformance(
      [{ id: shot.id, face: ["抬眉"], voice: { tone: "旧顶层语气" } }],
      [multiple],
    )[0]!.delivery,
  ).toContain("旧顶层语气");
  expect(
    assignPerformance(
      [
        {
          id: shot.id,
          performances: [{ who: "乙", face: ["抬眉"] }],
          voice: { tone: "旧顶层语气" },
        },
      ],
      [multiple],
    )[0]!.delivery,
  ).toContain("旧顶层语气");
  const alternatives = [
    {
      id: shot.id,
      performances: [{ who: "乙", face: ["抬眉"], voice: [{ tone: "低声" }, { tone: "高声" }] }],
    },
  ];
  expect(assignPerformance(alternatives, [shot])[0]?.voiceRisk).toBe("VOICE_NOT_UNIQUE");
  expect(
    applyPerformancePlans([shot], alternatives).shots[0]?.performancePlan?.people[0]
      ?.voiceAlternatives,
  ).toHaveLength(2);
  const request = async () => ({ text: JSON.stringify(reply), detail: "" });
  const manual = await planPerformanceDraft(multiple, {
    request,
    connected: true,
    current: () => true,
  });
  expect(manual.status).toBe("ready");
  if (manual.status === "ready") {
    expect(manual.shot.delivery).toBe("原语气");
    expect(manual.performanceState?.voiceReviews).toEqual([
      { shotId: shot.id, reason: "MULTIPLE_SPEAKERS" },
    ]);
    expect(manual.shot.performancePlan?.people).toHaveLength(2);
  }
  const pipeline = await runPipelineAgentAction(
    { ...film, shots: [multiple] },
    { step: "performance", targetId: shot.sceneId },
    { request, valid: () => true },
  );
  expect(pipeline).toMatchObject({ status: "blocked", code: "PERFORMANCE_VOICE_REVIEW" });
  expect(pipeline.film?.shots[0]?.delivery).toBe("原语气");
  expect(pipeline.film?.shots[0]?.performancePlan?.people).toHaveLength(2);
});
