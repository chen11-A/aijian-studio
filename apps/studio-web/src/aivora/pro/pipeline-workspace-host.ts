import { ProtectedGenerationFailure } from "../film/generation-execution-failure";
import { applyContinuityChecks } from "../film/continuity-rules";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { prepareFilmSnapshot } from "../film/library";
import type { FilmProject, FilmShot } from "../film/project";
import {
  isProductionPipeline,
  productionTargetKey,
  type ProductionRunOptions,
} from "../film/production-pipeline";
import { completeMembershipAgent } from "./agent-workflow";
import {
  createFilmPipelineController,
  filmPipelineTargets,
  filmPipelineFingerprint,
  type FilmPipelineHost,
} from "./film-pipeline-controller";
import {
  assemblePipelineFilm,
  makePipelinePortraits,
  makePipelineStill,
} from "./pipeline-media-actions";
import { stillAccepted } from "./still-acceptance";

import {
  generationExecutionNotice,
  createGenerationExecutionSession,
  prepareCurrentGenerationExecution,
  type GenerationExecutionSession,
} from "./actions/generation-execution";

class PipelineExecutionPreparationError extends Error {
  readonly code: string;
  constructor(
    readonly notice: ReturnType<typeof generationExecutionNotice>,
    cause: unknown,
  ) {
    super(notice.code, { cause });
    this.code = notice.code;
  }
}

