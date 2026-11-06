import type {
  FilmExportPhase,
  FilmExportProgressEvent,
  FilmExportProgressMeasure,
} from "@aijian/contracts/film-export-qc";
export type ExportProgressScope = { operationId: string; projectId: string; key: string };
const phases: Record<FilmExportPhase, true> = {
  preparing: true,
  joining: true,
  mixing: true,
  rendering: true,
  checking: true,
  tagging: true,
  "checking-final": true,
  waitingReview: true,
  publishing: true,
  completed: true,
  partial: true,
  failed: true,
  unknown: true,
};
const row = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function measurement(value: unknown): FilmExportProgressMeasure | undefined {
  const input = row(value);
  if (!input) return;
  if (
    input.kind === "units" &&
    Number.isSafeInteger(input.completed) &&
    Number.isSafeInteger(input.total) &&
    Number(input.total) > 0 &&
    Number(input.completed) >= 0 &&
    Number(input.completed) <= Number(input.total) &&
    (input.unit === "镜头" || input.unit === "画幅")
  )
    return {
      kind: "units",
      completed: Number(input.completed),
      total: Number(input.total),
      unit: input.unit,
    };
  if (
    input.kind === "media-time" &&
    typeof input.outTimeSeconds === "number" &&
    typeof input.durationSeconds === "number" &&
    Number.isFinite(input.outTimeSeconds) &&
    Number.isFinite(input.durationSeconds) &&
    input.outTimeSeconds >= 0 &&
    input.durationSeconds > 0 &&
    input.outTimeSeconds <= input.durationSeconds
  )
    return {
      kind: "media-time",
      outTimeSeconds: input.outTimeSeconds,
      durationSeconds: input.durationSeconds,
    };
}
/** An ACK snapshot uses this same monotonic gate; paint order never grants authority. */
export function acceptExportProgress(
  value: unknown,
  previous: FilmExportProgressEvent | null,
  scope: ExportProgressScope,
  currentKey: string,
): FilmExportProgressEvent | null {
  const input = row(value);
  if (
    !input ||
    currentKey !== scope.key ||
    input.operationId !== scope.operationId ||
    input.projectId !== scope.projectId ||
    !Number.isSafeInteger(input.seq) ||
    Number(input.seq) <= 0 ||
    (previous?.operationId === scope.operationId && Number(input.seq) <= previous.seq) ||
    typeof input.phase !== "string" ||
    !Object.hasOwn(phases, input.phase) ||
    !["available", "requested", "stopped", "unavailable"].includes(String(input.cancelState)) ||
    !Array.isArray(input.published) ||
    input.published.length > 2
  )
    return null;
  const published: FilmExportProgressEvent["published"] = [];
  for (const value of input.published) {
    const item = row(value);
    if (
      !item ||
      (item.aspectRatio !== "16:9" && item.aspectRatio !== "9:16") ||
      published.some((output) => output.aspectRatio === item.aspectRatio)
    )
      return null;
    published.push({
      aspectRatio: item.aspectRatio,
      label: item.aspectRatio === "16:9" ? "横屏成片" : "竖屏成片",
    });
  }
  return {
    operationId: scope.operationId,
    projectId: scope.projectId,
    seq: Number(input.seq),
    phase: input.phase as FilmExportPhase,
    cancelState: input.cancelState as FilmExportProgressEvent["cancelState"],
    progress: measurement(input.progress),
    published,
  };
}
