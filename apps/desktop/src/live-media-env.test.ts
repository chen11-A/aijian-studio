import { describe, expect, it } from "vitest";
import { liveMediaSidecarEnv } from "./live-media-env";

describe("live media sidecar env", () => {
  it("allows a normal desktop and forbids CI or an explicit block", () => {
    expect(liveMediaSidecarEnv({})).toEqual({ AIJIAN_ALLOW_LIVE_MEDIA: "1" });
    expect(liveMediaSidecarEnv({ AIJIAN_ALLOW_LIVE_MEDIA: "1", CI: "true" })).toEqual({
      AIJIAN_FORBID_LIVE_MEDIA: "1",
    });
    expect(liveMediaSidecarEnv({ GITHUB_ACTIONS: "true" })).toEqual({
      AIJIAN_FORBID_LIVE_MEDIA: "1",
    });
    expect(liveMediaSidecarEnv({ AIJIAN_FORBID_LIVE_MEDIA: "1" })).toEqual({
      AIJIAN_FORBID_LIVE_MEDIA: "1",
    });
  });
});
