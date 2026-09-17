import { describe, expect, test, vi } from "vitest";

import {
  EPISODE_CHANNELS,
  createTopLevelEpisodeClientFor,
  registerEpisodeHandlers,
} from "./episode-ipc";

const projectId = `prj_${"1".repeat(32)}`;
const episodeId = `ep_${"2".repeat(32)}`;
const input = { title: "第一集", target_duration_seconds: "90" };

describe("episode IPC boundary", () => {
  test("uses frozen fixed channels", () => {
    expect(EPISODE_CHANNELS).toEqual({
      list: "episodes:list",
      get: "episodes:get",
      create: "episodes:create",
    });
    expect(Object.isFrozen(EPISODE_CHANNELS)).toBe(true);
  });

  test("authorizes the sender before rejecting malformed or extra arguments", async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    const unauthorized = new Error("sender is not authorized");
    registerEpisodeHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => {
        throw unauthorized;
      },
    );
    await expect(listeners.get("episodes:create")!({}, "not-a-project", {}, "extra")).rejects.toBe(
      unauthorized,
    );

    const client = { listEpisodes: vi.fn(), getEpisode: vi.fn(), createEpisode: vi.fn() };
    registerEpisodeHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => client,
    );
    const invalid: Array<[string, unknown[]]> = [
      ["episodes:list", [projectId]],
      ["episodes:list", [projectId, { limit: 0 }]],
      ["episodes:list", [`${projectId}\n`, {}]],
      ["episodes:get", [projectId, `${episodeId}\n`]],
      ["episodes:get", [projectId, episodeId, "extra"]],
      ["episodes:create", [projectId, { title: "", target_duration_seconds: "90" }]],
      ["episodes:create", [projectId, { title: "第一集", target_duration_seconds: "0" }]],
      [
        "episodes:create",
        [projectId, { title: "第一集", target_duration_seconds: "90", extra: true }],
      ],
      ["episodes:create", ["../project", input]],
      ["episodes:create", [projectId, input, "extra"]],
    ];
    for (const [channel, args] of invalid) {
      await expect(listeners.get(channel)!({}, ...args)).rejects.toThrow(
        "exact canonical arguments",
      );
    }
    expect(client.listEpisodes).not.toHaveBeenCalled();
    expect(client.getEpisode).not.toHaveBeenCalled();
    expect(client.createEpisode).not.toHaveBeenCalled();
  });

  test("rejects a non-main frame through the same client resolver registered by main", async () => {
    const mainFrame = { name: "main" };
    const childFrame = { name: "child" };
    const client = { listEpisodes: vi.fn(), getEpisode: vi.fn(), createEpisode: vi.fn() };
    const trustedClientFor = vi.fn(() => client);
    const clientFor = createTopLevelEpisodeClientFor(
      trustedClientFor,
      (event: { senderFrame: object }) => event.senderFrame === mainFrame,
    );
    const listeners = new Map<
      string,
      (event: { senderFrame: object }, ...args: unknown[]) => Promise<unknown>
    >();
    registerEpisodeHandlers((channel, listener) => listeners.set(channel, listener), clientFor);

    await expect(
      listeners.get("episodes:get")!({ senderFrame: childFrame }, projectId, episodeId),
    ).rejects.toThrow("sender frame is not authorized");
    expect(trustedClientFor).toHaveBeenCalledWith({ senderFrame: childFrame });
    expect(client.getEpisode).not.toHaveBeenCalled();
  });

  test("delegates valid exact arguments and preserves create outcomes without retrying", async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    const unknown = { kind: "REMOTE_UNKNOWN" } as const;
    const client = {
      listEpisodes: vi.fn().mockResolvedValue({ data: [], request_id: "ok" }),
      getEpisode: vi.fn().mockResolvedValue({ data: {}, request_id: "ok" }),
      createEpisode: vi.fn().mockResolvedValue(unknown),
    };
    registerEpisodeHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => client,
    );
    await listeners.get("episodes:list")!({}, projectId, { limit: 1 });
    await listeners.get("episodes:get")!({}, projectId, episodeId);
    await expect(listeners.get("episodes:create")!({}, projectId, input)).resolves.toBe(unknown);
    expect(client.listEpisodes).toHaveBeenCalledWith(projectId, { limit: 1 });
    expect(client.getEpisode).toHaveBeenCalledWith(projectId, episodeId);
    expect(client.createEpisode).toHaveBeenCalledTimes(1);
    expect(client.createEpisode).toHaveBeenCalledWith(projectId, input);
  });
});
