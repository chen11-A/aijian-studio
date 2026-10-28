/** Decide whether the sidecar may call a real image, video, or speech API. */

export function liveMediaSidecarEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const forbid =
    env.AIJIAN_FORBID_LIVE_MEDIA === "1" || env.CI === "true" || env.GITHUB_ACTIONS === "true";
  return forbid ? { AIJIAN_FORBID_LIVE_MEDIA: "1" } : { AIJIAN_ALLOW_LIVE_MEDIA: "1" };
}
