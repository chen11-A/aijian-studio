import {
  isProbeAssetId,
  isProbeProjectId,
  isProbeVersionId,
  AUDIO_ASSET_PROBE_CHANNELS,
  type AudioAssetProbeReadResult,
  type AudioAssetProbeWriteResult,
} from "./audio-asset-probe-contract";

export type AudioAssetProbeClient = {
  getAudioAssetProbeEvidence(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeReadResult>;
  probeSelectedAudioAssetVersion(
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeWriteResult>;
};
export function registerAudioAssetProbeHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => AudioAssetProbeClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const active = new Set<string>();
  const authorized = (event: TEvent): AudioAssetProbeClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Audio asset probe IPC sender frame is not authorized");
    }
    return client;
  };
  const scope = (args: unknown[]): args is [string, string, string] =>
    isProbeProjectId(args[0]) && isProbeAssetId(args[1]) && isProbeVersionId(args[2]);
  handle(AUDIO_ASSET_PROBE_CHANNELS.get, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args)) {
      throw new Error("Audio asset probe read IPC requires canonical ids");
    }
    const result = await client.getAudioAssetProbeEvidence(args[0], args[1], args[2]);
    if (authorized(event) !== client) throw new Error("Audio probe client changed during readback");
    return result;
  });
  handle(AUDIO_ASSET_PROBE_CHANNELS.probe, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args)) {
      throw new Error("Audio asset probe write IPC requires canonical ids");
    }
    const key = args.join(":");
    if (active.has(key)) return { kind: "PROBE_UNKNOWN" };
    active.add(key);
    try {
      const result = await client.probeSelectedAudioAssetVersion(args[0], args[1], args[2]);
      if (authorized(event) !== client)
        throw new Error("Audio probe client changed during operation");
      return result;
    } finally {
      active.delete(key);
    }
  });
}
