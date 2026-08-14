import type {
  InvalidationOperationDetailResponse,
  InvalidationOperationListResponse,
} from "../../api/studio";

export type ImpactKind = "blocking" | "render_only" | "advisory";
export type OperationSummary = InvalidationOperationListResponse["data"]["operations"][number];
export type OperationDetail = InvalidationOperationDetailResponse["data"];
export type AffectedVersion = OperationDetail["affected_versions"][number];
export type PathImpact = AffectedVersion["paths"][number];

export type ReportListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; response: InvalidationOperationListResponse };

export type ReportDetailState =
  | { kind: "idle" }
  | { kind: "loading"; operationId: string }
  | { kind: "error"; operationId: string }
  | { kind: "ready"; response: InvalidationOperationDetailResponse };

export function impactLabel(impact: ImpactKind | null): string {
  if (impact === null) return "无影响";
  if (impact === "blocking") return "必须重做";
  if (impact === "render_only") return "只影响成片";
  return "提示";
}

export function impactIcon(impact: ImpactKind | null): string {
  if (impact === null) return "○";
  if (impact === "blocking") return "■";
  if (impact === "render_only") return "▲";
  return "◇";
}

export function impactTone(impact: ImpactKind | null): string {
  if (impact === null) return "none";
  if (impact === "blocking") return "blocking";
  if (impact === "render_only") return "render";
  return "advisory";
}

export function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** API order is oldest→newest; default selection is the newest entry. */
export function defaultSelectedOperationId(operations: OperationSummary[]): string | null {
  if (operations.length === 0) return null;
  return operations[operations.length - 1]!.operation_id;
}

export function isZeroImpact(summary: OperationSummary): boolean {
  return (
    summary.strongest_effective_impact === null &&
    summary.affected_version_count === 0 &&
    summary.independent_path_count === 0
  );
}

export function eventTimeFlagLabels(group: AffectedVersion): string[] {
  const labels: string[] = [];
  if (group.general_stale) labels.push("当时已过期");
  if (group.general_blocked) labels.push("当时必须重做");
  if (group.render_blocked) labels.push("当时成片受阻");
  if (labels.length === 0) labels.push("当时没有必须重做的项");
  return labels;
}
