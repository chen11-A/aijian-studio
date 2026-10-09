import type { MediaPreviewSessionHost } from "./media-preview-session-ipc";
import type { MediaPreviewResult } from "./media-preview-session-contract";

// No native host executable or plan resolver is included in this source candidate.
// Keep every command fail closed until the pinned plan, binary, and clock are verified.
export function createUnavailableMediaPreviewHost(): MediaPreviewSessionHost {
  const unavailable = async (): Promise<MediaPreviewResult> => ({
    kind: "UNAVAILABLE",
    reason: "NATIVE_HOST_NOT_INSTALLED",
  });
  return {
    open: unavailable,
    play: unavailable,
    pause: unavailable,
    seek: unavailable,
    status: unavailable,
    close: unavailable,
  };
}
