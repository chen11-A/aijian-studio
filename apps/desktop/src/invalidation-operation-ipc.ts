import type { InvalidationOperationResponse } from "@aijian/contracts/invalidation-operation";

import type { LocalApiClient } from "./api-client";

export const INVALIDATION_OPERATION_CHANNELS = Object.freeze({
  get: "invalidation-operations:get",
} as const);

type InvalidationOperationClient = Pick<LocalApiClient, "getInvalidationOperation">;
type InvalidationOperationInvoke = (
  channel: string,
  projectId: string,
  operationId: string,
) => Promise<unknown>;

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^ivo_[0-9a-f]{32}$/;

export function createInvalidationOperationPreload(invoke: InvalidationOperationInvoke): {
  getInvalidationOperation(
    projectId: string,
    operationId: string,
  ): Promise<InvalidationOperationResponse>;
} {
  return {
    getInvalidationOperation: (projectId, operationId) =>
      invoke(
        INVALIDATION_OPERATION_CHANNELS.get,
        projectId,
        operationId,
      ) as Promise<InvalidationOperationResponse>,
  };
}

export function registerInvalidationOperationHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => InvalidationOperationClient,
): void {
  handle(INVALIDATION_OPERATION_CHANNELS.get, async (event, ...args) => {
    const client = clientFor(event);
    if (
      args.length !== 2 ||
      typeof args[0] !== "string" ||
      !PROJECT_ID_PATTERN.test(args[0]) ||
      typeof args[1] !== "string" ||
      !OPERATION_ID_PATTERN.test(args[1])
    ) {
      throw new Error("Invalidation operation IPC requires exact canonical arguments");
    }
    return client.getInvalidationOperation(args[0], args[1]);
  });
}
