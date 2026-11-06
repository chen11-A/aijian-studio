import { expect, it } from "vitest";
import { createProductionPipeline } from "../film/production-pipeline";
import { pipelineRetryKey, pipelineView } from "./pipeline-view";
function fixture() {
  return { id: "film-1", productionPipeline: createProductionPipeline("film-1", "input-1") };
}
function reviewFixture() {
  const film = fixture();
  const state = film.productionPipeline;
  for (const step of state.steps) {
    if (step.id === "review") break;
    Object.assign(step, {
      status: "done",
      planned: true,
      done: 1,
      total: 1,
      targets: [{ id: "target", status: "done", attempt: 1 }],
    });
  }
  const review = state.steps.find((step) => step.id === "review")!;
  Object.assign(review, {
    status: "needs-input",
    planned: true,
    total: 1,
    targets: [{ id: "all", status: "needs-input", attempt: 1 }],
  });
  state.status = "needs-input";
  return film;
}
it("does not invent progress for absent, damaged or cross-project state", () => {
  expect(pipelineView({ id: "film-1" })).toEqual({ kind: "empty" });
  const film = fixture();
  film.productionPipeline.steps.pop();
  expect(pipelineView(film).kind).toBe("invalid");
  expect(pipelineView({ ...fixture(), id: "other" })).toEqual({
    kind: "invalid",
    code: "PROJECT_RESULT_MISMATCH",
  });
});
it("retains raw statuses and requires an explicit decision for the exact uncertain target", () => {
  const film = fixture(),
    step = film.productionPipeline.steps[0]!;
  Object.assign(step, {
    planned: true,
    status: "uncertain",
    total: 2,
    done: 1,
    targets: [
      { id: "script", status: "done", attempt: 1 },
      { id: "cast", status: "uncertain", attempt: 1 },
    ],
  });
  film.productionPipeline.status = "uncertain";
  const view = pipelineView(film);
  expect(view.kind === "ready" && view.steps[0]?.targets[1]?.status).toBe("uncertain");
  expect(pipelineRetryKey(film, "writer", "cast")).toBeNull();
  expect(pipelineRetryKey(film, "writer", "cast", true)).toBe("writer/cast");
  expect(pipelineRetryKey(film, "writer", "script", true)).toBeNull();
  expect(pipelineRetryKey(film, "portraits", "cast", true)).toBeNull();
  if (view.kind === "ready") view.steps[0]!.targets[1]!.status = "done";
  expect(step.targets[1]!.status).toBe("uncertain");
  film.productionPipeline.status = "running";
  expect(pipelineRetryKey(film, "writer", "cast", true)).toBeNull();
});
it("offers human review only after all earlier work, never as permission to continue", () => {
  const film = reviewFixture();
  expect(pipelineView(film)).toMatchObject({ canAcceptReview: true, canContinue: false });
  expect(pipelineRetryKey(film, "review", "all", true)).toBeNull();
  film.productionPipeline.steps[0]!.status = "blocked";
  expect(pipelineView(film)).toMatchObject({ canAcceptReview: false, canContinue: false });
});
it("requires an independent valid checkpoint and preserves manual acceptance", () => {
  const film = reviewFixture(),
    state = film.productionPipeline;
  const review = state.steps.find((step) => step.id === "review")!;
  Object.assign(review, {
    status: "accepted",
    done: 1,
    targets: [{ id: "all", status: "accepted", attempt: 1, detail: "已人工核对" }],
  });
  state.status = "checkpoint";
  state.checkpoint = {
    shotCount: 2,
    seconds: 8,
    estimatedRequests: 2,
    coverage: [{ sceneId: "scene-1", ok: true, missingLines: [], missingTail: null }],
    risks: [],
  };
  expect(pipelineView(film)).toMatchObject({ canContinue: true, canAcceptReview: false });
  state.checkpoint.risks.push({ code: "CHECK", text: "待检查", severity: "block" });
  expect(pipelineView(film)).toMatchObject({ canContinue: false });
  state.checkpoint.risks = [];
  state.checkpoint.coverage[0]!.ok = false;
  expect(pipelineView(film)).toMatchObject({ canContinue: false });
  state.status = "blocked";
  expect(pipelineView(film)).toMatchObject({ canContinue: false });
});
