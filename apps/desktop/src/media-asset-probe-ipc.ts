import {
  isProbeAssetId,
  isProbeProjectId,
  isProbeVersionId,
  MEDIA_ASSET_PROBE_CHANNELS,
  type MediaAssetProbeReadResult,
  type MediaAssetProbeWriteResult,
} from "./media-asset-probe-contract";

type MediaAssetProbeClient = {
  getMediaAssetProbeEvidence(
    projectId: string, assetId: string, versionId: string,
  ): Promise<MediaAssetProbeReadResult>;
  probeSelectedMediaAssetVersion(
    projectId: string, assetId: string, versionId: string,
  ): Promise<MediaAssetProbeWriteResult>;
};
export function registerMediaAssetProbeHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => MediaAssetProbeClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): MediaAssetProbeClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Media asset probe IPC sender frame is not authorized");
    }
    return client;
  };
  const scope = (args: unknown[]): args is [string, string, string] =>
    isProbeProjectId(args[0]) && isProbeAssetId(args[1]) && isProbeVersionId(args[2]);
  handle(MEDIA_ASSET_PROBE_CHANNELS.get, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args)) {
      throw new Error("Media asset probe read IPC requires canonical ids");
    }
    return client.getMediaAssetProbeEvidence(args[0], args[1], args[2]);
  });
  handle(MEDIA_ASSET_PROBE_CHANNELS.probe, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args)) {
      throw new Error("Media asset probe write IPC requires canonical ids");
    }
    return client.probeSelectedMediaAssetVersion(args[0], args[1], args[2]);
  });
}
