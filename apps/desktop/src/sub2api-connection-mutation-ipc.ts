import {
  SUB2API_MUTATION_CHANNELS,
  isEditSub2APIMetadataCommand,
  isRotateSub2APIKeyCommand,
  isSub2APIConnectionId,
  isSub2APIRotationOperationId,
  type EditSub2APIMetadataCommand,
  type RotateSub2APIKeyCommand,
  type Sub2APIConnectionMutationResult,
  type Sub2APIRotationReadResult,
} from "./sub2api-connection-mutation-contract";

type Sub2APIMutationClient = {
  editSub2APIMetadata(
    connectionId: string,
    command: EditSub2APIMetadataCommand,
  ): Promise<Sub2APIConnectionMutationResult>;
  rotateSub2APIKey(
    connectionId: string,
    command: RotateSub2APIKeyCommand,
  ): Promise<Sub2APIConnectionMutationResult>;
  readSub2APIKeyRotation(
    connectionId: string,
    operationId: string,
  ): Promise<Sub2APIRotationReadResult>;
};

export function registerSub2APIConnectionMutationHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => Sub2APIMutationClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): Sub2APIMutationClient => {
    if (!isTopLevelFrame(event)) {
      throw new Error("Sub2API mutation IPC sender frame is not authorized");
    }
    return clientFor(event);
  };
  handle(SUB2API_MUTATION_CHANNELS.edit, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 2 ||
      !isSub2APIConnectionId(args[0]) ||
      !isEditSub2APIMetadataCommand(args[1])
    ) {
      throw new Error("Sub2API metadata edit requires canonical arguments");
    }
    return client.editSub2APIMetadata(args[0], args[1]);
  });
  handle(SUB2API_MUTATION_CHANNELS.rotate, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 2 ||
      !isSub2APIConnectionId(args[0]) ||
      !isRotateSub2APIKeyCommand(args[1])
    ) {
      throw new Error("Sub2API credential rotation requires canonical arguments");
    }
    return client.rotateSub2APIKey(args[0], args[1]);
  });
  handle(SUB2API_MUTATION_CHANNELS.readRotation, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 2 ||
      !isSub2APIConnectionId(args[0]) ||
      !isSub2APIRotationOperationId(args[1])
    ) {
      throw new Error("Sub2API rotation readback requires canonical ids");
    }
    return client.readSub2APIKeyRotation(args[0], args[1]);
  });
}
