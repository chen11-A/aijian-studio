import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerStoryFilmHandlers, type StoryFilmFiles } from "./story-film-ipc";

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

  it("reads, reveals, and copies only a file inside the story-film folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-film-"));
    const films = join(root, "story-films");
    mkdirSync(films);
    const film = join(films, "clip.mp4");
    writeFileSync(film, Buffer.from("mp4-bytes"));
    const outside = join(root, "secret.mp4");
    writeFileSync(outside, Buffer.from("nope"));
    writeFileSync(join(films, "note.txt"), Buffer.from("text"));
    symlinkSync(outside, join(films, "escape.mp4"));
    const copied: string[] = [];
    const revealed: string[] = [];
    const files: StoryFilmFiles = {
      workspace: () => root,
      byteLength: async (path) => {
        const { stat } = await import("node:fs/promises");
        return (await stat(path)).size;
      },
      read: async (path) => new Uint8Array(await (await import("node:fs/promises")).readFile(path)),
      reveal: (path) => {
        revealed.push(path);
      },
      chooseExport: async (name) => join(root, name),
      copy: async (source, destination) => {
        copied.push(`${source} -> ${destination}`);
        const { copyFile } = await import("node:fs/promises");
        await copyFile(source, destination);
      },
    };
    const handlers = handlersFor(async () => null, vi.fn());
    registerStoryFilmHandlers(
      (channel, callback) => handlers.set(channel, callback),
      (event: boolean) => event,
      () => session,
      async () => null,
      vi.fn(),
      files,
    );
    const bytes = await handlers.get("story-film:read")?.(true, film);
    expect(Array.from(bytes as Uint8Array)).toEqual([109, 112, 52, 45, 98, 121, 116, 101, 115]);
    const voice = join(films, "voice.mp3");
    writeFileSync(voice, Buffer.from("mp3"));
    const heard = await handlers.get("story-film:read")?.(true, voice);
    expect(Array.from(heard as Uint8Array)).toEqual([109, 112, 51]);
    await expect(handlers.get("story-film:read")?.(false, film)).rejects.toThrow("not authorized");
    await expect(handlers.get("story-film:read")?.(true, outside)).rejects.toThrow(
      "Invalid story film path",
    );
    await expect(handlers.get("story-film:read")?.(true, `${films}/../secret.mp4`)).rejects.toThrow(
      "Invalid story film path",
    );
    await expect(
      handlers.get("story-film:read")?.(true, join(films, "escape.mp4")),
    ).rejects.toThrow("Invalid story film path");
    await expect(handlers.get("story-film:read")?.(true, join(films, "note.txt"))).rejects.toThrow(
      "Invalid story film path",
    );
    await handlers.get("story-film:reveal")?.(true, film);
    expect(revealed).toEqual([film]);
    const exported = await handlers.get("story-film:export")?.(true, film);
    expect(exported).toEqual({ ok: true });
    expect(copied[0]).toContain(film);
    files.chooseExport = async () => null;
    expect(await handlers.get("story-film:export")?.(true, film)).toEqual({
      ok: false,
      cancelled: true,
    });
    files.byteLength = async () => 80 * 1024 * 1024 + 1;
    await expect(handlers.get("story-film:read")?.(true, film)).rejects.toThrow("too large");
  });
});