export type PipelineSaveLease = {
  save: FilmPipelineHost["save"];
  release: () => Promise<void>;
};
export type PipelineVideoHost = {
  execution: GenerationExecutionSession;
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
  beforeRun?: (lease: PipelineSaveLease) => Promise<void>;
  /** Explicit human-trial path only; not provider, quantity or membership authorization. */
  checkTrialDecision?: (
    decisionId: string,
    lease: PipelineSaveLease,
    targetShotId?: string,
  ) => Promise<void>;
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
  type ActiveExecution = {
    projectId: string;
    abort: AbortController;
    execution?: GenerationExecutionSession;
  };
  let active: ActiveExecution | undefined;
  let mediaIntent:
    | {
        projectId: string;
        fingerprint: string | undefined;
        checkpoint: string;
        options: Pick<ProductionRunOptions, "retryTargets" | "acceptInputs">;
      }
    | undefined;
  function continueOptions(): ProductionRunOptions {
    const pending = mediaIntent;
    mediaIntent = undefined;
    const live = host.current();
    if (
      pending &&
      live?.id === pending.projectId &&
      live.productionInputFingerprint === pending.fingerprint &&
      live.productionPipeline?.status === "checkpoint" &&
      ["portraits", "stills"].includes(live.productionPipeline.current ?? "") &&
      JSON.stringify(live.productionPipeline.checkpoint) === pending.checkpoint
    )
      return { ...pending.options, continue: true };
    return { continue: true };
  }

  const cancel = () => {
    mediaIntent = undefined;
    if (!active) return;
    active.execution?.retire();
    active.abort.abort();
    host.cancelGeneration?.();
  };
  async function execute(
    options: ProductionRunOptions = {},
    recover = false,
    trialDecisionId?: string,
  ) {
    if (active) return stop("PIPELINE_ALREADY_RUNNING");
    const initialBinding = structuredClone(host.current());
    const projectId = initialBinding?.id;
    if (!projectId) return stop("PROJECT_REQUIRED");
    const session: ActiveExecution = { projectId, abort: new AbortController() };
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
      if (!recover) await host.beforeRun?.(lease);
      // A legacy plan may predate its first billing-project binding. Only this
      // invocation's exact ID-only transition may migrate its stored digest.
      // Keep all durable step facts and their original inputVersion intact.
      if (
        !recover &&
        initialBinding &&
        !initialBinding.backendProjectId &&
        isProductionPipeline(initialBinding.productionPipeline) &&
        initialBinding.productionPipeline.projectId === projectId &&
        initialBinding.productionInputFingerprint
      ) {
        const bound = host.current();
        const unchanged = () =>
          current() &&
          host.current() === bound &&
          bound?.backendProjectId === billingProjectId &&
          JSON.stringify({ ...bound, backendProjectId: initialBinding.backendProjectId }) ===
            JSON.stringify(initialBinding);
        if (unchanged()) {
          const originalHash = await filmPipelineFingerprint(initialBinding);
          if (unchanged() && originalHash === initialBinding.productionInputFingerprint) {
            const boundHash = await filmPipelineFingerprint(bound!);
            if (!unchanged()) return stop("PIPELINE_INPUT_CHANGED");
            const migrated = { ...bound!, productionInputFingerprint: boundHash };
            await lease.save(migrated, unchanged);
            if (!unchanged()) return stop("PIPELINE_INPUT_CHANGED");
            host.apply(migrated);
            if (!current() || JSON.stringify(host.current()) !== JSON.stringify(migrated))
              return stop("PIPELINE_INPUT_CHANGED");
          }
        }
      }
      if (trialDecisionId) {
        if (
          !host.checkTrialDecision ||
          host.current()?.productionPipeline?.status !== "checkpoint" ||
          ["portraits", "stills"].includes(host.current()?.productionPipeline?.current ?? "")
        )
          return stop("PIPELINE_REQUEST_STALE");
        await host.checkTrialDecision(trialDecisionId, lease);
      }
      if (!current()) return stop("PIPELINE_REQUEST_STALE");
      let preparation: Promise<void> | undefined;
      const execution = createGenerationExecutionSession(window.aijian ?? {}, current);
      session.execution = execution;
      const ensureExecution = async () => {
        if (!preparation) {
          const base = host.current();
          if (!base || !current()) return stop("PIPELINE_REQUEST_STALE");
          preparation = prepareCurrentGenerationExecution(
            execution,
            base,
            {
              mode: "pipeline",
              targets: filmPipelineTargets(base, "video").map((shotId) => ({
                shotId,
                versions: 1 as const,
              })),
            },
            {
              current: host.current,
              valid: current,
              read: async (id) => {
                if (!window.aijian?.readFilmProject)
                  return stop("GENERATION_EXECUTION_UNAVAILABLE");
                return window.aijian.readFilmProject(id);
              },
            },
          ).catch((cause: unknown) => {
            const notice = generationExecutionNotice(cause);
            throw new PipelineExecutionPreparationError(notice, cause);
          });
        }
        await preparation;
        if (!current()) return stop("PIPELINE_REQUEST_STALE");
        return execution;
      };
      const protectedMedia = async (action: () => ReturnType<typeof makePipelineStill>) => {
        try {
          return await action();
        } catch (error) {
          if (!(error instanceof ProtectedGenerationFailure)) throw error;
          const notice = generationExecutionNotice(error);
          return {
            status:
              error.code === "WRITE_UNCONFIRMED" ? ("uncertain" as const) : ("blocked" as const),
            code: notice.code,
            detail: notice.text,
          };
        }
      };
      const controller = createFilmPipelineController({
        current: host.current,
        apply: host.apply,
        save: lease.save,
        prepareSnapshot: async (film, current) =>
          applyContinuityChecks(await prepareFilmSnapshot(film, current)),
        notify: host.notify,
        labels: host.labels,
        verifyMedia: host.verifyMedia,
        reuseLocalSelectedMedia: async (_film, _targetId, ctx) => {
          try {
            const execution = await ensureExecution();
            if (!current() || !ctx.isCurrent())
              return { status: "uncertain", code: "PIPELINE_REQUEST_STALE" };
            return execution.noNewMedia()
              ? {
                  status: "done",
                  film: ctx.current(),
                  detail: "本轮沿用所选本地视频，未新增前置图；仍需人工检查。",
                }
              : null;
          } catch (cause) {
            const notice =
              cause instanceof PipelineExecutionPreparationError
                ? cause.notice
                : generationExecutionNotice(cause);
            return {
              status: [
                "GENERATION_EXECUTION_UNCONFIRMED",
                "GENERATION_EXECUTION_WRITE_UNCONFIRMED",
              ].includes(notice.code)
                ? "uncertain"
                : "blocked",
              code: notice.code,
              detail: notice.text,
            };
          }
        },
        generatePortraits: async (film, targetId, ctx) => {
          const execution = await ensureExecution();
          return protectedMedia(() => makePipelinePortraits(film, targetId, { ...ctx, execution }));
        },
        generateStill: async (film, targetId, ctx) => {
          const execution = await ensureExecution();
          return protectedMedia(() => makePipelineStill(film, targetId, { ...ctx, execution }));
        },
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
              captureFilm: host.current,
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
          if (trialDecisionId) {
            await host.checkTrialDecision!(trialDecisionId, lease!, targetId);
            if (!current() || !ctx.isCurrent())
              return { status: "uncertain", code: "PIPELINE_REQUEST_STALE" };
          }
          const execution = await ensureExecution();
          if (!current() || !ctx.isCurrent())
            return { status: "uncertain", code: "PIPELINE_REQUEST_STALE" };
          if (execution.noNewMedia())
            return {
              status: "blocked",
              code: "GENERATION_SELECTION_STALE",
              detail: "所选本地视频已变化，请重新核对。",
            };
          await host.submitGeneration([shot], {
            execution,
            current: () => current() && ctx.isCurrent(),
            apply: ctx.commitPartial,
            versions: 1,
            billingProjectId,
            signal: ctx.signal,
          });
          if (!current() || !ctx.isCurrent())
            return { status: "uncertain", code: "PIPELINE_REQUEST_STALE" };
          const after = ctx.current();
          const row = after.shots.find((item) => item.id === shot.id);
          const produced = row?.takes.some((take) => take.status === "done" && take.videoPath);
          if (row && !produced && !stillAccepted(after, row))
            return {
              status: "blocked",
              code: "STILL_NOT_ACCEPTED",
              detail: `镜头 ${row.no} 的画面还没核对`,
              film: after,
            };
          // A resolved submission is not evidence of a completed video. The controller verifies
          // an actual done take and saved path in this returned film before advancing.
          return { status: "done", film: ctx.current() };
        },
      });
      const result = recover
        ? await controller.recover()
        : await controller.run({ ...options, signal: session.abort.signal });
      if (
        !recover &&
        current() &&
        result.status === "checkpoint" &&
        ["portraits", "stills"].includes(result.current ?? "")
      ) {
        mediaIntent = {
          projectId,
          fingerprint: host.current()?.productionInputFingerprint,
          checkpoint: JSON.stringify(result.checkpoint),
          options: {
            ...(options.retryTargets ? { retryTargets: [...options.retryTargets] } : {}),
            ...(options.acceptInputs
              ? { acceptInputs: structuredClone(options.acceptInputs) }
              : {}),
          },
        };
      } else mediaIntent = undefined;
      return result;
    } finally {
      session.execution?.retire();
      try {
        await lease?.release();
      } finally {
        if (active === session) active = undefined;
      }
    }
  }
  return {
    start: () => {
      mediaIntent = undefined;
      return execute();
    },
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
    continue: () => execute(continueOptions()),
    continueAfterTrial: (decisionId: string) => {
      if (!/^rtd_[a-f0-9]{32}$/.test(decisionId))
        return Promise.reject(
          Object.assign(new Error("PIPELINE_REQUEST_STALE"), { code: "PIPELINE_REQUEST_STALE" }),
        );
      return execute({ continue: true }, false, decisionId);
    },
    cancel,
    /** Call on project identity changes and cancel() on workspace unmount. */
    projectChanged: () => {
      if (mediaIntent && host.current()?.id !== mediaIntent.projectId) mediaIntent = undefined;
      if (active && host.current()?.id !== active.projectId) cancel();
    },
  };
}
