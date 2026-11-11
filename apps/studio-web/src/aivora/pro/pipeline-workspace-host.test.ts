import * as pipelineController from "./film-pipeline-controller";
import { historyRecordHash } from "./actions/persistent-history";
import type { FilmGenerationExecutionGateway } from "@aijian/contracts/film-generation-execution";
import { applyVideoResponse } from "./actions/generation-run";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { sampleFilm, type FilmProject, type FilmTake } from "../film/project";
import { createProductionPipeline, type ProductionStepId } from "../film/production-pipeline";
import { prepareFilmSnapshot } from "../film/library";
import { completeMembershipAgent } from "./agent-workflow";
import {
  filmPipelineCheckpoint,
  filmPipelineFingerprint,
  filmPipelineTargets,
} from "./film-pipeline-controller";
import { createPipelineWorkspaceHost, type PipelineWorkspaceHost } from "./pipeline-workspace-host";
import { firstLookBlock } from "./look-lock";
import { saveStillReview, stillAccepted, stillChecklist } from "./still-acceptance";
vi.mock("../film/library", () => ({
  prepareFilmSnapshot: vi.fn(async (film: FilmProject) => structuredClone(film)),
}));
vi.mock("./agent-workflow", () => ({ completeMembershipAgent: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(completeMembershipAgent)
    .mockReset()
    .mockResolvedValue({ text: null, detail: "", code: "TEXT_REJECTED" });
  vi.mocked(prepareFilmSnapshot)
    .mockReset()
    .mockImplementation(async (film: FilmProject) => structuredClone(film));
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const film = sampleFilm();
  film.id = `film_${crypto.randomUUID().replaceAll("-", "")}`;
  film.backendProjectId = "billing-before";
  film.characters = [];
  film.scenes = [{ ...film.scenes[0]!, text: "雨落。", title: "书店", tags: [] }];
  film.shots = [
    {
      ...film.shots[0]!,
      sceneId: film.scenes[0]!.id,
      picture: "雨落。",
      action: "雨落。",
      characters: [],
      line: "",
      lines: [],
      speaker: "",
      poster: "/media/start.png",
      takes: [],
      selectedTakeId: "",
    },
  ];
  film.unassignedBeats = [];
  return film;
}
async function prime(film: FilmProject, start: ProductionStepId) {
  const hash = await filmPipelineFingerprint(film);
  const state = createProductionPipeline(film.id, hash);
  for (const step of state.steps) {
    if (step.id === start) break;
    step.targets = filmPipelineTargets(film, step.id).map((id) => ({
      id,
      status: "done",
      attempt: 1,
    }));
    Object.assign(step, {
      planned: true,
      status: "done",
      done: step.targets.length,
      total: step.targets.length,
    });
  }
  if (start === "video") {
    state.status = "checkpoint";
    state.checkpoint = filmPipelineCheckpoint(film);
  }
  return { ...film, productionPipeline: state, productionInputFingerprint: hash };
}
function setup(initial = fixture()) {
  let live = initial;
  const disk: FilmProject[] = [];
  const release = vi.fn(async () => undefined);
  const events: string[] = [];
  const host: PipelineWorkspaceHost = {
    current: () => live,
    apply: (film) => {
      live = film;
    },
    ensureBillingProject: vi.fn(async () => {
      events.push("billing");
      return live.backendProjectId;
    }),
    acquireSaveOwnership: vi.fn<PipelineWorkspaceHost["acquireSaveOwnership"]>(async () => {
      events.push("lease");
      return {
        save: async (film, guard) => {
          expect(guard()).toBe(true);
          events.push("save");
          disk.push(structuredClone(film));
        },
        release,
      };
    }),
    bridge: () => ({}) as GrokLoginBridge,
    modelIds: () => ["grok-3"],
    modelsChanged: vi.fn(),
    submitGeneration: vi.fn<PipelineWorkspaceHost["submitGeneration"]>(async () => undefined),
    cancelGeneration: vi.fn(),
  };
  window.aijian = {
    readFilmProject: vi.fn(async () => structuredClone(disk.at(-1) ?? initial)),
    prepareFilmGenerationExecution: vi.fn<
      FilmGenerationExecutionGateway["prepareFilmGenerationExecution"]
    >(async (input) => {
      const raw = disk.at(-1) ?? initial;
      if (input.expectedProjectHash !== (await historyRecordHash(raw)))
        return { kind: "FAILED", code: "PROJECT_CHANGED" };
      expect(input.targets).toEqual(
        filmPipelineTargets(raw, "video").map((shotId) => ({ shotId, versions: 1 })),
      );
      return {
        kind: "PREPARED",
        executionId: "pipeline-execution",
        projectId: input.projectId,
        projectHash: input.expectedProjectHash,
        stages: [],
        targets: input.targets.map((t) => ({
          shotId: t.shotId,
          videoSlotIds: [`video-${t.shotId}`],
          slotPreparations: [`video-${t.shotId}`].map((videoSlotId) => ({
            videoSlotId,
            preparation: "CLIENT_IMAGES" as const,
          })),
          preparation: "CLIENT_IMAGES" as const,
        })),
      };
    }),
    retireFilmGenerationExecution: vi.fn(async () => ({ kind: "RETIRED" })),
  } as unknown as Window["aijian"];
  const adapter = createPipelineWorkspaceHost(host);
  return {
    host,
    adapter,
    disk,
    release,
    events,
    live: () => live,
    edit: (film: FilmProject) => {
      live = film;
    },
  };
}

it("finishes billing and drains prior writes before capturing pipeline input; requests are independent of chat", async () => {
  const env = setup();
  env.host.ensureBillingProject = async () => {
    env.events.push("billing");
    env.edit({ ...env.live(), backendProjectId: "billing-prepared" });
    return "billing-prepared";
  };
  vi.mocked(completeMembershipAgent).mockImplementation(
    async (_agent, _context, _instruction, host) => {
      expect(await host.billingProject()).toBe("billing-prepared");
      expect(host.current()).toBe(true);
      expect(host.captureFilm?.()).toBe(env.live());
      expect(host.control?.signal.aborted).toBe(false);
      return { text: null, detail: "", code: "TEXT_REJECTED" };
    },
  );
  await env.adapter.start();
  expect(env.events.slice(0, 2)).toEqual(["billing", "lease"]);
  expect(env.disk[0]?.backendProjectId).toBe("billing-prepared");
  expect(env.disk[0]?.productionInputFingerprint).toBe(await filmPipelineFingerprint(env.disk[0]!));
  expect(completeMembershipAgent).toHaveBeenCalledOnce();
  expect(prepareFilmSnapshot).toHaveBeenCalled();
  expect(env.release).toHaveBeenCalledOnce();
});

it("cancels a pending independent membership request and releases save ownership", async () => {
  const env = setup();
  const started = deferred<AbortSignal>();
  vi.mocked(completeMembershipAgent).mockImplementation(async (_a, _b, _c, host) => {
    const signal = host.control!.signal;
    started.resolve(signal);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { text: null, detail: "", code: "TEXT_CANCELLED" };
  });
  const pending = env.adapter.start();
  const signal = await started.promise;
  env.adapter.cancel();
  await pending;
  expect(signal.aborted).toBe(true);
  expect(env.release).toHaveBeenCalledOnce();
  expect(env.host.cancelGeneration).toHaveBeenCalledOnce();
});

it("cancels project switching during preflight without acquiring or writing the new project", async () => {
  const env = setup();
  const billing = deferred<string>();
  env.host.ensureBillingProject = () => billing.promise;
  const pending = env.adapter.start();
  env.edit(fixture());
  env.adapter.projectChanged();
  billing.resolve("old-billing");
  await expect(pending).rejects.toMatchObject({ code: "PIPELINE_REQUEST_STALE" });
  expect(env.host.acquireSaveOwnership).not.toHaveBeenCalled();
  expect(env.disk).toHaveLength(0);
});

it("recovers running work as uncertain without billing or dispatch", async () => {
  const film = await prime(fixture(), "writer");
  const writer = film.productionPipeline.steps[0]!;
  Object.assign(writer, {
    planned: true,
    status: "running",
    total: 2,
    targets: [
      { id: "script", status: "running", attempt: 1 },
      { id: "cast", status: "queued", attempt: 0 },
    ],
  });
  film.productionPipeline.status = "running";
  film.productionPipeline.current = "writer";
  const env = setup(film);
  expect((await env.adapter.recover()).status).toBe("uncertain");
  expect(env.host.ensureBillingProject).not.toHaveBeenCalled();
  expect(completeMembershipAgent).not.toHaveBeenCalled();
  expect(env.host.submitGeneration).not.toHaveBeenCalled();
  expect(env.host.acquireSaveOwnership).toHaveBeenCalledOnce();
  expect(env.release).toHaveBeenCalledOnce();
});

it("keeps human review and video continuation separate and rejects a resolved submission without a take", async () => {
  const base = fixture();
  const shot = base.shots[0]!;
  const verdicts = Object.fromEntries(
    stillChecklist(base, shot).map((item) => [item.id, "match" as const]),
  );
  const env = setup(
    await prime(
      saveStillReview(base, shot.id, verdicts, "2026-11-10T00:00:00.000Z").film,
      "review",
    ),
  );
  expect((await env.adapter.start()).status).toBe("needs-input");
  await expect(env.adapter.acceptReview(" ")).rejects.toMatchObject({
    code: "REVIEW_REASON_REQUIRED",
  });
  expect((await env.adapter.acceptReview("已逐镜检查构图和人物")).status).toBe("checkpoint");
  expect(env.host.submitGeneration).not.toHaveBeenCalled();
  const result = await env.adapter.continue();
  expect(env.host.submitGeneration).toHaveBeenCalledOnce();
  expect(result.status).toBe("failed");
  expect(result.steps.find((step) => step.id === "video")?.targets[0]?.code).toBe(
    "MEDIA_RESULT_MISSING",
  );
  const [, generation] = vi.mocked(env.host.submitGeneration).mock.calls[0]!;
  expect(generation.versions).toBe(1);
  expect(generation.billingProjectId).toBe("billing-before");
});

it("blocks one-click video before any provider call when an on-screen look is not locked", async () => {
  const film = fixture();
  film.characters = [
    {
      id: "girl",
      name: "女孩",
      identity: "短发",
      voiceId: "",
      source: "user",
      userFields: [],
      portraits: [],
      lookLocked: false,
    },
  ];
  film.shots[0] = {
    ...film.shots[0]!,
    characters: ["女孩"],
  };
  const verdicts = Object.fromEntries(
    stillChecklist(film, film.shots[0]!).map((item) => [item.id, "match" as const]),
  );
  const adopted = saveStillReview(film, film.shots[0]!.id, verdicts, "2026-11-11T00:00:00.000Z").film;
  expect(firstLookBlock(adopted, adopted.shots)?.code).toBe("LOOK_NOT_LOCKED");
  const provider = vi.fn();
  const env = setup(await prime(adopted, "review"));
  expect((await env.adapter.start()).status).toBe("needs-input");
  expect((await env.adapter.acceptReview("已逐镜检查构图和人物")).status).toBe("checkpoint");
  vi.mocked(env.host.submitGeneration).mockImplementation(async (shots) => {
    const blocked = firstLookBlock(env.live(), shots);
    if (!blocked) {
      provider();
      return;
    }
    return blocked.code;
  });
  const result = await env.adapter.continue();
  expect(provider).not.toHaveBeenCalled();
  expect(result.status).toBe("blocked");
  expect(result.steps.find((step) => step.id === "video")?.targets[0]?.code).toBe(
    "LOOK_NOT_LOCKED",
  );
  expect(JSON.stringify(result)).toContain("还没有锁定定妆");
});

it("blocks one-click video before any provider call when the still is not adopted", async () => {
  const provider = vi.fn();
  const env = setup(await prime(fixture(), "review"));
  expect((await env.adapter.start()).status).toBe("needs-input");
  expect((await env.adapter.acceptReview("已逐镜检查构图和人物")).status).toBe("checkpoint");
  vi.mocked(env.host.submitGeneration).mockImplementation(async (shots) => {
    const live = env.live();
    const shot = live.shots.find((item) => item.id === shots[0]!.id);
    if (shot && stillAccepted(live, shot)) provider();
    return "STILL_NOT_ACCEPTED";
  });
  const result = await env.adapter.continue();
  expect(provider).not.toHaveBeenCalled();
  expect(result.status).toBe("blocked");
  expect(JSON.stringify(result)).toContain(`镜头 ${env.live().shots[0]!.no} 的画面还没核对`);
});

it("blocks an explicit still refusal when an older finished version is still on the shot", async () => {
  const film = fixture();
  const shot = film.shots[0]!;
  shot.stills = [];
  shot.selectedTakeId = "queued-next";
  shot.takes = [
    {
      id: "old-finished",
      shotId: shot.id,
      index: 1,
      status: "done",
      stillUrl: shot.poster,
      videoPath: "/tmp/old-finished.mp4",
      videoUrl: "",
      prompt: "旧版",
      createdAt: "",
      reason: "",
    },
    {
      id: "queued-next",
      shotId: shot.id,
      index: 2,
      status: "queued",
      stillUrl: "",
      videoPath: "",
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  const provider = vi.fn();
  const env = setup(await prime(film, "review"));
  expect((await env.adapter.start()).status).toBe("needs-input");
  expect((await env.adapter.acceptReview("已逐镜检查构图和人物")).status).toBe("checkpoint");
  vi.mocked(env.host.submitGeneration).mockImplementation(async () => "STILL_NOT_ACCEPTED");
  const result = await env.adapter.continue();
  expect(provider).not.toHaveBeenCalled();
  expect(env.host.submitGeneration).toHaveBeenCalledOnce();
  expect(result.status).toBe("blocked");
  expect(result.steps.find((step) => step.id === "video")?.targets[0]?.code).toBe(
    "STILL_NOT_ACCEPTED",
  );
  expect(JSON.stringify(result)).toContain(`镜头 ${shot.no} 的画面还没核对`);
});

it("releases a drained lease after cancellation and never dispatches from a stale capture", async () => {
  const env = setup();
  const acquired = deferred<void>();
  const drained = deferred<void>();
  const original = env.host.acquireSaveOwnership;
  env.host.acquireSaveOwnership = async (id) => {
    acquired.resolve();
    await drained.promise;
    return original(id);
  };
  const pending = env.adapter.start();
  await acquired.promise;
  env.adapter.cancel();
  drained.resolve();
  await expect(pending).rejects.toMatchObject({ code: "PIPELINE_REQUEST_STALE" });
  expect(env.release).toHaveBeenCalledOnce();
  expect(completeMembershipAgent).not.toHaveBeenCalled();
  expect(env.disk).toHaveLength(0);
});

it("does not replay failed text work until an exact target retry is requested", async () => {
  const env = setup();
  expect((await env.adapter.start()).status).toBe("failed");
  expect(completeMembershipAgent).toHaveBeenCalledOnce();
  await env.adapter.start();
  expect(completeMembershipAgent).toHaveBeenCalledOnce();
  await env.adapter.retry(["writer/script"]);
  expect(completeMembershipAgent).toHaveBeenCalledTimes(2);
  expect(env.host.submitGeneration).not.toHaveBeenCalled();
});

it("completes its actual beforeRun history barrier under the save lease before any member or media step", async () => {
  const f = setup(),
    wait = deferred<void>();
  const before = vi.fn<NonNullable<PipelineWorkspaceHost["beforeRun"]>>(async (lease) => {
    f.events.push("history-start");
    await lease.save(f.live()!, () => true);
    await wait.promise;
    f.events.push("history-saved");
  });
  f.host.beforeRun = before;
  const running = f.adapter.start();
  await vi.waitFor(() => expect(before).toHaveBeenCalledOnce());
  expect(completeMembershipAgent).not.toHaveBeenCalled();
  expect(f.host.submitGeneration).not.toHaveBeenCalled();
  expect(f.events.indexOf("lease")).toBeLessThan(f.events.indexOf("history-start"));
  wait.resolve();
  await running;
  expect(f.events).toContain("history-saved");
  expect(f.release).toHaveBeenCalledOnce();
});
it("blocks the entire pipeline before provider dispatch if its persisted history barrier fails", async () => {
  const f = setup();
  f.host.beforeRun = async () => {
    throw Object.assign(new Error("HISTORY_BACKUP_FAILED"), { code: "HISTORY_BACKUP_FAILED" });
  };
  await expect(f.adapter.start()).rejects.toThrow("HISTORY_BACKUP_FAILED");
  expect(completeMembershipAgent).not.toHaveBeenCalled();
  expect(f.host.submitGeneration).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledOnce();
});
it("does not run a pre-dispatch snapshot or save an old running baseline during read-only restart recovery", async () => {
  const film = await prime(fixture(), "writer");
  film.productionPipeline!.status = "running";
  film.productionPipeline!.current = "writer";
  const f = setup(film);
  f.host.beforeRun = vi.fn(async () => {
    throw new Error("must not capture old running state");
  });
  await f.adapter.recover();
  expect(f.host.beforeRun).not.toHaveBeenCalled();
  expect(completeMembershipAgent).not.toHaveBeenCalled();
  expect(f.host.submitGeneration).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledOnce();
});

async function trialBatch() {
  const initial = fixture();
  initial.narrationVoiceId = "eve";
  initial.shots[0] = {
    ...initial.shots[0]!,
    line: "雨落。",
    lines: [{ speaker: "", text: "雨落。" }],
  };
  vi.mocked(prepareFilmSnapshot).mockImplementation(async (film) => ({
    ...structuredClone(film),
    shots: film.shots.map((shot) => ({
      ...structuredClone(shot),
      poster: shot.poster.startsWith("data:") ? `/media/materialized-${shot.id}.png` : shot.poster,
      takes: shot.takes.map((take) => ({
        ...take,
        stillUrl: take.stillUrl.startsWith("data:")
          ? `/media/materialized-${shot.id}.png`
          : take.stillUrl,
      })),
    })),
  }));
  initial.shots.push({ ...structuredClone(initial.shots[0]!), id: "independent-next", no: 2 });
  const env = setup(await prime(initial, "video"));
  env.host.checkTrialDecision = vi.fn(async () => undefined);
  vi.mocked(env.host.submitGeneration).mockImplementation(async ([shot], control) => {
    const current = env.live();
    const take: FilmTake = {
      id: `trial-result-${shot!.id}`,
      shotId: shot!.id,
      index: 1,
      status: "running",
      videoPath: "",
      videoUrl: "",
      stillUrl: "",
      prompt: "fixed",
      reason: "",
      createdAt: "",
    };
    const prepared = {
      ...current,
      shots: current.shots.map((row) =>
        row.id === shot!.id ? { ...row, takes: [...row.takes, take] } : row,
      ),
    };
    await control.apply(prepared);
    const completed = applyVideoResponse(env.live(), shot!, take, {
      status: "SUCCEEDED",
      output_path: `/media/${shot!.id}.mp4`,
      preview_image: "data:image/png;base64,AA==",
      voice_path: `/media/${shot!.id}.wav`,
      duration_seconds: 5,
    });
    await control.apply(completed.film);
  });
  return env;
}
it("checks the explicit accepted-trial path before dispatch and each actual video while keeping the original one-version billing scope", async () => {
  const env = await trialBatch(),
    decision = `rtd_${"a".repeat(32)}`;
  await env.adapter.continueAfterTrial(decision);
  expect(env.host.checkTrialDecision).toHaveBeenCalledTimes(3);
  expect(vi.mocked(env.host.checkTrialDecision!).mock.calls.map((call) => call[2])).toEqual([
    undefined,
    env.live().shots[0]!.id,
    "independent-next",
  ]);
  expect(env.host.submitGeneration).toHaveBeenCalledTimes(2);
  expect(vi.mocked(env.host.submitGeneration).mock.calls.map((call) => call[1].versions)).toEqual([
    1, 1,
  ]);
  expect(
    vi.mocked(env.host.submitGeneration).mock.calls.map((call) => call[1].billingProjectId),
  ).toEqual(["billing-before", "billing-before"]);
  expect(env.release).toHaveBeenCalledOnce();
});
it("stops the next actual request when the user edits the just-completed prior target while its check is pending", async () => {
  const env = await trialBatch(),
    entered = deferred<void>(),
    release = deferred<void>();
  env.host.checkTrialDecision = vi.fn(async (_id, _lease, target) => {
    if (target === "independent-next") {
      entered.resolve();
      await release.promise;
    }
  });
  const pending = env.adapter.continueAfterTrial(`rtd_${"b".repeat(32)}`);
  try {
    await Promise.race([
      entered.promise,
      pending.then(() => {
        throw Error("pipeline settled before second target admission");
      }),
    ]);
    expect(env.host.submitGeneration).toHaveBeenCalledOnce();
    const live = env.live();
    env.edit({
      ...live,
      shots: live.shots.map((shot, i) => (i ? shot : { ...shot, picture: "用户回改刚完成镜头" })),
    });
  } finally {
    release.resolve();
  }
  await pending;
  expect(env.host.submitGeneration).toHaveBeenCalledOnce();
  expect(env.live().shots[0]!.picture).toBe("用户回改刚完成镜头");
  expect(env.live().shots[0]!.takes.some((take) => take.status === "done" && take.videoPath)).toBe(
    true,
  );
  expect(env.release).toHaveBeenCalledOnce();
});
it("does not replace the existing manual continuation or treat metadata recording as a new creative request", async () => {
  const env = setup(await prime(fixture(), "video"));
  env.host.checkTrialDecision = vi.fn(async () => {
    throw Error("must not run on manual continue");
  });
  const before = await filmPipelineFingerprint(env.live());
  const withDecision = {
    ...env.live(),
    riskTrialDecisions: [
      {
        schemaVersion: 1 as const,
        id: `rtd_${"c".repeat(32)}`,
        projectId: env.live().id,
        shotId: env.live().shots[0]!.id,
        takeId: "old",
        inputFingerprint: "d".repeat(64),
        decision: "accepted" as const,
        note: "人工决定",
        recordedAt: "2026-11-07T00:00:00.000Z",
      },
    ],
  };
  expect(await filmPipelineFingerprint(withDecision)).toBe(before);
  env.edit(withDecision);
  await env.adapter.continue();
  expect(env.host.checkTrialDecision).not.toHaveBeenCalled();
  expect(env.host.submitGeneration).toHaveBeenCalledOnce();
});

it("retains only the explicit failed-target retry across the separate first-media confirmation", async () => {
  const film = fixture();
  film.shots.push({ ...structuredClone(film.shots[0]!), id: "other-shot" });
  const initial = await prime(film, "stills");
  const step = initial.productionPipeline!.steps.find((s) => s.id === "stills")!;
  Object.assign(step, {
    planned: true,
    status: "failed",
    done: 0,
    total: 2,
    targets: film.shots.map((s) => ({
      id: s.id,
      status: "failed",
      attempt: 1,
      code: "STILL_FAILED",
    })),
  });
  initial.productionPipeline!.status = "failed";
  initial.productionPipeline!.current = "stills";
  const f = setup(initial);
  const checkpoint = await f.adapter.retry([`stills/${film.shots[0]!.id}`]);
  expect(checkpoint).toMatchObject({ status: "checkpoint", current: "stills", continued: false });
  expect(checkpoint.checkpoint!.estimatedRequests).toBe(2);
  expect(checkpoint.steps.find((s) => s.id === "stills")!.targets.map((t) => t.attempt)).toEqual([
    1, 1,
  ]);
  const completed = await f.adapter.continue();
  const actual = completed.steps.find((s) => s.id === "stills")!.targets;
  expect(actual[0]).toMatchObject({ status: "done", attempt: 2 });
  expect(actual[1]).toMatchObject({ status: "failed", attempt: 1 });
  expect(f.host.submitGeneration).not.toHaveBeenCalled();
  const again = await f.adapter.continue();
  expect(again.steps.find((s) => s.id === "stills")!.targets).toEqual(actual);
});

it("preserves an unchanged legacy pipeline when this preflight first binds its billing project", async () => {
  const initial = fixture();
  initial.backendProjectId = "";
  const legacy = await prime(initial, "review");
  const steps = structuredClone(legacy.productionPipeline.steps);
  const env = setup(legacy);
  env.host.ensureBillingProject = async () => {
    env.edit({ ...env.live(), backendProjectId: "billing-created-now" });
    return "billing-created-now";
  };
  const result = await env.adapter.start();
  expect(result.code).not.toBe("PIPELINE_INPUT_CHANGED");
  expect(result.status).toBe("needs-input");
  expect(env.live().backendProjectId).toBe("billing-created-now");
  expect(env.live().productionPipeline?.steps.filter((s) => s.id !== "review")).toEqual(
    steps.filter((s) => s.id !== "review"),
  );
  expect(env.live().productionInputFingerprint).toBe(await filmPipelineFingerprint(env.live()));
  expect(completeMembershipAgent).not.toHaveBeenCalled();
  expect(env.host.submitGeneration).not.toHaveBeenCalled();
  expect(window.aijian?.prepareFilmGenerationExecution).not.toHaveBeenCalled();
});

it.each(["stale-input", "creative", "progress", "existing-id"] as const)(
  "does not bootstrap a legacy billing binding over %s changes",
  async (change) => {
    const initial = fixture();
    initial.backendProjectId = change === "existing-id" ? "already-bound" : "";
    const legacy = await prime(initial, "review");
    if (change === "stale-input") legacy.title += " old unaccepted edit";
    const fingerprint = legacy.productionInputFingerprint;
    const env = setup(legacy);
    env.host.ensureBillingProject = async () => {
      const live = structuredClone(env.live());
      live.backendProjectId = "billing-created-now";
      if (change === "creative") live.shots[0]!.picture += " changed during billing";
      if (change === "progress") live.productionPipeline!.steps[0]!.targets[0]!.attempt = 7;
      env.edit(live);
      return "billing-created-now";
    };
    const result = await env.adapter.start();
    expect(result.code).toBe("PIPELINE_INPUT_CHANGED");
    expect(env.live().productionInputFingerprint).toBe(fingerprint);
    expect(env.disk).toHaveLength(0);
    expect(completeMembershipAgent).not.toHaveBeenCalled();
    expect(env.host.submitGeneration).not.toHaveBeenCalled();
    expect(window.aijian?.prepareFilmGenerationExecution).not.toHaveBeenCalled();
  },
);

it("does not migrate a user edit arriving while the legacy digest is being checked", async () => {
  const initial = fixture();
  initial.backendProjectId = "";
  const legacy = await prime(initial, "review");
  const env = setup(legacy);
  env.host.ensureBillingProject = async () => {
    env.edit({ ...env.live(), backendProjectId: "billing-created-now" });
    return "billing-created-now";
  };
  const entered = deferred<void>(),
    release = deferred<void>();
  const original = pipelineController.filmPipelineFingerprint;
  const digest = vi
    .spyOn(pipelineController, "filmPipelineFingerprint")
    .mockImplementationOnce(async (film) => {
      const result = await original(film);
      entered.resolve();
      await release.promise;
      return result;
    });
  try {
    const running = env.adapter.start();
    await entered.promise;
    env.edit({ ...env.live(), title: "new user title during digest" });
    release.resolve();
    const result = await running;
    expect(result.code).toBe("PIPELINE_INPUT_CHANGED");
    expect(env.live().title).toBe("new user title during digest");
    expect(env.live().productionInputFingerprint).toBe(legacy.productionInputFingerprint);
    expect(env.disk).toHaveLength(0);
    expect(completeMembershipAgent).not.toHaveBeenCalled();
    expect(env.host.submitGeneration).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    digest.mockRestore();
  }
});
