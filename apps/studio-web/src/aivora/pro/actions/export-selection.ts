import type { FilmProject } from "../../film/project";
import { exportFilmTask, type FilmExportSettings } from "../media-tasks";

export type ExportAspectChoice = "work" | "other" | "both";
export type ExportAspect = "16:9" | "9:16";
export type ExportSelectionOutput = {
  aspectRatio: ExportAspect;
  path: string;
  /** 4B-B09: written beside the film. */
  subtitlePath?: string;
  coverPath?: string;
  note?: string;
};
export type ExportSelectionResult = {
  status: "done" | "partial" | "failed" | "cancelled" | "stale";
  outputs: ExportSelectionOutput[];
  primaryPath: string;
  directory: string;
  error?: {
    code: "EXPORT_FAILED" | "EXPORT_CANCELLED" | "WORK_STALE" | "EXPORT_SUBTITLES_BAKED";
    detail?: string;
  };
};
type Host = Parameters<typeof exportFilmTask>[3] & { signal?: AbortSignal };

/** Missing aspect belongs to the legacy portrait format, never a guessed landscape project. */
export function exportAspectPlan(
  film: Partial<Pick<FilmProject, "aspectRatio">>,
  choice: ExportAspectChoice,
): ExportAspect[] {
  const work = film.aspectRatio === "16:9" ? "16:9" : "9:16";
  const other = work === "16:9" ? "9:16" : "16:9";
  if (choice === "work") return [work];
  if (choice === "other") return [other];
  if (choice === "both") return [work, other];
  throw new TypeError("EXPORT_ASPECT_INVALID");
}

/** Coordinates existing export tasks. It does not generate media or own the workspace save lease. */
export async function exportFilmSelection(
  base: FilmProject,
  paths: readonly string[],
  directory: string,
  host: Host,
  choice: ExportAspectChoice = "work",
  settings?: FilmExportSettings,
): Promise<ExportSelectionResult> {
  const outputs: ExportSelectionOutput[] = [];
  let folder = directory;
  let stopped: "cancelled" | "stale" | undefined;
  const controller = new AbortController();
  const abort = () => {
    stopped ??= "cancelled";
    controller.abort();
  };
  const current = () => {
    if (!host.valid() || host.current()?.id !== base.id) {
      stopped ??= "stale";
      controller.abort();
    } else if (host.signal?.aborted) abort();
    return !controller.signal.aborted;
  };
  const result = (
    status: ExportSelectionResult["status"],
    error?: ExportSelectionResult["error"],
  ): ExportSelectionResult => ({
    status,
    outputs: outputs.map((output) => ({ ...output })),
    primaryPath: outputs[0]?.path ?? "",
    directory: folder,
    ...(error ? { error } : {}),
  });
  const assertCurrent = () => {
    if (!current()) throw new Error(stopped === "stale" ? "WORK_STALE" : "EXPORT_CANCELLED");
  };
  host.signal?.addEventListener("abort", abort, { once: true });
  const watch = setInterval(current, 100);
  try {
    assertCurrent();
    const snapshot = structuredClone(base);
    const selectedPaths = [...paths];
    const plan = exportAspectPlan(snapshot, choice);
    for (const aspectRatio of plan) {
      assertCurrent();
      // The first export owns the folder picker; the second reuses its actual returned folder.
      const options = {
        aspectRatio,
        signal: controller.signal,
        ...(settings ? { settings } : {}),
      };
      const exported = await exportFilmTask(
        snapshot,
        [...selectedPaths],
        folder,
        {
          current: host.current,
          valid: current,
          apply: (next) => {
            assertCurrent();
            const path = next.exportPath;
            if (!path || outputs.some((output) => output.path === path))
              throw new Error("EXPORT_OUTPUT_COLLISION");
            const primaryPath = outputs[0]?.path ?? path;
            host.apply({ ...next, exportPath: primaryPath });
            outputs.push({ aspectRatio, path });
          },
        },
        options,
      );
      folder = exported.directory;
      const written = outputs.find((output) => output.path === exported.path);
      if (written) {
        if (exported.subtitlePath) written.subtitlePath = exported.subtitlePath;
        if (exported.coverPath) written.coverPath = exported.coverPath;
        if (exported.note) written.note = exported.note;
      }
    }
    assertCurrent();
    return result("done");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const cancelled =
      stopped === "cancelled" ||
      code === "EXPORT_CANCELLED" ||
      detail === "EXPORT_CANCELLED" ||
      detail === "TASK_CANCELLED";
    const stale = stopped === "stale" || detail === "WORK_STALE";
    return result(
      stale ? "stale" : cancelled ? "cancelled" : outputs.length ? "partial" : "failed",
      {
        code: stale
          ? "WORK_STALE"
          : cancelled
            ? "EXPORT_CANCELLED"
            : code === "EXPORT_SUBTITLES_BAKED"
              ? "EXPORT_SUBTITLES_BAKED"
              : "EXPORT_FAILED",
        detail,
      },
    );
  } finally {
    clearInterval(watch);
    host.signal?.removeEventListener("abort", abort);
  }
}
