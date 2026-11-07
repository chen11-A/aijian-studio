import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { createProductionPipeline } from "../film/production-pipeline";
import { createPipelineControls } from "./pipeline-controls";
import type { createPipelineWorkspaceHost } from "./pipeline-workspace-host";
function setup() {
  let film = sampleFilm();
  film.productionPipeline = createProductionPipeline(film.id, "input");
  const workspace = {
    start: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    retry: vi.fn(async (_keys: string[]) => undefined),
    continue: vi.fn(async () => undefined),
    continueAfterTrial: vi.fn(async (_decisionId: string) => undefined),
    acceptReview: vi.fn(async (_reason: string) => undefined),
    cancel: vi.fn(),
    projectChanged: vi.fn(),
  };
  const notify = vi.fn();
  const controls = createPipelineControls({
    current: () => film,
    workspace: workspace as unknown as ReturnType<typeof createPipelineWorkspaceHost>,
    notify,
  });
  return {
    film,
    workspace,
    notify,
    controls,
    switchProject: () => {
      film = { ...film, id: "other" };
    },
  };
}
it("keeps empty progress empty instead of inventing completed work", () => {
  const s = setup();
  delete s.film.productionPipeline;
  expect(s.controls.props()).toMatchObject({ steps: [], checkpoint: null, canContinue: false });
});
it("retries only the selected uncertain target after explicit outcome confirmation", async () => {
  const s = setup(),
    state = s.film.productionPipeline!,
    step = state.steps[0]!;
  state.status = "uncertain";
  Object.assign(step, {
    status: "uncertain",
    planned: true,
    total: 2,
    done: 1,
    targets: [
      { id: "script", status: "done", attempt: 1 },
      { id: "cast", status: "uncertain", attempt: 1 },
    ],
  });
  const props = s.controls.props();
  expect(await props.onRetryTarget("writer", "cast", false)).toBe(false);
  expect(await props.onRetryTarget("video", "all", true)).toBe(false);
  expect(s.workspace.retry).not.toHaveBeenCalled();
  expect(await props.onRetryTarget("writer", "cast", true)).toBe(true);
  expect(s.workspace.retry).toHaveBeenCalledExactlyOnceWith(["writer/cast"]);
});
it("rechecks persisted state and project identity when an old callback is clicked", async () => {
  const s = setup(),
    state = s.film.productionPipeline!,
    step = state.steps[0]!;
  Object.assign(step, {
    status: "failed",
    planned: true,
    total: 1,
    targets: [{ id: "script", status: "failed", attempt: 1 }],
  });
  state.status = "failed";
  const props = s.controls.props();
  state.status = "running";
  expect(await props.onRetryTarget("writer", "script", true)).toBe(false);
  state.status = "failed";
  s.switchProject();
  expect(await props.onRetryTarget("writer", "script", true)).toBe(false);
  props.onCancel();
  expect(s.workspace.retry).not.toHaveBeenCalled();
  expect(s.workspace.cancel).not.toHaveBeenCalled();
});
it("cannot bypass the review and checkpoint through the continue callback", async () => {
  const s = setup();
  expect(await s.controls.props().onContinue()).toBe(false);
  expect(s.workspace.continue).not.toHaveBeenCalled();
});
function reviewed(s: ReturnType<typeof setup>, accepted = false) {
  const state = s.film.productionPipeline!;
  for (const step of state.steps) {
    if (step.id === "video") break;
    Object.assign(step, {
      planned: true,
      status: "done",
      done: 1,
      total: 1,
      targets: [{ id: "all", status: "done", attempt: 1 }],
    });
  }
  const review = state.steps.find((step) => step.id === "review")!;
  review.status = accepted ? "accepted" : "needs-input";
  review.targets[0]!.status = review.status;
  review.done = accepted ? 1 : 0;
  if (accepted) review.targets[0]!.detail = "已经逐张核对";
  state.status = accepted ? "checkpoint" : "needs-input";
  return state;
}
it("records explicit human review separately from continuing to videos", async () => {
  const s = setup();
  reviewed(s);
  const props = s.controls.props();
  expect(props.canAcceptReview).toBe(true);
  expect(await props.onAcceptReview(" ")).toBe(false);
  expect(await props.onAcceptReview(" 看过每张图 ")).toBe(true);
  expect(s.workspace.acceptReview).toHaveBeenCalledExactlyOnceWith("看过每张图");
  expect(s.workspace.continue).not.toHaveBeenCalled();
});
it("continues only from a valid complete checkpoint, not from stale props", async () => {
  const s = setup(),
    state = reviewed(s, true);
  state.checkpoint = {
    shotCount: 1,
    seconds: 3,
    estimatedRequests: 1,
    coverage: [{ sceneId: "scene", ok: true, missingLines: [], missingTail: null }],
    risks: [],
  };
  const props = s.controls.props();
  expect(props.canContinue).toBe(true);
  state.checkpoint.coverage[0]!.ok = false;
  expect(await props.onContinue()).toBe(false);
  state.checkpoint.coverage[0]!.ok = true;
  expect(await props.onContinue()).toBe(true);
  expect(s.workspace.continue).toHaveBeenCalledOnce();
});
it("blocks duplicate starts before state saves, permits cancel and releases the local busy flag", async () => {
  const s = setup();
  let finish!: () => void;
  s.workspace.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(undefined);
      }),
  );
  const pending = s.controls.start();
  expect(s.controls.props().busy).toBe(true);
  expect(await s.controls.start()).toBe(false);
  s.controls.props().onCancel();
  expect(s.workspace.cancel).toHaveBeenCalledOnce();
  finish();
  expect(await pending).toBe(true);
  expect(s.controls.props().busy).toBe(false);
});
it("reports known failure codes without leaking raw exceptions and allows a later action", async () => {
  const s = setup();
  s.workspace.start.mockRejectedValueOnce(
    Object.assign(new Error("private request"), { code: "PIPELINE_SAVE_FAILED" }),
  );
  expect(await s.controls.start()).toBe(false);
  expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "PIPELINE_SAVE_FAILED" }));
  expect(JSON.stringify(s.notify.mock.calls)).not.toContain("private request");
  expect(await s.controls.start()).toBe(true);
});

it("keeps trial continuation behind the same live checkpoint, project and single busy gate", async () => {
  const s = setup(),
    id = `rtd_${"a".repeat(32)}`;
  expect(await s.controls.props().onContinueAfterTrial(id)).toBe(false);
  const state = reviewed(s, true);
  state.checkpoint = {
    shotCount: 1,
    seconds: 3,
    estimatedRequests: 1,
    coverage: [{ sceneId: "scene", ok: true, missingLines: [], missingTail: null }],
    risks: [],
  };
  const props = s.controls.props();
  expect(await props.onContinueAfterTrial("wrong")).toBe(false);
  let release!: () => void;
  s.workspace.continueAfterTrial.mockImplementationOnce(
    () =>
      new Promise<undefined>((done) => {
        release = () => done(undefined);
      }),
  );
  const first = props.onContinueAfterTrial(id);
  expect(await props.onContinueAfterTrial(id)).toBe(false);
  expect(s.workspace.continueAfterTrial).toHaveBeenCalledExactlyOnceWith(id);
  release();
  expect(await first).toBe(true);
  state.checkpoint.coverage[0]!.ok = false;
  expect(await props.onContinueAfterTrial(id)).toBe(false);
  state.checkpoint.coverage[0]!.ok = true;
  s.switchProject();
  expect(await props.onContinueAfterTrial(id)).toBe(false);
  expect(s.workspace.continue).not.toHaveBeenCalled();
});
