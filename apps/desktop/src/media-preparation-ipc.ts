import {
  MEDIA_PREPARATION_CHANNELS,
  mediaCommand,
  mediaScope,
  mediaVersionId,
  type MediaPreparationGateway,
} from "@aijian/contracts/media-preparation";

export function registerMediaPreparationHandlers<T>(
  handle: (c: string, f: (e: T, ...a: unknown[]) => Promise<unknown>) => void,
  clientFor: (e: T) => MediaPreparationGateway,
  top: (e: T) => boolean,
): void {
  for (const [kind, channel] of Object.entries(MEDIA_PREPARATION_CHANNELS))
    handle(channel, async (event, ...args) => {
      const client = clientFor(event);
      if (!top(event)) throw new Error("Unauthorized preparation frame");
      if (args.length !== 3 || !mediaScope(args[0], args[1]))
        throw new Error("Invalid preparation scope");
      const [p, e, value] = args as [string, string, unknown];
      if (kind === "list") {
        if (value !== undefined && !mediaVersionId(value))
          throw new Error("Invalid preparation cursor");
        return client.listMediaPreparations(p, e, value as string | undefined);
      }
      if (kind === "get") {
        if (!mediaVersionId(value)) throw new Error("Invalid preparation version");
        return client.getMediaPreparation(p, e, value);
      }
      if (!mediaCommand(value, p, e)) throw new Error("Invalid original preparation command");
      return kind === "save"
        ? client.saveMediaPreparation(p, e, value)
        : client.getMediaPreparationOperation(p, e, value);
    });
}
