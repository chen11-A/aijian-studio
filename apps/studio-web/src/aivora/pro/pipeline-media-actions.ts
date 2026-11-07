import {
  ensureSceneReferences,
  makeLocationReferences,
  sceneLocationTargets,
} from "../film/location-reference";
import { prepareShotSceneReferences } from "./actions/scene-references";
import { withStyleBible } from "../film/style-bible";
import type { ProductionResult } from "../film/production-pipeline";
import type { FilmProject } from "../film/project";
import { assemblySelection, readAssemblyInput, requestAssembly } from "./assembly";
import { makeAllPortraits } from "./portrait-workflow";
import { ensureShotFrame } from "./still-workflow";
import { fileMediaUrl, requestStill } from "./workflow";

export type PipelineMediaContext = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  current: () => FilmProject;
  commitPartial: (film: FilmProject) => Promise<void>;
};
type MediaResult = Omit<ProductionResult, "data"> & { film?: FilmProject; path?: string };
const valid = (context: PipelineMediaContext) => context.isCurrent() && !context.signal.aborted;
const stale = (): MediaResult => ({ status: "uncertain", code: "PIPELINE_REQUEST_STALE" });

export async function makePipelinePortraits(
  film: FilmProject,
  targetId: string,
  context: PipelineMediaContext,
  generate: typeof requestStill = requestStill,
): Promise<MediaResult> {
  if (targetId.startsWith("location:")) {
    const locationId = targetId.slice("location:".length);
    const planned = sceneLocationTargets(film).find((item) => item.id === locationId);
    const stored = film.locations.find((item) => item.id === locationId);
    if (!planned && !stored) return { status: "blocked", code: "LOCATION_TARGET_INVALID" };
    if (!valid(context)) return stale();
    const host = {
      base: film,
      locationIds: [locationId],
      current: context.current,
      isCurrent: () => valid(context),
      apply: context.commitPartial,
      generate: (prompt: string, references: string[]) =>
        generate(film.seriesId, withStyleBible(prompt, film.styleZh), film.aspectRatio, references),
    };
    const result = planned?.sceneId
      ? await ensureSceneReferences({ ...host, sceneIds: [planned.sceneId] })
      : await makeLocationReferences(host);
    if (!valid(context) || result.cancelled) return stale();
    return {
      film: context.current(),
      status: result.failed ? "failed" : "done",
      code: result.failed ? result.failures[0]!.code : "LOCATION_IMAGE_DONE",
    };
  }
  const separator = targetId.lastIndexOf("@");
  const characterId = targetId.slice(0, separator);
  const view = targetId.slice(separator + 1);
  if (separator < 1 || !["正面", "侧面", "背面", "脸部"].includes(view))
    return { status: "blocked", code: "PORTRAIT_TARGET_INVALID" };
  const person = film.characters.find((item) => item.id === characterId);
  if (!person || !person.identity.trim())
    return { status: "blocked", code: "PORTRAIT_IDENTITY_REQUIRED" };
  if (!valid(context)) return stale();
  const result = await makeAllPortraits({
    base: film,
    characterIds: [characterId],
    views: [view],
    current: context.current,
    isCurrent: () => valid(context),
    apply: context.commitPartial,
    generate: (prompt, references) =>
      generate(film.seriesId, withStyleBible(prompt, film.styleZh), film.aspectRatio, references),
    progress: () => undefined, // The existing task feed reports each image's progress.
  });
  if (!valid(context) || result.cancelled) return stale();
  return {
    film: context.current(),
    status: result.failures.some((item) => item.reason.includes("TASK_TIMEOUT"))
      ? "uncertain"
      : result.failed
        ? "failed"
        : "done",
    code: result.failed ? "PORTRAIT_BATCH_PARTIAL" : "PORTRAIT_BATCH_DONE",
  };
}

export async function makePipelineStill(
  film: FilmProject,
  shotId: string,
  context: PipelineMediaContext,
): Promise<MediaResult> {
  const shot = film.shots.find((item) => item.id === shotId);
  if (!shot || !valid(context)) return stale();
  try {
    const ready = await prepareShotSceneReferences(film, [shot], {
      current: context.current,
      valid: () => valid(context),
      apply: context.commitPartial,
    });
    const currentShot = ready.shots.find((item) => item.id === shot.id);
    if (!currentShot || !valid(context)) return stale();
    await ensureShotFrame(ready, currentShot, {
      current: context.current,
      valid: () => valid(context),
      apply: context.commitPartial,
    });
    return valid(context)
      ? { status: "done", film: context.current(), code: "STILL_DONE" }
      : stale();
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_TIMEOUT")
      return { status: "uncertain", code: "TASK_TIMEOUT" };
    return valid(context) ? { status: "failed", code: "STILL_FAILED" } : stale();
  }
}

export async function assemblePipelineFilm(
  film: FilmProject,
  paths: string[],
  context: PipelineMediaContext,
): Promise<MediaResult> {
  if (!valid(context)) return stale();
  if (
    !window.aijian?.assembleFilmProject ||
    !window.aijian.cancelFilmAssemblyOperation ||
    !window.aijian.readFilmProject
  )
    return { status: "blocked", code: "DESKTOP_REQUIRED" };
  if (
    paths.length !== film.shots.length ||
    !paths.length ||
    paths.some((path) => !path) ||
    assemblySelection(film).length !== film.shots.length
  )
    return { status: "blocked", code: "PIPELINE_MISSING_VIDEO" };
  try {
    // The controller already persisted this running checkpoint under its original lease.
    const accepted = context.current();
    const control = {
      current: context.current,
      valid: () => valid(context),
      signal: context.signal,
    };
    const input = await readAssemblyInput(accepted, control);
    if (!input || !valid(context)) return stale();
    const result = await requestAssembly(accepted, input, control);
    if (!valid(context)) return stale();
    if (result.kind === "FAILED")
      return {
        status:
          result.code === "PROJECT_CHANGED" || result.code === "OPERATION_STOPPED"
            ? "uncertain"
            : "failed",
        code: result.code === "PROJECT_CHANGED" ? "PIPELINE_REQUEST_STALE" : "ASSEMBLY_FAILED",
      };
    return {
      status: result.kind === "PARTIAL" ? "needs-input" : "done",
      code: result.kind === "PARTIAL" ? "ASSEMBLY_PARTIAL" : "ASSEMBLY_DONE",
      ...(result.kind === "PARTIAL"
        ? {
            detail:
              result.incomplete === "subtitles"
                ? "粗剪已有文件，但字幕处理未完成，请核对。"
                : "粗剪已有文件，但声音处理未完整完成，请核对。",
          }
        : {}),
      path: result.path,
      film: {
        ...context.current(),
        assemblyPath: result.path,
        assemblyUrl: fileMediaUrl(result.path),
      },
    };
  } catch {
    return valid(context) ? { status: "failed", code: "ASSEMBLY_FAILED" } : stale();
  }
}
