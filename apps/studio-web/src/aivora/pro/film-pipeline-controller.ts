import { MEDIA_EXECUTION_ORDER } from "../film/production-pipeline";
import {
  pipelineMediaPath as mediaPath,
  pipelineSelectedVideo as selectedVideo,
} from "../film/pipeline-media-selection";
import {
  locationAssociationUnique,
  locationImageCurrent,
  sceneLocationTargets,
} from "../film/location-reference";
import { applyContinuityChecks } from "../film/continuity-rules";
import type { PipelineProgress, UiNotice } from "../film/contracts3j";
import { detectDirectorCoverage, shotLines } from "../film/director-continuity";
import { isFightScene, portraitPrompts, shotVoiceId } from "../film/operations";
import { interruptStaleWork, upgradeFilm, type FilmProject } from "../film/project";
import { fileMediaUrl } from "./workflow";
import {
  createProductionPipeline,
  isProductionPipeline,
  recoverProductionPipeline,
  runProductionPipeline,
  type ProductionCheckpoint,
  type ProductionPipeline,
  type ProductionResult,
  type ProductionRunOptions,
  type ProductionStepId,
} from "../film/production-pipeline";
import {
  runPipelineAgentAction,
  type PipelineAgentHost,
  type PipelineAgentTarget,
} from "./pipeline-agent-actions";

export type FilmPipelineResult = Omit<ProductionResult, "data"> & {
  film?: FilmProject;
  /** An actual saved artifact returned by the media host, never an invented placeholder. */
  path?: string;
};
export type FilmPipelineContext = {
  signal: AbortSignal;
  runId: string;
  isCurrent: () => boolean;
  current: () => FilmProject;
  /** Await after each durable media result and before dispatching the next request. */
  commitPartial: (film: FilmProject) => Promise<void>;
};
type MediaAction = (
  film: FilmProject,
  targetId: string,
  context: FilmPipelineContext,
) => Promise<FilmPipelineResult>;
export type FilmPipelineHost = {
  current: () => FilmProject | null;
  apply: (film: FilmProject) => void;
  /** Materialize data URLs / clear session URLs without writing project.json.
   * The returned business fields must be unchanged by save (apart from savedAt/directory).
   * Check the guard before starting side effects; never apply the prepared snapshot here. */
  prepareSnapshot?: (film: FilmProject, isCurrent: () => boolean) => Promise<FilmProject>;
  /** Persist the prepared snapshot without changing its business fields.
   * Check the guard at the storage write boundary. This callback must not apply another snapshot. */
  save: (film: FilmProject, isCurrent: () => boolean) => Promise<void>;
  request: PipelineAgentHost["request"];
  notify?: (notice: UiNotice) => void;
  /** Only the actual workspace host may return a current native local-reuse result.
   * This skips unconsumed image work without inventing portrait/poster artifacts. */
  reuseLocalSelectedMedia?: (
    film: FilmProject,
    targetId: string,
    context: FilmPipelineContext,
  ) => Promise<FilmPipelineResult | null>;
  generatePortraits?: MediaAction;
  generateStill?: MediaAction;
  video?: MediaAction;
  assemble?: (
    film: FilmProject,
    videoPaths: string[],
    context: FilmPipelineContext,
  ) => Promise<FilmPipelineResult>;
  visualReviewAvailable?: boolean;
  /** Only when no additional audio tracks need to be applied. */
  reuseSingleVideo?: boolean;
  review?: MediaAction;
  /** A desktop host can additionally check existence/probe the reported artifact. */
  verifyMedia?: (path: string, kind: "image" | "video") => Promise<boolean>;
  labels?: Partial<Record<ProductionStepId, string>>;
};
const owners = new Map<string, symbol>();

class SnapshotPreparationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
// These are the media fields transformed by desktop film-library.materializeMedia.
// Source text and prompts remain business content, even if they mention data/blob URLs.
const transientMediaKeys = new Set([
  "referenceImage",
  "poster",
  "stillUrl",
  "videoUrl",
  "url",
  "assemblyUrl",
  "preview",
  "path",
]);
function hasTransientMedia(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTransientMedia);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) =>
    typeof item === "string"
      ? transientMediaKeys.has(key) && /^(data:|blob:)/.test(item)
      : hasTransientMedia(item),
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function businessContent(film: FilmProject): string {
  const excluded = new Set([
    "productionPipeline",
    "productionInputFingerprint",
    "riskTrialDecisions",
    "pipeline",
    "savedAt",
    "directory",
  ]);
  return JSON.stringify(
    canonical(Object.fromEntries(Object.entries(film).filter(([key]) => !excluded.has(key)))),
  );
}
/** Only a digest is persisted; source prose is not duplicated in orchestration metadata. */
export async function filmPipelineFingerprint(film: FilmProject): Promise<string> {
  // readSaved upgrades persisted films and hydrateFilm derives playback URLs. Hash that
  // stable business shape, while the running owner guard still compares raw businessContent.
  const upgraded = upgradeFilm(structuredClone(film));
  if (!upgraded) throw new Error("PIPELINE_INPUT_INVALID");
  const normalized = applyContinuityChecks(upgraded);
  // Adopting the current poster only records a human checklist. It does not change the
  // picture or the script, so a one-click run can continue after 核对并采用.
  normalized.shots = normalized.shots.map((shot) => ({
    ...shot,
    stills: shot.stills
      .filter((item) => item.prompt.trim() || item.url !== shot.poster)
      .map((item) => ({ ...item, acceptance: undefined })),
    takes: shot.takes.map((take) => ({
      ...take,
      videoUrl:
        take.videoPath &&
        (!take.videoUrl ||
          take.videoUrl === take.videoPath ||
          take.videoUrl === fileMediaUrl(take.videoPath))
          ? ""
          : take.videoUrl,
    })),
  }));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(businessContent(normalized)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function projectProductionProgress(
  state: ProductionPipeline,
  labels: Partial<Record<ProductionStepId, string>> = {},
): PipelineProgress {
  return {
    steps: state.steps.map(({ id, status, done, total }) => ({
      id,
      label: labels[id] ?? id,
      status,
      done,
      total,
    })),
    current: state.current,
    status: state.status,
    checkpoint: state.checkpoint ? structuredClone(state.checkpoint) : undefined,
    code: state.code,
  };
}
export function filmPipelineTargets(film: FilmProject, step: ProductionStepId): string[] {
  switch (step) {
    case "writer":
      return ["script", "cast"];
    case "art":
      return ["art"];
    case "portraits":
      return [
        ...film.characters.flatMap((person) =>
          portraitPrompts(person.name, person.identity, film.styleZh).map(
            ({ view }) => `${person.id}@${view}`,
          ),
        ),
        ...sceneLocationTargets(film).map((location) => `location:${location.id}`),
      ];
    case "director":
      return film.scenes.map((scene) => scene.id);
    case "action":
      return film.scenes
        .filter((scene) =>
          isFightScene(
            `${scene.title}\n${scene.where}\n${scene.text}`,
            (scene.tags ?? []).join(" "),
          ),
        )
        .map((scene) => scene.id);
    case "performance":
      return film.scenes
        .filter((scene) =>
          film.shots.some(
            (shot) =>
              shot.sceneId === scene.id &&
              (shot.characters.some((name) => name && !["人物", "空镜"].includes(name)) ||
                shotLines(shot).some((line) => line.speaker)),
          ),
        )
        .map((scene) => scene.id);
    case "prompter":
    case "stills":
    case "video":
      return film.shots.map((shot) => shot.id);
    case "review":
    case "assembly":
      return ["all"];
  }
}
export function filmPipelineCheckpoint(film: FilmProject): ProductionCheckpoint {
  const coverage = film.scenes.map((scene) => detectDirectorCoverage(scene, film.shots));
  const risks: ProductionCheckpoint["risks"] = [];
  if (film.unassignedBeats?.length)
    risks.push({
      code: "ACTION_UNASSIGNED",
      text: `${film.unassignedBeats.length} 个动作尚未归属镜头。`,
      severity: "block",
    });
  if (
    film.shots.some(
      (shot) =>
        new Set(
          shotLines(shot)
            .map((line) => line.speaker)
            .filter(Boolean),
        ).size > 1 &&
        shotLines(shot).some(
          (line) =>
            !shotVoiceId({ ...shot, lines: [line], line: line.text, speaker: line.speaker }, film),
        ),
    )
  )
    risks.push({ code: "MULTI_VOICE_REQUIRED", text: "有镜头需要分角色配音。", severity: "block" });
  risks.push({
    code: "VIDEO_SUBMISSIONS_ESTIMATE",
    text: "预计次数仅统计视频生成提交；不包含轮询与配音。",
    severity: "info",
  });
  return {
    shotCount: film.shots.length,
    seconds: film.shots.reduce((sum, shot) => sum + shot.seconds, 0),
    estimatedRequests: film.shots.filter((shot) => !selectedVideo(shot)).length,
    coverage,
    risks,
  };
}
const failure = (
  code: string,
  status: FilmPipelineResult["status"] = "blocked",
): FilmPipelineResult => ({ status, code });

/** Artifacts and orchestration state share each save, including per-image partial checkpoints. */
export function createFilmPipelineController(host: FilmPipelineHost) {
  async function operate(
    options: ProductionRunOptions & { restart?: boolean } = {},
    recoveryOnly = false,
  ): Promise<ProductionPipeline> {
    const initial = host.current();
    if (!initial) throw new Error("PROJECT_REQUIRED");
    const fresh = () => createProductionPipeline(initial.id, "unresolved");
    if (owners.has(initial.id))
      return {
        ...(initial.productionPipeline ?? fresh()),
        status: "blocked",
        code: "PIPELINE_ALREADY_RUNNING",
      };
    const owner = Symbol(initial.id);
    owners.set(initial.id, owner);
    let expected = initial;
    let expectedContent = businessContent(initial);
    let latestState: ProductionPipeline = initial.productionPipeline ?? fresh();
    const current = () =>
      owners.get(initial.id) === owner &&
      host.current() === expected &&
      host.current()?.id === initial.id &&
      businessContent(expected) === expectedContent;
    const stale = () => ({
      ...latestState,
      status: "blocked" as const,
      code: "PIPELINE_INPUT_CHANGED",
    });
    try {
      const fingerprint = await filmPipelineFingerprint(initial);
      if (!current()) return stale();
      if (
        initial.productionPipeline !== undefined &&
        !isProductionPipeline(initial.productionPipeline)
      )
        return { ...fresh(), status: "blocked", code: "STATE_INVALID" };
      if (
        !options.restart &&
        initial.productionPipeline &&
        (initial.productionPipeline.projectId !== initial.id ||
          initial.productionInputFingerprint !== fingerprint)
      )
        return stale();
      latestState =
        options.restart || !initial.productionPipeline
          ? createProductionPipeline(initial.id, fingerprint)
          : structuredClone(initial.productionPipeline);
      const inputVersion = latestState.inputVersion;
      const persist = async (
        film: FilmProject,
        state: ProductionPipeline,
        permitted: () => boolean = current,
      ) => {
        if (!current() || !permitted() || film.id !== initial.id)
          throw new Error("PIPELINE_INPUT_CHANGED");
        let snapshot = structuredClone(film);
        const guard = () => current() && permitted();
        if (host.prepareSnapshot) {
          snapshot = structuredClone(await host.prepareSnapshot(snapshot, guard));
          if (!guard()) throw new Error("PIPELINE_INPUT_CHANGED");
          if (snapshot.id !== initial.id || snapshot.seriesId !== initial.seriesId)
            throw new SnapshotPreparationError("PIPELINE_PREPARATION_INVALID");
        }
        if (hasTransientMedia(snapshot))
          throw new SnapshotPreparationError("PIPELINE_PREPARATION_REQUIRED");
        // Materialization must precede hashing. No second metadata write is necessary,
        // so a crash cannot leave the new media with the old fingerprint in project.json.
        const hash = await filmPipelineFingerprint(snapshot);
        if (!current() || !permitted()) throw new Error("PIPELINE_INPUT_CHANGED");
        snapshot.productionPipeline = structuredClone(state);
        snapshot.productionInputFingerprint = hash;
        snapshot.pipeline = projectProductionProgress(state, host.labels);
        await host.save(snapshot, () => current() && permitted());
        if (!current() || !permitted()) throw new Error("PIPELINE_INPUT_CHANGED");
        host.apply(snapshot);
        const applied = host.current();
        // React hosts may normalize/clone a prepared snapshot. Accept only an exact
        // business/state equivalent of what was saved, never a concurrent edit.
        if (
          !applied ||
          applied.id !== snapshot.id ||
          businessContent(applied) !== businessContent(snapshot) ||
          applied.productionInputFingerprint !== hash ||
          JSON.stringify(applied.productionPipeline) !== JSON.stringify(snapshot.productionPipeline)
        )
          throw new Error("PIPELINE_INPUT_CHANGED");
        expected = applied;
        expectedContent = businessContent(applied);
        latestState = structuredClone(state);
      };
      if (recoveryOnly) {
        const ownedShots = new Set(
          latestState.steps
            .find((step) => step.id === "video")
            ?.targets.filter((target) => ["running", "queued", "uncertain"].includes(target.status))
            .map((target) => target.id) ?? [],
        );
        const interrupted = interruptStaleWork({
          ...expected,
          shots: expected.shots.filter((shot) => ownedShots.has(shot.id)),
          jobs: expected.jobs.filter((job) => job.kind === "video" && ownedShots.has(job.shotId)),
        });
        const recoveredFilm = interrupted.interrupted
          ? {
              ...expected,
              shots: expected.shots.map(
                (shot) => interrupted.film.shots.find((item) => item.id === shot.id) ?? shot,
              ),
              jobs: expected.jobs.map(
                (job) => interrupted.film.jobs.find((item) => item.id === job.id) ?? job,
              ),
            }
          : expected;
        latestState = recoverProductionPipeline(latestState);
        await persist(recoveredFilm, latestState);
        return latestState;
      }
      const result = await runProductionPipeline(
        latestState,
        {
          current: () => ({
            projectId: host.current()?.id ?? "",
            inputVersion: current() ? inputVersion : "stale",
          }),
          targets: (step) => filmPipelineTargets(expected, step),
          executionOrder: MEDIA_EXECUTION_ORDER,
          beforeMediaCheckpoint: () => ({
            ...filmPipelineCheckpoint(expected),
            // Full confirmed scope is the upper bound. Native, not path strings, decides cache reuse.
            estimatedRequests: filmPipelineTargets(expected, "video").length,
            risks: [
              ...filmPipelineCheckpoint(expected).risks.filter(
                (r) => r.code !== "VIDEO_SUBMISSIONS_ESTIMATE",
              ),
              {
                code: "MEDIA_SCOPE_UPPER_BOUND",
                text: "视频次数按完整镜头范围给出上限，本机核实可复用素材后可能减少；自动前置图与配音另占会员额度。",
                severity: "info" as const,
              },
            ],
          }),
          checkpoint: () => filmPipelineCheckpoint(expected),
          save: async (state, context) => {
            const completed = context.completion?.result.data as { film?: FilmProject } | undefined;
            await persist(completed?.film ?? expected, state, context.isCurrent);
          },
          execute: async (step, targetId, execution) => {
            const before = expected;
            let active = true;
            let partial = false;
            const valid = () => active && current() && !execution.signal.aborted;
            const ctx: FilmPipelineContext = {
              ...execution,
              isCurrent: valid,
              current: () => expected,
              commitPartial: async (film) => {
                if (!valid()) throw new Error("PIPELINE_INPUT_CHANGED");
                await persist(film, latestState, valid);
                partial = true;
              },
            };
            try {
              const textSteps = ["writer", "art", "director", "action", "performance", "prompter"];
              let output: FilmPipelineResult;
              if (textSteps.includes(step)) {
                output = await runPipelineAgentAction(
                  structuredClone(before),
                  { step, targetId } as PipelineAgentTarget,
                  { request: host.request, valid, signal: execution.signal, notify: host.notify },
                );
                if (output.status === "done" && !output.film)
                  output = failure("STEP_RESULT_MISSING", "failed");
              } else {
                output = await executeMedia(step, targetId, before, ctx, host);
              }
              if (!valid()) return failure("PIPELINE_INPUT_CHANGED");
              if (
                partial &&
                output.film &&
                businessContent(output.film) !== businessContent(expected)
              )
                return failure("STEP_RESULT_STALE");
              if (output.film && output.film.id !== initial.id)
                return failure("PROJECT_RESULT_MISMATCH");
              return {
                status: output.status,
                code: output.code,
                detail: output.detail,
                ...(output.film ? { data: { film: output.film } } : {}),
              };
            } finally {
              active = false;
            }
          },
        },
        options,
      );
      return current() ? result : stale();
    } catch (error) {
      if (!current()) return stale();
      if (error instanceof SnapshotPreparationError)
        return { ...latestState, status: "blocked", code: error.code };
      return { ...latestState, status: "uncertain", code: "PIPELINE_SAVE_FAILED" };
    } finally {
      if (owners.get(initial.id) === owner) owners.delete(initial.id);
    }
  }
  return {
    run: (options?: ProductionRunOptions & { restart?: boolean }) => operate(options),
    recover: () => operate({}, true),
    project: () => {
      const state = host.current()?.productionPipeline;
      return state && isProductionPipeline(state)
        ? projectProductionProgress(state, host.labels)
        : undefined;
    },
  };
}

async function executeMedia(
  step: ProductionStepId,
  targetId: string,
  film: FilmProject,
  ctx: FilmPipelineContext,
  host: FilmPipelineHost,
): Promise<FilmPipelineResult> {
  const validMedia = async (path: string, kind: "image" | "video") =>
    mediaPath(path, kind) && (!host.verifyMedia || (await host.verifyMedia(path, kind)));
  if (step === "review") {
    if (!host.visualReviewAvailable || !host.review)
      return {
        status: "needs-input",
        code: "VISUAL_REVIEW_REQUIRED",
        detail: "尚无视觉审片结果，请人工检查全部镜头并明确确认。",
      };
    return host.review(film, targetId, ctx);
  }
  if (step === "portraits") {
    const split = targetId.lastIndexOf("@");
    const characterId = targetId.slice(0, split);
    const view = targetId.slice(split + 1);
    const complete = async (value: FilmProject) => {
      if (targetId.startsWith("location:")) {
        const location = value.locations.find(
          (item) => item.id === targetId.slice("location:".length),
        );
        return Boolean(
          location &&
          locationImageCurrent(value, location) &&
          locationAssociationUnique(value, location) &&
          location.referenceStyleRevision === (value.styleRevision ?? 0) &&
          (await validMedia(location.referenceImage!, "image")),
        );
      }
      const person = value.characters.find((person) => person.id === characterId);
      if (
        !person ||
        !portraitPrompts(person.name, person.identity, value.styleZh).some(
          (item) => item.view === view,
        )
      )
        return false;
      const portrait = person.portraits.find(
        (portrait) => portrait.view === view && mediaPath(portrait.url, "image"),
      );
      return Boolean(portrait && (await validMedia(portrait.url, "image")));
    };
    if (await complete(film)) return { status: "done", film };
    const reuse = await host.reuseLocalSelectedMedia?.(film, targetId, ctx);
    if (reuse) return reuse;
    if (!host.generatePortraits) return failure("PORTRAIT_CAPABILITY_REQUIRED");
    const result = await host.generatePortraits(film, targetId, ctx);
    const next = result.film ?? ctx.current();
    if (result.status !== "done") return { ...result, film: next };
    return (await complete(next))
      ? { ...result, film: next }
      : {
          ...failure(
            targetId.startsWith("location:") ? "LOCATION_IMAGE_INCOMPLETE" : "PORTRAITS_INCOMPLETE",
            "failed",
          ),
          film: next,
        };
  }
  if (step === "stills" || step === "video") {
    const shot = film.shots.find((shot) => shot.id === targetId);
    if (!shot) return failure("SHOT_NOT_FOUND");
    const existing = step === "stills" ? shot.poster : selectedVideo(shot);
    if (existing && (await validMedia(existing, step === "stills" ? "image" : "video")))
      return { status: "done", film };
    if (step === "stills") {
      const reuse = await host.reuseLocalSelectedMedia?.(film, targetId, ctx);
      if (reuse) return reuse;
    }
    const action = step === "stills" ? host.generateStill : host.video;
    if (!action) return failure("MEDIA_CAPABILITY_REQUIRED");
    const result = await action(film, targetId, ctx);
    let next = result.film ?? ctx.current();
    if (result.status !== "done") return { ...result, film: next };
    if (result.path && step === "stills")
      next = {
        ...next,
        shots: next.shots.map((item) =>
          item.id === targetId ? { ...item, poster: result.path ?? "" } : item,
        ),
      };
    const updated = next.shots.find((item) => item.id === targetId);
    const path = updated && (step === "stills" ? updated.poster : selectedVideo(updated));
    return path && (await validMedia(path, step === "stills" ? "image" : "video"))
      ? { ...result, film: next }
      : { ...failure("MEDIA_RESULT_MISSING", "failed"), film: next };
  }
  if (step === "assembly") {
    const paths = film.shots.map(selectedVideo);
    if (!paths.length || paths.some((path) => !path)) return failure("VIDEO_COVERAGE_INCOMPLETE");
    for (const path of paths)
      if (!(await validMedia(path, "video"))) return failure("VIDEO_FILE_MISSING");
    if (paths.length === 1 && host.reuseSingleVideo === true && film.audioClips.length === 0)
      return {
        status: "done",
        film: { ...film, assemblyPath: paths[0] ?? "", assemblyUrl: paths[0] ?? "" },
      };
    if (!host.assemble) return failure("ASSEMBLY_CAPABILITY_REQUIRED");
    const result = await host.assemble(film, paths, ctx);
    const next = result.film ?? ctx.current();
    if (result.status !== "done") return { ...result, film: next };
    const path = result.path ?? next.assemblyPath;
    return (await validMedia(path, "video"))
      ? {
          ...result,
          film: {
            ...next,
            assemblyPath: path,
            assemblyUrl: next.assemblyPath === path && next.assemblyUrl ? next.assemblyUrl : path,
          },
        }
      : { ...failure("ASSEMBLY_RESULT_MISSING", "failed"), film: next };
  }
  return failure("STEP_UNSUPPORTED");
}
