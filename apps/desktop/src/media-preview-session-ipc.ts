import {
  MEDIA_PREVIEW_CHANNELS,
  isMediaPreviewMutation,
  isMediaPreviewResult,
  isMediaPreviewStatusQuery,
  isOpenMediaPreviewCommand,
  isSeekMediaPreviewCommand,
  type MediaPreviewMutation,
  type MediaPreviewResult,
  type MediaPreviewStatusQuery,
  type OpenMediaPreviewCommand,
  type SeekMediaPreviewCommand,
} from "./media-preview-session-contract";

export type MediaPreviewSessionHost = {
  open(command: OpenMediaPreviewCommand): Promise<MediaPreviewResult>;
  play(command: MediaPreviewMutation): Promise<MediaPreviewResult>;
  pause(command: MediaPreviewMutation): Promise<MediaPreviewResult>;
  seek(command: SeekMediaPreviewCommand): Promise<MediaPreviewResult>;
  status(query: MediaPreviewStatusQuery): Promise<MediaPreviewResult>;
  close(command: MediaPreviewMutation): Promise<MediaPreviewResult>;
};

export function registerMediaPreviewSessionHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  host: MediaPreviewSessionHost,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const register = <T>(
    channel: string,
    valid: (value: unknown) => value is T,
    action: (command: T) => Promise<MediaPreviewResult>,
  ): void => {
    handle(channel, async (event, ...args) => {
      if (!isTopLevelFrame(event)) {
        throw new Error("Media preview IPC sender frame is not authorized");
      }
      if (args.length !== 1 || !valid(args[0])) {
        throw new Error("Media preview IPC requires a canonical command");
      }
      try {
        const result = await action(args[0]);
        return isMediaPreviewResult(result) ? result : { kind: "UNKNOWN" };
      } catch {
        // The native command may have executed. A read-only status call can reconcile it.
        return { kind: "UNKNOWN" };
      }
    });
  };
  register(MEDIA_PREVIEW_CHANNELS.open, isOpenMediaPreviewCommand, host.open.bind(host));
  register(MEDIA_PREVIEW_CHANNELS.play, isMediaPreviewMutation, host.play.bind(host));
  register(MEDIA_PREVIEW_CHANNELS.pause, isMediaPreviewMutation, host.pause.bind(host));
  register(MEDIA_PREVIEW_CHANNELS.seek, isSeekMediaPreviewCommand, host.seek.bind(host));
  register(MEDIA_PREVIEW_CHANNELS.status, isMediaPreviewStatusQuery, host.status.bind(host));
  register(MEDIA_PREVIEW_CHANNELS.close, isMediaPreviewMutation, host.close.bind(host));
}
