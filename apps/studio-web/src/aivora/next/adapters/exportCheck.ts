import { filmFileName } from "../../film/operations";
import type { ExportCheckProps, ShotSpan } from "../ExportCheck";
import { exportedShots, shotName } from "./names";
import { readProject } from "./read";
import type { Adapted } from "./result";

export type ExportCheckData = Pick<
  ExportCheckProps,
  | "report"
  | "checking"
  | "error"
  | "shots"
  | "fileName"
  | "reviewMode"
  | "busy"
  | "stale"
  | "publishBlocked"
  | "unverified"
>;

export type ExportCheckOptions = Pick<
  ExportCheckProps,
  "reviewMode" | "busy" | "stale" | "publishBlocked" | "unverified"
> & {
  /** The check is running. */
  checking?: boolean;
  /** The check could not run, in plain Chinese. */
  error?: string | null;
  /**
   * The measured length of each joined clip in seconds, in export order. Without it the saved
   * shot lengths are used, which can be off by up to about a second per clip, so an issue near a
   * cut can be put on the shot next to it.
   */
  clipSeconds?: readonly number[];
};

/**
 * ExportCheck props from project.json and the parsed aivora-qc report. The report itself is
 * passed through; ExportCheck checks it. Spans cover the shots the export joins, in its order and
 * with no title card, as the desktop's film:assemble does. After a shot whose length is unknown
 * no more spans are placed, so later issues keep the checker's own time label.
 */
export function exportCheckData(
  value: unknown,
  report: unknown,
  options: ExportCheckOptions = {},
): Adapted<ExportCheckData> {
  const base = {
    ...(options.reviewMode !== undefined ? { reviewMode: options.reviewMode } : {}),
    ...(options.busy !== undefined ? { busy: options.busy } : {}),
    ...(options.stale !== undefined ? { stale: options.stale } : {}),
    ...(options.publishBlocked !== undefined ? { publishBlocked: options.publishBlocked } : {}),
    ...(options.unverified !== undefined ? { unverified: options.unverified } : {}),
    report,
    checking: Boolean(options.checking),
    error: options.error ?? null,
  };
  const read = readProject(value);
  if (!read.ok) return { ok: true, props: base, missing: ["project.json"] };
  const project = read.project;
  const spans: ShotSpan[] = [];
  let at = 0;
  for (const [index, { shot }] of exportedShots(project).entries()) {
    const measured = options.clipSeconds?.[index];
    const seconds = typeof measured === "number" && measured > 0 ? measured : shot.seconds;
    if (seconds === null || seconds <= 0) break;
    spans.push({ id: shot.id, start: at, end: at + seconds, label: shotName(project, shot) });
    at += seconds;
  }
  return {
    ok: true,
    props: {
      ...base,
      shots: spans,
      fileName: filmFileName(project.seriesTitle || project.title, project.episodeTitle || "第1集"),
    },
    missing: project.missing,
  };
}
