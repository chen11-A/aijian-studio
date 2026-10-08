import {
  isAddMediaAssetReferenceCommand,
  isMediaAssetId,
  isMediaAssetVersionId,
  isMediaProjectId,
  isRemoveMediaAssetReferenceCommand,
  MEDIA_ASSET_CHANNELS,
  type AddMediaAssetReferenceCommand,
  type MediaAssetDeleteResult,
  type MediaAssetImportResult,
  type MediaAssetListResult,
  type MediaAssetPreviewResult,
  type MediaAssetReadResult,
  type MediaAssetReferenceResult,
  type MediaAssetUnreferenceResult,
  type RemoveMediaAssetReferenceCommand,
} from "./media-asset-contract";

type MediaAssetClient = {
  listProjectMediaAssets(projectId: string): Promise<MediaAssetListResult>;
  getProjectMediaAsset(projectId: string, assetId: string): Promise<MediaAssetReadResult>;
  importProjectMediaAssetFile(
    projectId: string, assetId: string | null, selectedPath: string,
  ): Promise<MediaAssetImportResult>;
  readProjectMediaAssetPreview(
    projectId: string, assetId: string, versionId: string,
  ): Promise<MediaAssetPreviewResult>;
  addProjectMediaAssetEpisodeReference(
    projectId: string, assetId: string, command: AddMediaAssetReferenceCommand,
  ): Promise<MediaAssetReferenceResult>;
  removeProjectMediaAssetEpisodeReference(
    projectId: string, assetId: string, command: RemoveMediaAssetReferenceCommand,
  ): Promise<MediaAssetUnreferenceResult>;
  deleteProjectMediaAsset(projectId: string, assetId: string): Promise<MediaAssetDeleteResult>;
};

export function registerMediaAssetHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => MediaAssetClient,
  isTopLevelFrame: (event: TEvent) => boolean,
  chooseFile: (event: TEvent) => Promise<string | null>,
): void {
  const authorized = (event: TEvent): MediaAssetClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Media asset IPC sender frame is not authorized");
    }
    return client;
  };
  handle(MEDIA_ASSET_CHANNELS.list, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 1 || !isMediaProjectId(args[0])) {
      throw new Error("Media asset list IPC requires a project id");
    }
    return client.listProjectMediaAssets(args[0]);
  });
  handle(MEDIA_ASSET_CHANNELS.get, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !isMediaProjectId(args[0]) || !isMediaAssetId(args[1])) {
      throw new Error("Media asset read IPC requires canonical ids");
    }
    return client.getProjectMediaAsset(args[0], args[1]);
  });
  const importFromPicker = async (
    event: TEvent, args: unknown[], version: boolean,
  ): Promise<MediaAssetImportResult> => {
    const client = authorized(event);
    if (args.length !== (version ? 2 : 1) || !isMediaProjectId(args[0]) ||
        (version && !isMediaAssetId(args[1]))) {
      throw new Error("Media asset import IPC requires canonical ids");
    }
    let selectedPath: string | null;
    try {
      selectedPath = await chooseFile(event);
    } catch {
      return { kind: "LOCAL_FILE_REJECTED", code: "INVALID_FILE" };
    }
    if (selectedPath === null) return { kind: "CANCELLED" };
    if (authorized(event) !== client) {
      throw new Error("Media asset IPC client changed during file selection");
    }
    return client.importProjectMediaAssetFile(
      args[0], version ? args[1] as string : null, selectedPath,
    );
  };
  handle(MEDIA_ASSET_CHANNELS.import, (event, ...args) =>
    importFromPicker(event, args, false));
  handle(MEDIA_ASSET_CHANNELS.importVersion, (event, ...args) =>
    importFromPicker(event, args, true));
  handle(MEDIA_ASSET_CHANNELS.preview, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !isMediaProjectId(args[0]) ||
        !isMediaAssetId(args[1]) || !isMediaAssetVersionId(args[2])) {
      throw new Error("Media asset preview IPC requires canonical ids");
    }
    return client.readProjectMediaAssetPreview(args[0], args[1], args[2]);
  });
  handle(MEDIA_ASSET_CHANNELS.reference, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !isMediaProjectId(args[0]) || !isMediaAssetId(args[1]) ||
        !isAddMediaAssetReferenceCommand(args[2])) {
      throw new Error("Media asset reference IPC requires canonical arguments");
    }
    return client.addProjectMediaAssetEpisodeReference(args[0], args[1], args[2]);
  });
  handle(MEDIA_ASSET_CHANNELS.unreference, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !isMediaProjectId(args[0]) || !isMediaAssetId(args[1]) ||
        !isRemoveMediaAssetReferenceCommand(args[2])) {
      throw new Error("Media asset unreference IPC requires canonical arguments");
    }
    return client.removeProjectMediaAssetEpisodeReference(args[0], args[1], args[2]);
  });
  handle(MEDIA_ASSET_CHANNELS.delete, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !isMediaProjectId(args[0]) || !isMediaAssetId(args[1])) {
      throw new Error("Media asset delete IPC requires canonical ids");
    }
    return client.deleteProjectMediaAsset(args[0], args[1]);
  });
}
