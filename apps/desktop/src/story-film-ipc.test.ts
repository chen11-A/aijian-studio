import { describe, expect, it, vi } from "vitest";
import { registerStoryFilmHandlers } from "./story-film-ipc";

const projectId = `prj_${"b".repeat(32)}`;
const session = { origin: "http://127.0.0.1:56121", token: "s".repeat(43) };

function handlersFor(mediaBearerFor: () => Promise<string | null>, fetcher: typeof fetch) {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerStoryFilmHandlers(
    (channel, callback) => handlers.set(channel, callback),
    (event: boolean) => event,
    () => session,
    mediaBearerFor,
    fetcher,
  );
  return handlers;
}

describe("story film IPC", () => {
  it("attaches the Grok token only for a subscription film and never returns it", async () => {
    const secret = "grok-access-secret";
    const bearerFor = vi.fn(async () => secret);
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { status: "BLOCKED", message: "先登录", live_call: false },
            request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
          }),
          { status: 200 },
        ),
    );
    const handlers = handlersFor(bearerFor, fetcher);
    await expect(handlers.get("story-film:create")?.(false, projectId, {})).rejects.toThrow(
      "not authorized",
    );
    expect(bearerFor).not.toHaveBeenCalled();
    const input = {
      scene_label: "灯塔夜班",
      narration: "雾散之前，不要回头。",
      provider: "grok_subscription",
      confirmed: false,
    };
    const result = await handlers.get("story-film:create")?.(true, projectId, input);
    expect(JSON.stringify(result)).not.toContain(secret);
    const calls = fetcher.mock.calls as unknown as [string | URL | Request, RequestInit][];
    const headers = calls[0]?.[1].headers as Record<string, string>;
    expect(headers["X-Aivora-Media-Bearer"]).toBe(secret);
    bearerFor.mockClear();
    await handlers.get("story-film:create")?.(true, projectId, { ...input, provider: "stub" });
    expect(bearerFor).not.toHaveBeenCalled();
    const stubHeaders = calls[1]?.[1].headers as Record<string, string>;
    expect(stubHeaders["X-Aivora-Media-Bearer"]).toBeUndefined();
  });
});
