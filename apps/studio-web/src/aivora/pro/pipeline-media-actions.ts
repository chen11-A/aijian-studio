import { withStyleBible } from "../film/style-bible";
import type { ProductionResult } from "../film/production-pipeline";
import type { FilmProject } from "../film/project";
import { dialogueTracks } from "../film/operations";
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
    generate: (prompt) =>
      generate(film.seriesId, withStyleBible(prompt, film.styleZh), film.aspectRatio),
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
    await ensureShotFrame(film, shot, {
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
  assemble = window.aijian?.assembleFilm,
): Promise<MediaResult> {
  if (!valid(context)) return stale();
  if (!assemble) return { status: "blocked", code: "DESKTOP_REQUIRED" };
  if (paths.length !== film.shots.length || paths.length === 0 || paths.some((path) => !path))
    return { status: "blocked", code: "PIPELINE_MISSING_VIDEO" };
  try {
    const music = film.audioClips.find((clip) => clip.lane === "score" && clip.path);
    // The existing desktop path also handles one clip and applies its requested audio.
    const result = await assemble(
      film.seriesId,
      paths,
      music?.path ?? "",
      music?.gainDb ?? -14,
      dialogueTracks(film),
    );
    if (!valid(context)) return stale();
    if (!result.path) return { status: "failed", code: "ASSEMBLY_FAILED" };
    return {
      status: result.reason ? "needs-input" : "done",
      code: result.reason ? "ASSEMBLY_PARTIAL" : "ASSEMBLY_DONE",
      detail: result.reason ? "成片已有文件，但声音处理未完整完成，请检查。" : undefined,
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
