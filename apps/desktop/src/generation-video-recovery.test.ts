import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { generationVideoRecovery } from "./generation-video-recovery";

const project = `prj_${"a".repeat(32)}`;
const attempt = "b".repeat(32);
const identity = { accountSha256: "c".repeat(64), bearer: "synthetic-private" };
const session = () => ({ origin: "http://127.0.0.1:43131", token: "synthetic-sidecar" });
const data = Buffer.from("original recovered bytes");
const file = {
  fileName: `recovered-${attempt}.mp4`,
  sha256: createHash("sha256").update(data).digest("hex"),
  bytes: data.length,
};
const result = { kind: "RECOVERED", attemptId: attempt, file };
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function destination() {
  const directory = await mkdtemp(join(tmpdir(), "aivora-recovered-"));
  directories.push(directory);
  return join(directory, "saved.mp4");
}

it("signs exact empty-body account requests and exposes only curated local attempts", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toMatchObject({ "X-Aivora-Media-Bearer": identity.bearer });
    const headers = init?.headers as Record<string, string>;
    const attestation = JSON.parse(
      Buffer.from(headers["X-Aivora-Generation-Account"]!, "base64url").toString(),
    );
    expect(attestation.account).toBe(identity.accountSha256);
    return Response.json({
      kind: "ATTEMPTS",
      items: [{ attemptId: attempt, state: "RECOVERED", file }],
      hasMore: false,
    });
  });
  expect(
    await generationVideoRecovery(fetcher, session, async () => identity, project, "list"),
  ).toEqual({
    kind: "ATTEMPTS",
    items: [{ attemptId: attempt, state: "RECOVERED", file }],
    hasMore: false,
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("only explicitly recovers one opaque attempt and does not turn accepted work into success", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.method).toBe("POST");
    return Response.json({ kind: "UNKNOWN", attemptId: attempt, reason: "WAITING" });
  });
  expect(
    await generationVideoRecovery(
      fetcher,
      session,
      async () => identity,
      project,
      "recover",
      attempt,
    ),
  ).toEqual({ kind: "UNKNOWN", attemptId: attempt, reason: "WAITING" });
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(
    generationVideoRecovery(
      fetcher,
      session,
      async () => identity,
      project,
      "recover",
      "https://secret.invalid/id",
    ),
  ).rejects.toThrow("Invalid video recovery scope");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("requires an actual fresh account pair; switching accounts or retiring the document rejects a late result", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));
  expect(
    await generationVideoRecovery(
      fetcher,
      session,
      async () => "bare-token",
      project,
      "recover",
      attempt,
    ),
  ).toEqual({ kind: "FAILED", code: "ACCOUNT_UNAVAILABLE" });
  expect(fetcher).not.toHaveBeenCalled();
  const media = vi
    .fn()
    .mockResolvedValueOnce(identity)
    .mockResolvedValue({ ...identity, accountSha256: "d".repeat(64) });
  expect(
    await generationVideoRecovery(fetcher, session, media, project, "recover", attempt),
  ).toEqual({ kind: "FAILED", code: "ACCOUNT_UNAVAILABLE" });
  let current = true;
  fetcher.mockImplementationOnce(async () => {
    current = false;
    return Response.json(result);
  });
  expect(
    await generationVideoRecovery(
      fetcher,
      session,
      async () => identity,
      project,
      "recover",
      attempt,
      undefined,
      () => current,
    ),
  ).toEqual({ kind: "FAILED", code: "UNAVAILABLE" });
});

it("saves only actual verified bytes after a native user choice, never overwrites existing files", async () => {
  const path = await destination();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method).toBe("GET");
    return String(input).endsWith("/file") ? new Response(data) : Response.json(result);
  });
  const choose = vi.fn(async (name: string) => {
    expect(name).toBe(file.fileName);
    return path;
  });
  expect(
    await generationVideoRecovery(
      fetcher,
      session,
      async () => identity,
      project,
      "save",
      attempt,
      choose,
    ),
  ).toEqual({ kind: "SAVED", file });
  expect(await readFile(path)).toEqual(data);
  await writeFile(path, "existing bytes");
  expect(
    await generationVideoRecovery(
      fetcher,
      session,
      async () => identity,
      project,
      "save",
      attempt,
      choose,
    ),
  ).toEqual({ kind: "FAILED", code: "WRITE_UNCONFIRMED" });
  expect((await readFile(path)).toString()).toBe("existing bytes");
});

it("native cancellation performs no download; altered or oversized bytes are not written", async () => {
  const path = await destination();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));
  expect(
    await generationVideoRecovery(
      fetcher,
      session,
      async () => identity,
      project,
      "save",
      attempt,
      async () => null,
    ),
  ).toEqual({ kind: "CANCELLED" });
  expect(fetcher).toHaveBeenCalledOnce();
  for (const changed of [
    new Response("bad"),
    new Response(data, { headers: { "content-length": String(81 * 1024 * 1024) } }),
  ]) {
    fetcher.mockImplementation(async (input) =>
      String(input).endsWith("/file") ? changed : Response.json(result),
    );
    expect(
      await generationVideoRecovery(
        fetcher,
        session,
        async () => identity,
        project,
        "save",
        attempt,
        async () => path,
      ),
    ).toEqual({ kind: "FAILED", code: "UNAVAILABLE" });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("rejects paths/provider IDs/unbounded or mismatched metadata from a sidecar result", async () => {
  for (const value of [
    { ...result, path: "/private" },
    { ...result, attemptId: "d".repeat(32) },
    { ...result, file: { ...file, fileName: "../outside.mp4" } },
    { ...result, file: { ...file, bytes: 81 * 1024 * 1024 } },
  ]) {
    expect(
      await generationVideoRecovery(
        vi.fn(async () => Response.json(value)),
        session,
        async () => identity,
        project,
        "recover",
        attempt,
      ),
    ).toEqual({ kind: "FAILED", code: "UNAVAILABLE" });
  }
});

it("authorizes fixed main-frame IPC and exact scope before touching account or HTTP", async () => {
  const { registerStoryFilmHandlers } = await import("./story-film-ipc.js");
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  const media = vi.fn(async () => identity);
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(result));
  registerStoryFilmHandlers(
    (name, run) => handlers.set(name, run),
    (event: boolean) => event,
    session,
    media,
    fetcher,
  );
  await expect(handlers.get("story-film:video-recover")!(false, project, attempt)).rejects.toThrow(
    "not authorized",
  );
  await expect(
    handlers.get("story-film:video-recover")!(true, project, attempt, "/private/override"),
  ).rejects.toThrow("Invalid video recovery arguments");
  await expect(
    handlers.get("story-film:video-recover")!(true, project, "https://provider/id"),
  ).rejects.toThrow("Invalid video recovery scope");
  expect(media).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(await handlers.get("story-film:video-recover")!(true, project, attempt)).toEqual(result);
});
