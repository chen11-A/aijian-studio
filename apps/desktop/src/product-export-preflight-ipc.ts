import {
  isProductExportEpisodeId,
  isProductExportPreflightRequest,
  isProductExportProjectId,
  PRODUCT_EXPORT_PREFLIGHT_CHANNEL,
  type ProductExportPreflightRequest,
  type ProductExportPreflightResult,
} from "./product-export-preflight-contract";

type ProductExportPreflightClient = {
  preflightProductExport(
    projectId: string,
    episodeId: string,
    input: ProductExportPreflightRequest,
  ): Promise<ProductExportPreflightResult>;
};

export function registerProductExportPreflightHandler<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => ProductExportPreflightClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  handle(PRODUCT_EXPORT_PREFLIGHT_CHANNEL, async (event, ...args) => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Product export preflight IPC sender frame is not authorized");
    }
    const [projectId, episodeId, input] = args;
    if (args.length !== 3 || !isProductExportProjectId(projectId) ||
        !isProductExportEpisodeId(episodeId) || !isProductExportPreflightRequest(input)) {
      throw new Error("Product export preflight IPC requires canonical arguments");
    }
    return client.preflightProductExport(projectId, episodeId, input);
  });
}
