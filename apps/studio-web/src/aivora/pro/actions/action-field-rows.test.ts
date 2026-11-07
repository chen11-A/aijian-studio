import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { prepareShotDirection } from "./shot-direction-transaction";
import { projectActionFields } from "./action-field-rows";
function fixture() {
  const film = sampleFilm(),
    shot = film.shots[0]!;
  shot.userFields = [];
  shot.source = "agent:director";
  shot.action = "原动作";
  delete shot.actionPlan;
  const scope = {
    projectId: film.id,
    page: "board" as const,
    sceneId: shot.sceneId,
    shotId: shot.id,
  };
  const plan = {
    sourceShotIds: [shot.id],
    binding: "source-overlap" as const,
    nodes: [
      {
        id: "node-private-a",
        at: 0.4,
        duration: 0.6,
        actor: "动作甲",
        target: "动作乙",
        move: "抬起左手",
        bodyPart: "前臂",
        direction: "向上",
        force: 2,
        forceCue: "适中",
        contact: false,
        reaction: "停顿",
        sfxCue: "衣料声",
        feasibility: "稳" as const,
        workaround: "减慢动作",
      },
    ],
    injuries: [
      {
        name: "动作甲",
        bodyPart: "前臂",
        side: "左",
        kind: "擦伤",
        fromShot: shot.id,
        visibleAs: "轻微红痕",
      },
    ],
    propsAfter: [{ name: "书", left: null, right: "手中", shotId: shot.id }],
    promptAddon: "动作自然",
  };
  const next = {
    ...shot,
    action: "抬起左手",
    actionBeats: ["抬起左手"],
    actionPlan: plan,
    source: "agent:action",
    sound: {
      source: "dub" as const,
      ambience: "雨声",
      sfx: [
        { atSeconds: 0, text: "脚步声" },
        { atSeconds: 1.5, text: "衣料声" },
      ],
      musicMood: "紧张",
    },
  };
  const state = {
    propsAfter: [{ name: "书", left: null, right: "桌上", shotId: shot.id }],
    safetyNotes: ["不接触面部"],
    unassigned: [{ shotId: shot.id, reason: "ACTION_REJECTED" as const, plan }],
  };
  film.unassignedBeats = [{ sceneId: shot.sceneId, text: "旧待对应动作" }];
  const tx = prepareShotDirection(film, next, scope, "action", state, [
    { sceneId: shot.sceneId, text: "另一个待核动作" },
  ]);
  return { film, shot, scope, plan, next, state, tx };
}
it("projects every actual action, sound, full state and unassigned change with safe scope labels", () => {
  const f = fixture(),
    rows = projectActionFields(f.tx, f.scope)!;
  expect(rows).not.toBeNull();
  expect(rows.map((row) => row.label)).toEqual([
    "动作说明",
    "动作要点",
    "动作计划",
    "声音计划",
    "镜头建议来源",
    "场内动作状态",
    "本场待对应动作",
  ]);
  const text = rows.map((row) => [row.before, row.after].join("\n")).join("\n");
  for (const term of [
    "0.4 秒（建议时间）",
    "0 秒（建议时间）",
    "0.6 秒（建议时间）",
    "左手：明确留空",
    "配音",
    "紧张",
    "轻微红痕",
    "无接触",
    "减慢动作",
    "不接触面部",
    "动作尚未采纳",
    "旧待对应动作",
    "另一个待核动作",
  ])
    expect(text).toContain(term);
  expect(text).not.toContain(f.shot.id);
  expect(text).not.toContain(f.film.id);
  expect(text).not.toContain("node-private-a");
  f.shot.action = "后来改写";
  f.film.unassignedBeats = [];
  expect(projectActionFields(f.tx, f.scope)).toEqual(rows);
});
it.each([
  "field",
  "plan-key",
  "node-id",
  "duplicate-node",
  "foreign-injury",
  "foreign-prop",
  "source-shot",
  "source-duplicate",
  "binding-missing",
  "state-key",
  "state-prop",
  "unassigned",
  "beats",
  "source",
  "unsafe",
  "scope",
])("falls back as a whole for unknown or ambiguous %s", (mode) => {
  const f = fixture(),
    tx = structuredClone(f.tx),
    scope = { ...f.scope };
  const plan = tx.changes.find((row) => row.field === "actionPlan")!.after.value as typeof f.plan &
    Record<string, unknown>;
  if (mode === "field") tx.changes[0]!.field = "picture";
  if (mode === "plan-key") plan.hidden = "cannot omit";
  if (mode === "node-id") plan.nodes[0]!.id = "/private/node";
  if (mode === "duplicate-node") plan.nodes.push({ ...plan.nodes[0]! });
  if (mode === "foreign-injury") plan.injuries[0]!.fromShot = "foreign";
  if (mode === "foreign-prop") plan.propsAfter[0]!.shotId = "foreign";
  if (mode === "source-shot") plan.sourceShotIds = ["foreign"];
  if (mode === "source-duplicate") plan.sourceShotIds = [f.scope.shotId!, f.scope.shotId!];
  if (mode === "binding-missing") Reflect.deleteProperty(plan, "sourceShotIds");
  if (mode === "state-key")
    (tx.stateAfter.value as unknown as Record<string, unknown>).hidden = "cannot omit";
  if (mode === "state-prop")
    (tx.stateAfter.value as typeof f.state).propsAfter[0]!.shotId = "foreign";
  if (mode === "unassigned")
    (tx.stateAfter.value as typeof f.state).unassigned[0]!.shotId = "foreign";
  if (mode === "beats") tx.beatsAfter[0]!.sceneId = "foreign";
  if (mode === "source") tx.changes.find((row) => row.field === "source")!.after.value = "unknown";
  if (mode === "unsafe") plan.nodes[0]!.move = "Bearer private-secret-value";
  if (mode === "scope") scope.shotId = "foreign";
  expect(projectActionFields(tx, scope)).toBeNull();
});
it("shows node identity replacement without leaking raw IDs or hiding a real plan change", () => {
  const f = fixture();
  f.shot.actionPlan = structuredClone(f.plan);
  const plan = {
    ...structuredClone(f.plan),
    nodes: [{ ...f.plan.nodes[0]!, id: "new-hidden-id" }],
  };
  const tx = prepareShotDirection(f.film, { ...f.shot, actionPlan: plan }, f.scope, "action");
  const rows = projectActionFields(tx, f.scope)!;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.before).toContain("原动作段 1");
  expect(rows[0]!.after).toContain("新动作段 1");
  expect(JSON.stringify(rows)).not.toMatch(/node-private-a|new-hidden-id/);
});
it("rejects oversized combined state instead of truncating the reviewed transaction", () => {
  const f = fixture();
  f.tx.beatsAfter = Array.from({ length: 5 }, () => ({
    sceneId: f.scope.sceneId,
    text: "x".repeat(8192),
  }));
  expect(projectActionFields(f.tx, f.scope)).toBeNull();
});
