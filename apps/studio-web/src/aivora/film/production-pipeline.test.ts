import { describe, expect, it, vi } from "vitest";
import {
  createProductionPipeline,
  recoverProductionPipeline,
  runProductionPipeline,
  type ProductionCheckpoint,
  type ProductionHost,
  type ProductionPipeline,
  type ProductionResult,
  isProductionPipeline,
  validateProductionPipeline,
} from "./production-pipeline";
const checkpoint = (): ProductionCheckpoint => ({
  shotCount: 2,
  seconds: 8,
  estimatedRequests: 2,
  coverage: [{ sceneId: "s1", ok: true, missingLines: [], missingTail: null }],
  risks: [],
});
function setup() {
  let state = createProductionPipeline(crypto.randomUUID(), "source-v1");
  const live = { projectId: state.projectId, inputVersion: state.inputVersion };
  const order: string[] = [];
  const host: ProductionHost = {
    current: () => live,
    targets: vi.fn(() => ["all"]),
    execute: vi.fn<ProductionHost["execute"]>(async (step) => {
      order.push(`execute:${step}`);
      return { status: "done", data: { artifact: step } };
    }),
    checkpoint,
    save: vi.fn(async (next, context) => {
      if (context.isCurrent()) {
        state = structuredClone(next);
        if (context.completion) order.push(`save:${context.completion.step}`);
      }
    }),
  };
  return { host, live, order, saved: () => state };
}
describe("persisted production pipeline", () => {
  it.each([
    "schema",
    "missing-step",
    "duplicate-step",
    "duplicate-target",
    "unknown-status",
    "bad-count",
    "fake-done",
  ])("blocks corrupted %s persisted state without starting a new run", async (kind) => {
    const h = setup();
    const value = structuredClone(h.saved()) as ProductionPipeline;
    if (kind === "schema") Object.assign(value, { schemaVersion: 2 });
    if (kind === "missing-step") value.steps.pop();
    if (kind === "duplicate-step") value.steps[1]!.id = "writer";
    if (kind === "unknown-status") Object.assign(value.steps[0]!, { status: "success" });
    if (kind === "bad-count") value.steps[0]!.done = 9;
    if (kind === "fake-done") value.status = "done";
    if (kind === "duplicate-target")
      value.steps[0] = {
        id: "writer",
        status: "queued",
        planned: true,
        done: 0,
        total: 2,
        targets: [
          { id: "same", status: "queued", attempt: 0 },
          { id: "same", status: "queued", attempt: 0 },
        ],
      };
    expect(isProductionPipeline(value)).toBe(false);
    expect(validateProductionPipeline(value)).toEqual({ ok: false, code: "STATE_INVALID" });
    const result = await runProductionPipeline(value, h.host);
    expect(result).toMatchObject({ status: "blocked", code: "STATE_INVALID" });
    expect((await runProductionPipeline(result, h.host)).code).toBe("STATE_INVALID");
    expect(h.host.execute).not.toHaveBeenCalled();
    expect(h.host.save).not.toHaveBeenCalled();
  });

  it("rejects malformed storage fields and forged continuation or manual-review claims", () => {
    const base = setup().saved();
    const wrongStep = (patch: Record<string, unknown>) => ({
      ...base,
      steps: [{ ...base.steps[0], ...patch }, ...base.steps.slice(1)],
    });
    const wrongTarget = (patch: Record<string, unknown>) =>
      wrongStep({
        planned: true,
        total: 1,
        targets: [{ id: "all", status: "queued", attempt: 0, ...patch }],
      });
    for (const invalid of [
      null,
      [],
      1,
      { ...base, projectId: "" },
      { ...base, inputVersion: "" },
      { ...base, continued: true },
      { ...base, continued: "yes" },
      { ...base, runId: 7 },
      { ...base, current: "not-a-step" },
      { ...base, code: 7 },
      { ...base, checkpoint: {} },
      { ...base, status: "checkpoint" },
      wrongStep({ targets: null }),
      wrongStep({ status: "done" }),
      wrongTarget({ id: "" }),
      wrongTarget({ attempt: -1 }),
      wrongTarget({ status: "running" }),
      wrongTarget({ code: 9 }),
      wrongTarget({ detail: 9 }),
      wrongTarget({ status: "accepted", detail: "" }),
      { ...base, checkpoint: { ...checkpoint(), seconds: Number.NaN } },
      {
        ...base,
        checkpoint: {
          ...checkpoint(),
          coverage: [{ sceneId: "s1", ok: true, missingLines: ["lost"], missingTail: null }],
        },
      },
      {
        ...base,
        checkpoint: { ...checkpoint(), risks: [{ code: "x", text: "risk", severity: "unknown" }] },
      },
    ])
      expect(validateProductionPipeline(invalid).ok).toBe(false);
  });

  it("validates every saved snapshot, including manual-review progress", async () => {
    const h = setup();
    const save = h.host.save;
    h.host.save = async (state, context) => {
      expect(validateProductionPipeline(state).ok).toBe(true);
      await save(state, context);
    };
    expect(validateProductionPipeline(null).ok).toBe(false);
    expect(validateProductionPipeline({}).ok).toBe(false);
    h.host.execute = vi.fn<ProductionHost["execute"]>(async (step) =>
      step === "review"
        ? { status: "needs-input", code: "VISION_UNAVAILABLE" }
        : { status: "done" },
    );
    const first = await runProductionPipeline(h.saved(), h.host);
    const result = await runProductionPipeline(first, h.host, {
      acceptInputs: [{ key: "review/all", reason: "用户已检查全部画面" }],
    });
    await runProductionPipeline(result, h.host, { continue: true });
  });

  it("saves every successful step before advancing and always stops at the checkpoint", async () => {
    const h = setup();
    const result = await runProductionPipeline(h.saved(), h.host);
    expect(result.status).toBe("checkpoint");
    expect(result.checkpoint).toEqual(checkpoint());
    expect(h.order).toEqual(
      [
        "writer",
        "art",
        "portraits",
        "director",
        "action",
        "performance",
        "prompter",
        "stills",
        "review",
      ].flatMap((id) => [`execute:${id}`, `save:${id}`]),
    );
    expect(JSON.stringify(result)).not.toContain("artifact");
    const resumed = await runProductionPipeline(h.saved(), h.host, { continue: true });
    expect(resumed.status).toBe("done");
    expect(h.order.slice(-4)).toEqual([
      "execute:video",
      "save:video",
      "execute:assembly",
      "save:assembly",
    ]);
    expect(vi.mocked(h.host.execute)).toHaveBeenCalledTimes(11);
    await runProductionPipeline(h.saved(), h.host, { continue: true });
    expect(vi.mocked(h.host.execute)).toHaveBeenCalledTimes(11);
  });

  it("cannot bypass the first checkpoint by supplying continue on a new run", async () => {
    const h = setup();
    expect((await runProductionPipeline(h.saved(), h.host, { continue: true })).status).toBe(
      "checkpoint",
    );
    expect(vi.mocked(h.host.execute).mock.calls.some(([step]) => step === "video")).toBe(false);
  });

  it("waits for the artifact and successful target state to be saved before the next request", async () => {
    const h = setup();
    const save = h.host.save;
    let release!: () => void;
    h.host.save = async (state, context) => {
      if (context.completion?.step === "writer")
        await new Promise<void>((done) => {
          release = done;
        });
      await save(state, context);
    };
    const pending = runProductionPipeline(h.saved(), h.host);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(h.host.execute).toHaveBeenCalledTimes(1);
    expect(h.saved().steps[0]?.status).toBe("running");
    release();
    expect((await pending).status).toBe("checkpoint");
  });

  it("preserves ambiguous dispatch outcomes and handles cancellation before dispatch safely", async () => {
    const h = setup();
    h.host.execute = vi.fn<ProductionHost["execute"]>(async () => {
      throw new Error("transport closed");
    });
    expect((await runProductionPipeline(h.saved(), h.host)).status).toBe("uncertain");
    const fresh = setup();
    const controller = new AbortController();
    const save = fresh.host.save;
    fresh.host.save = async (state, context) => {
      await save(state, context);
      if (state.steps[0]?.targets[0]?.status === "running") controller.abort();
    };
    const result = await runProductionPipeline(fresh.saved(), fresh.host, {
      signal: controller.signal,
    });
    expect(result.status).toBe("cancelled");
    expect(result.steps[0]?.targets[0]?.status).toBe("queued");
    expect(fresh.host.execute).not.toHaveBeenCalled();
  });

  it("does not dispatch a pre-cancelled run and refuses duplicate target identities", async () => {
    const h = setup();
    const controller = new AbortController();
    controller.abort();
    expect(
      (await runProductionPipeline(h.saved(), h.host, { signal: controller.signal })).status,
    ).toBe("cancelled");
    expect(h.host.execute).not.toHaveBeenCalled();
    h.host.targets = () => ["same", "same"];
    expect((await runProductionPipeline(h.saved(), h.host)).code).toBe("PIPELINE_TARGETS_INVALID");
  });

  it("allows empty optional stages without inventing work or skipping required review", async () => {
    const h = setup();
    h.host.targets = (step) =>
      ["action", "portraits", "performance"].includes(step) ? [] : ["all"];
    expect((await runProductionPipeline(h.saved(), h.host)).status).toBe("checkpoint");
    expect(vi.mocked(h.host.execute).mock.calls.map(([step]) => step)).toEqual([
      "writer",
      "art",
      "director",
      "prompter",
      "stills",
      "review",
    ]);
  });

  it("resumes only the explicitly retried failed subtarget, retaining earlier completed targets", async () => {
    const h = setup();
    h.host.targets = (step) => (step === "director" ? ["scene-a", "scene-b"] : ["all"]);
    let failed = false;
    h.host.execute = vi.fn<ProductionHost["execute"]>(async (step, id) => {
      if (step === "director" && id === "scene-b" && !failed) {
        failed = true;
        return { status: "failed", code: "PARSE_FAILED" };
      }
      return { status: "done" };
    });
    await runProductionPipeline(h.saved(), h.host);
    expect(h.saved().steps.find((step) => step.id === "director")).toMatchObject({
      done: 1,
      total: 2,
      status: "failed",
    });
    const before = vi.mocked(h.host.execute).mock.calls.length;
    await runProductionPipeline(h.saved(), h.host);
    expect(h.host.execute).toHaveBeenCalledTimes(before);
    const next = await runProductionPipeline(h.saved(), h.host, {
      retryTargets: ["director/scene-b"],
    });
    expect(next.status).toBe("checkpoint");
    expect(
      vi
        .mocked(h.host.execute)
        .mock.calls.filter(([step, id]) => step === "director" && id === "scene-a"),
    ).toHaveLength(1);
    expect(next.steps.find((step) => step.id === "director")?.targets[1]?.attempt).toBe(2);
  });

  it("does not resend an interrupted running request without explicit retry authority", async () => {
    const h = setup();
    const state = h.saved();
    state.status = "running";
    state.steps[0] = {
      id: "writer",
      planned: true,
      done: 0,
      total: 1,
      status: "running",
      targets: [{ id: "all", status: "running", attempt: 1 }],
    };
    expect(recoverProductionPipeline(state).steps[0]?.targets[0]?.status).toBe("uncertain");
    const stopped = await runProductionPipeline(state, h.host);
    expect(stopped.status).toBe("uncertain");
    expect(h.host.execute).not.toHaveBeenCalled();
    expect(
      (await runProductionPipeline(stopped, h.host, { retryTargets: ["writer/all"] })).status,
    ).toBe("checkpoint");
  });

  it("records unavailable visual review as needs-input, never as automatic success", async () => {
    const h = setup();
    h.host.execute = vi.fn<ProductionHost["execute"]>(async (step) =>
      step === "review"
        ? { status: "needs-input", code: "VISION_UNAVAILABLE", detail: "请检查画面。" }
        : { status: "done" },
    );
    const first = await runProductionPipeline(h.saved(), h.host, { continue: true });
    expect(first.status).toBe("needs-input");
    expect(first.steps.find((step) => step.id === "review")?.done).toBe(0);
    const accepted = await runProductionPipeline(first, h.host, {
      acceptInputs: [{ key: "review/all", reason: "用户已逐镜确认" }],
    });
    expect(accepted.status).toBe("checkpoint");
    expect(accepted.steps.find((step) => step.id === "review")?.status).toBe("accepted");
    expect((await runProductionPipeline(accepted, h.host, { continue: true })).status).toBe(
      "accepted",
    );
  });

  it.each(["coverage", "risk", "empty"])(
    "keeps an unsafe %s checkpoint blocked even with continue",
    async (kind) => {
      const h = setup();
      h.host.checkpoint = () => {
        const result = checkpoint();
        if (kind === "coverage") result.coverage[0]!.ok = false;
        if (kind === "risk")
          result.risks.push({ code: "MISSING_IMAGE", text: "缺少画面", severity: "block" });
        if (kind === "empty") result.shotCount = 0;
        return result;
      };
      const result = await runProductionPipeline(h.saved(), h.host, { continue: true });
      expect(result.status).toBe("blocked");
      expect(result.checkpoint).toBeDefined();
      expect(vi.mocked(h.host.execute).mock.calls.some(([step]) => step === "video")).toBe(false);
    },
  );

  it("rejects changed input or planned targets before dispatching more work", async () => {
    const h = setup();
    const saved = h.saved();
    h.live.inputVersion = "changed";
    expect((await runProductionPipeline(saved, h.host)).code).toBe("PIPELINE_INPUT_CHANGED");
    expect(h.host.save).not.toHaveBeenCalled();
    h.live.inputVersion = saved.inputVersion;
    const ready = await runProductionPipeline(saved, h.host);
    h.host.targets = () => ["different-target"];
    const calls = vi.mocked(h.host.execute).mock.calls.length;
    expect((await runProductionPipeline(ready, h.host)).code).toBe("PIPELINE_TARGETS_CHANGED");
    expect(h.host.execute).toHaveBeenCalledTimes(calls);
  });

  it("does not advance or dispatch when the durable save fails", async () => {
    const h = setup();
    h.host.save = vi.fn(async () => {
      throw new Error("disk full");
    });
    await expect(runProductionPipeline(h.saved(), h.host)).rejects.toThrow("disk full");
    expect(h.host.execute).not.toHaveBeenCalled();
  });

  it("serializes owners and discards a late response after project switching", async () => {
    const h = setup();
    let resolve!: (value: { status: "done" }) => void;
    h.host.execute = vi.fn<ProductionHost["execute"]>(
      () =>
        new Promise<ProductionResult>((done) => {
          resolve = done;
        }),
    );
    const pending = runProductionPipeline(h.saved(), h.host);
    await vi.waitFor(() => expect(h.host.execute).toHaveBeenCalledTimes(1));
    expect((await runProductionPipeline(h.saved(), h.host)).code).toBe("PIPELINE_ALREADY_RUNNING");
    const saves = vi.mocked(h.host.save).mock.calls.length;
    h.live.projectId = "other-project";
    resolve({ status: "done" });
    await pending;
    expect(h.host.save).toHaveBeenCalledTimes(saves);
  });

  it("marks cancelled in-flight work uncertain and ignores its late completion", async () => {
    const h = setup();
    const abort = new AbortController();
    let resolve!: (value: { status: "done" }) => void;
    h.host.execute = vi.fn<ProductionHost["execute"]>(
      () =>
        new Promise<ProductionResult>((done) => {
          resolve = done;
        }),
    );
    const pending = runProductionPipeline(h.saved(), h.host, { signal: abort.signal });
    await vi.waitFor(() => expect(h.host.execute).toHaveBeenCalledTimes(1));
    abort.abort();
    const result = await pending;
    expect(result.status).toBe("uncertain");
    const saves = vi.mocked(h.host.save).mock.calls.length;
    resolve({ status: "done" });
    await Promise.resolve();
    expect(h.host.save).toHaveBeenCalledTimes(saves);
    await runProductionPipeline(result, h.host);
    expect(h.host.execute).toHaveBeenCalledTimes(1);
  });

  it("does not silently complete a required stage with no targets on resume", async () => {
    const h = setup();
    h.host.targets = () => [];
    const first = await runProductionPipeline(h.saved(), h.host);
    expect(first.status).toBe("blocked");
    expect((await runProductionPipeline(first, h.host)).status).toBe("blocked");
    expect(h.host.execute).not.toHaveBeenCalled();
  });
});
