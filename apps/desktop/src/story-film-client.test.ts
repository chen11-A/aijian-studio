import { describe, expect, it, vi } from "vitest";
import { createStoryFilmClient, parseStoryFilmCreate } from "./story-film-client";

const origin = "http://127.0.0.1:56121";
const token = "t".repeat(43);
const projectId = `prj_${"a".repeat(32)}`;

describe("story film client", () => {
  it("plans and creates without putting a media token in the body", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          data: { status: "SUCCEEDED", message: "好了", live_call: false },
          request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const client = createStoryFilmClient(
      fetcher,
      { origin, token },
      () => "11111111-1111-4111-8111-111111111111",
    );
    await client.plan(projectId);
    const bearer = "media-secret";
    const created = await client.create(
      projectId,
      {
        scene_label: "灯塔夜班",
        narration: "雾散之前，不要回头。",
        subtitle: "雾城来信",
        provider: "grok_subscription",
        confirmed: false,
      },
      bearer,
    );
    expect(created).toMatchObject({ data: { status: "SUCCEEDED", live_call: false } });
    expect(JSON.stringify(created)).not.toContain(bearer);
    expect(calls[0]?.url).toBe(`${origin}/api/v1/projects/${projectId}/story-film/plan`);
    expect(calls[1]?.url).toBe(`${origin}/api/v1/projects/${projectId}/story-film`);
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers["X-Aivora-Media-Bearer"]).toBe(bearer);
    expect(headers["Idempotency-Key"]).toBe("story-film:v1:11111111-1111-4111-8111-111111111111");
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(String(calls[1]?.init?.body)).not.toContain(bearer);
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      provider: "grok_subscription",
      confirmed: false,
    });
  });

  it("surfaces a finished Chinese reason when the service responds with an error", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              status: "FAILED",
              message: "画面、视频和配音都已经做好。整理视频时没有成功，可以重试。",
            },
            request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
          }),
          { status: 500 },
        ),
    );
    const client = createStoryFilmClient(
      fetcher,
      { origin, token },
      () => "11111111-1111-4111-8111-111111111111",
    );
    await expect(client.progress(projectId)).rejects.toThrow("整理视频时没有成功");
  });

  it("sends regenerate only when the user asks for a new generation", async () => {
    const calls: { body?: string }[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(
        JSON.stringify({
          data: { status: "SUCCEEDED", message: "好了" },
          request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        }),
        { status: 200 },
      );
    });
    const client = createStoryFilmClient(
      fetcher,
      { origin, token },
      () => "11111111-1111-4111-8111-111111111111",
    );
    await client.create(projectId, {
      scene_label: "灯塔",
      narration: "一句旁白",
      provider: "stub",
      confirmed: false,
      regenerate: true,
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ regenerate: true });
    expect(() =>
      parseStoryFilmCreate({
        scene_label: "灯塔",
        narration: "一句旁白",
        provider: "stub",
        confirmed: false,
        regenerate: "yes",
      }),
    ).toThrow("Invalid story film request");
  });

  it("rejects a request that tries to carry a token field", () => {
    expect(() =>
      parseStoryFilmCreate({
        scene_label: "灯塔",
        narration: "一句旁白",
        provider: "stub",
        confirmed: false,
        mediaBearer: "nope",
      }),
    ).toThrow("Invalid story film request");
  });
});
