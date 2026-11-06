import { webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { sampleFilm, type FilmProject } from "../film/project";
import { createProductionPipeline, type ProductionStepId } from "../film/production-pipeline";
import { prepareFilmSnapshot } from "../film/library";
import { completeMembershipAgent } from "./agent-workflow";
import {
  filmPipelineCheckpoint,
  filmPipelineFingerprint,
  filmPipelineTargets,
} from "./film-pipeline-controller";
import { createPipelineWorkspaceHost, type PipelineWorkspaceHost } from "./pipeline-workspace-host";
vi.mock("../film/library", () => ({
  prepareFilmSnapshot: vi.fn(async (film: FilmProject) => structuredClone(film)),
}));
vi.mock("./agent-workflow", () => ({ completeMembershipAgent: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(completeMembershipAgent)
    .mockReset()
    .mockResolvedValue({ text: null, detail: "", code: "TEXT_REJECTED" });
  vi.mocked(prepareFilmSnapshot).mockClear();
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
  const env = setup(await prime(fixture(), "review"));
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
