import type { NativePreviewPlanClient } from "./media-preview-plan-client";
import {
  isAssemblyProjectId,
  isAssemblyEpisodeId,
  isAssemblyVersionId,
} from "./episode-media-assembly-contract";

export const MEDIA_PREVIEW_PLAN_CHANNEL = "media-preview:plan";
export function registerNativePreviewPlanHandler<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => NativePreviewPlanClient,
  authorized: (event: TEvent) => boolean,
  authorityFor: (event: TEvent) => unknown = () => null,
) {
  handle(MEDIA_PREVIEW_PLAN_CHANNEL, async (event, ...args) => {
    const client = clientFor(event);
    if (
      !authorized(event) ||
      args.length !== 3 ||
      !isAssemblyProjectId(args[0]) ||
      !isAssemblyEpisodeId(args[1]) ||
      !isAssemblyVersionId(args[2])
    )
      throw new Error("Native preview plan requires main-document exact ids");
    const authority = authorityFor(event);
    const result = await client.getNativeMediaPreviewPlan(args[0], args[1], args[2]);
    if (!authorized(event) || clientFor(event) !== client || authorityFor(event) !== authority)
      throw new Error("Native preview plan document changed during read");
    return result;
  });
}
