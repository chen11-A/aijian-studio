import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { prepareFilmSnapshot } from "../film/library";
import type { FilmProject, FilmShot } from "../film/project";
import { productionTargetKey, type ProductionRunOptions } from "../film/production-pipeline";
import { completeMembershipAgent } from "./agent-workflow";
import { createFilmPipelineController, type FilmPipelineHost } from "./film-pipeline-controller";
import {
  assemblePipelineFilm,
  makePipelinePortraits,
  makePipelineStill,
} from "./pipeline-media-actions";

export type PipelineSaveLease = {
  save: FilmPipelineHost["save"];
  release: () => Promise<void>;
};
export type PipelineVideoHost = {
  current: () => boolean;
  apply: (film: FilmProject) => Promise<void>;
  versions: 1;
  billingProjectId: string;
  signal: AbortSignal;
};
export type PipelineWorkspaceHost = {
  current: FilmPipelineHost["current"];
  apply: FilmPipelineHost["apply"];
  /** May update backendProjectId; completes before acquiring/capturing pipeline inputs. */
  ensureBillingProject: () => Promise<string>;
  /** Block new autosaves and drain already issued writes before resolving the lease. */
  acquireSaveOwnership: (projectId: string) => Promise<PipelineSaveLease>;
  bridge: () => GrokLoginBridge | null;
  modelIds: () => string[];
  modelsChanged: (ids: string[]) => void;
  submitGeneration: (shots: FilmShot[], host: PipelineVideoHost) => Promise<void>;
  cancelGeneration?: () => void;
  notify?: FilmPipelineHost["notify"];
  labels?: FilmPipelineHost["labels"];
  verifyMedia?: FilmPipelineHost["verifyMedia"];
};
const stop = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

/** A workspace lifecycle adapter; chat selection/activeTurn is deliberately not an input. */
export function createPipelineWorkspaceHost(host: PipelineWorkspaceHost) {
  let active: { projectId: string; abort: AbortController } | undefined;
  const cancel = () => {
    if (!active) return;
    active.abort.abort();
    host.cancelGeneration?.();
  };
  async function execute(options: ProductionRunOptions = {}, recover = false) {
    if (active) return stop("PIPELINE_ALREADY_RUNNING");
    const projectId = host.current()?.id;
    if (!projectId) return stop("PROJECT_REQUIRED");
    const session = { projectId, abort: new AbortController() };
    active = session;
    let lease: PipelineSaveLease | undefined;
    const current = () =>
      active === session && !session.abort.signal.aborted && host.current()?.id === projectId;
    try {
      // Billing is allowed to update the film here, never from an executing text/video step.
      const billingProjectId = recover ? "" : await host.ensureBillingProject();
      if (!current()) return stop("PIPELINE_REQUEST_STALE");
      if (!recover && !billingProjectId) return stop("BILLING_PROJECT_REQUIRED");
      lease = await host.acquireSaveOwnership(projectId);
      if (!current()) return stop("PIPELINE_REQUEST_STALE");
      const controller = createFilmPipelineController({
        current: host.current,
        apply: host.apply,
        save: lease.save,
        prepareSnapshot: prepareFilmSnapshot,
        notify: host.notify,
        labels: host.labels,
        verifyMedia: host.verifyMedia,
        generatePortraits: makePipelinePortraits,
        generateStill: makePipelineStill,
        assemble: assemblePipelineFilm,
        // No vision capability is claimed: the controller requires explicit human review.
        request: async (agent, context, instruction, control) => {
          const bridge = host.bridge();
          if (!bridge)
            return { text: null, detail: "需要桌面会员登录。", code: "GROK_MEMBERSHIP_REQUIRED" };
          const requestFilm = host.current();
          const abort = new AbortController();
          const abortRequest = () => abort.abort();
          session.abort.signal.addEventListener("abort", abortRequest, { once: true });
          control?.signal.addEventListener("abort", abortRequest, { once: true });
          if (session.abort.signal.aborted || control?.signal.aborted) abort.abort();
          try {
            return await completeMembershipAgent(agent, context, instruction, {
              bridge,
              modelIds: host.modelIds(),
              modelsChanged: host.modelsChanged,
              billingProject: async () => billingProjectId,
              current: () => current() && host.current() === requestFilm,
              control: {
                signal: abort.signal,
                deadlineAt: control?.deadlineAt ?? Date.now() + 300_000,
              },
            });
          } finally {
            session.abort.signal.removeEventListener("abort", abortRequest);
            control?.signal.removeEventListener("abort", abortRequest);
          }
        },
        video: async (film, targetId, ctx) => {
          const shot = film.shots.find((item) => item.id === targetId);
          if (!shot) return { status: "blocked", code: "SHOT_NOT_FOUND" };
          if (!current() || !ctx.isCurrent())
            return { status: "uncertain", code: "PIPELINE_REQUEST_STALE" };
          await host.submitGeneration([shot], {
            current: () => current() && ctx.isCurrent(),
            apply: ctx.commitPartial,
            versions: 1,
            billingProjectId,
            signal: ctx.signal,
          });
          if (!current() || !ctx.isCurrent())
            return { status: "uncertain", code: "PIPELINE_REQUEST_STALE" };
          // A resolved submission is not evidence of a completed video. The controller verifies
          // an actual done take and saved path in this returned film before advancing.
          return { status: "done", film: ctx.current() };
        },
      });
      return recover
        ? await controller.recover()
        : await controller.run({ ...options, signal: session.abort.signal });
    } finally {
      try {
        await lease?.release();
      } finally {
        if (active === session) active = undefined;
      }
    }
  }
  return {
    start: () => execute(),
    recover: () => execute({}, true),
    retry: (keys: string[]) => execute({ retryTargets: [...keys] }),
    acceptReview: (reason: string) => {
      if (!reason.trim())
        return Promise.reject(
          Object.assign(new Error("REVIEW_REASON_REQUIRED"), { code: "REVIEW_REASON_REQUIRED" }),
        );
      return execute({
        acceptInputs: [{ key: productionTargetKey("review", "all"), reason: reason.trim() }],
      });
    },
    continue: () => execute({ continue: true }),
    cancel,
    /** Call on project identity changes and cancel() on workspace unmount. */
    projectChanged: () => {
      if (active && host.current()?.id !== active.projectId) cancel();
    },
  };
}
