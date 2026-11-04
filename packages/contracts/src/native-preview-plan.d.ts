import type { components } from "./generated";
export type NativePreviewPlanResponse = components["schemas"]["MediaPreviewPlanResponse"];
export type NativePreviewPlanResult =
  | { kind: "READY"; receipt: NativePreviewPlanResponse }
  | { kind: "REJECTED"; code: string; status: number }
  | { kind: "UNKNOWN" };
export interface NativePreviewPlanGateway {
  getNativeMediaPreviewPlan(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<NativePreviewPlanResult>;
}
export function nativePreviewPlanResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  versionId: string,
  requestId: string | null,
): value is NativePreviewPlanResponse;
