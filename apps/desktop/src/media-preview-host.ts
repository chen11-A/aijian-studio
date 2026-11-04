import type { MediaPreviewSessionHost } from "./media-preview-session-ipc";
import type { MediaPreviewResult } from "./media-preview-session-contract";

// The read-only plan bridge does not install a native executable or authorize launch.
// Keep commands closed until a trusted launch resolver, binary, and clock are verified.
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
