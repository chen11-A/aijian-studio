import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { prepareShotDirection } from "./shot-direction-transaction";
import { projectPerformanceFields } from "./performance-field-rows";
function fixture() {
  const film = sampleFilm(),
    shot = film.shots[0]!;
  shot.userFields = [];
  shot.source = "agent:director";
  delete shot.performanceSource;
  delete shot.performancePlan;
  const scope = {
    projectId: film.id,
    page: "board" as const,
    sceneId: shot.sceneId,
    shotId: shot.id,
  };
  const person = {
    name: "小林",
    emotion: "紧张",
    intensity: 2,
    face: ["收紧眉头"],
    faceAt: [0.5],
    eyes: "看向对方",
    gaze: "短暂移开",
    holdSeconds: 1,
    hands: "握紧",
    breath: "急促",
    voice: { tone: "低声", pace: "稍慢", pauses: "句间停顿", emotion: "克制" },
    voiceAlternatives: [{ tone: "平静", pace: "正常", pauses: "无", emotion: "冷静" }],
    declarations: {
      role: "primary" as const,
      holdS: null,
      voice: [{ tone: "轻声", pause: "短停" }],
    },
  };
  const proposed = {
    ...shot,
    performance: "压低声音，目光停留",
    performanceSource: "agent:performance",
    delivery: "低声稍慢",
    source: "agent:performance",
    performancePlan: {
      binding: "explicit" as const,
      sourceId: shot.id,
      people: [person],
      scopeCues: [],
      promptAddon: "不要夸张",
      unverifiedPeople: [],
      timingWarnings: [{ name: "小林", field: "faceAt" as const, value: 0.5 }],
    },
  };
  const tx = prepareShotDirection(film, proposed, scope, "performance", {
    unassigned: [],
    voiceReviews: [{ shotId: shot.id, reason: "VOICE_NOT_UNIQUE" }],
  });
  return { film, shot, scope, tx };
}
it("projects every supported field and state from the fixed request, with typed safe prose and explicit proposed timing", () => {
  const f = fixture(),
    rows = projectPerformanceFields(f.tx, f.scope)!;
  expect(rows).not.toBeNull();
  expect(rows.map((row) => row.label)).toEqual([
    "表演说明",
    "表演计划",
    "表演来源",
    "配音语气",
    "镜头建议来源",
    "表演待核项",
  ]);
  const plan = rows.find((row) => row.label === "表演计划")!;
  expect(plan.before).toBeNull();
  expect(plan.kind).toBe("added");
  for (const text of ["收紧眉头", "0.5 秒（建议时间）", "轻声", "明确留空", "声音对应待确认"])
    expect(rows.map((row) => row.after).join("\n")).toContain(text);
  expect(JSON.stringify(rows)).not.toContain(f.shot.id);
  expect(JSON.stringify(rows)).not.toContain("sourceId");
  f.shot.performance = "后来改写";
  f.film.characters[0]!.name = "后来改名";
  expect(projectPerformanceFields(f.tx, f.scope)).toEqual(rows);
});
it.each([
  "unknown-key",
  "source-id",
  "unsafe-text",
  "wrong-target",
  "unknown-source",
  "unknown-review",
  "unassigned",
  "scope",
  "unsupported",
])("keeps %s transactions entirely out of field mode", (mode) => {
  const f = fixture();
  const tx = structuredClone(f.tx),
    scope = { ...f.scope };
  const plan = tx.changes.find((row) => row.field === "performancePlan")!;
  if (mode === "unknown-key") (plan.after.value as Record<string, unknown>).hidden = "not shown";
  if (mode === "source-id")
    (plan.after.value as Record<string, unknown>).sourceId = "another-private-id";
  if (mode === "unsafe-text")
    tx.changes.find((row) => row.field === "performance")!.after.value = "secret=private";
  if (mode === "wrong-target") plan.target = { collection: "shots", id: "another" };
  if (mode === "unknown-source")
    tx.changes.find((row) => row.field === "source")!.after.value = "file:///private";
  if (mode === "unknown-review")
    (tx.stateAfter.value as { voiceReviews: { reason: string }[] }).voiceReviews[0]!.reason =
      "unknown";
  if (mode === "unassigned")
    (tx.stateAfter.value as { unassigned: unknown[] }).unassigned.push({
      shotId: "private",
      plan: {},
    });
  if (mode === "scope") scope.shotId = "another";
  if (mode === "unsupported") tx.unsupported.push("UNKNOWN");
  expect(projectPerformanceFields(tx, scope)).toBeNull();
});
it("preserves meaningful absent, empty and explicit undefined presence without inventing values", () => {
  const f = fixture();
  f.shot.performance = "原来的表演";
  const tx = prepareShotDirection(
    f.film,
    { ...f.shot, performance: "", performancePlan: undefined },
    f.scope,
    "performance",
  );
  const rows = projectPerformanceFields(tx, f.scope)!;
  expect(rows.find((row) => row.label === "表演说明")?.after).toBe("");
  expect(rows.find((row) => row.label === "表演计划")).toMatchObject({
    kind: "added",
    before: null,
    after: "未设置",
  });
});
