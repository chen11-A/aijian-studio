import { describe, expect, test, vi } from "vitest";

import {
  INVALIDATION_OPERATION_CHANNELS,
  createInvalidationOperationPreload,
  registerInvalidationOperationHandlers,
} from "./invalidation-operation-ipc";

const projectId = `prj_${"1".repeat(32)}`;
const operationId = `ivo_${"2".repeat(32)}`;

describe("invalidation operation IPC boundary", () => {
  test("uses frozen fixed list and get channels from the typed preload helper", async () => {
    expect(INVALIDATION_OPERATION_CHANNELS).toEqual({
      list: "invalidation-operations:list",
      get: "invalidation-operations:get",
    });
    expect(Object.isFrozen(INVALIDATION_OPERATION_CHANNELS)).toBe(true);

    const response = { data: { operation_id: operationId } };
    const invoke = vi.fn().mockResolvedValue(response);
    const preload = createInvalidationOperationPreload(invoke);

    await expect(preload.getInvalidationOperation(projectId, operationId)).resolves.toBe(response);
    await expect(preload.listInvalidationOperations(projectId)).resolves.toBe(response);
    await expect(preload.listInvalidationOperations(projectId, { limit: 1 })).resolves.toBe(response);
    await expect(preload.listInvalidationOperations(projectId, null as never)).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(invoke).toHaveBeenCalledWith("invalidation-operations:get", projectId, operationId);
    expect(invoke).toHaveBeenNthCalledWith(2, "invalidation-operations:list", projectId, {});
    expect(invoke).toHaveBeenNthCalledWith(3, "invalidation-operations:list", projectId, { limit: 1 });
    expect(invoke).toHaveBeenNthCalledWith(4, "invalidation-operations:list", projectId, null);
  });

  test("authorizes the sender before rejecting non-canonical or extra arguments", async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    const client = { getInvalidationOperation: vi.fn(), listInvalidationOperations: vi.fn() };
    const clientFor = vi.fn(() => client);
    registerInvalidationOperationHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      clientFor,
    );

    expect([...listeners]).toHaveLength(2);
    const listener = listeners.get("invalidation-operations:get")!;
    const unauthorized = new Error("sender is not authorized");
    const unauthorizedListeners = new Map<
      string,
      (event: object, ...args: unknown[]) => Promise<unknown>
    >();
    const unauthorizedClientFor = vi.fn(() => {
      throw unauthorized;
    });
    registerInvalidationOperationHandlers<object>(
      (channel, registered) => unauthorizedListeners.set(channel, registered),
      unauthorizedClientFor,
    );
    await expect(
      unauthorizedListeners.get("invalidation-operations:get")!(
        {},
        {},
        "not-an-operation",
        "extra",
      ),
    ).rejects.toBe(unauthorized);
    await expect(
      unauthorizedListeners.get("invalidation-operations:list")!({}, projectId, { limit: 0 }),
    ).rejects.toBe(unauthorized);
    expect(unauthorizedClientFor).toHaveBeenCalledTimes(2);
    expect(unauthorizedClientFor).toHaveBeenNthCalledWith(1, {});
    expect(unauthorizedClientFor).toHaveBeenNthCalledWith(2, {});

    const invalidArgs: unknown[][] = [
      [],
      [projectId],
      [projectId, operationId, "extra"],
      [{}, operationId],
      [[], operationId],
      [`${projectId}\n`, operationId],
      ["../project", operationId],
      [projectId.toUpperCase(), operationId],
      [projectId, {}],
      [projectId, []],
      [projectId, `${operationId}\n`],
      [projectId, "../../operation"],
      [projectId, operationId.toUpperCase()],
    ];
    for (const args of invalidArgs) {
      await expect(listener({}, ...args)).rejects.toThrow("exact canonical arguments");
    }
    expect(clientFor).toHaveBeenCalledTimes(invalidArgs.length);
    expect(client.getInvalidationOperation).not.toHaveBeenCalled();

    const listListener = listeners.get("invalidation-operations:list")!;
    for (const args of [
      [],
      [projectId],
      [projectId, {}, "extra"],
      [projectId, []],
      [projectId, { limit: 0 }],
      [projectId, { limit: 101 }],
      [projectId, { limit: 1.5 }],
      [projectId, { cursor: "ivo_bad" }],
      [projectId, { extra: true }],
      [projectId, undefined],
    ] as unknown[][]) {
      await expect(listListener({}, ...args)).rejects.toThrow("exact canonical arguments");
    }
    expect(client.listInvalidationOperations).not.toHaveBeenCalled();
  });

  test("delegates valid exact keys and propagates downstream failures unchanged", async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    const response = { data: { operation_id: operationId } };
    const downstreamFailure = { kind: "downstream failure" };
    const client = {
      getInvalidationOperation: vi
        .fn()
        .mockResolvedValueOnce(response)
        .mockRejectedValueOnce(downstreamFailure),
      listInvalidationOperations: vi
        .fn()
        .mockResolvedValueOnce(response)
        .mockRejectedValueOnce(downstreamFailure),
    };
    registerInvalidationOperationHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => client,
    );

    const listener = listeners.get(INVALIDATION_OPERATION_CHANNELS.get)!;
    await expect(listener({}, projectId, operationId)).resolves.toBe(response);
    await expect(listener({}, projectId, operationId)).rejects.toBe(downstreamFailure);
    expect(client.getInvalidationOperation).toHaveBeenNthCalledWith(1, projectId, operationId);
    expect(client.getInvalidationOperation).toHaveBeenNthCalledWith(2, projectId, operationId);
    const listListener = listeners.get(INVALIDATION_OPERATION_CHANNELS.list)!;
    const query = { limit: 1 };
    await expect(listListener({}, projectId, query)).resolves.toBe(response);
    await expect(listListener({}, projectId, query)).rejects.toBe(downstreamFailure);
    expect(query).toEqual({ limit: 1 });
    expect(client.listInvalidationOperations).toHaveBeenNthCalledWith(1, projectId, { limit: 1 });
    expect(client.listInvalidationOperations).toHaveBeenNthCalledWith(2, projectId, { limit: 1 });
  });
});
