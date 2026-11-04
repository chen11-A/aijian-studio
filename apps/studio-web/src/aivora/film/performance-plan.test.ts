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
    const result = applyPerformancePlans(
      source.map((row) => ({ ...base, id: row.shot_id, userFields: [] })),
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
  const shot = { ...sampleFilm().shots[0]!, userFields: [], performance: "" };
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
  const base = { ...sampleFilm().shots[0]!, userFields: [] };
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
